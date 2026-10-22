const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/epgUpdater/EPGUpdateManageModel.ts');
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
        if (request === 'inversify') {
            return {
                inject: () => () => {},
                injectable: () => target => target,
            };
        }
        if (request === 'eventsource') return class EventSource {};
        if (request === './IEPGUpdateManageModel') {
            return {
                EPGUpdateEvent: { SERVICE_UPDATED: 'service updated' },
            };
        }
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const EPGUpdateManageModel = loadedModule.exports.default;

const channelDBPath = path.resolve(__dirname, '../../src/model/db/ChannelDB.ts');
const channelDBSource = fs.readFileSync(channelDBPath, 'utf8');
const channelDBCompiled = ts.transpileModule(channelDBSource, {
    compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
    fileName: channelDBPath,
}).outputText;
const channelDBModule = new Module(channelDBPath, module);
channelDBModule.filename = channelDBPath;
channelDBModule.paths = Module._nodeModulePaths(path.dirname(channelDBPath));
Module._load = function (request, parent, isMain) {
    if (parent?.filename === channelDBPath) {
        if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
        if (request === 'typeorm') return { In: values => ({ inValues: values }) };
        if (request === '../../db/entities/Channel') return { __esModule: true, default: class Channel {} };
        if (request === '../../util/StrUtil') {
            return { __esModule: true, default: { toDBStr: value => value, toHalf: value => value } };
        }
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    channelDBModule._compile(channelDBCompiled, channelDBPath);
} finally {
    Module._load = originalLoad;
}
const ChannelDB = channelDBModule.exports.default;

const makeService = (id, overrides = {}) => ({
    id,
    serviceId: id,
    networkId: 1,
    name: `service-${id}`,
    hasLogoData: false,
    channel: { type: 'GR', channel: String(id) },
    ...overrides,
});

function createFixture({ services = [], serviceError = null, excludedChannels = [], excludedSids = [] } = {}) {
    const calls = { channelUpdates: [], programDeletes: [] };
    const logger = { info() {}, debug() {}, error() {} };
    const model = new EPGUpdateManageModel(
        { getLogger: () => ({ system: logger }) },
        {
            getConfig: () => ({
                mirakurunPath: 'http://localhost/',
                excludeChannels: excludedChannels,
                excludeSids: excludedSids,
            }),
        },
        {
            getClient: () => ({
                getServices: async () => {
                    if (serviceError !== null) throw serviceError;
                    return services;
                },
            }),
        },
        { update: async values => calls.channelUpdates.push(values) },
        {
            insert: async (index, programs, ids) =>
                calls.programDeletes.push({ index: structuredClone(index), programs, ids }),
        },
    );
    return { model, calls };
}

const queue = (model, ...events) => {
    model.serviceQueue.push(...events.map(({ type, data }) => ({ resource: 'service', type, data })));
};

test('a create after remove wins and keeps the channel in the index', async () => {
    const service = makeService(4);
    const { model, calls } = createFixture({ services: [service] });
    model.channelIndex = { 1: { 4: { id: 4, type: 'GR', channel: 'old' } } };
    queue(model, { type: 'remove', data: service }, { type: 'create', data: service });

    await model.saveService();

    assert.deepEqual(
        calls.channelUpdates[0].insert.map(item => item.id),
        [4],
    );
    assert.deepEqual(calls.channelUpdates[0].delete, []);
    assert.equal(calls.programDeletes.length, 0);
    assert.equal(model.channelIndex[1][4].channel, '4');
});

test('a final remove deletes the channel and its programs once', async () => {
    const service = makeService(7);
    const { model, calls } = createFixture({ services: [service] });
    model.channelIndex = { 1: { 7: { id: 7, type: 'GR', channel: '7' }, 8: { id: 8, type: 'GR', channel: '8' } } };
    queue(
        model,
        { type: 'create', data: service },
        { type: 'update', data: service },
        { type: 'remove', data: service },
        { type: 'remove', data: service },
    );

    await model.saveService();

    assert.deepEqual(calls.channelUpdates[0].insert, []);
    assert.deepEqual(calls.channelUpdates[0].update, []);
    assert.deepEqual(calls.channelUpdates[0].delete, [7]);
    assert.deepEqual(calls.programDeletes[0].ids, [7]);
    assert.deepEqual(calls.programDeletes[0].index, { 1: { 8: { id: 8, type: 'GR', channel: '8' } } });
});

test('a REST failure alone does not delete an updated service', async () => {
    const service = makeService(9);
    const { model, calls } = createFixture({ serviceError: new Error('offline') });
    queue(model, { type: 'update', data: service });

    await model.saveService();

    assert.deepEqual(calls.channelUpdates[0].delete, []);
    assert.equal(calls.programDeletes.length, 0);
});

test('excluded service removals are ignored', async () => {
    const service = makeService(10);
    const { model, calls } = createFixture({ excludedChannels: [10] });
    model.channelIndex = { 1: { 10: { id: 10, type: 'GR', channel: '10' } } };
    queue(model, { type: 'remove', data: service });

    await model.saveService();

    assert.deepEqual(calls.channelUpdates[0].delete, []);
    assert.equal(calls.programDeletes.length, 0);
    assert.equal(model.channelIndex[1][10].id, 10);
});

test('channel removal and upsert run in one transaction', async () => {
    const operations = [];
    const manager = {
        clear: async () => operations.push(['clear']),
        delete: async (entity, where) => operations.push(['delete', where.id.inValues]),
        insert: async (entity, value) => operations.push(['insert', value.id]),
        update: async (entity, id) => operations.push(['update', id]),
    };
    const queryRunner = {
        manager,
        startTransaction: async () => operations.push(['start']),
        commitTransaction: async () => operations.push(['commit']),
        rollbackTransaction: async () => operations.push(['rollback']),
        release: async () => operations.push(['release']),
    };
    const channelDB = new ChannelDB(
        { getLogger: () => ({ system: { error() {} } }) },
        { getConfig: () => ({}) },
        { getConnection: async () => ({ createQueryRunner: () => queryRunner }) },
        { run: operation => operation() },
    );

    await channelDB.update({ insert: [makeService(20)], update: [], delete: [19] });

    assert.deepEqual(operations, [['start'], ['delete', [19]], ['insert', 20], ['commit'], ['release']]);
});
