const base = require('./electron-builder-config');
module.exports = {
    ...base,
    productName: 'BlueBubbles Candidate',
    appId: 'dev.metaember.bluebubbles.candidate',
    extraMetadata: { main: './dist/shadow.js', version: '1.9.9-contact.1' },
    directories: { ...base.directories, output: 'candidate-build' },
    mac: { ...base.mac, identity: null, publish: null, target: [{ target: 'dir', arch: ['x64'] }] }
};
