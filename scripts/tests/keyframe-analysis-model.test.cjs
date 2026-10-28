const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/video/KeyframeAnalysisModel.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        experimentalDecorators: true,
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
    fileName: sourcePath,
}).outputText;

class VideoFileKeyframeInfo {}
class VideoFile {}
class VideoFileTsInfo {}
class Recorded {}

const processHarness = { spawn: null, killed: [] };
const utilPath = path.resolve(__dirname, '../../src/util/KeyframeIntervalUtil.ts');
const utilModule = new Module(utilPath, module);
utilModule.filename = utilPath;
utilModule.paths = Module._nodeModulePaths(path.dirname(utilPath));
utilModule._compile(
    ts.transpileModule(fs.readFileSync(utilPath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText,
    utilPath,
);
const keyframeUtil = utilModule.exports;
const moduleMocks = {
    inversify: {
        inject: () => () => {},
        injectable: () => target => target,
    },
    '../../../api': {},
    '../../db/entities/Recorded': { __esModule: true, default: Recorded },
    '../../db/entities/VideoFile': { __esModule: true, default: VideoFile },
    '../../db/entities/VideoFileKeyframeInfo': { __esModule: true, default: VideoFileKeyframeInfo },
    '../../db/entities/VideoFileTsInfo': { __esModule: true, default: VideoFileTsInfo },
    '../../util/KeyframeIntervalUtil': {
        ...keyframeUtil,
        parseKeyframePacketSample: (output, fallbackWindow) => ({
            ...fallbackWindow,
            keyframeTimes: JSON.parse(output).keyframeTimes,
        }),
    },
    '../../util/ManagedProcess': {
        killManaged: async child => {
            processHarness.killed.push(child);
        },
        spawnManaged: (...args) => {
            assert.equal(typeof processHarness.spawn, 'function', 'test must provide a child process');
            return processHarness.spawn(...args);
        },
    },
    '../RecordedFileUse': { acquireRecordedFileUse: async () => ({ release: async () => {} }) },
};

const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath && Object.prototype.hasOwnProperty.call(moduleMocks, request)) {
        return moduleMocks[request];
    }
    if (parent?.filename === sourcePath && request.startsWith('.')) return {};
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const KeyframeAnalysisModel = loadedModule.exports.default;
const { KEYFRAME_ANALYSIS_VERSION } = loadedModule.exports;

function makeRow(overrides = {}) {
    return {
        videoFileId: 41,
        version: KEYFRAME_ANALYSIS_VERSION,
        status: 'ready',
        sourceSize: 1000,
        sourceMtime: 2000,
        requestedAt: 3000,
        attemptedAt: 4000,
        result: JSON.stringify({
            version: KEYFRAME_ANALYSIS_VERSION,
            sourceSize: 1000,
            sourceMtime: 2000,
            analyzedAt: 5000,
            averageInterval: 4,
            minInterval: 3,
            maxInterval: 5,
            intervalCount: 6,
            keyframeCount: 7,
            sampledDuration: 20,
            sampleWindows: [{ start: 0, end: 20, keyframeCount: 7 }],
        }),
        error: null,
        ...overrides,
    };
}

function createModel(row) {
    const updates = [];
    const repo = {
        createQueryBuilder: () => ({
            insert() {
                return this;
            },
            values() {
                return this;
            },
            orIgnore() {
                return this;
            },
            execute: async () => {},
        }),
        findOneBy: async () => row,
        findOneByOrFail: async () => row,
        update: async (where, values) => {
            updates.push({ where, values });
            if (
                (where.requestedAt === undefined || where.requestedAt === row.requestedAt) &&
                (where.status === undefined || where.status === row.status)
            ) {
                Object.assign(row, values);
                return { affected: 1 };
            }
            return { affected: 0 };
        },
    };
    const db = { getConnection: async () => ({ getRepository: () => repo }) };
    const model = new KeyframeAnalysisModel(
        db,
        { getConfig: () => ({ ffprobe: 'ffprobe' }) },
        { getFullFilePathFromVideoFile: () => 'sample.ts' },
        { getLogger: () => ({ system: { warn() {}, error() {} } }) },
    );
    return { model, row, updates };
}

test('request reuses a successful same-source cached result without scheduling a refresh', async () => {
    const { model, row, updates } = createModel(makeRow());

    const result = await model.request({ id: 41 }, 1000, 2000);

    assert.equal(result.status, 'ready');
    assert.equal(result.averageInterval, 4);
    assert.equal(result.keyframeCount, 7);
    assert.equal(result.stale, false);
    assert.equal(updates.length, 0);
    assert.equal(row.status, 'ready');
});

test('forced refresh marks the result stale but preserves the last successful metrics', async () => {
    const { model, row, updates } = createModel(makeRow());
    const cachedResult = row.result;

    const result = await model.request({ id: 41 }, 1000, 2000, true);

    assert.equal(row.status, 'pending');
    assert.equal(row.result, cachedResult);
    assert.equal(result.status, 'pending');
    assert.equal(result.averageInterval, 4);
    assert.equal(result.analyzedAt, 5000);
    assert.equal(result.stale, true);
    assert.equal(updates.length, 1);
});

test('an error inside the retry cooldown is returned with cached data and is not rescheduled', async () => {
    const row = makeRow({ status: 'error', error: 'ffprobe failed', attemptedAt: Date.now() });
    const { model, updates } = createModel(row);

    const result = await model.request({ id: 41 }, 1000, 2000);

    assert.equal(result.status, 'error');
    assert.equal(result.error, 'ffprobe failed');
    assert.equal(result.averageInterval, 4);
    assert.equal(result.stale, true);
    assert.equal(updates.length, 0);
});

test('refreshed basic metadata wakes a request that previously lacked a matching duration or time origin', async () => {
    const { model, updates } = createModel(
        makeRow({ status: 'error', error: 'Error: BasicVideoAnalysisOutdated', attemptedAt: Date.now() }),
    );
    const result = await model.request(
        { id: 41, analyzedSize: 1000, analyzedMtime: 2000, analysisError: null },
        1000,
        2000,
    );
    assert.equal(result.status, 'pending');
    assert.equal(result.averageInterval, 4);
    assert.equal(result.stale, true);
    assert.equal(updates.length, 1);
});

test('a keyframe analysis version change queues a refresh and exposes the prior result as stale', async () => {
    const row = makeRow({ version: KEYFRAME_ANALYSIS_VERSION - 1 });
    row.result = JSON.stringify({ ...JSON.parse(row.result), version: KEYFRAME_ANALYSIS_VERSION - 1 });
    const { model, updates } = createModel(row);

    const result = await model.request({ id: 41 }, 1000, 2000);

    assert.equal(row.version, KEYFRAME_ANALYSIS_VERSION);
    assert.equal(row.status, 'pending');
    assert.equal(result.version, KEYFRAME_ANALYSIS_VERSION - 1);
    assert.equal(result.currentVersion, KEYFRAME_ANALYSIS_VERSION);
    assert.equal(result.averageInterval, 4);
    assert.equal(result.stale, true);
    assert.equal(updates.length, 1);
});

test('an unavailable result from the fixed-window version is queued again under the adaptive version', async () => {
    const row = makeRow({ status: 'unavailable', version: KEYFRAME_ANALYSIS_VERSION - 1 });
    row.result = JSON.stringify({
        ...JSON.parse(row.result),
        version: KEYFRAME_ANALYSIS_VERSION - 1,
        averageInterval: null,
        minInterval: null,
        maxInterval: null,
        intervalCount: 0,
    });
    const { model } = createModel(row);
    const result = await model.request({ id: 41 }, 1000, 2000);
    assert.equal(result.status, 'pending');
    assert.equal(result.currentVersion, 2);
    assert.equal(result.averageInterval, null);
    assert.equal(result.stale, true);
});

test('a changed source fingerprint queues a refresh and retains cached metrics', async () => {
    const { model, row } = createModel(makeRow());

    const result = await model.request({ id: 41 }, 2000, 3000);

    assert.equal(row.status, 'pending');
    assert.equal(row.sourceSize, 2000);
    assert.equal(row.sourceMtime, 3000);
    assert.equal(result.averageInterval, 4);
    assert.equal(result.stale, true);
});

function fakeChild() {
    const child = new EventEmitter();
    child.stdout = new PassThrough();
    child.stderr = new PassThrough();
    return child;
}

test('probe timeout kills the child but waits for close before rejecting', async () => {
    const { model } = createModel(makeRow());
    const child = fakeChild();
    processHarness.killed = [];
    processHarness.spawn = () => child;

    let timeoutCallback;
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    global.setTimeout = (callback, delay) => {
        assert.equal(delay, 20_000);
        timeoutCallback = callback;
        return { fakeTimer: true };
    };
    global.clearTimeout = () => {};
    try {
        let settled = false;
        const pending = model.probe('sample.ts', '0', 0, 20).finally(() => {
            settled = true;
        });
        assert.equal(typeof timeoutCallback, 'function');
        timeoutCallback();
        await Promise.resolve();
        assert.deepEqual(processHarness.killed, [child]);
        assert.equal(settled, false);

        child.emit('close', null);
        await assert.rejects(pending, /KeyframeProbeTimeout/);
        assert.equal(settled, true);
        assert.equal(model.child, null);
    } finally {
        global.setTimeout = originalSetTimeout;
        global.clearTimeout = originalClearTimeout;
        processHarness.spawn = null;
    }
});

test('probe returns stdout only after the child closes successfully', async () => {
    const { model } = createModel(makeRow());
    const child = fakeChild();
    processHarness.spawn = () => child;

    const pending = model.probe('sample.ts', '0', 0, 20);
    child.stdout.write('{"packets":[]}');
    let settled = false;
    void pending.then(() => {
        settled = true;
    });
    await Promise.resolve();
    assert.equal(settled, false);

    child.emit('close', 0);
    assert.equal(await pending, '{"packets":[]}');
    assert.equal(settled, true);
    processHarness.spawn = null;
});

async function sampleWithResponses(duration, responseForWindow) {
    const { model } = createModel(makeRow());
    model.stopped = false;
    const calls = [];
    model.probe = async (filePath, stream, start, windowDuration) => {
        calls.push({ filePath, stream, start, duration: windowDuration });
        const relativeStart = start - 1000;
        return JSON.stringify({ keyframeTimes: responseForWindow(relativeStart, windowDuration) });
    };
    const samples = await model.sampleKeyframes('video.ts', '1', duration, 1000);
    return { calls, samples };
}

test('adaptive sampling stops at 20 seconds once a location has three keyframes', async () => {
    const { calls, samples } = await sampleWithResponses(600, start => [start, start + 5, start + 10]);

    assert.equal(KEYFRAME_ANALYSIS_VERSION, 2);
    assert.equal(calls.length, 3);
    assert.deepEqual(
        calls.map(({ start, duration }) => [start, duration]),
        [
            [1000, 20],
            [1290, 20],
            [1580, 20],
        ],
    );
    assert.equal(samples.length, 3);
    assert.ok(samples.every(sample => sample.keyframeTimes.length === 3));
});

test('a 25-second keyframe interval expands a location to 60 seconds and then stops', async () => {
    const { calls, samples } = await sampleWithResponses(600, (start, duration) =>
        duration === 20 ? [start] : [start, start + 25, start + 50],
    );

    assert.equal(calls.length, 6);
    assert.equal(calls.length, samples.length);
    assert.deepEqual(
        calls.map(({ start, duration }) => [start, duration]),
        [
            [1000, 20],
            [1000, 60],
            [1290, 20],
            [1270, 60],
            [1580, 20],
            [1540, 60],
        ],
    );
});

test('each location expands independently and keeps its 120-second result when still sparse', async () => {
    const { calls, samples } = await sampleWithResponses(600, (start, duration) => {
        if (start === 0) return [0, 5, 10];
        if (start === 290 || start === 580) return [start];
        if (start === 270 || start === 540) return [start, start + 25];
        return [start, start + 25];
    });

    assert.deepEqual(
        calls.map(({ start, duration }) => [start - 1000, duration]),
        [
            [0, 20],
            [290, 20],
            [270, 60],
            [240, 120],
            [580, 20],
            [540, 60],
            [480, 120],
        ],
    );
    assert.equal(samples.length, 7);
    assert.deepEqual(
        samples.map(sample => sample.keyframeTimes.length),
        [3, 1, 2, 2, 1, 2, 2],
    );
});

test('short videos use the deduplicated fallback window and sparse maximum samples remain usable', async () => {
    const short = await sampleWithResponses(10, start => [start, start + 5]);
    assert.equal(short.calls.length, 1);
    assert.deepEqual(short.samples[0], { start: 0, end: 10, keyframeTimes: [0, 5] });

    const maximum = await sampleWithResponses(600, (start, duration) =>
        duration < 120 ? [start] : [start, start + 25],
    );
    assert.equal(maximum.calls.length, 9);
    assert.equal(maximum.samples.length, 9);
    assert.deepEqual(
        maximum.samples.map(sample => sample.keyframeTimes.length),
        [1, 1, 2, 1, 1, 2, 1, 1, 2],
    );
    assert.equal(keyframeUtil.summarizeKeyframeSamples(maximum.samples).averageInterval, 25);
});

test('sampling with no measurable interval stops at the limit and reports unknown instead of zero', async () => {
    const { calls, samples } = await sampleWithResponses(600, () => []);
    assert.equal(calls.length, 9);
    const summary = keyframeUtil.summarizeKeyframeSamples(samples);
    assert.equal(summary.intervalCount, 0);
    assert.equal(summary.averageInterval, null);
});
