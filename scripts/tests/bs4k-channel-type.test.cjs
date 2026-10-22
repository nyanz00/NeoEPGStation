const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScript(relativePath, dependencies = {}) {
    const sourcePath = path.resolve(__dirname, '../..', relativePath);
    const source = fs.readFileSync(sourcePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: sourcePath,
    }).outputText;
    const loadedModule = new Module(sourcePath, module);
    loadedModule.filename = sourcePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === sourcePath) {
            if (request in dependencies) return dependencies[request];
            if (request.startsWith('.')) return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, sourcePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports.default ?? loadedModule.exports;
}

const ChannelTypeUtil = loadTypeScript('src/util/ChannelTypeUtil.ts');
const searchOptions = loadTypeScript('client/src/core/search/options.ts');
const ReserveOptionChecker = loadTypeScript('src/model/operator/ReserveOptionChecker.ts', {
    inversify: { inject: () => () => {}, injectable: () => target => target },
    '../../util/ChannelTypeUtil': { __esModule: true, default: ChannelTypeUtil },
});
const ChannelDB = loadTypeScript('src/model/db/ChannelDB.ts', {
    inversify: { inject: () => () => {}, injectable: () => target => target },
    typeorm: { In: values => values },
    '../../db/entities/Channel': { __esModule: true, default: class Channel {} },
    '../../util/StrUtil': { __esModule: true, default: {} },
});

test('BS4K is a recognized broadcast, schedule, and rule search type', () => {
    assert.deepEqual(ChannelTypeUtil.filterChannelTypes(['BS4K', 'GR-ALT2', 'invalid']), ['BS4K', 'GR-ALT2']);
    assert.deepEqual(ChannelTypeUtil.parseChannelTypes('BS4K,GR-ALT2'), ['BS4K', 'GR-ALT2']);
    assert.deepEqual(ChannelTypeUtil.getRuleChannelTypes({ BS4K: true }), ['BS4K']);
    assert.deepEqual(ChannelTypeUtil.getRuleChannelTypes({ BS4K: true, channelTypes: ['GR-ALT2'] }), [
        'BS4K',
        'GR-ALT2',
    ]);
    assert.equal(ChannelTypeUtil.createBroadcastStatus().BS4K, false);
});

test('search form preserves BS4K as its dedicated rule option alongside additional channel types', () => {
    const form = { ...searchOptions.createDefaultSearchForm(), channelTypes: ['BS4K', 'GR-ALT2'] };
    const option = searchOptions.toSearchOption(form);
    assert.equal(option.BS4K, true);
    assert.deepEqual(option.channelTypes, ['GR-ALT2']);

    const restored = searchOptions.fromSearchOption({ BS4K: true, channelTypes: ['GR-ALT2'] });
    assert.deepEqual(restored.channelTypes, ['GR-ALT2', 'BS4K']);
});

test('BS4K channel ordering and channel-id validation include the new broadcast type', () => {
    const channelDB = Object.create(ChannelDB.prototype);
    assert.equal(channelDB.getChannelTypeId('BS4K'), 103);

    const checker = Object.create(ReserveOptionChecker.prototype);
    assert.equal(checker.checkSearchOption(false, { BS4K: true }), true);
    assert.equal(checker.checkSearchOption(false, { channelIds: [1], BS4K: true }), false);
});
