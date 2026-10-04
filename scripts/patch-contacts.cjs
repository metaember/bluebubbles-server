// Apply only to the locked 1.7.2 dependency, before compiling native modules.
const fs = require('node:fs');
const path = require('node:path');
const root = path.dirname(require.resolve('node-mac-contacts/package.json'));
if (require(path.join(root, 'package.json')).version !== '1.7.2') {
    throw new Error('Review the contacts patch before changing node-mac-contacts version');
}
function patch(file, edits) {
    const target = path.join(root, file);
    let source = fs.readFileSync(target, 'utf8');
    for (const [before, after] of edits) {
        if (source.includes(after)) continue;
        if (source.split(before).length !== 2) throw new Error(`Unexpected contacts source: ${file}`);
        source = source.replace(before, after);
    }
    fs.writeFileSync(target, source);
}
patch('contacts.mm', [
    ['#include <napi.h>', '#include <napi.h>\n#include <atomic>'],
    ['Napi::Reference<Napi::Array> contacts_ref;',
     'Napi::Reference<Napi::Array> contacts_ref;\nstd::atomic<bool> contacts_dirty{true};'],
    ['  if (!contacts_ref.IsEmpty())\n    return contacts_ref.Value();',
     '  // Touch N-API references only on the JavaScript thread.\n  if (contacts_dirty.exchange(false)) contacts_ref.Reset();\n  if (!contacts_ref.IsEmpty())\n    return contacts_ref.Value();'],
    ['                if ([info count] == 0)\n                  return;\n\n                contacts_ref.Reset();',
     '                // Empty userInfo is still a valid contact-store change.\n                contacts_dirty.store(true);'],
    ['// Initializes all functions exposed to JS.',
     'Napi::Value InvalidateCache(const Napi::CallbackInfo &info) {\n  contacts_dirty.store(true);\n  return info.Env().Undefined();\n}\n\n// Initializes all functions exposed to JS.'],
    ['Napi::Object Init(Napi::Env env, Napi::Object exports) {',
     'Napi::Object Init(Napi::Env env, Napi::Object exports) {\n  exports.Set("invalidateCache", Napi::Function::New(env, InvalidateCache));']
]);
patch('index.js', [
    ['module.exports = {\n  listener,',
     'module.exports = {\n  invalidateCache: contacts.invalidateCache,\n  listener,']
]);
console.log('Applied node-mac-contacts 1.7.2 cache invalidation patch');
