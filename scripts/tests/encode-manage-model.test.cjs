const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

const sourcePath = path.resolve(__dirname, '../../src/model/service/encode/EncodeManageModel.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        experimentalDecorators: true,
        emitDecoratorMetadata: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const load = Module._load;
Module._load = function (request, parent, isMain) {
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
