const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const filename = path.join(__dirname, '..', '..', 'client', 'src', 'core', 'channels.ts');
const source = fs.readFileSync(filename, 'utf8');
const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    fileName: filename,
}).outputText;
const loaded = { exports: {} };
Function('exports', 'module', output)(loaded.exports, loaded);
const { isMainBroadcastChannel, sortRuleEncodeChannels } = loaded.exports;

const channels = [
    { id: 4, channelType: 'BS', serviceId: 102 },
    { id: 5, channelType: 'CS', serviceId: 200 },
    { id: 1, channelType: 'GR', serviceId: 0x0400 },
    { id: 2, channelType: 'GR', serviceId: 0x0401 },
    { id: 3, channelType: 'BS', serviceId: 101 },
    { id: 6, channelType: 'BS', serviceId: 191 },
];

test('Annict channel priority includes main channels but leaves subchannels in the normal list', () => {
    const sorted = sortRuleEncodeChannels(channels, [2, 3], [1, 2, 3, 4, 5]);
    assert.deepEqual(sorted.map(channel => channel.id), [3, 1, 5, 4, 2, 6]);
});

test('non-Annict reservation priorities retain their existing order', () => {
    const sorted = sortRuleEncodeChannels(channels, [2, 3], []);
    assert.deepEqual(sorted.map(channel => channel.id), [2, 3, 4, 5, 1, 6]);
});

test('non-video and known terrestrial or BS subchannels are not main channels', () => {
    assert.equal(isMainBroadcastChannel({ channelType: 'GR-ALT', serviceId: 0x0401 }), false);
    assert.equal(isMainBroadcastChannel({ channelType: 'BS', serviceId: 142 }), false);
    assert.equal(isMainBroadcastChannel({ channelType: 'BS', serviceId: 101, type: 0xc0 }), false);
    assert.equal(isMainBroadcastChannel({ channelType: 'GR', serviceId: 0x0400 }), true);
});
