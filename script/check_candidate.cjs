// Runs on the Mac. Only aggregate results leave this process; never print credentials,
// contact cards, message bodies, or identifiers. No Messages/Contacts writes.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const assert = require('node:assert/strict');
const token = fs.readFileSync(path.join(os.homedir(), 'Library/Application Support/bluebubbles-candidate/shadow-token'), 'utf8').trim();
const base = 'http://127.0.0.1:1235';
let stage = 'boundary checks';
async function request(route, { method = 'GET', authenticated = true } = {}) {
    return fetch(base + route, {
        method, headers: authenticated ? { Authorization: `Bearer ${token}` } : {},
        signal: AbortSignal.timeout(30_000)
    });
}
async function read(route) {
    const response = await request(route);
    if (!response.ok) throw new Error('Candidate read failed');
    return response.json();
}
const db = path.join(os.homedir(), 'Library/Messages/chat.db');
function sql(query) {
    return JSON.parse(execFileSync('/usr/bin/sqlite3', ['-readonly', '-json', db, query], {
        encoding: 'utf8', maxBuffer: 10 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe']
    }) || '[]');
}
const quote = value => "'" + String(value).replaceAll("'", "''") + "'";
async function main() {
    assert.equal((await request('/shadow/status', { authenticated: false })).status, 401);
    assert.equal((await request('/api/v1/message/text', { method: 'POST' })).status, 405);
    assert.equal((await request('/api/v1/mac/imessage/restart')).status, 404);
    assert.equal((await request('/socket.io/')).status, 404);
    const status = await read('/shadow/status');
    console.log(JSON.stringify({ status, boundaryChecksPassed: 4 }));
    let blocked = false;
    if (status.contacts === 'Authorized') {
        stage = 'contact reads and expected-name checks';
        const first = (await read('/api/v1/contact?refresh=true')).data;
        const next = (await read('/api/v1/contact')).data;
        assert.deepEqual(first.map(x => x.id).sort(), next.map(x => x.id).sort());
        const names = process.argv.slice(2);
        const found = names.map(name => first.some(card => card.displayName?.toLowerCase() === name.toLowerCase()));
        console.log(JSON.stringify({ contacts: first.length, expectedNames: names.length, expectedNamesFound: found.filter(Boolean).length }));
        assert.ok(found.every(Boolean));
    } else {
        console.log(JSON.stringify({ contactsBlockedByPermission: true }));
        blocked = true;
    }
    if (status.messagesReady) {
        stage = 'native message/text/attachment comparisons';
        // Compare stable native identifiers plus text and attachments, not fuzzy names.
        const messages = sql('SELECT ROWID, guid, text FROM message WHERE text IS NOT NULL ORDER BY ROWID DESC LIMIT 20');
        for (const message of messages) {
            const result = (await read(`/api/v1/message/${encodeURIComponent(message.guid)}?with=attachments`)).data;
            assert.equal(result.guid, message.guid);
            assert.equal(result.originalROWID, message.ROWID);
            assert.equal(result.text, message.text);
            const attachments = sql(`SELECT a.guid FROM attachment a JOIN message_attachment_join j ON j.attachment_id=a.ROWID WHERE j.message_id=${Number(message.ROWID)}`);
            assert.deepEqual(result.attachments.map(a => a.guid).sort(), attachments.map(a => a.guid).sort());
        }
        const chats = sql('SELECT c.guid, MAX(j.message_id) latest FROM chat c JOIN chat_message_join j ON j.chat_id=c.ROWID GROUP BY c.guid ORDER BY latest DESC LIMIT 10');
        stage = 'native recent-chat comparisons';
        for (const chat of chats) {
            const expected = sql(`SELECT DISTINCT m.guid FROM message m JOIN chat_message_join j ON j.message_id=m.ROWID JOIN chat c ON c.ROWID=j.chat_id WHERE c.guid=${quote(chat.guid)} ORDER BY m.date DESC LIMIT 3`);
            const actual = (await read(`/api/v1/chat/${encodeURIComponent(chat.guid)}/message?limit=3&sort=DESC`)).data;
            assert.deepEqual(actual.map(m => m.guid).sort(), expected.map(m => m.guid).sort());
        }
        console.log(JSON.stringify({ nativeMessageComparisons: messages.length, nativeChatComparisons: chats.length, matched: true }));
    } else {
        console.log(JSON.stringify({ messagesBlockedByPermission: true }));
        blocked = true;
    }
    process.exitCode = blocked ? 2 : 0;
}
main().catch(() => {
    // Assertion error objects can include message bodies. Deliberately do not log them.
    console.error(`Candidate verification failed during ${stage}; no personal data exported.`);
    process.exitCode = 1;
});
