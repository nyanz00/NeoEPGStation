'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const helperPath = path.resolve(__dirname, '../../client/src/core/media/recordedBulkEncode.ts');
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
const { createBulkEncodeJobs, getCommonEncodeSourceNames, submitBulkEncodeJobs } = helperModule.exports;

function recorded(id, name, files, extra = {}) {
    return {
        id,
        name,
        isRecording: false,
        videoFiles: files,
        ...extra,
    };
}

function file(id, name) {
    return { id, name };
}

const settings = {
    mode: 'h264',
    removeOriginal: true,
    updateThumbnail: false,
    isSaveSameDirectory: false,
    parentDir: '  D:\\encoded  ',
    directory: '  Drama  ',
};

test('common sources are the exact nonempty name intersection across all records', () => {
    const items = [
        recorded(1, 'one', [file(10, 'source.ts'), file(11, 'shared.m2ts'), file(12, '')]),
        recorded(2, 'two', [file(20, 'shared.m2ts'), file(21, 'source.tsx')]),
        recorded(3, 'three', [file(30, 'shared.m2ts'), file(31, 'SOURCE.ts')]),
    ];

    assert.deepEqual(getCommonEncodeSourceNames(items), ['shared.m2ts']);
    assert.deepEqual(getCommonEncodeSourceNames([]), []);
    assert.deepEqual(getCommonEncodeSourceNames([recorded(4, 'missing', undefined)]), []);
    assert.deepEqual(getCommonEncodeSourceNames([recorded(5, 'empty', [])]), []);
});

test('jobs match duplicate source labels per record and carry each record source id', () => {
    const items = [
        recorded(1, 'first', [file(10, 'main.ts'), file(11, 'main.ts')]),
        recorded(2, 'second', [file(20, 'other.ts'), file(21, 'main.ts')]),
    ];

    const jobs = createBulkEncodeJobs(items, 'main.ts', settings);
    assert.deepEqual(
        jobs.map(job => job.option.sourceVideoFileId),
        [10, 21],
    );
    assert.deepEqual(
        jobs.map(job => job.recordedId),
        [1, 2],
    );
    assert.deepEqual(
        jobs.map(job => job.option.recordedId),
        [1, 2],
    );
    assert.deepEqual(
        jobs.map(job => job.option.parentDir),
        ['  D:\\encoded  ', '  D:\\encoded  '],
    );
    assert.deepEqual(
        jobs.map(job => job.option.directory),
        ['Drama', 'Drama'],
    );
});

test('same directory jobs omit parent and subdirectory even when stale values are supplied', () => {
    const options = { ...settings, isSaveSameDirectory: true, parentDir: 'stale-parent', directory: ' stale-child ' };
    const jobs = createBulkEncodeJobs([recorded(8, 'eight', [file(80, 'video.ts')])], 'video.ts', options);

    assert.equal(jobs.length, 1);
    assert.equal(jobs[0].option.isSaveSameDirectory, true);
    assert.equal(Object.hasOwn(jobs[0].option, 'parentDir'), false);
    assert.equal(Object.hasOwn(jobs[0].option, 'directory'), false);
});

test('explicit output directory is trimmed, while blank subdirectory is omitted', () => {
    const item = recorded(1, 'one', [file(10, 'source.ts')]);
    const withDirectory = createBulkEncodeJobs([item], 'source.ts', { ...settings, directory: '  nested path  ' });
    const withoutDirectory = createBulkEncodeJobs([item], 'source.ts', { ...settings, directory: '   ' });

    assert.equal(withDirectory[0].option.directory, 'nested path');
    assert.equal(Object.hasOwn(withoutDirectory[0].option, 'directory'), false);
});

test('rejects missing, non-common, recording, or incomplete submissions before enqueue', async () => {
    const first = recorded(1, 'first', [file(10, 'a.ts')]);
    const second = recorded(2, 'second', [file(20, 'b.ts')]);
    assert.throws(() => createBulkEncodeJobs([], 'a.ts', settings));
    assert.throws(() => createBulkEncodeJobs([first, second], 'a.ts', settings));
    assert.throws(() =>
        createBulkEncodeJobs([recorded(3, 'busy', [file(30, 'a.ts')], { isRecording: true })], 'a.ts', settings),
    );
    assert.throws(() => createBulkEncodeJobs([first], 'a.ts', { ...settings, mode: '' }));
    assert.throws(() => createBulkEncodeJobs([first], 'a.ts', { ...settings, parentDir: '' }));
});

test('intakes sequentially, records partial failures and reports attempted progress', async () => {
    const jobs = createBulkEncodeJobs(
        [1, 2, 3].map(id => recorded(id, `record-${id}`, [file(id * 10, 'shared.ts')])),
        'shared.ts',
        settings,
    );
    const pending = new Set();
    const calls = [];
    const progress = [];
    const enqueue = option => {
        assert.equal(pending.size, 0, 'the next enqueue must wait for the previous one');
        calls.push(option.recordedId);
        pending.add(option.recordedId);
        return new Promise((resolve, reject) => {
            setImmediate(() => {
                pending.delete(option.recordedId);
                if (option.recordedId === 2) reject(new Error('queue full'));
                else resolve(option.recordedId + 100);
            });
        });
    };

    const result = await submitBulkEncodeJobs(
        jobs,
        enqueue,
        count => progress.push(count),
        () => true,
    );
    assert.deepEqual(calls, [1, 2, 3]);
    assert.deepEqual(
        result.succeeded.map(job => job.recordedId),
        [1, 3],
    );
    assert.deepEqual(result.failed, [{ job: jobs[1], error: 'queue full' }]);
    assert.deepEqual(progress, [1, 2, 3]);
});

test('retrying failed job objects leaves successes out and retains original option snapshots', async () => {
    const snapshots = [
        { recordedId: 11, sourceVideoFileId: 110, mode: 'old', parentDir: 'D:\\old', removeOriginal: true },
        { recordedId: 12, sourceVideoFileId: 120, mode: 'old', parentDir: 'D:\\old', removeOriginal: true },
    ];
    const jobs = snapshots.map(option => ({
        recordedId: option.recordedId,
        recordedName: `rec-${option.recordedId}`,
        option: { ...option },
    }));
    const first = await submitBulkEncodeJobs(
        jobs,
        async option => {
            if (option.recordedId === 12) throw 'temporary';
            return 1;
        },
        () => {},
        () => true,
    );
    const retryJobs = first.failed.map(failure => failure.job);
    const attemptedRetry = [];
    const retry = await submitBulkEncodeJobs(
        retryJobs,
        async option => {
            attemptedRetry.push(option);
            return 2;
        },
        () => {},
        () => true,
    );

    assert.deepEqual(
        first.succeeded.map(job => job.recordedId),
        [11],
    );
    assert.deepEqual(
        attemptedRetry.map(option => option.recordedId),
        [12],
    );
    assert.deepEqual(attemptedRetry[0], snapshots[1]);
    assert.deepEqual(retry.succeeded, retryJobs);
    assert.deepEqual(retry.failed, []);
});

test('stops intake after continuation turns false during enqueue', async () => {
    const jobs = createBulkEncodeJobs(
        [1, 2, 3].map(id => recorded(id, `record-${id}`, [file(id, 'shared.ts')])),
        'shared.ts',
        settings,
    );
    let active = true;
    const attempted = [];
    const progress = [];
    const result = await submitBulkEncodeJobs(
        jobs,
        async option => {
            attempted.push(option.recordedId);
            if (option.recordedId === 1) active = false;
            return 1;
        },
        count => progress.push(count),
        () => active,
    );

    assert.deepEqual(attempted, [1]);
    assert.deepEqual(
        result.succeeded.map(job => job.recordedId),
        [1],
    );
    assert.deepEqual(result.failed, []);
    assert.deepEqual(progress, []);
});

function createHookHarness() {
    let states = [];
    let refs = [];
    let memos = [];
    let effects = [];
    let cursor = 0;
    let dirty = false;
    const sameDeps = (left, right) =>
        left !== undefined &&
        left.length === right.length &&
        left.every((value, index) => Object.is(value, right[index]));
    const hooks = {
        useState(initial) {
            const index = cursor++;
            if (!(index in states)) states[index] = typeof initial === 'function' ? initial() : initial;
            return [
                states[index],
                value => {
                    const next = typeof value === 'function' ? value(states[index]) : value;
                    if (!Object.is(states[index], next)) {
                        states[index] = next;
                        dirty = true;
                    }
                },
            ];
        },
        useRef(initial) {
            const index = cursor++;
            if (!(index in refs)) refs[index] = { current: initial };
            return refs[index];
        },
        useMemo(factory, dependencies) {
            const index = cursor++;
            if (!sameDeps(memos[index]?.dependencies, dependencies)) memos[index] = { dependencies, value: factory() };
            return memos[index].value;
        },
        useCallback(callback, dependencies) {
            return hooks.useMemo(() => callback, dependencies);
        },
        useEffect(effect, dependencies) {
            const index = cursor++;
            if (!sameDeps(effects[index]?.dependencies, dependencies))
                effects[index] = { dependencies, effect, cleanup: undefined, pending: true };
        },
    };
    return {
        hooks,
        render(component, props) {
            let tree;
            for (let pass = 0; pass < 30; pass++) {
                dirty = false;
                cursor = 0;
                tree = component(props);
                for (const item of effects.filter(effect => effect?.pending)) {
                    item.pending = false;
                    item.cleanup = item.effect();
                }
                if (!dirty) return tree;
            }
            assert.fail('React hook harness did not settle after effects');
        },
        unmount() {
            for (const effect of effects) if (typeof effect?.cleanup === 'function') effect.cleanup();
        },
    };
}

function loadBulkDialog({ configData, settings: savedSettings, addManualEncode = async () => 1 } = {}) {
    const harness = createHookHarness();
    const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
    const muiNames = [
        'Alert',
        'Box',
        'Button',
        'Checkbox',
        'Dialog',
        'DialogActions',
        'DialogContent',
        'DialogTitle',
        'FormControl',
        'FormControlLabel',
        'IconButton',
        'InputLabel',
        'LinearProgress',
        'MenuItem',
        'Select',
        'Stack',
        'TextField',
        'Typography',
    ];
    const material = Object.fromEntries(muiNames.map(name => [name, name]));
    const apiCalls = [];
    const notifications = [];
    const api = {
        getConfig: async () => configData,
        addManualEncode: async option => {
            apiCalls.push(option);
            return addManualEncode(option);
        },
    };
    const dependencies = {
        '@mui/icons-material/CloseOutlined': 'CloseOutlined',
        '@mui/material': material,
        '@tanstack/react-query': {
            useQuery: () => ({ data: configData, isPending: false, isError: false, refetch: async () => {} }),
        },
        react: harness.hooks,
        'react/jsx-runtime': jsxRuntime,
        '../core/api/queries': { api },
        '../core/notifications/Notifications': {
            useNotifications: () => ({ notify: (...args) => notifications.push(args) }),
        },
        '../core/media/recordedBulkEncode': helperModule.exports,
        '../core/storage/encode': {
            loadAddEncodeSettings: () =>
                savedSettings ?? {
                    encodeMode: 'h264',
                    isSaveSameDirectory: false,
                    parentDirectory: 'D:\\recorded',
                    removeOriginal: false,
                    updateThumbnail: false,
                },
            saveAddEncodeSettings: () => {},
        },
        './programDialogStyles': { programDialogClose: {}, programDialogFields: {}, programDialogPaper: () => ({}) },
    };
    const componentPath = path.resolve(__dirname, '../../client/src/components/RecordedBulkEncodeDialog.tsx');
    const componentSource = fs.readFileSync(componentPath, 'utf8');
    const componentCompiled = ts.transpileModule(componentSource, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const componentModule = new Module(componentPath, module);
    componentModule.filename = componentPath;
    componentModule.paths = Module._nodeModulePaths(path.dirname(componentPath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === componentPath && request in dependencies) return dependencies[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        componentModule._compile(componentCompiled, componentPath);
    } finally {
        Module._load = originalLoad;
    }
    return { component: componentModule.exports.RecordedBulkEncodeDialog, harness, apiCalls, notifications };
}

function bulkItems() {
    return [
        recorded(1, 'first', [file(10, 'common.ts'), file(11, 'only-first.ts')]),
        recorded(2, 'second', [file(20, 'common.ts'), file(21, 'only-second.ts')]),
    ];
}

function button(tree, label) {
    const match = descendants(tree, node => node.type === 'Button' && treeText(node).includes(label))[0];
    assert.ok(match, `Expected button containing ${label}`);
    return match;
}

function treeText(node) {
    if (node === null || node === undefined || typeof node === 'boolean') return '';
    if (typeof node === 'string' || typeof node === 'number') return String(node);
    if (Array.isArray(node)) return node.map(treeText).join(' ');
    return treeText(node.props?.children);
}

function descendants(node, predicate, result = []) {
    if (node === null || node === undefined) return result;
    if (Array.isArray(node)) {
        for (const child of node) descendants(child, predicate, result);
        return result;
    }
    if (typeof node !== 'object') return result;
    if (predicate(node)) result.push(node);
    descendants(node.props?.children, predicate, result);
    return result;
}

function waitTurn() {
    return new Promise(resolve => setImmediate(resolve));
}

test('dialog disables Add and does not call the API when no source name is common', async () => {
    const { component, harness, apiCalls } = loadBulkDialog({
        configData: { encode: ['h264'], recorded: ['D:\\recorded'] },
    });
    const props = {
        items: [recorded(1, 'a', [file(1, 'a.ts')]), recorded(2, 'b', [file(2, 'b.ts')])],
        onClose() {},
        onCompleted() {},
    };
    const tree = harness.render(component, props);
    assert.equal(button(tree, '追加').props.disabled, true);
    button(tree, '追加').props.onClick();
    await waitTurn();
    assert.deepEqual(apiCalls, []);
});

test('selected common label uses each matching source id and omits stale same-directory paths', async () => {
    const { component, harness, apiCalls } = loadBulkDialog({
        configData: { encode: ['h264'], recorded: ['D:\\recorded'] },
        settings: {
            encodeMode: 'h264',
            isSaveSameDirectory: true,
            parentDirectory: 'stale-path',
            removeOriginal: false,
            updateThumbnail: true,
        },
    });
    const completed = [];
    const props = { items: bulkItems(), onClose() {}, onCompleted: result => completed.push(result) };
    const tree = harness.render(component, props);
    const sourceControl = descendants(tree, node => node.type === 'FormControl').find(node =>
        treeText(node.props.children).includes('元ファイル'),
    );
    const sourceSelect = descendants(sourceControl, node => node.type === 'Select')[0];
    sourceSelect.props.onChange({ target: { value: 'common.ts' } });
    button(harness.render(component, props), '追加').props.onClick();
    await waitTurn();
    await waitTurn();
    assert.deepEqual(
        apiCalls.map(option => [option.recordedId, option.sourceVideoFileId]),
        [
            [1, 10],
            [2, 20],
        ],
    );
    assert.ok(apiCalls.every(option => !Object.hasOwn(option, 'parentDir') && !Object.hasOwn(option, 'directory')));
    assert.equal(completed.length, 1);
});

test('partial result locks settings and retry calls only failed jobs with the original preset', async () => {
    const attempts = [];
    const { component, harness, apiCalls } = loadBulkDialog({
        configData: { encode: ['h264', 'hevc'], recorded: ['D:\\recorded'] },
        addManualEncode: async option => {
            attempts.push({ ...option });
            if (option.recordedId === 2 && attempts.filter(item => item.recordedId === 2).length === 1)
                throw new Error('busy');
            return 1;
        },
    });
    const props = { items: bulkItems(), onClose() {}, onCompleted() {} };
    button(harness.render(component, props), '追加').props.onClick();
    await waitTurn();
    await waitTurn();
    let tree = harness.render(component, props);
    const controls = descendants(tree, node => node.type === 'FormControl');
    assert.ok(controls.length > 0 && controls.every(node => node.props.disabled));
    const originalFailedOptions = apiCalls.filter(option => option.recordedId === 2);
    button(tree, '失敗した録画を再試行').props.onClick();
    await waitTurn();
    await waitTurn();
    assert.deepEqual(
        attempts.map(option => option.recordedId),
        [1, 2, 2],
    );
    assert.equal(attempts[0].mode, 'h264');
    assert.equal(attempts[2].mode, 'h264');
    assert.equal(attempts[2].sourceVideoFileId, originalFailedOptions[0].sourceVideoFileId);
    assert.equal(apiCalls.length, 3);
});

test('double submit while enqueue is pending does not duplicate intake', async () => {
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    const { component, harness, apiCalls } = loadBulkDialog({
        configData: { encode: ['h264'], recorded: ['D:\\recorded'] },
        addManualEncode: async () => gate,
    });
    const props = { items: bulkItems(), onClose() {}, onCompleted() {} };
    let tree = harness.render(component, props);
    button(tree, '追加').props.onClick();
    button(harness.render(component, props), '追加').props.onClick();
    await waitTurn();
    assert.equal(apiCalls.length, 1);
    release(1);
    await waitTurn();
    await waitTurn();
    assert.equal(apiCalls.length, 2);
});

test('unmount during enqueue stops remaining calls and suppresses completion', async () => {
    let release;
    const gate = new Promise(resolve => {
        release = resolve;
    });
    const completed = [];
    const { component, harness, apiCalls } = loadBulkDialog({
        configData: { encode: ['h264'], recorded: ['D:\\recorded'] },
        addManualEncode: async () => gate,
    });
    const props = { items: bulkItems(), onClose() {}, onCompleted: result => completed.push(result) };
    button(harness.render(component, props), '追加').props.onClick();
    await waitTurn();
    assert.equal(apiCalls.length, 1);
    harness.unmount();
    release(1);
    await waitTurn();
    await waitTurn();
    assert.equal(apiCalls.length, 1);
    assert.deepEqual(completed, []);
});
