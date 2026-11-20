const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
require('reflect-metadata');

function loadTypeScript(relativePath, mocks = {}) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath && Object.hasOwn(mocks, request)) return mocks[request];
        if (parent?.filename === absolutePath && request.startsWith('.')) return {};
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports;
}

const suspendUtilPath = path.resolve(__dirname, '../../src/util/EncodeSuspendTime.ts');
const suspendUtilSource = fs.readFileSync(suspendUtilPath, 'utf8');
const suspendUtilCompiled = ts.transpileModule(suspendUtilSource, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const suspendUtilModule = new Module(suspendUtilPath, module);
suspendUtilModule.filename = suspendUtilPath;
suspendUtilModule.paths = Module._nodeModulePaths(path.dirname(suspendUtilPath));
suspendUtilModule._compile(suspendUtilCompiled, suspendUtilPath);

let persistRequest = async (_dbOperator, option) => ({ ...option, encodeId: 99 });
let acquireRecordedUse = async () => ({ release: async () => {} });
const intakeMock = { persistEncodeRequest: (...args) => persistRequest(...args) };
const recordedUseMock = { recordedUseClient: { acquire: (...args) => acquireRecordedUse(...args) } };
const { default: EncodeManageModel } = loadTypeScript('../../src/model/service/encode/EncodeManageModel.ts', {
    '../../../util/EncodeSuspendTime': suspendUtilModule.exports,
    '../../encode/EncodeTaskIntake': intakeMock,
    '../../RecordedUseClient': recordedUseMock,
});

function createEncoder(encodeId, events = []) {
    const option = {
        encodeId,
        recordedId: 20,
        sourceVideoFileId: 30,
        mode: 'test',
        parentDir: 'recorded',
        removeOriginal: false,
    };
    return {
        option,
        startCount: 0,
        setOption(value) {
            this.option = value;
        },
        getEncodeOption() {
            return this.option;
        },
        getEncodeId() {
            return this.option.encodeId;
        },
        getOutputFilePath() {
            return 'output.mp4';
        },
        setOnFinish() {},
        setOnAmatsukazeTaskMatched() {},
        async start() {
            this.startCount++;
            events.push(`start-${this.option.encodeId}`);
        },
    };
}

function createModel({ config = {}, waiting = [], running = [], scheduled = [] } = {}) {
    const model = Object.create(EncodeManageModel.prototype);
    Object.assign(model, {
        restorePromise: Promise.resolve(),
        configure: { getConfig: () => ({ encode: [], ...config }) },
        concurrentEncodeNum: 2,
        waitQueue: waiting,
        runningQueue: running,
        scheduledQueue: scheduled,
        recoveryQueue: new Map(),
        activeUses: new Map(),
        deletingRecordedIds: new Map(),
        deletingVideoFileIds: new Map(),
        executeManagementModel: {
            getExecution: async () => 1,
            unLockExecution() {},
        },
        encoderModelProvider: async () => createEncoder(90),
        encodeEvent: {
            emitAddEncode() {},
            emitUpdateEncode() {},
            emitUpdateEncodeProgress() {},
            emitErrorEncode() {},
        },
        log: { encode: { info() {}, error() {}, warn() {} } },
        dbOperator: {},
        recordedDB: { findId: async id => ({ id }) },
        videoFileDB: { findId: async id => ({ id, recordedId: 20 }) },
        saveTask: async () => {},
        saveWaitQueuePositions: async () => {},
        saveScheduledQueuePositions: async () => {},
        refreshScheduledTimer() {},
        emitNeedsCheckQueue() {},
    });
    return model;
}

function freezeTime(t, date) {
    const OriginalDate = global.Date;
    const fixedTime = date.getTime();
    global.Date = class extends OriginalDate {
        constructor(...args) {
            super(...(args.length === 0 ? [fixedTime] : args));
        }
        static now() {
            return fixedTime;
        }
    };
    t.after(() => (global.Date = OriginalDate));
}

function withFakeTimers(t) {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timers = [];
    global.setTimeout = (callback, delay) => {
        const timer = { callback, delay, unref() {} };
        timers.push(timer);
        return timer;
    };
    global.clearTimeout = () => {};
    t.after(() => {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    });
    return timers;
}

test('encodeSuspendTime blocks new starts without stopping already-running work', async t => {
    const now = new Date(2026, 9, 23, 12, 0, 0);
    freezeTime(t, now);
    const timers = withFakeTimers(t);
    const running = createEncoder(1);
    const waiting = createEncoder(2);
    const model = createModel({
        config: { encodeSuspendTime: [{ start: '11:00', end: '13:00' }] },
        waiting: [waiting],
        running: [running],
    });
    model.persistQueueStart = async () => assert.fail('suspended queue must not transition to running');

    await model.checkQueue();

    assert.deepEqual(model.runningQueue, [running]);
    assert.deepEqual(model.waitQueue, [waiting]);
    assert.equal(waiting.startCount, 0);
    assert.equal(timers.length, 1);
    assert.ok(timers[0].delay > 0 && timers[0].delay <= 30_000);
});

test('queue check can resume and start the waiting item after the suspension interval', async t => {
    freezeTime(t, new Date(2026, 9, 23, 14, 0, 0));
    const waiting = createEncoder(4);
    const model = createModel({
        config: { encodeSuspendTime: [{ start: '11:00', end: '13:00' }] },
        waiting: [waiting],
    });
    model.persistQueueStart = async () => {};
    model.saveOutputFilePath = async () => {};

    await model.checkQueue();

    assert.equal(waiting.startCount, 1);
    assert.deepEqual(model.waitQueue, []);
    assert.deepEqual(model.runningQueue, [waiting]);
    assert.equal(model.activeUses.get(4)?.encoder, waiting);
});

test('durable encode intake receives the pending cap and rejection never enters memory queues', async () => {
    const waitItem = createEncoder(5);
    const scheduledItem = {
        option: { ...createEncoder(6).option, scheduledAt: Date.now() + 60_000 },
        scheduledAt: Date.now() + 60_000,
    };
    const model = createModel({
        config: { encodeMaxPending: 2, encode: [{ name: 'test', type: 'normal' }] },
        waiting: [waitItem],
        scheduled: [scheduledItem],
    });
    let persistArgs;
    let leaseReleased = false;
    let promoted = 0;
    persistRequest = async (...args) => {
        persistArgs = args;
        throw new Error('EncodeQueueFull');
    };
    acquireRecordedUse = async () => ({ release: async () => (leaseReleased = true) });
    model.pushPersisted = async () => (promoted += 1);

    try {
        await assert.rejects(
            model.push({
                recordedId: 20,
                sourceVideoFileId: 30,
                mode: 'test',
                parentDir: 'recorded',
                removeOriginal: false,
                scheduledAt: Date.now() + 120_000,
            }),
            /EncodeQueueFull/,
        );
        assert.equal(persistArgs[0], model.dbOperator);
        assert.equal(persistArgs[1].recordedId, 20);
        assert.equal(persistArgs[1].sourceVideoFileId, 30);
        assert.equal(persistArgs[2], 2, 'configured cap is passed to durable intake');
        assert.equal(leaseReleased, true);
        assert.equal(promoted, 0, 'rejected intake is never promoted');
        assert.deepEqual(model.waitQueue, [waitItem]);
        assert.deepEqual(model.scheduledQueue, [scheduledItem]);
    } finally {
        persistRequest = async (_dbOperator, option) => ({ ...option, encodeId: 99 });
        acquireRecordedUse = async () => ({ release: async () => {} });
    }
});

test('suspended hours still allow reconnecting to a recovered Amatsukaze task monitor', async t => {
    freezeTime(t, new Date(2026, 9, 23, 12, 0, 0));
    withFakeTimers(t);
    const monitor = createEncoder(7);
    monitor.option = { ...monitor.option, resumeExistingAmatsukaze: true, amatsukazeTaskId: 123 };
    const model = createModel({
        config: {
            encode: [{ name: 'test', type: 'amatsukaze' }],
            encodeSuspendTime: [{ start: '11:00', end: '13:00' }],
        },
        waiting: [monitor],
    });
    model.persistQueueStart = async () => {};
    model.saveOutputFilePath = async () => {};

    await model.checkQueue();

    assert.equal(monitor.startCount, 1);
    assert.equal(model.activeUses.get(7)?.encoder, monitor);
});

test('a recovered Amatsukaze monitor may start above the limit but a new job stays queued', async () => {
    const events = [];
    const firstRunning = createEncoder(1);
    const secondRunning = createEncoder(2);
    const monitor = createEncoder(7, events);
    monitor.option = { ...monitor.option, resumeExistingAmatsukaze: true, amatsukazeTaskId: 123 };
    const newJob = createEncoder(8, events);
    const model = createModel({
        config: { encode: [{ name: 'test', type: 'amatsukaze' }] },
        waiting: [monitor, newJob],
        running: [firstRunning, secondRunning],
    });
    model.concurrentEncodeNum = 2;
    const persistedStarts = [];
    model.persistQueueStart = async option => persistedStarts.push(option.encodeId);
    model.saveOutputFilePath = async () => {};

    await model.checkQueue();

    assert.deepEqual(persistedStarts, [7]);
    assert.equal(monitor.startCount, 1, 'existing external task monitoring is reconnected');
    assert.equal(newJob.startCount, 0, 'new work must respect the concurrent limit');
    assert.deepEqual(model.runningQueue, [firstRunning, secondRunning, monitor]);
    assert.deepEqual(model.waitQueue, [newJob]);
});
