'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const componentPath = path.resolve(__dirname, '../../client/src/components/RecordedItemActions.tsx');
const componentSource = fs.readFileSync(componentPath, 'utf8');
const sourceFile = ts.createSourceFile(componentPath, componentSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const requiredFunctions = ['formatLatestAnalysisDate', 'getVideoAnalysisStatus'];
const extractedFunctions = sourceFile.statements.filter(
    statement => ts.isFunctionDeclaration(statement) && requiredFunctions.includes(statement.name?.text),
);
assert.deepEqual(
    extractedFunctions.map(statement => statement.name.text).sort(),
    [...requiredFunctions].sort(),
    'expected to find both Info display helpers in RecordedItemActions.tsx',
);

const helperSource = extractedFunctions.map(statement => statement.getText(sourceFile)).join('\n\n');
const compiled = ts.transpileModule(
    `${helperSource}\nmodule.exports = { formatLatestAnalysisDate, getVideoAnalysisStatus };`,
    {
        compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    },
).outputText;
const helpersModule = new Module(componentPath, module);
helpersModule.filename = componentPath;
helpersModule.paths = Module._nodeModulePaths(path.dirname(componentPath));
helpersModule._compile(compiled, componentPath);
const { formatLatestAnalysisDate, getVideoAnalysisStatus } = helpersModule.exports;

const keyframes = (status, { stale = false, error = null, analyzedAt = null } = {}) => ({
    status,
    stale,
    error,
    analyzedAt,
});

test('Analyzed uses the newer valid timestamp from video and keyframe analysis', () => {
    const older = 1_700_000_000_000;
    const newer = 1_800_000_000_000;

    assert.equal(formatLatestAnalysisDate(older, newer), new Date(newer).toLocaleString());
    assert.equal(formatLatestAnalysisDate(newer, older), new Date(newer).toLocaleString());
});

test('Analyzed ignores null and invalid timestamps and uses a valid remaining timestamp', () => {
    const valid = 1_800_000_000_000;

    assert.equal(formatLatestAnalysisDate(null, valid), new Date(valid).toLocaleString());
    assert.equal(formatLatestAnalysisDate(Number.NaN, Number.POSITIVE_INFINITY, Number.MAX_VALUE), '-');
    assert.equal(formatLatestAnalysisDate(null, null), '-');
});

test('healthy ready analysis reports OK', () => {
    assert.equal(getVideoAnalysisStatus({ analysisError: null, keyframes: keyframes('ready') }), 'OK');
});

test('pending, analyzing, unavailable, error, and stale states remain visible', () => {
    const statuses = [
        ['pending', {}, 'Pending'],
        ['analyzing', {}, 'Analyzing'],
        ['unavailable', {}, 'Unavailable'],
        ['error', { error: 'decoder failed' }, 'Error: decoder failed'],
        ['ready', { stale: true }, 'Stale'],
    ];

    for (const [status, options, expected] of statuses) {
        assert.match(
            getVideoAnalysisStatus({ analysisError: null, keyframes: keyframes(status, options) }),
            new RegExp(expected),
        );
    }
});

test('video analysis errors remain visible alongside keyframe state', () => {
    assert.equal(
        getVideoAnalysisStatus({ analysisError: 'probe failed', keyframes: keyframes('pending') }),
        'Video error: probe failed; Keyframe analysis Pending',
    );
});

test('missing keyframe data is reported as unavailable', () => {
    assert.equal(getVideoAnalysisStatus({ analysisError: null }), 'Keyframe analysis unavailable');
});
