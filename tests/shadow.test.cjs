const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const Module = require('node:module');
const root = path.join(__dirname, '..');
const filename = path.join(root, 'packages/server/src/shadow-policy.ts');
const mod = new Module(filename, module);
mod._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }
}).outputText, filename);
const policy = mod.exports.shadowReadPolicy('fixture-token');

test('candidate requires header authentication; query tokens do not authenticate', async () => {
    for (const authorization of ['', 'Bearer wrong', 'Bearer fixture-tokenX']) {
        let called = false;
        const ctx = { method: 'GET', query: { password: 'fixture-token' }, get: () => authorization };
        await policy(ctx, async () => { called = true; });
        assert.equal(ctx.status, 401); assert.equal(called, false);
    }
});
test('candidate rejects every non-GET method before invoking handlers', async () => {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']) {
        let called = false;
        const ctx = { method, get: () => 'Bearer fixture-token' };
        await policy(ctx, async () => { called = true; });
        assert.equal(ctx.status, 405); assert.equal(called, false);
    }
});
test('authenticated GET reaches the registered handler', async () => {
    let called = false;
    await policy({ method: 'GET', get: () => 'Bearer fixture-token' }, async () => { called = true; });
    assert.equal(called, true);
});
test('errors disclose neither sensitive exception contents nor a successful empty result', async () => {
    const ctx = { method: 'GET', get: () => 'Bearer fixture-token' };
    await policy(ctx, async () => { throw new Error('sensitive fixture'); });
    assert.equal(ctx.status, 503);
    assert.doesNotMatch(JSON.stringify(ctx.body), /sensitive|data/);
});
test('candidate mounts only reviewed read controllers and binds loopback', () => {
    const source = fs.readFileSync(path.join(root, 'packages/server/src/shadow-server.ts'), 'utf8');
    assert.match(source, /\.initialize\(true\)/);
    assert.match(source, /koa.listen\(1235, "127.0.0.1"\)/);
    assert.doesNotMatch(source, /startServices|initServer|HttpRoutes|HttpService|SocketServer|loadSettingsFromArgs/);
    const routes = [...source.matchAll(/router\.get\("([^"]+)"/g)].map(m => m[1]);
    assert.deepEqual(routes, ['/shadow/status', '/api/v1/contact', '/api/v1/chat/:guid/message',
        '/api/v1/chat/:guid', '/api/v1/message/count', '/api/v1/message/:guid']);
});
