const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const ts = require('typescript');

async function invokeRoute(file, query, expectedMethod, expectedArgs) {
    const source = fs.readFileSync(path.join(__dirname, '../../src/model/service/api/iptv', file), 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
    }).outputText;
    const calls = [];
    const model = {
        getEpg: async (...args) => calls.push(['getEpg', ...args]),
        getChannelList: async (...args) => calls.push(['getChannelList', ...args]),
    };
    const container = {
        get: name => (name === 'IIPTVApiModel' ? model : { getConfig: () => ({ subDirectory: '' }) }),
    };
    const module = { exports: {} };
    const imports = {
        '../../ModelContainer': { default: container },
        '../../../ModelContainer': { default: container },
        '../../api': { isSecureProtocol: () => false, responseServerError: () => assert.fail('route failed') },
        '../../../api': { isSecureProtocol: () => false, responseServerError: () => assert.fail('route failed') },
    };
    vm.runInNewContext(compiled, {
        module,
        exports: module.exports,
        require: name => imports[name] || {},
    });
    const response = { setHeader() {}, status() {}, end() {} };
    await module.exports.get({ query, headers: { host: 'localhost' } }, response);
    assert.equal(calls[0][0], expectedMethod);
    const numericArgIndex = expectedMethod === 'getEpg' ? 1 : 3;
    assert.equal(calls[0][numericArgIndex], expectedArgs[0]);
}

(async () => {
    await invokeRoute('epg.xml.ts', { days: 1e21 }, 'getEpg', [1e21]);
    await invokeRoute('epg.xml.ts', { days: '12' }, 'getEpg', [12]);
    await invokeRoute('channel.m3u8.ts', { mode: 1e21 }, 'getChannelList', [1e21]);
    await invokeRoute('channel.m3u8.ts', { mode: '3' }, 'getChannelList', [3]);
    console.log('IPTV query value tests passed');
})().catch(error => {
    console.error(error);
    process.exitCode = 1;
});
