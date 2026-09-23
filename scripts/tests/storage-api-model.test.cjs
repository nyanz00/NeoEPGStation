const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

function loadTypeScript(sourcePath) {
    const absolutePath = path.resolve(__dirname, sourcePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath && request === '../../../util/LogConfig') {
            return {
                getConfiguredLogFile: () => null,
                resolveCurrentLogFile: async configured => configured.filename,
            };
        }
        if (parent?.filename === absolutePath && request.startsWith('.')) return {};
        return load.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = load;
    }
    return loadedModule.exports.default;
}

const StorageApiModel = loadTypeScript('../../src/model/api/storage/StorageApiModel.ts');

function createStorageModel(config = { recorded: [] }) {
    const model = Object.create(StorageApiModel.prototype);
    Object.assign(model, {
        config: {
            dropLog: '/drop-log',
            thumbnail: '/thumbnail',
            ...config,
        },
        storageVolumeCache: null,
        storageVolumePromise: null,
        storageBreakdownCache: null,
        storageBreakdownPromise: null,
        storageBreakdownError: false,
        directorySizeCache: new Map(),
        directorySizePromises: new Map(),
        sizeSummaryCache: null,
        sizeSummaryPromise: null,
        getSystemInfo: async () => ({}),
    });
    return model;
}

function volume(id) {
    return {
        id,
        name: id,
        path: `/${id}`,
        type: 'removable',
        available: 400,
        used: 600,
        total: 1_000,
    };
}

test('storage volumes refresh before the 30-second UI poll, while enumeration failures remain retryable', async t => {
    let now = 1_000;
    t.mock.method(Date, 'now', () => now);

    const model = createStorageModel();
    const samples = [[volume('A')], [volume('B')], new Error('enumeration unavailable'), [volume('C')]];
    let calls = 0;
    const enumerate = async () => {
        calls += 1;
        const sample = samples.shift();
        if (sample instanceof Error) throw sample;
        return sample;
    };
    model[process.platform === 'win32' ? 'getWindowsStorageVolumes' : 'getUnixStorageVolumes'] = enumerate;

    assert.deepEqual(
        (await model.getStorageVolumes()).items.map(item => item.id),
        ['A'],
    );
    now += 24_999;
    assert.deepEqual(
        (await model.getStorageVolumes()).items.map(item => item.id),
        ['A'],
    );
    assert.equal(calls, 1, 'the cached sample should be reused before 30 seconds');

    now += 1;
    assert.deepEqual(
        (await model.getStorageVolumes()).items.map(item => item.id),
        ['B'],
    );
    assert.equal(calls, 2, 'the expired sample should be replaced, adding B and removing A');

    now += 30_000;
    await assert.rejects(model.getStorageVolumes(), /enumeration unavailable/);
    assert.equal(calls, 3);
    assert.deepEqual(
        (await model.getStorageVolumes()).items.map(item => item.id),
        ['C'],
        'a failed enumeration should not cache an empty list or block the next retry',
    );
    assert.equal(calls, 4);
});

test('Windows and Unix volume probes propagate command failures', async () => {
    const model = createStorageModel();
    model.runCommand = async () => {
        throw new Error('storage probe failed');
    };

    await assert.rejects(model.getWindowsStorageVolumes(), /storage probe failed/);
    await assert.rejects(model.getUnixStorageVolumes(), /storage probe failed/);
});

test('getInfo keeps healthy recorded storage when another recorded path fails', async () => {
    const model = createStorageModel({
        recorded: [
            { name: 'healthy', path: '/recorded/healthy' },
            { name: 'unavailable', path: '/recorded/unavailable' },
        ],
    });
    model.storageBreakdownCache = {
        expiresAt: Date.now() + 10_000,
        value: {
            sizeByDirectory: new Map([['healthy', 20]]),
            dropLogSize: 10,
            thumbnailSize: 5,
        },
    };
    model.getDiskInfo = async dirPath => {
        if (dirPath === '/recorded/unavailable') throw new Error('permission denied');
        return { total: 100, used: 70, available: 30 };
    };

    const result = await model.getInfo();

    assert.deepEqual(result.items.map(item => item.name), ['healthy']);
    assert.deepEqual(result.errors, [{ name: 'unavailable' }]);
    assert.deepEqual(result.items[0].breakdown, {
        recorded: 20,
        dropLogs: 10,
        thumbnails: 5,
        other: 35,
    });
});

test('a failed breakdown is reported on the next refresh without labeling all used space as other', async () => {
    const model = createStorageModel({ recorded: [{ name: 'main', path: '/recorded' }] });
    model.getDiskInfo = async () => ({ total: 1_000, used: 700, available: 300 });
    let failSummary = true;
    model.getCachedSizeSummaries = async () => {
        if (failSummary) throw new Error('size summary unavailable');
        return [{ parentDirectoryName: 'main', size: 100 }];
    };
    model.getCachedDirectorySize = async () => 0;

    const initial = await model.getInfo();
    assert.equal(initial.items[0].breakdownPending, true);
    assert.equal(initial.items[0].breakdown, undefined);

    await new Promise(resolve => setImmediate(resolve));
    failSummary = false;
    const refreshed = await model.getInfo();

    assert.equal(refreshed.items[0].breakdownPending, undefined);
    assert.equal(refreshed.items[0].breakdownError, true);
    assert.equal(refreshed.items[0].breakdown, undefined);

    await new Promise(resolve => setImmediate(resolve));
    const recovered = await model.getInfo();
    assert.equal(recovered.items[0].breakdownError, undefined);
    assert.deepEqual(recovered.items[0].breakdown, {
        recorded: 100,
        dropLogs: 0,
        thumbnails: 0,
        other: 600,
    });
});
