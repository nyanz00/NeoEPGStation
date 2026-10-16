const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
const ts = require('typescript');

const repoRoot = path.resolve(__dirname, '../..');
const policyPath = path.join(repoRoot, 'client/src/core/player/recordedCommentPolicy.ts');
const settingsPath = path.join(repoRoot, 'client/src/core/storage/settings.ts');
const recordedCommentsPath = path.join(repoRoot, 'client/src/core/player/RecordedJikkyoCommentCore.ts');

function loadTypeScript(sourcePath, mocks = {}) {
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loaded = new Module(sourcePath, module);
    loaded.filename = sourcePath;
    loaded.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === sourcePath && Object.hasOwn(mocks, request)) return mocks[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(compiled, sourcePath);
    } finally {
        Module._load = originalLoad;
    }
    return loaded.exports;
}

class MemoryStorage {
    values = new Map();

    getItem(key) {
        return this.values.get(key) ?? null;
    }

    setItem(key, value) {
        this.values.set(key, String(value));
    }
}

function loadSettingsStore(storage) {
    const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
    const originalNavigator = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
    Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
    Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { userAgent: '', maxTouchPoints: 0 } });
    try {
        return loadTypeScript(settingsPath, {
            react: { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() },
            '../icons/appIcons': { isAppIconSetId: value => value === 'neo' },
            '../theme/themePresets': {
                defaultAppThemePresetId: 'default',
                defaultCustomThemeColor: '#000000',
                isAppThemePresetId: value => value === 'default',
                normalizeCustomThemeColor: value => (typeof value === 'string' ? value : '#000000'),
            },
            '../navigation': {
                defaultSideNavigationOrder: [],
                normalizeHiddenSideNavigationItems: value => (Array.isArray(value) ? value : []),
                normalizeSideNavigationOrder: value => (Array.isArray(value) ? value : []),
            },
        });
    } finally {
        if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
        else delete globalThis.localStorage;
        if (originalNavigator) Object.defineProperty(globalThis, 'navigator', originalNavigator);
        else delete globalThis.navigator;
    }
}

test('recorded comment policy keeps TS comments independent and selects encoded subtitle switches by mode', () => {
    const { getRecordedCommentPolicy } = loadTypeScript(policyPath);
    const flags = [
        { watchPlaySubtitleDanmaku: false, watchStreamingSubtitleDanmaku: false },
        { watchPlaySubtitleDanmaku: true, watchStreamingSubtitleDanmaku: false },
        { watchPlaySubtitleDanmaku: false, watchStreamingSubtitleDanmaku: true },
        { watchPlaySubtitleDanmaku: true, watchStreamingSubtitleDanmaku: true },
    ];

    for (const streaming of [false, true]) {
        for (const settings of flags) {
            assert.deepEqual(getRecordedCommentPolicy('ts', streaming, settings), {
                usesJikkyo: true,
                usesClientSubtitles: false,
                subtitleDanmaku: false,
            });
        }
    }

    assert.deepEqual(getRecordedCommentPolicy('encoded', false, flags[1]), {
        usesJikkyo: false,
        usesClientSubtitles: true,
        subtitleDanmaku: true,
    });
    // PLAY still renders ordinary subtitles in the client when danmaku is off.
    assert.deepEqual(getRecordedCommentPolicy('encoded', false, flags[2]), {
        usesJikkyo: false,
        usesClientSubtitles: true,
        subtitleDanmaku: false,
    });
    assert.deepEqual(getRecordedCommentPolicy('encoded', true, flags[2]), {
        usesJikkyo: false,
        usesClientSubtitles: true,
        subtitleDanmaku: true,
    });
    assert.deepEqual(getRecordedCommentPolicy('encoded', true, flags[1]), {
        usesJikkyo: false,
        usesClientSubtitles: false,
        subtitleDanmaku: false,
    });
    assert.deepEqual(getRecordedCommentPolicy(undefined, false, flags[3]), {
        usesJikkyo: false,
        usesClientSubtitles: false,
        subtitleDanmaku: false,
    });
    assert.deepEqual(getRecordedCommentPolicy(undefined, true, flags[3]), {
        usesJikkyo: false,
        usesClientSubtitles: false,
        subtitleDanmaku: false,
    });
});

test('streaming subtitle danmaku setting defaults off and saves independently from PLAY', () => {
    const storage = new MemoryStorage();
    const save = value => {
        const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, 'localStorage');
        Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: storage });
        try {
            settingsStore.save(value);
        } finally {
            if (originalLocalStorage) Object.defineProperty(globalThis, 'localStorage', originalLocalStorage);
            else delete globalThis.localStorage;
        }
    };
    storage.setItem('settings', JSON.stringify({ watchPlaySubtitleDanmaku: true }));
    let { defaultSettings, settingsStore } = loadSettingsStore(storage);
    assert.equal(settingsStore.getSnapshot().watchPlaySubtitleDanmaku, true);
    assert.equal(settingsStore.getSnapshot().watchStreamingSubtitleDanmaku, false);

    storage.setItem('settings', JSON.stringify({ watchStreamingSubtitleDanmaku: 'true' }));
    ({ settingsStore } = loadSettingsStore(storage));
    assert.equal(settingsStore.getSnapshot().watchStreamingSubtitleDanmaku, false);

    save({
        ...defaultSettings,
        watchPlaySubtitleDanmaku: false,
        watchStreamingSubtitleDanmaku: true,
    });
    assert.equal(JSON.parse(storage.getItem('settings')).watchStreamingSubtitleDanmaku, true);
    ({ settingsStore } = loadSettingsStore(storage));
    assert.equal(settingsStore.getSnapshot().watchStreamingSubtitleDanmaku, true);
    assert.equal(settingsStore.getSnapshot().watchPlaySubtitleDanmaku, false);

    save({
        ...settingsStore.getSnapshot(),
        watchPlaySubtitleDanmaku: true,
        watchStreamingSubtitleDanmaku: false,
    });
    ({ settingsStore } = loadSettingsStore(storage));
    assert.equal(settingsStore.getSnapshot().watchPlaySubtitleDanmaku, true);
    assert.equal(settingsStore.getSnapshot().watchStreamingSubtitleDanmaku, false);
});

function createVideo(currentTime = 0) {
    const listeners = new Map();
    return {
        currentTime,
        paused: true,
        seeking: false,
        addEventListener: (event, listener) => listeners.set(event, listener),
        removeEventListener: (event, listener) => {
            if (listeners.get(event) === listener) listeners.delete(event);
        },
        dispatch: event => listeners.get(event)?.(),
        listenerCount: () => listeners.size,
    };
}

function createAnimationFrames() {
    let nextId = 1;
    const callbacks = new Map();
    return {
        callbacks,
        frame() {
            const entry = callbacks.entries().next().value;
            assert.ok(entry, 'expected a scheduled animation frame');
            const [id, callback] = entry;
            callbacks.delete(id);
            callback(0);
        },
        window: {
            requestAnimationFrame(callback) {
                const id = nextId++;
                callbacks.set(id, callback);
                return id;
            },
            cancelAnimationFrame(id) {
                callbacks.delete(id);
            },
        },
    };
}

const apiComments = [
    {
        id: 1,
        time: 1,
        text: 'first',
        color: '#ffffff',
        position: 'right',
        size: 'medium',
        userId: 'user-a',
        postedAt: 100,
    },
    { id: 2, time: 2, text: 'second', color: '#ff0000', position: 'top', size: 'big', userId: 'user-b', postedAt: 200 },
];

function commentWithVpos(comment) {
    return { ...comment, vpos: Math.round(comment.time * 100) };
}

test('normalized Jikkyo and ASS comment responses schedule, pause, seek-reset, and clean up', async () => {
    const { RecordedJikkyoCommentCore } = loadTypeScript(recordedCommentsPath);
    const originalFetch = globalThis.fetch;
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const normalizedComments = [];

    try {
        for (const source of ['jikkyo', 'ass']) {
            const frames = createAnimationFrames();
            const video = createVideo();
            const delivered = [];
            const normalized = [];
            let resets = 0;
            globalThis.window = frames.window;
            globalThis.fetch = async () => ({
                ok: true,
                json: async () => ({
                    isSuccess: true,
                    comments: apiComments,
                    detail: 'loaded',
                    source,
                    timeBase: 'video',
                }),
            });

            const core = new RecordedJikkyoCommentCore({
                commentsUrl: '/comments',
                video,
                onComment: comment => delivered.push(comment),
                onCommentsChange: comments => normalized.push(comments),
                onReset: () => resets++,
            });
            await core.start();
            assert.deepEqual(normalized, [apiComments.map(commentWithVpos)]);

            frames.frame();
            assert.deepEqual(delivered, [], 'paused playback must not schedule comments');
            video.paused = false;
            video.currentTime = 1.05;
            frames.frame();
            assert.deepEqual(delivered, [commentWithVpos(apiComments[0])]);

            video.paused = true;
            video.currentTime = 2.05;
            frames.frame();
            assert.deepEqual(delivered, [commentWithVpos(apiComments[0])], 'pause must hold the comment timeline');
            video.paused = false;
            frames.frame();
            assert.deepEqual(delivered, [commentWithVpos(apiComments[0]), commentWithVpos(apiComments[1])]);

            video.currentTime = 0.25;
            video.dispatch('seeking');
            video.dispatch('seeked');
            assert.ok(resets >= 2, 'seeking and seeked must reset the display position');
            video.currentTime = 1.05;
            frames.frame();
            assert.deepEqual(delivered, [
                commentWithVpos(apiComments[0]),
                commentWithVpos(apiComments[1]),
                commentWithVpos(apiComments[0]),
            ]);

            normalizedComments.push(normalized[0]);
            core.destroy();
            assert.equal(video.listenerCount(), 0);
            assert.equal(frames.callbacks.size, 0, 'destroy must cancel the pending animation frame');
        }
    } finally {
        globalThis.fetch = originalFetch;
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else delete globalThis.window;
    }

    assert.deepEqual(normalizedComments[0], normalizedComments[1]);
});

test('destroy aborts an in-flight comment request and ignores a late response', async () => {
    const { RecordedJikkyoCommentCore } = loadTypeScript(recordedCommentsPath);
    const originalFetch = globalThis.fetch;
    const originalWindow = Object.getOwnPropertyDescriptor(globalThis, 'window');
    const frames = createAnimationFrames();
    const video = createVideo();
    let requestSignal;
    let resolveFetch;
    const lateResponse = {
        isSuccess: true,
        comments: apiComments,
        detail: 'late response',
        source: 'ass',
        timeBase: 'video',
    };
    const delivered = [];
    const statuses = [];
    const errors = [];
    globalThis.window = frames.window;
    globalThis.fetch = (_url, { signal }) => {
        requestSignal = signal;
        return new Promise(resolve => {
            resolveFetch = resolve;
        });
    };

    try {
        const core = new RecordedJikkyoCommentCore({
            commentsUrl: '/comments',
            video,
            onComment: comment => delivered.push(comment),
            onStatus: status => statuses.push(status),
            onError: error => errors.push(error),
        });
        const starting = core.start();
        assert.ok(requestSignal);
        core.destroy();
        assert.equal(requestSignal.aborted, true);

        resolveFetch({ ok: true, json: async () => lateResponse });
        await starting;
        assert.deepEqual(delivered, []);
        assert.deepEqual(statuses, []);
        assert.deepEqual(errors, []);
        assert.equal(frames.callbacks.size, 0);
        assert.equal(video.listenerCount(), 0);
    } finally {
        globalThis.fetch = originalFetch;
        if (originalWindow) Object.defineProperty(globalThis, 'window', originalWindow);
        else delete globalThis.window;
    }
});
