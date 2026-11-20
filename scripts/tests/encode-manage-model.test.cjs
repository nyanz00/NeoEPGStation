const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
require('reflect-metadata');

const sourcePath = path.resolve(__dirname, '../../src/model/service/encode/EncodeManageModel.ts');
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
const recordedUseClient = {
    async acquire() {
        return { release: async () => {} };
    },
};
const load = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath && request === '../../RecordedUseClient') {
        return { recordedUseClient };
    }
    if (parent?.filename === sourcePath && request === '../../encode/EncodeTaskIntake') {
        return { persistEncodeRequest: async () => assert.fail('push is outside this test file scope') };
    }
    if (parent?.filename === sourcePath && request.startsWith('.')) return {};
    return load.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = load;
}
const EncodeManageModel = loadedModule.exports.default;

function createEncoder(order) {
    const option = {
        encodeId: 10,
        recordedId: 20,
        sourceVideoFileId: 30,
        mode: 'test',
        parentDir: 'recorded',
        removeOriginal: false,
    };
    return {
        option,
        setOnFinish() {},
        setOnAmatsukazeTaskMatched() {},
        getEncodeOption: () => option,
        getEncodeId: () => option.encodeId,
        getOutputFilePath: () => 'output.mp4',
        start: async () => order.push('start'),
    };
}

function createModel(encoder) {
    const model = Object.create(EncodeManageModel.prototype);
    Object.assign(model, {
        restorePromise: Promise.resolve(),
        concurrentEncodeNum: 1,
        waitQueue: [encoder],
        runningQueue: [],
        activeUses: new Map(),
        deletingRecordedIds: new Map(),
        deletingVideoFileIds: new Map(),
        configure: { getConfig: () => ({ encode: [{ name: 'test', type: 'normal' }] }) },
        executeManagementModel: {
            getExecution: async () => 1,
            unLockExecution() {},
        },
        log: {
            encode: {
                info() {},
                error() {},
                warn() {},
            },
        },
        encodeEvent: {
            emitErrorEncode() {},
        },
    });
    return model;
}

function deferred() {
    let resolve;
    const promise = new Promise(res => {
        resolve = res;
    });
    return { promise, resolve };
}

test('a failed DB transition leaves the encoder waiting and never starts it', async () => {
    const order = [];
    const encoder = createEncoder(order);
    const model = createModel(encoder);
    let retryCount = 0;
    model.persistQueueStart = async () => {
        order.push('persist');
        throw new Error('database unavailable');
    };
    model.scheduleQueueCheckRetry = () => {
        retryCount += 1;
    };

    await model.checkQueue();

    assert.deepEqual(order, ['persist']);
    assert.deepEqual(model.waitQueue, [encoder]);
    assert.deepEqual(model.runningQueue, []);
    assert.equal(retryCount, 1);
});

test('the running transition is persisted before the encoder starts', async () => {
    const order = [];
    const encoder = createEncoder(order);
    const model = createModel(encoder);
    model.persistQueueStart = async () => order.push('persist');
    model.saveOutputFilePath = async () => order.push('save-output');

    await model.checkQueue();

    assert.deepEqual(order, ['persist', 'start', 'save-output']);
    assert.deepEqual(model.waitQueue, []);
    assert.deepEqual(model.runningQueue, [encoder]);
});

test('an output-path DB failure keeps the running encoder tracked and retries only persistence', async () => {
    const order = [];
    const encoder = createEncoder(order);
    const model = createModel(encoder);
    model.persistQueueStart = async () => order.push('persist');
    model.saveOutputFilePath = async () => {
        order.push('save-output');
        throw new Error('database unavailable');
    };
    model.retrySaveOutputFilePath = (encodeId, currentEncoder) => {
        assert.equal(encodeId, encoder.option.encodeId);
        assert.equal(currentEncoder, encoder);
        order.push('retry-output');
    };

    await model.checkQueue();

    assert.deepEqual(order, ['persist', 'start', 'save-output', 'retry-output']);
    assert.deepEqual(model.waitQueue, []);
    assert.deepEqual(model.runningQueue, [encoder]);
});

test('a finalize DB failure keeps the finished encoder tracked and schedules cleanup retry', async () => {
    const order = [];
    const encoder = createEncoder(order);
    const model = createModel(encoder);
    model.waitQueue = [];
    model.runningQueue = [encoder];
    model.finalizeRetryIds = new Set();
    model.persistQueueFinalize = async () => {
        throw new Error('database unavailable');
    };
    let scheduledId = null;
    model.scheduleFinalizeRetry = encodeId => {
        scheduledId = encodeId;
    };

    await assert.rejects(model.finalize(encoder.option.encodeId), /database unavailable/);

    assert.deepEqual(model.runningQueue, [encoder]);
    assert.equal(scheduledId, encoder.option.encodeId);
});

test('a finalize lock failure also keeps the item and schedules cleanup retry', async () => {
    const order = [];
    const encoder = createEncoder(order);
    const model = createModel(encoder);
    model.waitQueue = [];
    model.runningQueue = [encoder];
    model.finalizeRetryIds = new Set();
    model.executeManagementModel.getExecution = async () => {
        throw new Error('lock timeout');
    };
    let scheduledId = null;
    model.scheduleFinalizeRetry = encodeId => {
        scheduledId = encodeId;
    };

    await assert.rejects(model.finalize(encoder.option.encodeId), /lock timeout/);

    assert.deepEqual(model.runningQueue, [encoder]);
    assert.equal(scheduledId, encoder.option.encodeId);
});

test('finalize removes the in-memory item only after persisted cleanup succeeds', async () => {
    const order = [];
    const encoder = createEncoder(order);
    const model = createModel(encoder);
    model.waitQueue = [];
    model.runningQueue = [encoder];
    model.finalizeRetryIds = new Set([encoder.option.encodeId]);
    model.persistQueueFinalize = async (_encodeId, remaining) => {
        assert.deepEqual(model.runningQueue, [encoder]);
        assert.deepEqual(remaining, []);
    };
    model.emitNeedsCheckQueue = () => {};

    await model.finalize(encoder.option.encodeId);

    assert.deepEqual(model.runningQueue, []);
    assert.equal(model.finalizeRetryIds.has(encoder.option.encodeId), false);
});

test('a failed scheduled recovery retry cannot duplicate the in-memory queue', async () => {
    const order = [];
    const encoder = createEncoder(order);
    encoder.option.scheduledAt = Date.now() + 60_000;
    const model = createModel(encoder);
    model.waitQueue = [];
    model.scheduledQueue = [];
    model.recoveryQueue = new Map([
        [
            encoder.option.encodeId,
            {
                task: { encodeId: encoder.option.encodeId, startedAt: 0, outputFilePath: null },
                option: encoder.option,
                reason: 'test',
            },
        ],
    ]);
    model.configure = { getConfig: () => ({ encode: [{ name: 'test', type: 'normal' }] }) };
    model.recordedDB = { findId: async () => ({ id: encoder.option.recordedId }) };
    model.videoFileDB = {
        findId: async () => ({ id: encoder.option.sourceVideoFileId, recordedId: encoder.option.recordedId }),
    };
    model.persistScheduledQueue = async () => {
        throw new Error('database unavailable');
    };

    await assert.rejects(model.retry(encoder.option.encodeId), /database unavailable/);

    assert.deepEqual(model.scheduledQueue, []);
    assert.equal(model.recoveryQueue.has(encoder.option.encodeId), true);
});

test('recovery retry availability follows the current encode configuration', () => {
    const order = [];
    const encoder = createEncoder(order);
    const model = createModel(encoder);
    const recoveryItem = {
        task: { encodeId: encoder.option.encodeId },
        option: encoder.option,
        reason: 'mode was unavailable during startup',
    };
    let modes = [];
    model.configure = { getConfig: () => ({ encode: modes }) };

    assert.equal(model.canRetryRecoveryItem(recoveryItem), false);

    modes = [{ name: encoder.option.mode, type: 'normal' }];
    assert.equal(model.canRetryRecoveryItem(recoveryItem), true);
});

test('a failed queued cancellation keeps the in-memory queues unchanged', async () => {
    const order = [];
    const encoder = createEncoder(order);
    const model = createModel(encoder);
    model.recoveryQueue = new Map();
    model.scheduledQueue = [];
    model.persistQueueCancellation = async () => {
        throw new Error('database unavailable');
    };

    await assert.rejects(model.cancel(encoder.option.encodeId), /database unavailable/);

    assert.deepEqual(model.waitQueue, [encoder]);
    assert.deepEqual(model.scheduledQueue, []);
});

test('a failed reorder persistence keeps the original in-memory order', async () => {
    const order = [];
    const first = createEncoder(order);
    const second = createEncoder(order);
    second.option = { ...second.option, encodeId: 11 };
    second.getEncodeOption = () => second.option;
    second.getEncodeId = () => second.option.encodeId;
    const model = createModel(first);
    model.waitQueue = [first, second];
    model.persistWaitQueueOrder = async () => {
        throw new Error('database unavailable');
    };

    await assert.rejects(model.reorderWaitQueue([11, 10], [10, 11]), /database unavailable/);

    assert.deepEqual(model.waitQueue, [first, second]);
});

test('unconfirmed Amatsukaze failure keeps its source lease and task for recovery', async () => {
    const order = [];
    const encoder = createEncoder(order);
    encoder.option.mode = 'external';
    const task = { encodeId: encoder.option.encodeId, status: 'running', startedAt: 123, outputFilePath: null };
    const model = createModel(encoder);
    let released = 0;
    model.configure = { getConfig: () => ({ encode: [{ name: 'external', type: 'amatsukaze' }] }) };
    model.dbOperator = {
        getConnection: async () => ({
            getRepository: () => ({
                update: async (_where, values) => Object.assign(task, values),
                findOne: async () => task,
            }),
        }),
    };
    model.runningQueue = [encoder];
    model.recoveryQueue = new Map();
    model.activeUses = new Map([[encoder.option.encodeId, { release: async () => released++ }]]);
    model.encodeEvent.emitUpdateEncode = () => order.push('update-recovery');
    model.emitNeedsCheckQueue = () => {};
    model.finalize = async () => order.push('finalize');

    await model.processFinish(true, null, encoder.option, false, 'connection lost', false);

    assert.equal(task.status, 'needs_attention');
    assert.deepEqual(model.runningQueue, []);
    assert.equal(model.recoveryQueue.get(encoder.option.encodeId).task, task);
    assert.equal(released, 0);
    assert.equal(model.activeUses.has(encoder.option.encodeId), true);
    assert.equal(order.includes('finalize'), false);
});

test('confirmed terminal Amatsukaze failure releases its lease and finalizes normally', async () => {
    const order = [];
    const encoder = createEncoder(order);
    encoder.option.mode = 'external';
    const model = createModel(encoder);
    let released = 0;
    let errorEvent;
    model.configure = { getConfig: () => ({ encode: [{ name: 'external', type: 'amatsukaze' }] }) };
    model.activeUses = new Map([[encoder.option.encodeId, { release: async () => released++ }]]);
    model.encodeEvent.emitErrorEncode = info => {
        errorEvent = info;
    };
    model.finalize = async encodeId => order.push(`finalize:${encodeId}`);

    await model.processFinish(true, null, encoder.option, false, 'terminal failure', true);

    assert.equal(released, 1);
    assert.equal(model.activeUses.has(encoder.option.encodeId), false);
    assert.equal(errorEvent.encoderMessage, 'terminal failure');
    assert.deepEqual(order, [`finalize:${encoder.option.encodeId}`]);
});

test('checks persisted duplicate-source tasks before removing an original file', async () => {
    const order = [];
    const encoder = createEncoder(order);
    encoder.option.removeOriginal = true;
    const model = createModel(encoder);
    model.configure = { getConfig: () => ({ encode: [{ name: 'test', type: 'normal' }], recorded: [] }) };
    const pendingTasks = deferred();
    let finishInfo;
    model.runningQueue = [encoder];
    model.waitQueue = [];
    model.scheduledQueue = [];
    model.recoveryQueue = new Map();
    model.dbOperator = {
        getConnection: async () => ({ getRepository: () => ({ find: () => pendingTasks.promise }) }),
    };
    model.encodeEvent.emitFinishEncode = async info => {
        finishInfo = info;
        order.push('finish');
    };
    model.finalize = async () => order.push('finalize');

    const finishing = model.processFinish(false, 'output.mp4', encoder.option, false);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(order, []);
    pendingTasks.resolve([
        {
            encodeId: 11,
            optionJson: JSON.stringify({ sourceVideoFileId: encoder.option.sourceVideoFileId }),
        },
    ]);
    await finishing;

    assert.equal(finishInfo.removeOriginal, false);
    assert.deepEqual(order, ['finish', 'finalize']);
});

test('releases the encode-intake lease when acquiring the manual-push lock rejects', async () => {
    let released = 0;
    const previousAcquire = recordedUseClient.acquire;
    recordedUseClient.acquire = async () => ({ release: async () => released++ });
    try {
        const encoder = createEncoder([]);
        const model = createModel(encoder);
        model.executeManagementModel.getExecution = async () => {
            throw new Error('lock rejected');
        };

        await assert.rejects(model.push({ recordedId: 20, sourceVideoFileId: 30, mode: 'test' }), {
            message: 'lock rejected',
        });
        assert.equal(released, 1);
    } finally {
        recordedUseClient.acquire = previousAcquire;
    }
});

test('refuses to cancel a queued Amatsukaze recovery monitor before safe reconnect', async () => {
    const encoder = createEncoder([]);
    Object.assign(encoder.option, { mode: 'external', resumeExistingAmatsukaze: true });
    const model = createModel(encoder);
    let released = 0;
    let queueCancellationWrites = 0;
    let deletes = 0;
    model.configure = { getConfig: () => ({ encode: [{ name: 'external', type: 'amatsukaze' }] }) };
    model.waitQueue = [encoder];
    model.recoveryQueue = new Map();
    model.scheduledQueue = [];
    model.activeUses = new Map([[encoder.option.encodeId, { release: async () => released++ }]]);
    model.persistQueueCancellation = async () => queueCancellationWrites++;
    model.deleteTask = async () => deletes++;
    model.refreshScheduledTimer = () => {};
    model.emitNeedsCheckQueue = () => {};

    await assert.rejects(model.cancel(encoder.option.encodeId), { message: 'AmatsukazeRecoveryNotReady' });

    assert.deepEqual(model.waitQueue, [encoder]);
    assert.equal(queueCancellationWrites, 0);
    assert.equal(deletes, 0);
    assert.equal(released, 0);
    assert.equal(model.activeUses.has(encoder.option.encodeId), true);
});

test('refuses to delete a started Amatsukaze recovery row before stop confirmation', async () => {
    const encoder = createEncoder([]);
    encoder.option = { ...encoder.option, mode: 'external', resumeExistingAmatsukaze: true };
    const model = createModel(encoder);
    let released = 0;
    let deletes = 0;
    const row = { encodeId: encoder.option.encodeId, status: 'needs_attention', startedAt: 100 };
    model.configure = { getConfig: () => ({ encode: [{ name: 'external', type: 'amatsukaze' }] }) };
    model.waitQueue = [];
    model.recoveryQueue = new Map([
        [encoder.option.encodeId, { task: row, option: encoder.option, reason: 'stop is unconfirmed' }],
    ]);
    model.activeUses = new Map([[encoder.option.encodeId, { release: async () => released++ }]]);
    model.deleteTask = async () => deletes++;

    await assert.rejects(model.cancel(encoder.option.encodeId), { message: 'AmatsukazeRecoveryNotReady' });

    assert.equal(model.recoveryQueue.get(encoder.option.encodeId).task, row);
    assert.equal(row.status, 'needs_attention');
    assert.equal(deletes, 0);
    assert.equal(released, 0);
    assert.equal(model.activeUses.has(encoder.option.encodeId), true);
});
