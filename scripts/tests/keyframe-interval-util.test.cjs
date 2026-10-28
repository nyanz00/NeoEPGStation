const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/util/KeyframeIntervalUtil.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    fileName: sourcePath,
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);
const { parseKeyframePacketSample, planKeyframeSampleStages, planKeyframeSampleWindows, summarizeKeyframeSamples } =
    loadedModule.exports;

test('sample windows cover beginning, center, and end within a bounded budget', () => {
    assert.deepEqual(planKeyframeSampleWindows(120), [
        { start: 0, end: 20 },
        { start: 50, end: 70 },
        { start: 100, end: 120 },
    ]);
    assert.deepEqual(planKeyframeSampleWindows(45), [{ start: 0, end: 45 }]);
    assert.deepEqual(planKeyframeSampleWindows(0), []);
    assert.deepEqual(planKeyframeSampleWindows(-1), []);
    assert.deepEqual(planKeyframeSampleWindows(Number.NaN), []);
    assert.deepEqual(planKeyframeSampleWindows(Number.POSITIVE_INFINITY), []);
    assert.ok(planKeyframeSampleWindows(10_000).length <= 3);
    assert.ok(planKeyframeSampleWindows(10_000).reduce((sum, window) => sum + window.end - window.start, 0) <= 60);
});

test('staged plans expand each fixed location from 20 to 60 to 120 seconds and deduplicate short videos', () => {
    assert.deepEqual(planKeyframeSampleStages(600), [
        [
            { start: 0, end: 20 },
            { start: 0, end: 60 },
            { start: 0, end: 120 },
        ],
        [
            { start: 290, end: 310 },
            { start: 270, end: 330 },
            { start: 240, end: 360 },
        ],
        [
            { start: 580, end: 600 },
            { start: 540, end: 600 },
            { start: 480, end: 600 },
        ],
    ]);
    assert.deepEqual(planKeyframeSampleStages(10), [[{ start: 0, end: 10 }]]);
    assert.deepEqual(planKeyframeSampleStages(0), []);
    assert.deepEqual(planKeyframeSampleStages(Number.NaN), []);
});

test('packet sample uses PTS with DTS fallback, sorts B-frame times, and deduplicates keyframes', () => {
    const result = parseKeyframePacketSample(
        JSON.stringify({
            packets: [
                { pts_time: '12.0', dts_time: '10.0', flags: 'K_' },
                { pts_time: '11.0', dts_time: '10.5', flags: '__' },
                { pts_time: '12.0', flags: 'K_' },
                { pts_time: null, dts_time: '13.0', flags: 'K_' },
                { pts_time: '', dts_time: '14.0', flags: 'KD' },
                { pts_time: '15.0', flags: 'KC' },
                { pts_time: 'N/A', dts_time: 'bad', flags: 'K_' },
            ],
        }),
        { start: 0, end: 20 },
        10,
    );
    assert.deepEqual(result, { start: 1, end: 5, keyframeTimes: [2, 3] });
});

test('invalid packet JSON or missing packets throws, while an empty packet list uses its fallback window', () => {
    assert.throws(() => parseKeyframePacketSample('{', { start: 0, end: 10 }), /Invalid ffprobe/);
    assert.throws(() => parseKeyframePacketSample('{}', { start: 0, end: 10 }), /missing packets/);
    assert.deepEqual(parseKeyframePacketSample('{"packets":[]}', { start: 30, end: 50 }), {
        start: 30,
        end: 50,
        keyframeTimes: [],
    });
});

test('summary computes intervals only inside each window and weights the mean by interval count', () => {
    const summary = summarizeKeyframeSamples([
        { start: 0, end: 10, keyframeTimes: [0, 2, 2, 6, Number.NaN] },
        { start: 100, end: 110, keyframeTimes: [100, 109] },
    ]);
    assert.deepEqual(summary, {
        averageInterval: 5,
        minInterval: 2,
        maxInterval: 9,
        intervalCount: 3,
        keyframeCount: 5,
        sampledDuration: 20,
        sampleWindows: [
            { start: 0, end: 10, keyframeCount: 3 },
            { start: 100, end: 110, keyframeCount: 2 },
        ],
    });
});

test('summary merges overlapping or touching samples without double counting keyframes or intervals', () => {
    const summary = summarizeKeyframeSamples([
        { start: 0, end: 10, keyframeTimes: [0, 5, 10] },
        { start: 5, end: 15, keyframeTimes: [5, 10, 15] },
        { start: 15, end: 20, keyframeTimes: [15, 20] },
        { start: 100, end: 110, keyframeTimes: [100, 110] },
    ]);
    assert.deepEqual(summary, {
        averageInterval: 6,
        minInterval: 5,
        maxInterval: 10,
        intervalCount: 5,
        keyframeCount: 7,
        sampledDuration: 30,
        sampleWindows: [
            { start: 0, end: 20, keyframeCount: 5 },
            { start: 100, end: 110, keyframeCount: 2 },
        ],
    });
});

test('summary reports null interval estimates when there are not two keyframes in one sample', () => {
    assert.deepEqual(summarizeKeyframeSamples([{ start: 0, end: 10, keyframeTimes: [4, 4, Infinity] }]), {
        averageInterval: null,
        minInterval: null,
        maxInterval: null,
        intervalCount: 0,
        keyframeCount: 1,
        sampledDuration: 10,
        sampleWindows: [{ start: 0, end: 10, keyframeCount: 1 }],
    });
});
