const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const { finished } = require('node:stream/promises');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/operator/recording/RecorderModel.ts');
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
const logger = { info() {}, warn() {}, error() {}, fatal() {}, debug() {} };
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath) {
        if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
        if (request === './IRecordingStreamCreator') {
            return { __esModule: true, default: { PREP_TIME: 15_000 } };
        }
        if (request === '../../../util/FileUtil') {
            return { __esModule: true, default: { unlink: async filePath => fs.promises.unlink(filePath) } };
        }
        if (request === '../../../util/StrUtil') {
            return { __esModule: true, default: { deleteBrackets: value => value } };
        }
        if (request.endsWith('/DropLogFile')) return { __esModule: true, default: class DropLogFile {} };
        if (request.endsWith('/Recorded')) return { __esModule: true, default: class Recorded {} };
        if (request.endsWith('/RecordedHistory')) return { __esModule: true, default: class RecordedHistory {} };
        if (request.endsWith('/VideoFile')) return { __esModule: true, default: class VideoFile {} };
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const RecorderModel = loadedModule.exports.default;

function makeReserve({ programId = null, isTimeSpecified = programId === null, endAt = Date.now() + 120_000 } = {}) {
    return {
        id: 1,
        programId,
        channelId: 2,
        channelType: 'GR',
        channel: { type: 'GR', channel: '13' },
        startAt: Date.now(),
        endAt,
        isTimeSpecified,
        isConflict: false,
        isSkip: false,
        isOverlap: false,
        allowEndLack: false,
        ruleId: null,
        isEventRelay: false,
    };
}

function makeRecorder({ stream, dropChecker, streamCreator = {}, reserve = makeReserve(), dropCheck = true } = {}) {
    const events = [];
    const recorder = new RecorderModel(
        { getLogger: () => ({ system: logger, stream: logger }) },
        { getConfig: () => ({ isEnabledDropCheck: dropCheck, dropLog: os.tmpdir() }) },
        { findId: async () => ({ id: 123 }) },
        { findId: async () => reserve },
        { insertOnce: async () => 100, removeRecording: async () => {} },
        { insertOnce: async () => {} },
        { insertOnce: async () => 200 },
        { insertOnce: async () => 300 },
        streamCreator,
        dropChecker,
        {
            getRecPath: async () => ({
                fullPath: path.join(os.tmpdir(), `recorder-regression-${process.pid}.ts`),
                parendDir: { name: 'tmp' },
                subDir: '',
                fileName: 'recording.ts',
            }),
        },
        {
            emitStartPrepRecording: () => events.push('prep'),
            emitPrepRecordingFailed: () => events.push('prep-failed'),
            emitCancelPrepRecording: () => events.push('cancel'),
            emitStartRecording: () => events.push('recording'),
            emitFinishRecording: () => {},
        },
        { getClient: () => ({}) },
    );
    recorder.reserve = reserve;
    if (stream !== undefined) recorder.stream = stream;
    recorder.addRecorded = async () => ({ id: 100 });
    recorder.setEndProcess = () => {};
    return { recorder, events };
}

const deferred = () => {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
};

test('the first stream chunk reaches both the recording file and DropChecker', async () => {
    const source = new PassThrough();
    const dropStartEntered = deferred();
    const releaseDropStart = deferred();
    const checked = [];
    const destination = path.join(os.tmpdir(), `recorder-regression-${process.pid}.ts`);
    const dropChecker = {
        prepare: async () => {
            dropStartEntered.resolve();
            await releaseDropStart.promise;
        },
        attach: (_file, input) => input.on('data', chunk => checked.push(chunk.toString())),
        getFilePath: () => null,
        setRecordingEndAt() {},
        stop: async () => {},
    };
    const { recorder } = makeRecorder({ stream: source, dropChecker });
    const recordingPromise = recorder.doRecord();

    await dropStartEntered.promise;
    source.write('first-chunk');
    await new Promise(resolve => setImmediate(resolve));
    releaseDropStart.resolve();
    await new Promise(resolve => setImmediate(resolve));
    source.write('second-chunk');
    await recordingPromise;
    source.end();
    await finished(recorder.recFile);

    const recorded = await fs.promises.readFile(destination, 'utf8');
    await fs.promises.unlink(destination).catch(() => {});
    assert.equal(recorded, 'first-chunksecond-chunk');
    assert.deepEqual(checked, ['first-chunk', 'second-chunk']);
});

test('a failed recorded-program insert rejects doRecord without an unhandled rejection', async () => {
    const source = new PassThrough();
    const dropStartEntered = deferred();
    const releaseDropStart = deferred();
    const destination = path.join(os.tmpdir(), `recorder-regression-${process.pid}.ts`);
    let unhandledRejection;
    const onUnhandledRejection = error => {
        unhandledRejection = error;
    };
    const dropChecker = {
        prepare: async () => {
            dropStartEntered.resolve();
            await releaseDropStart.promise;
        },
        attach: (_file, input) => input.resume(),
        getFilePath: () => null,
        setRecordingEndAt() {},
        stop: async () => {},
    };
    const { recorder } = makeRecorder({ stream: source, dropChecker });
    recorder.addRecorded = async () => {
        throw new Error('AddRecordedDBError');
    };
    process.on('unhandledRejection', onUnhandledRejection);
    const recordingPromise = recorder.doRecord();

    try {
        await dropStartEntered.promise;
        releaseDropStart.resolve();
        await new Promise(resolve => setImmediate(resolve));
        source.write('first-chunk');
        await assert.rejects(recordingPromise, /AddRecordedDBError/);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(unhandledRejection, undefined);
    } finally {
        releaseDropStart.resolve();
        process.removeListener('unhandledRejection', onUnhandledRejection);
        source.destroy();
        await finished(recorder.recFile).catch(() => {});
        await fs.promises.unlink(destination).catch(() => {});
    }
});

test('a source error during DropChecker preparation rejects doRecord', async () => {
    const source = new PassThrough();
    const dropStartEntered = deferred();
    const releaseDropStart = deferred();
    const destination = path.join(os.tmpdir(), `recorder-regression-${process.pid}.ts`);
    const streamError = new Error('SourceFailedDuringDropPrepare');
    let unhandledRejection;
    const onUnhandledRejection = error => {
        unhandledRejection = error;
    };
    const dropChecker = {
        prepare: async () => {
            dropStartEntered.resolve();
            await releaseDropStart.promise;
        },
        attach: (_file, input) => input.resume(),
        getFilePath: () => null,
        setRecordingEndAt() {},
        stop: async () => {},
    };
    const { recorder } = makeRecorder({ stream: source, dropChecker });
    process.on('unhandledRejection', onUnhandledRejection);
    const recordingPromise = recorder.doRecord();

    try {
        await dropStartEntered.promise;
        source.destroy(streamError);
        releaseDropStart.resolve();
        await assert.rejects(recordingPromise, /SourceFailedDuringDropPrepare/);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(unhandledRejection, undefined);
    } finally {
        releaseDropStart.resolve();
        process.removeListener('unhandledRejection', onUnhandledRejection);
        source.destroy();
        await finished(recorder.recFile).catch(() => {});
        await fs.promises.unlink(destination).catch(() => {});
    }
});

test('a hanging Mirakurun stream response is aborted after 30 seconds', async () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const scheduled = [];
    let observedSignal;
    let createCalls = 0;
    let model;
    global.setTimeout = (callback, delay, ...args) => {
        const timer = { callback, delay, args, cleared: false, fakeTimer: true };
        if (delay === 30_000 || delay === 5_000) {
            scheduled.push(timer);
            return timer;
        }
        return originalSetTimeout(callback, delay, ...args);
    };
    global.clearTimeout = timer => {
        if (timer?.fakeTimer === true) timer.cleared = true;
        else originalClearTimeout(timer);
    };

    try {
        const reserve = makeReserve({ programId: 99, isTimeSpecified: false });
        const { recorder } = makeRecorder({
            reserve,
            dropCheck: false,
            streamCreator: {
                create: (_reserve, signal) => {
                    createCalls++;
                    observedSignal = signal;
                    return new Promise((_resolve, reject) => {
                        signal.addEventListener('abort', () => reject(new Error('aborted')));
                    });
                },
            },
        });
        model = recorder;
        const preparation = recorder.prepRecord();
        await new Promise(resolve => originalSetTimeout(resolve, 0));
        const responseTimer = scheduled.find(timer => timer.delay === 30_000);
        assert.ok(responseTimer, 'preparation must arm a 30-second response timeout');
        responseTimer.callback();
        await preparation;
        assert.equal(observedSignal.aborted, true);
        assert.equal(createCalls, 1);
        assert.ok(
            scheduled.some(timer => timer.delay === 5_000),
            'a timed out attempt should schedule a retry',
        );
    } finally {
        if (model?.abortController !== null) {
            model.isStopPrepRec = true;
            model.abortController?.abort();
        }
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

test('program reservations keep retrying until endAt after the ordinary retry count', async () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const scheduled = [];
    let createCalls = 0;
    let model;
    global.setTimeout = (callback, delay, ...args) => {
        const timer = { callback, delay, args, cleared: false, fakeTimer: true };
        if (delay === 5_000) {
            scheduled.push(timer);
            return timer;
        }
        return originalSetTimeout(callback, delay, ...args);
    };
    global.clearTimeout = timer => {
        if (timer?.fakeTimer === true) timer.cleared = true;
        else originalClearTimeout(timer);
    };

    try {
        const reserve = makeReserve({ programId: 99, isTimeSpecified: false });
        const { recorder } = makeRecorder({
            reserve,
            dropCheck: false,
            streamCreator: {
                create: async () => {
                    createCalls++;
                    throw new Error('not ready');
                },
            },
        });
        model = recorder;
        await recorder.prepRecord(3);
        assert.ok(scheduled[0], 'program reservations should keep the five-second retry after the regular retry count');
        assert.equal(createCalls, 1);
    } finally {
        if (model?.abortController !== null) {
            model.isStopPrepRec = true;
            model.abortController?.abort();
        }
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});

test('a cancelled pending retry does not open another Mirakurun stream', async () => {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const scheduled = [];
    let createCalls = 0;
    let model;
    global.setTimeout = (callback, delay, ...args) => {
        const timer = { callback, delay, args, cleared: false, fakeTimer: true };
        if (delay === 5_000) {
            scheduled.push(timer);
            return timer;
        }
        return originalSetTimeout(callback, delay, ...args);
    };
    global.clearTimeout = timer => {
        if (timer?.fakeTimer === true) timer.cleared = true;
        else originalClearTimeout(timer);
    };

    try {
        const reserve = makeReserve({ programId: 99, isTimeSpecified: false });
        const { recorder } = makeRecorder({
            reserve,
            dropCheck: false,
            streamCreator: {
                create: async () => {
                    createCalls++;
                    throw new Error('not ready');
                },
            },
        });
        model = recorder;
        await recorder.prepRecord(0);
        assert.ok(scheduled[0], 'the initial failure should enqueue a retry');

        model.isStopPrepRec = true;
        scheduled[0].callback();
        await new Promise(resolve => originalSetTimeout(resolve, 0));
        assert.equal(createCalls, 1);
    } finally {
        if (model?.abortController !== null) {
            model.isStopPrepRec = true;
            model.abortController?.abort();
        }
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
    }
});
