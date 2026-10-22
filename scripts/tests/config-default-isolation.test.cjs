const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/Configuration.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath) {
        if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
        if (request === 'js-yaml') return {};
        if (request === 'url-join') return (...parts) => parts.join('/');
        if (request === '../util/EncodeSuspendTime') return { validateEncodeSuspendTimes: () => {} };
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const Configuration = loadedModule.exports.default;

function createFormatter(templateConfig) {
    const formatter = Object.create(Configuration.prototype);
    formatter.templateConfig = templateConfig;
    const noop = () => {};
    formatter.log = { system: { fatal: noop } };
    return formatter;
}

function createConfig(port) {
    return {
        port,
        stream: {
            live: { ts: {} },
            recorded: { ts: {}, encoded: {} },
        },
    };
}

test('each config read gets independent default values and nested stream template fallbacks', () => {
    const templateConfig = {
        stream: {
            live: { ts: { m2ts: { options: ['--copy'] } } },
            recorded: { ts: { webm: { options: ['--webm'] } }, encoded: { hls: { options: ['--hls'] } } },
        },
    };
    const formatter = createFormatter(templateConfig);

    const first = formatter.formatConfig(createConfig(9001));
    first.apiServers.push('custom-server');
    first.recorded[0].name = 'changed';
    first.stream.live.ts.m2ts.options.push('--changed');
    first.stream.recorded.ts.webm.options.push('--changed');

    const second = formatter.formatConfig(createConfig(9002));
    assert.deepEqual(second.apiServers, ['http://localhost:9002']);
    assert.equal(second.recorded[0].name, 'recorded');
    assert.deepEqual(second.stream.live.ts.m2ts, { options: ['--copy'] });
    assert.deepEqual(second.stream.recorded.ts.webm, { options: ['--webm'] });
    assert.deepEqual(second.stream.recorded.encoded.hls, { options: ['--hls'] });

    assert.deepEqual(Configuration.DEFAULT_VALUE.apiServers, []);
    assert.equal(Configuration.DEFAULT_VALUE.recorded[0].name, 'recorded');
    assert.deepEqual(templateConfig.stream.live.ts.m2ts, { options: ['--copy'] });
    assert.deepEqual(templateConfig.stream.recorded.ts.webm, { options: ['--webm'] });
});
