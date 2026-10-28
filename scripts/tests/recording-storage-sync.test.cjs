const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

function loadTypeScript(relativePath, mocks = {}) {
    const filename = path.join(root, relativePath);
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
            experimentalDecorators: true,
        },
        fileName: filename,
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === filename) {
            if (Object.hasOwn(mocks, request)) return mocks[request];
            if (request === 'inversify') {
                return {
                    inject: () => () => {},
                    injectable: () => target => target,
                };
            }
            if (request.startsWith('.')) return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(output, filename);
    } finally {
        Module._load = originalLoad;
    }
    return loaded.exports.default;
}

async function withFakeTimers(callback) {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timers = [];
    global.setTimeout = (handler, delay) => {
        const timer = { handler, delay, active: true };
        timers.push(timer);
        return timer;
    };
    global.clearTimeout = timer => {
        if (timer !== undefined) timer.active = false;
    };
    const fire = async delay => {
        for (let index = 0; index < 8; index++) await Promise.resolve();
        const timer = timers.find(value => value.active && value.delay === delay);
        assert.ok(timer, `expected an active ${delay}ms timer`);
        timer.active = false;
        timer.handler();
        await Promise.resolve();
    };
    try {
        await callback(fire);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
}

test('storage sync retries transient errors three times before succeeding', async () => {
    const RecordingStorageSync = await loadTypeScript('src/model/operator/recording/RecordingStorageSync.ts');
    await withFakeTimers(async fire => {
        let attempts = 0;
        const warnings = [];
        const resultPromise = RecordingStorageSync.sync(
            'recorded.ts',
            async () => {
                attempts++;
                if (attempts < 3) throw new Error('temporary sync error');
            },
            { warn: message => warnings.push(message) },
        );
        await fire(RecordingStorageSync.SYNC_RETRY_INTERVAL_MS);
        await fire(RecordingStorageSync.SYNC_RETRY_INTERVAL_MS);
        assert.equal(await resultPromise, 'synced');
        assert.equal(attempts, 3);
        assert.deepEqual(warnings, []);
    });
});

test('storage sync stops after three failed attempts', async () => {
    const RecordingStorageSync = await loadTypeScript('src/model/operator/recording/RecordingStorageSync.ts');
    await withFakeTimers(async fire => {
        let attempts = 0;
        const warnings = [];
        const resultPromise = RecordingStorageSync.sync(
            'recorded.ts',
            async () => {
                attempts++;
                throw new Error('persistent sync error');
            },
            { warn: message => warnings.push(message) },
        );
        await fire(RecordingStorageSync.SYNC_RETRY_INTERVAL_MS);
        await fire(RecordingStorageSync.SYNC_RETRY_INTERVAL_MS);
        assert.equal(await resultPromise, 'failed');
        assert.equal(attempts, 3);
        assert.equal(warnings.length, 1);
    });
});

test('storage sync classifies unsupported and missing targets without retrying', async () => {
    const RecordingStorageSync = await loadTypeScript('src/model/operator/recording/RecordingStorageSync.ts');
    for (const [code, expected] of [
        ['ENOTSUP', 'unsupported'],
        ['ENOENT', 'missing'],
    ]) {
        let attempts = 0;
        const warnings = [];
        const result = await RecordingStorageSync.sync(
            'recorded.ts',
            async () => {
                attempts++;
                throw Object.assign(new Error(code), { code });
            },
            { warn: message => warnings.push(message) },
        );
        assert.equal(result, expected);
        assert.equal(attempts, 1);
        assert.equal(warnings.length, 1);
    }
});

test('storage sync returns timed-out without waiting for its production timeout', async () => {
    const RecordingStorageSync = await loadTypeScript('src/model/operator/recording/RecordingStorageSync.ts');
    await withFakeTimers(async fire => {
        const resultPromise = RecordingStorageSync.sync('recorded.ts', () => new Promise(() => {}), { warn: () => {} });
        await fire(RecordingStorageSync.SYNC_TIMEOUT_MS);
        assert.equal(await resultPromise, 'timed-out');
    });
});

function makeRecordingUtilHarness(syncResult = 'synced', options = {}) {
    const events = [];
    const sourcePath = 'tmp/source.ts';
    const destinationPath = 'recorded/destination.ts';
    const storageSync = {
        sync: async (target, operation) => {
            if (target === destinationPath && syncResult !== 'synced') {
                events.push('file sync failed');
                return syncResult;
            }
            if (target === path.dirname(destinationPath) && options.directorySyncResult !== undefined) {
                events.push('directory sync failed');
                return options.directorySyncResult;
            }
            await operation();
            return 'synced';
        },
        syncFile: async () => events.push('file sync'),
        syncDirectory: async () => events.push('directory sync'),
    };
    const fileUtil = {
        rename: async () => {
            throw Object.assign(new Error('cross-device rename'), { code: 'EXDEV' });
        },
        copyFile: async () => events.push('copy'),
        unlink: async filePath => events.push(filePath === sourcePath ? 'remove source' : 'remove destination'),
    };
    return { dbUpdateError: options.dbUpdateError, destinationPath, events, fileUtil, sourcePath, storageSync };
}

async function createRecordingUtil(harness) {
    const RecordingUtilModel = await loadTypeScript('src/model/operator/recording/RecordingUtilModel.ts', {
        './RecordingStorageSync': { __esModule: true, default: harness.storageSync },
        './RecordingStorageSync.js': { __esModule: true, default: harness.storageSync },
        '../../../util/FileUtil': { __esModule: true, default: harness.fileUtil },
        '../../../util/FileUtil.js': { __esModule: true, default: harness.fileUtil },
    });
    const model = Object.create(RecordingUtilModel.prototype);
    Object.assign(model, {
        config: { recordedTmp: 'tmp' },
        log: { system: { info() {}, debug() {}, error() {} } },
        videoUtil: { getFullFilePathFromId: async () => harness.sourcePath },
        getRecPath: async () => ({
            fullPath: harness.destinationPath,
            parendDir: { name: 'Recorded' },
            subDir: '',
            fileName: 'destination.ts',
        }),
        videoFileDB: {
            updateFilePath: async () => {
                harness.events.push('db path update');
                if (harness.dbUpdateError) throw harness.dbUpdateError;
            },
        },
    });
    return model;
}

test('copy sync failure preserves the source and leaves the database path unchanged', async () => {
    const harness = makeRecordingUtilHarness('failed');
    const model = await createRecordingUtil(harness);
    await assert.rejects(model.movingFromTmp({ id: 1 }, 2), /RecordingFileSync: failed/);
    assert.deepEqual(harness.events, ['copy', 'file sync failed']);
});

test('destination directory sync failure preserves the source and leaves the database path unchanged', async () => {
    const harness = makeRecordingUtilHarness('synced', { directorySyncResult: 'timed-out' });
    const model = await createRecordingUtil(harness);

    await assert.rejects(model.movingFromTmp({ id: 1 }, 2), /RecordingDirectorySync: timed-out/);
    assert.deepEqual(harness.events, ['copy', 'file sync', 'directory sync failed']);
});

test('database update failure removes the copied destination and preserves the source', async () => {
    const harness = makeRecordingUtilHarness('synced', { dbUpdateError: new Error('database update failed') });
    const model = await createRecordingUtil(harness);

    await assert.rejects(model.movingFromTmp({ id: 1 }, 2), /database update failed/);
    assert.deepEqual(harness.events, ['copy', 'file sync', 'directory sync', 'db path update', 'remove destination']);
});

test('successful copy syncs the file and directory before updating the database and removing the source', async () => {
    const harness = makeRecordingUtilHarness();
    const model = await createRecordingUtil(harness);
    const destination = await model.movingFromTmp({ id: 1 }, 2);
    assert.equal(destination, harness.destinationPath);
    assert.deepEqual(harness.events, ['copy', 'file sync', 'directory sync', 'db path update', 'remove source']);
});
