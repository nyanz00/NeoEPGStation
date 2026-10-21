const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScript(relativePath, dependencies = {}) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { jsx: ts.JsxEmit.ReactJSX, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath && request in dependencies) return dependencies[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports;
}

const subtitles = loadTypeScript('../../client/src/core/media/subtitles.ts');
const recorded = loadTypeScript('../../client/src/core/media/recorded.ts', {
    '../path': { withBasePath: value => `/base${value}` },
});

const normalTrack = { subtitleIndex: 2, displayName: '日本語字幕', codecName: 'ass' };
const commentTrack = { subtitleIndex: 5, displayName: 'NicoJK-1080T', codecName: 'ass' };

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
                effects[index] = { dependencies, effect, pending: true };
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
                const pending = effects.filter(item => item?.pending);
                for (const item of pending) {
                    item.pending = false;
                    item.effect();
                }
                if (!dirty) return tree;
            }
            assert.fail('React hook harness did not settle after effects');
        },
    };
}

function loadDialogComponent(queryData) {
    const harness = createHookHarness();
    const jsx = (type, props, key) => ({ type, props: props ?? {}, key });
    const jsxRuntime = { jsx, jsxs: jsx, Fragment: 'Fragment' };
    const material = Object.fromEntries(
        [
            'Button',
            'Dialog',
            'DialogActions',
            'DialogContent',
            'DialogTitle',
            'FormControl',
            'InputLabel',
            'MenuItem',
            'Select',
            'Stack',
            'Typography',
        ].map(name => [name, name]),
    );
    const prepared = [];
    const api = {
        prepareVideoSubtitle: async (videoId, subtitleIndex) => {
            prepared.push({ videoId, subtitleIndex });
            return { subtitleFileKey: `prepared-${subtitleIndex}` };
        },
    };
    const componentModule = loadTypeScript('../../client/src/components/RecordedSelectStreamDialog.tsx', {
        '@mui/material': material,
        '@tanstack/react-query': { useQuery: () => ({ data: queryData, isPending: false }) },
        react: harness.hooks,
        'react/jsx-runtime': jsxRuntime,
        '../core/api/queries': { api },
        '../core/notifications/Notifications': { useNotifications: () => ({ notify: () => {} }) },
        './programDialogStyles': { programDialogPaper: () => ({}) },
        '../core/media/recorded': recorded,
        '../core/media/subtitles': subtitles,
    });
    return { component: componentModule.RecordedSelectStreamDialog, harness, prepared };
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

function labeledSelect(tree, label) {
    const control = descendants(tree, node => node.type === 'FormControl').find(node =>
        treeText(node.props.children).includes(label),
    );
    assert.ok(control, `Expected a ${label} select`);
    return descendants(control, node => node.type === 'Select')[0];
}

function encodedDialogProps(settings, callbacks) {
    return {
        recordedId: 11,
        video: { id: 22, type: 'encoded', name: '番組' },
        config: { streamConfig: { recorded: { encoded: { hls: ['720p'] } } } },
        settings: { ...streamSettings(settings), watchDefaultQuality: null, watchSubtitlePreferredKeywords: [] },
        onClose: () => {},
        onWatch: value => callbacks.push(value),
    };
}

function withDialogStorage(t) {
    const originalStorage = global.localStorage;
    const values = new Map();
    global.localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
    t.after(() => {
        if (originalStorage === undefined) delete global.localStorage;
        else global.localStorage = originalStorage;
    });
}

test('initial subtitle selection respects the requested index and the displayed track list', () => {
    const allTracks = [normalTrack, commentTrack];
    const normalTracks = [normalTrack];
    const commentTracks = [commentTrack];

    assert.equal(subtitles.initialSubtitleIndex(allTracks, '5', null), 5);
    assert.equal(subtitles.initialSubtitleIndex(normalTracks, '2', null), 2);
    assert.equal(subtitles.initialSubtitleIndex(commentTracks, '5', null), 5);
    assert.equal(subtitles.initialSubtitleIndex(normalTracks, null, 2), 2);
    assert.equal(subtitles.initialSubtitleIndex(normalTracks, null, null), null);
});

test('initial subtitle selection treats off, invalid, and stale saved tracks as unselected', () => {
    const tracks = [normalTrack, commentTrack];

    assert.equal(subtitles.initialSubtitleIndex(tracks, '-1', 2), null);
    assert.equal(subtitles.initialSubtitleIndex(tracks, 'not-a-number', 2), null);
    assert.equal(subtitles.initialSubtitleIndex(tracks, '8', 2), null);
});

test('recorded stream settings preserve legacy absence, explicit off, and each selected track', t => {
    const originalStorage = global.localStorage;
    const values = new Map();
    global.localStorage = {
        getItem: key => values.get(key) ?? null,
        setItem: (key, value) => values.set(key, value),
    };
    t.after(() => {
        if (originalStorage === undefined) delete global.localStorage;
        else global.localStorage = originalStorage;
    });

    const key = 'RecordedSelectStreamSetting';
    values.set(key, JSON.stringify({ type: 'HLS', mode: 0, subtitleIndex: 2 }));
    const legacy = recorded.loadRecordedSelectStreamSettings();
    assert.equal(legacy.subtitleIndex, 2);
    assert.equal(legacy.danmakuSubtitleIndex, undefined);

    recorded.saveRecordedSelectStreamSettings({
        type: 'HLS',
        mode: 1,
        subtitleIndex: null,
        danmakuSubtitleIndex: null,
    });
    assert.deepEqual(recorded.loadRecordedSelectStreamSettings(), {
        type: 'HLS',
        mode: 1,
        subtitleIndex: null,
        danmakuSubtitleIndex: null,
    });

    recorded.saveRecordedSelectStreamSettings({ type: 'HLS-TS', mode: 2, subtitleIndex: 2, danmakuSubtitleIndex: 5 });
    assert.deepEqual(recorded.loadRecordedSelectStreamSettings(), {
        type: 'HLS-TS',
        mode: 2,
        subtitleIndex: 2,
        danmakuSubtitleIndex: 5,
    });
});

function streamSettings(watchStreamingSubtitleDanmaku) {
    return {
        watchStreamEncoder: 'Config',
        watchUseHevc: false,
        watchStreamingBufferedStart: false,
        watchStreamingSubtitleSizePercent: 100,
        watchStreamingSubtitleOpacityPercent: 100,
        watchStreamingSubtitleOutlineSizePercent: 100,
        watchStreamingSubtitleOutlineOpacityPercent: 100,
        watchStreamingSubtitleDanmaku,
    };
}

test('watch path carries the separate comment track only when streaming comments are enabled', () => {
    const settings = streamSettings(true);
    const pathWithTracks = recorded.getRecordedStreamWatchPath(11, 22, 'HLS', 0, '720p', settings, 2, undefined, 5);
    const params = new URLSearchParams(pathWithTracks.split('?')[1]);
    assert.equal(params.get('subtitleIndex'), '2');
    assert.equal(params.get('danmakuSubtitleIndex'), '5');

    const offPath = recorded.getRecordedStreamWatchPath(11, 22, 'HLS', 0, '720p', settings, 2, undefined, null);
    assert.equal(new URLSearchParams(offPath.split('?')[1]).get('danmakuSubtitleIndex'), '-1');

    const disabledPath = recorded.getRecordedStreamWatchPath(
        11,
        22,
        'HLS',
        0,
        '720p',
        streamSettings(false),
        2,
        undefined,
        5,
    );
    assert.equal(new URLSearchParams(disabledPath.split('?')[1]).has('danmakuSubtitleIndex'), false);
});

test('server playlist URL never receives the client-selected comment track', () => {
    const originalWindow = global.window;
    global.window = { location: { pathname: '/base/' } };
    try {
        const url = recorded.getRecordedStreamURL(22, 'HLS', 0, '720p', streamSettings(true), 2);
        const params = new URLSearchParams(url.split('?')[1]);
        assert.equal(params.get('subtitleIndex'), '2');
        assert.equal(params.has('danmakuSubtitleIndex'), false);
    } finally {
        if (originalWindow === undefined) delete global.window;
        else global.window = originalWindow;
    }
});

test('encoded dialog separates comment and subtitle choices and sends both selected indexes to watch', async t => {
    withDialogStorage(t);
    const callbacks = [];
    const { component, harness, prepared } = loadDialogComponent({ items: [normalTrack, commentTrack] });
    const props = encodedDialogProps(true, callbacks);
    let tree = harness.render(component, props);

    const commentSelect = labeledSelect(tree, '弾幕');
    const subtitleSelect = labeledSelect(tree, '字幕');
    assert.deepEqual(descendants(commentSelect, node => node.type === 'MenuItem').map(treeText), [
        '弾幕なし',
        'NicoJK-1080T',
    ]);
    assert.deepEqual(descendants(subtitleSelect, node => node.type === 'MenuItem').map(treeText), [
        '字幕なし',
        '日本語字幕',
    ]);

    commentSelect.props.onChange({ target: { value: 5 } });
    subtitleSelect.props.onChange({ target: { value: 2 } });
    tree = harness.render(component, props);
    assert.equal(labeledSelect(tree, '弾幕').props.value, 5);
    assert.equal(labeledSelect(tree, '字幕').props.value, 2);

    const watchButton = descendants(tree, node => node.type === 'Button' && treeText(node) === '視聴')[0];
    watchButton.props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(callbacks.length, 1);
    const params = new URLSearchParams(callbacks[0].split('?')[1]);
    assert.equal(params.get('subtitleIndex'), '2');
    assert.equal(params.get('danmakuSubtitleIndex'), '5');
    assert.deepEqual(prepared, [{ videoId: 22, subtitleIndex: 2 }]);
});

test('encoded dialog honors explicit no-comment selection', async t => {
    withDialogStorage(t);
    const callbacks = [];
    const { component, harness } = loadDialogComponent({ items: [normalTrack, commentTrack] });
    const props = encodedDialogProps(true, callbacks);
    let tree = harness.render(component, props);

    labeledSelect(tree, '弾幕').props.onChange({ target: { value: 'none' } });
    tree = harness.render(component, props);
    assert.equal(labeledSelect(tree, '弾幕').props.value, 'none');
    descendants(tree, node => node.type === 'Button' && treeText(node) === '視聴')[0].props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(callbacks.length, 1);
    assert.equal(new URLSearchParams(callbacks[0].split('?')[1]).get('danmakuSubtitleIndex'), '-1');
});

test('disabled comment setting shows one subtitle selector with all tracks and omits comment URL parameter', async t => {
    withDialogStorage(t);
    const callbacks = [];
    const { component, harness } = loadDialogComponent({ items: [normalTrack, commentTrack] });
    const props = encodedDialogProps(false, callbacks);
    let tree = harness.render(component, props);

    assert.equal(
        descendants(tree, node => node.type === 'InputLabel')
            .map(treeText)
            .filter(text => text === '弾幕').length,
        0,
    );
    const subtitleSelect = labeledSelect(tree, '字幕');
    assert.deepEqual(descendants(subtitleSelect, node => node.type === 'MenuItem').map(treeText), [
        '字幕なし',
        '日本語字幕',
        'NicoJK-1080T',
    ]);
    subtitleSelect.props.onChange({ target: { value: 5 } });
    tree = harness.render(component, props);
    descendants(tree, node => node.type === 'Button' && treeText(node) === '視聴')[0].props.onClick();
    await new Promise(resolve => setImmediate(resolve));
    await new Promise(resolve => setImmediate(resolve));

    assert.equal(callbacks.length, 1);
    const params = new URLSearchParams(callbacks[0].split('?')[1]);
    assert.equal(params.get('subtitleIndex'), '5');
    assert.equal(params.has('danmakuSubtitleIndex'), false);
});

test('TS dialog does not show subtitle or comment selectors even when comment setting is enabled', t => {
    withDialogStorage(t);
    const callbacks = [];
    const { component, harness } = loadDialogComponent({ items: [normalTrack, commentTrack] });
    const props = {
        ...encodedDialogProps(true, callbacks),
        video: { id: 22, type: 'ts', name: '番組' },
        config: { streamConfig: { recorded: { ts: { hls: ['720p'] } } } },
    };
    const tree = harness.render(component, props);

    assert.equal(
        descendants(tree, node => node.type === 'InputLabel')
            .map(treeText)
            .some(text => text === '弾幕' || text === '字幕'),
        false,
    );
});
