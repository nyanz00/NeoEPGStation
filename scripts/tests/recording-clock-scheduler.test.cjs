const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { finished } = require('node:stream/promises');
const test = require('node:test');
const ts = require('typescript');

function createFakeScheduler() {
    const calls = [];
    let refreshCount = 0;
    return {
        calls,
        get refreshCount() {
            return refreshCount;
        },
        schedule(key, at, callback) {
            const call = { key, at, callback, cancelled: false };
            calls.push(call);
            return () => {
                call.cancelled = true;
            };
        },
        refresh() {
            refreshCount++;
        },
    };
}

function loadTypeScript(relativePath, dependencies = {}) {
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
        if (parent?.filename === absolutePath) {
            if (request in dependencies) return dependencies[request];
            if (request.startsWith('.')) return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports;
}

function createReserve(overrides = {}) {
    return {
        id: 12,
        programId: 7,
        channelId: 2,
        startAt: Date.now() + 60_000,
        endAt: Date.now() + 180_000,
        isSkip: false,
        isOverlap: false,
        isConflict: false,
        isTimeSpecified: false,
        isEventRelay: false,
        ruleId: null,
        ...overrides,
    };
}

function createRecorder(scheduler) {
    const sourcePath = '../../src/model/operator/recording/RecorderModel.ts';
    const { default: RecorderModel } = loadTypeScript(sourcePath, {
        inversify: { inject: () => () => {}, injectable: () => target => target },
        './RecordingScheduler': { recordingScheduler: scheduler },
        './IRecordingStreamCreator': { __esModule: true, default: { PREP_TIME: 15_000 } },
        '../../../util/FileUtil': { __esModule: true, default: {} },
        '../../../util/StrUtil': { __esModule: true, default: {} },
        '../../../db/entities/DropLogFile': { __esModule: true, default: class DropLogFile {} },
        '../../../db/entities/Recorded': { __esModule: true, default: class Recorded {} },
        '../../../db/entities/RecordedHistory': { __esModule: true, default: class RecordedHistory {} },
        '../../../db/entities/Reserve': { __esModule: true, default: class Reserve {} },
        '../../../db/entities/VideoFile': { __esModule: true, default: class VideoFile {} },
    });
    const recorder = Object.create(RecorderModel.prototype);
    recorder.log = { system: { info() {}, debug() {}, warn() {}, error() {} } };
    recorder.timerId = null;
    recorder.eventRelayTimerId = null;
    recorder.startScheduleKey = {};
    recorder.relayScheduleKey = {};
    recorder.isPrepRecording = false;
    recorder.isRecording = false;
    recorder.reserve = createReserve();
    recorder.streamCreator = { changeEndAt() {} };
    recorder.dropChecker = { setRecordingEndAt() {} };
    recorder.eventEmitter = new (require('node:events').EventEmitter)();
    recorder.timeSpecifiedStreams = new Map();
    return recorder;
}

async function waitForStreamClose(stream) {
    await finished(stream).catch(error => {
        if (error.code !== 'ERR_STREAM_PREMATURE_CLOSE') throw error;
    });
}

test('RecorderModel schedules starts by absolute wall clock and cancels replaced or removed timers', async () => {
    const scheduler = createFakeScheduler();
    const recorder = createRecorder(scheduler);
    const now = Date.now();
    const reserve = createReserve({ startAt: now + 60_000, endAt: now + 180_000 });
    assert.equal(recorder.setTimer(reserve, true), true);
    assert.equal(scheduler.calls[0].at, reserve.startAt - 15_000);

    const updatedReserve = { ...reserve, startAt: now + 120_000 };
    await recorder.update(updatedReserve, true);
    assert.equal(scheduler.calls[0].cancelled, true);
    assert.equal(scheduler.calls[1].at, updatedReserve.startAt - 15_000);

    await recorder.cancel(false);
    assert.equal(scheduler.calls[1].cancelled, true);
});

test('RecorderModel reset refreshes the shared scheduler without duplicating a prep timer', () => {
    const scheduler = createFakeScheduler();
    const recorder = createRecorder(scheduler);
    recorder.setTimer(createReserve(), true);
    recorder.isPrepRecording = true;

    assert.equal(recorder.resetTimer(), true);
    assert.equal(scheduler.refreshCount, 1);
    assert.equal(scheduler.calls.length, 1);
});

test('RecorderModel schedules event relay check exactly twenty seconds before endAt', () => {
    const scheduler = createFakeScheduler();
    const recorder = createRecorder(scheduler);
    const reserve = createReserve({ endAt: 50_000_000 });

    recorder.setEventRelayTimer(reserve);

    assert.equal(scheduler.calls.length, 1);
    assert.equal(scheduler.calls[0].at, reserve.endAt - 20_000);
});

test('RecordingStreamCreator schedules and reschedules time-specified stream end by absolute time', async () => {
    const scheduler = createFakeScheduler();
    const channelStream = new PassThrough();
    const { default: RecordingStreamCreator } = loadTypeScript(
        '../../src/model/operator/recording/RecordingStreamCreator.ts',
        {
            inversify: { inject: () => () => {}, injectable: () => target => target },
            mirakurun: { __esModule: true, default: class Mirakurun {} },
            './RecordingScheduler': { recordingScheduler: scheduler },
            './IRecordingStreamCreator': { __esModule: true, default: { PREP_TIME: 15_000 } },
        },
    );
    const creator = Object.create(RecordingStreamCreator.prototype);
    creator.config = { timeSpecifiedEndMargin: 7 };
    creator.log = { system: { debug() {}, warn() {}, error() {} } };
    creator.tuners = [];
    creator.timerIndex = {};
    creator.timeSpecifiedStreams = new Map();
    creator.mirakurunClientModel = { getClient: () => ({ getServiceStream: async () => channelStream }) };
    const reserve = createReserve({
        id: 92,
        programId: null,
        channelId: 3,
        startAt: Date.now() - 1_000,
        endAt: Date.now() + 30_000,
    });

    assert.equal(await creator.create(reserve), channelStream);
    assert.equal(scheduler.calls.length, 1);
    assert.equal(scheduler.calls[0].at, reserve.endAt + 7_000);

    const updatedReserve = { ...reserve, endAt: reserve.endAt + 90_000 };
    creator.changeEndAt(updatedReserve);
    assert.equal(scheduler.calls[0].cancelled, true);
    assert.equal(scheduler.calls[1].at, updatedReserve.endAt + 7_000);

    scheduler.calls[1].callback();
    await waitForStreamClose(channelStream);
    assert.equal(channelStream.destroyed, true);
    assert.equal(scheduler.calls[1].cancelled, true);
});

test('finishing an old time-specified stream does not cancel its replacement timer', async () => {
    const scheduler = createFakeScheduler();
    const oldStream = new PassThrough();
    const replacementStream = new PassThrough();
    const streams = [oldStream, replacementStream];
    const { default: RecordingStreamCreator } = loadTypeScript(
        '../../src/model/operator/recording/RecordingStreamCreator.ts',
        {
            inversify: { inject: () => () => {}, injectable: () => target => target },
            mirakurun: { __esModule: true, default: class Mirakurun {} },
            './RecordingScheduler': { recordingScheduler: scheduler },
            './IRecordingStreamCreator': { __esModule: true, default: { PREP_TIME: 15_000 } },
        },
    );
    const creator = Object.create(RecordingStreamCreator.prototype);
    creator.config = { timeSpecifiedEndMargin: 7 };
    creator.log = { system: { debug() {}, warn() {}, error() {} } };
    creator.tuners = [];
    creator.timerIndex = {};
    creator.timeSpecifiedStreams = new Map();
    const mirakurun = { getServiceStream: async () => streams.shift() };
    creator.mirakurunClientModel = { getClient: () => mirakurun };
    const reserve = createReserve({
        id: 93,
        programId: null,
        channelId: 3,
        startAt: Date.now() - 1_000,
        endAt: Date.now() + 30_000,
    });

    assert.equal(await creator.getTimeSpecifiedStream(reserve, mirakurun), oldStream);
    assert.equal(await creator.getTimeSpecifiedStream(reserve, mirakurun), replacementStream);
    await waitForStreamClose(oldStream);

    assert.equal(oldStream.destroyed, true);
    assert.equal(creator.timeSpecifiedStreams.get(reserve.id), replacementStream);
    assert.equal(scheduler.calls[0].cancelled, true);
    assert.equal(scheduler.calls[1].cancelled, false);

    scheduler.calls[1].callback();
    await waitForStreamClose(replacementStream);
    assert.equal(replacementStream.destroyed, true);
    assert.equal(scheduler.calls[1].cancelled, true);
});

test('the end deadline destroys a time-specified stream without a tuner assignment', async () => {
    const scheduler = createFakeScheduler();
    const channelStream = new PassThrough();
    const { default: RecordingStreamCreator } = loadTypeScript(
        '../../src/model/operator/recording/RecordingStreamCreator.ts',
        {
            inversify: { inject: () => () => {}, injectable: () => target => target },
            mirakurun: { __esModule: true, default: class Mirakurun {} },
            './RecordingScheduler': { recordingScheduler: scheduler },
            './IRecordingStreamCreator': { __esModule: true, default: { PREP_TIME: 15_000 } },
        },
    );
    const creator = Object.create(RecordingStreamCreator.prototype);
    creator.config = { timeSpecifiedEndMargin: 0 };
    creator.log = { system: { debug() {}, warn() {}, error() {} } };
    creator.tuners = [];
    creator.timerIndex = {};
    creator.timeSpecifiedStreams = new Map();
    creator.mirakurunClientModel = { getClient: () => ({ getServiceStream: async () => channelStream }) };
    const reserve = createReserve({
        id: 94,
        programId: null,
        channelId: 3,
        startAt: Date.now() - 1_000,
        endAt: Date.now() + 30_000,
    });

    assert.equal(await creator.create(reserve), channelStream);
    assert.equal(creator.tuners.length, 0);
    assert.equal(creator.timeSpecifiedStreams.get(reserve.id), channelStream);
    assert.equal(scheduler.calls[0].at, reserve.endAt);

    scheduler.calls[0].callback();
    await waitForStreamClose(channelStream);

    assert.equal(channelStream.destroyed, true);
    assert.equal(creator.timeSpecifiedStreams.has(reserve.id), false);
    assert.equal(scheduler.calls[0].cancelled, true);
});
