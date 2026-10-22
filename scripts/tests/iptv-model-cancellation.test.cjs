const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/api/iptv/IPTVApiModel.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        experimentalDecorators: true,
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
        if (request === 'inversify') {
            return { inject: () => () => {}, injectable: () => target => target };
        }
        if (request === '../../../util/DateUtil') {
            return { __esModule: true, default: { format: () => '20260101000000 +0000' } };
        }
        if (request === '../../../util/ChannelUtil') {
            return { __esModule: true, default: { isMediaService: () => true } };
        }
        return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const IPTVApiModel = loadedModule.exports.default;

const createProgram = index => ({
    channelId: 1,
    startAt: index,
    endAt: index + 1,
    name: 'program',
    description: null,
    extended: null,
});

test('checks cancellation after the program query before querying channels', async () => {
    let resolvePrograms;
    let channelQueries = 0;
    const model = new IPTVApiModel(
        { findAll: async () => (channelQueries++, []) },
        { findSchedule: () => new Promise(resolve => (resolvePrograms = resolve)) },
    );
    let cancelled = false;
    const context = {
        ensureActive() {
            if (cancelled) throw new Error('request terminated');
        },
    };

    const result = model.getEpg(1, false, context);
    cancelled = true;
    resolvePrograms([]);
    await assert.rejects(result, /terminated/);
    assert.equal(channelQueries, 0);
});

test('yields during large program projection so a disconnect interrupts further work', async () => {
    const programs = Array.from({ length: 300 }, (_value, index) => createProgram(index));
    let channelQueries = 0;
    const model = new IPTVApiModel(
        { findAll: async () => (channelQueries++, []) },
        { findSchedule: async () => programs },
    );
    let cancelled = false;
    const context = {
        ensureActive() {
            if (cancelled) throw new Error('request terminated');
        },
    };
    setImmediate(() => (cancelled = true));

    await assert.rejects(model.getEpg(1, false, context), /terminated/);
    assert.equal(channelQueries, 1);
});

test('yields while building a large channel playlist so disconnect stops generation', async () => {
    const channels = Array.from({ length: 300 }, (_value, index) => ({
        id: index + 1,
        type: 'GR',
        name: `channel-${index}`,
        halfWidthName: `channel-${index}`,
        channelType: 'GR',
        hasLogoData: false,
    }));
    const model = new IPTVApiModel({ findAll: async () => channels }, { findSchedule: async () => [] });
    let cancelled = false;
    const context = {
        ensureActive() {
            if (cancelled) throw new Error('request terminated');
        },
    };
    setImmediate(() => (cancelled = true));

    await assert.rejects(model.getChannelList('localhost', false, 0, false, undefined, context), /terminated/);
});
