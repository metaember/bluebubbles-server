const { test } = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const root = path.join(__dirname, '..');
const filename = path.join(root, 'packages/server/src/server/api/lib/ContactCache.ts');
const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText;
const mod = new Module(filename, module);
mod._compile(compiled, filename);
const { ContactCache } = mod.exports;

function fixture() {
    let time = 0;
    let data = [{ id: 'one', note: 'fixture' }];
    let stored = null;
    let authorized = true;
    let fail = false;
    let refreshes = 0;
    let setups = 0;
    const listener = new EventEmitter();
    listener.setup = () => { setups++; };
    const native = {
        listener,
        getAuthStatus: () => authorized ? 'Authorized' : 'Denied',
        invalidateCache: () => { stored = null; },
        getAllContacts: properties => {
            assert.deepEqual(properties, ['note']);
            if (fail) throw new Error('fixture failure');
            if (!stored) { stored = structuredClone(data); refreshes++; }
            return stored;
        }
    };
    const cache = new ContactCache(native, ['note'], () => time, 60_000);
    return { cache, native, listener,
        advance: value => { time += value; },
        data: value => { data = value; },
        authorize: value => { authorized = value; },
        fail: value => { fail = value; },
        refreshes: () => refreshes, setups: () => setups };
}

test('warm reads use cache, missed changes refresh exactly at the TTL boundary', () => {
    const f = fixture();
    assert.equal(f.cache.read()[0].id, 'one');
    f.data([{ id: 'new-card' }]);
    f.advance(59_999);
    assert.equal(f.cache.read()[0].id, 'one');
    f.advance(1);
    assert.equal(f.cache.read()[0].id, 'new-card');
    assert.equal(f.refreshes(), 2);
    assert.equal(f.setups(), 1);
});
test('explicit refresh sees an edit immediately without a restart or notification', () => {
    const f = fixture(); f.cache.read();
    f.data([{ id: 'one', note: 'edited' }]);
    assert.equal(f.cache.read(true)[0].note, 'edited');
});
test('repeated change notifications remain subscribed, including empty payloads', () => {
    const f = fixture(); f.cache.read();
    for (let i = 0; i < 3; i++) {
        f.data([{ id: String(i) }]);
        f.listener.emit('contact-changed');
        assert.equal(f.cache.read()[0].id, String(i));
    }
    assert.equal(f.setups(), 1);
});
test('an authoritative empty store replaces a previous nonempty store', () => {
    const f = fixture(); f.cache.read(); f.data([]);
    assert.deepEqual(f.cache.read(true), []);
});
test('permission revocation errors instead of reporting an empty successful snapshot', () => {
    const f = fixture(); f.cache.read(); f.authorize(false);
    assert.throws(() => f.cache.read(), /permission/);
    f.authorize(true); f.data([{ id: 'restored' }]);
    assert.equal(f.cache.read()[0].id, 'restored');
});
test('failed refresh does not advance expiry or serve stale data', () => {
    const f = fixture(); f.cache.read(); f.advance(60_000); f.fail(true);
    assert.throws(() => f.cache.read(), /fixture failure/);
    f.fail(false); f.data([{ id: 'retry' }]);
    assert.equal(f.cache.read()[0].id, 'retry');
});
test('native invalidation rehydrates the complete optional field set', () => {
    const f = fixture(); f.cache.read(); f.native.invalidateCache();
    f.data([{ id: 'one', note: 'native-invalidated' }]);
    assert.equal(f.cache.read()[0].note, 'native-invalidated');
});
test('native patch covers empty notifications and avoids N-API calls from notification thread', () => {
    const nativePath = path.join(path.dirname(require.resolve('node-mac-contacts/package.json')), 'contacts.mm');
    const source = fs.readFileSync(nativePath, 'utf8');
    assert.match(source, /contacts_dirty\.exchange\(false\)/);
    assert.match(source, /exports.Set\("invalidateCache"/);
    const notification = source.split('usingBlock:^(NSNotification *notification) {')[1].split('}];')[0];
    assert.match(notification, /contacts_dirty\.store\(true\)/);
    assert.doesNotMatch(notification, /contacts_ref|\[info count\]/);
});
