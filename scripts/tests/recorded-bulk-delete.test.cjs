'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const helperPath = path.resolve(__dirname, '../../client/src/core/media/recordedBulkDelete.ts');
const source = fs.readFileSync(helperPath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const helperModule = new Module(helperPath, module);
helperModule.filename = helperPath;
helperModule.paths = Module._nodeModulePaths(path.dirname(helperPath));
helperModule._compile(compiled, helperPath);
const { createRecordedBulkDeleteTargets, deleteRecordedBulkTargets, getRecordedDeleteFileNames } = helperModule.exports;

function recorded(id, videoFiles) {
    return { id, name: `recording-${id}`, videoFiles };
}

function file(id, name, type) {
    return { id, name, type };
}

test('name counts include actual files, including duplicate labels within one recording', () => {
    const items = [
        recorded(10, [file(1, 'TS10', 'ts'), file(2, 'AMNVQ24', 'encoded'), file(3, 'TS10', 'ts')]),
        recorded(29, [file(4, 'TS10', 'ts'), file(5, 'AMNVQ29', 'encoded')]),
    ];

    assert.deepEqual(getRecordedDeleteFileNames(items), [
        { name: 'TS10', count: 3 },
        { name: 'AMNVQ24', count: 1 },
        { name: 'AMNVQ29', count: 1 },
    ]);
});

test('selecting AMNVQ24 and AMNVQ29 across ten recordings deletes only those ten files', async () => {
    const items = [
        ...Array.from({ length: 3 }, (_, index) => recorded(index + 1, [
            file((index + 1) * 10, 'TS', 'ts'),
            file((index + 1) * 10 + 1, 'AMNVQ24', 'encoded'),
        ])),
        ...Array.from({ length: 7 }, (_, index) => recorded(index + 4, [
            file((index + 4) * 10, 'TS', 'ts'),
            file((index + 4) * 10 + 1, 'AMNVQ29', 'encoded'),
        ])),
    ];
    assert.deepEqual(getRecordedDeleteFileNames(items), [
        { name: 'TS', count: 10 },
        { name: 'AMNVQ24', count: 3 },
        { name: 'AMNVQ29', count: 7 },
    ]);

    const selectedNames = ['AMNVQ24', 'AMNVQ29'];
    const targets = createRecordedBulkDeleteTargets(items, 'names', selectedNames);
    selectedNames.splice(0, selectedNames.length, 'TS');
    const deletedVideoIds = [];
    const deleteRecordedCalls = [];
    const result = await deleteRecordedBulkTargets(
        targets,
        async id => deleteRecordedCalls.push(id),
        async id => deletedVideoIds.push(id),
    );

    assert.deepEqual(deletedVideoIds.sort((left, right) => left - right), [11, 21, 31, 41, 51, 61, 71, 81, 91, 101]);
    assert.deepEqual(deleteRecordedCalls, []);
    assert.deepEqual(result, { succeeded: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], failed: [] });
});

test('selected names match exact labels across mixed file types and never delete recordings', async () => {
    const items = [
        recorded(1, [file(11, 'same', 'ts'), file(12, 'same', 'encoded'), file(13, 'same-extra', 'ts')]),
        recorded(2, [file(21, 'same', 'encoded'), file(22, 'same-extra', 'encoded')]),
    ];
    const targets = createRecordedBulkDeleteTargets(items, 'names', ['same']);
    const calls = [];
    const result = await deleteRecordedBulkTargets(
        targets,
        async id => calls.push(['recording', id]),
        async id => calls.push(['video', id]),
    );

    assert.deepEqual(targets.map(target => [target.item.id, target.deleteRecording, target.videoFileIds]), [
        [1, false, [11, 12]],
        [2, false, [21]],
    ]);
    assert.deepEqual(calls.sort((left, right) => left[1] - right[1]), [
        ['video', 11],
        ['video', 12],
        ['video', 21],
    ]);
    assert.deepEqual(result, { succeeded: [1, 2], failed: [] });
});

test('no selected names produce no targets and no API calls', async () => {
    const items = [recorded(1, [file(11, 'video.ts', 'ts')])];
    const targets = createRecordedBulkDeleteTargets(items, 'names', []);
    const calls = [];
    const result = await deleteRecordedBulkTargets(
        targets,
        async id => calls.push(['recording', id]),
        async id => calls.push(['video', id]),
    );

    assert.deepEqual(targets, []);
    assert.deepEqual(calls, []);
    assert.deepEqual(result, { succeeded: [], failed: [] });
});

test('original and encoded options select by type, while all removes every recording including empty ones', async () => {
    const items = [
        recorded(1, [file(11, 'original.ts', 'ts'), file(12, 'encoded.mp4', 'encoded')]),
        recorded(2, undefined),
    ];

    assert.deepEqual(createRecordedBulkDeleteTargets(items, 'original', []).map(target => target.videoFileIds), [[11]]);
    assert.deepEqual(createRecordedBulkDeleteTargets(items, 'encoded', []).map(target => target.videoFileIds), [[12]]);

    const allTargets = createRecordedBulkDeleteTargets(items, 'all', []);
    const calls = [];
    const result = await deleteRecordedBulkTargets(
        allTargets,
        async id => calls.push(['recording', id]),
        async id => calls.push(['video', id]),
    );
    assert.deepEqual(allTargets.map(target => [target.item.id, target.deleteRecording, target.videoFileIds]), [
        [1, true, [11, 12]],
        [2, true, []],
    ]);
    assert.deepEqual(calls, [['recording', 1], ['recording', 2]]);
    assert.deepEqual(result, { succeeded: [1, 2], failed: [] });
});

test('records without matching files are excluded from non-all operations', () => {
    const items = [recorded(1, undefined), recorded(2, []), recorded(3, [file(31, 'keep.mp4', 'encoded')])];
    assert.deepEqual(createRecordedBulkDeleteTargets(items, 'original', []), []);
    assert.deepEqual(createRecordedBulkDeleteTargets(items, 'names', ['missing']), []);
});

test('per-file failure attempts remaining ids, fails only its record, and allows other records to succeed', async () => {
    const items = [
        recorded(1, [file(11, 'selected', 'ts'), file(12, 'selected', 'encoded'), file(13, 'selected', 'ts')]),
        recorded(2, [file(21, 'selected', 'encoded')]),
    ];
    const targets = createRecordedBulkDeleteTargets(items, 'names', ['selected']);
    const attempts = [];
    const result = await deleteRecordedBulkTargets(
        targets,
        async () => assert.fail('name deletion must not call deleteRecorded'),
        async id => {
            attempts.push(id);
            if (id === 12) throw new Error('file is locked');
        },
    );

    assert.deepEqual(attempts.filter(id => [11, 12, 13].includes(id)), [11, 12, 13]);
    assert.ok(attempts.includes(21));
    assert.deepEqual(result.succeeded, [2]);
    assert.deepEqual(result.failed, [{ item: items[0], error: 'file is locked' }]);
});
