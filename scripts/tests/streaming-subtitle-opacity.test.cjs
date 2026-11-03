'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const vm = require('node:vm');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/api/stream/StreamApiModel.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const ast = ts.createSourceFile(sourcePath, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
const names = [
    'transformAssAlpha',
    'scaleAssNumber',
    'splitAssFields',
    'transformAssInlineStyle',
    'transformAssSubtitleForStreaming',
];
const declarations = new Map();
for (const statement of ast.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
        if (ts.isIdentifier(declaration.name) && names.includes(declaration.name.text)) {
            declarations.set(
                declaration.name.text,
                ts.transpileModule(statement.getFullText(ast), {
                    compilerOptions: { target: ts.ScriptTarget.ES2021, module: ts.ModuleKind.None },
                }).outputText,
            );
        }
    }
}
for (const name of names) assert.ok(declarations.has(name), `could not find ${name} in ${sourcePath}`);
const context = { exports: {} };
vm.runInNewContext(
    `${names.map(name => declarations.get(name)).join('\n')}\nthis.transformAssSubtitleForStreaming = transformAssSubtitleForStreaming;`,
    context,
);
const transform = context.transformAssSubtitleForStreaming;

const style = (overrides = {}) => ({
    sizePercent: 100,
    opacityPercent: 100,
    outlineSizePercent: 100,
    outlineOpacityPercent: 100,
    ...overrides,
});
const ass = (primary = '&H7FFFFFFF', outline = '&H7F000000', text = 'caption') =>
    `[Script Info]\nTitle: sample\n\n[V4+ Styles]\nFormat: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding\nStyle: Default,Arial,40,${primary},&H7FFFFFFF,${outline},&H66000000,0,0,1,2,1,2,10,10,20,1\n\n[Events]\nFormat: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text\nDialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,${text}\n`;

test('ASS source alpha is converted to absolute opacity for style and inline text and outline', () => {
    const input = ass('&H7FFFFFFF', '&H7F000000', '{\\alpha&H7F&}caption');
    const full = transform(input, style());
    assert.match(full, /Style: Default,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000/);
    assert.match(full, /\{\\1a&H00&\\2a&H00&\\3a&H00&\\4a&H7F&\}caption/);

    const half = transform(input, style({ opacityPercent: 50, outlineOpacityPercent: 50 }));
    assert.match(half, /Style: Default,Arial,40,&H7FFFFFFF,&H7FFFFFFF,&H7F000000,&H66000000/);
    assert.match(half, /\{\\1a&H7F&\\2a&H7F&\\3a&H7F&\\4a&H7F&\}caption/);

    const hidden = transform(input, style({ opacityPercent: 0, outlineOpacityPercent: 0 }));
    assert.match(hidden, /Style: Default,Arial,40,&HFFffffff/i);
    assert.match(hidden, /\{\\1a&HFF&\\2a&HFF&\\3a&HFF&\\4a&H7F&\}caption/);
});

test('text and outline opacity are independent, while geometry remains relative', () => {
    const input = ass('&H7FFFFFFF', '&H7F000000', '{\\fscx100\\fscy80\\bord2\\xbord3\\ybord4}caption');
    const output = transform(
        input,
        style({
            sizePercent: 125,
            opacityPercent: 100,
            outlineSizePercent: 50,
            outlineOpacityPercent: 0,
        }),
    );
    assert.match(output, /Style: Default,Arial,50,&H00FFFFFF,&H00FFFFFF,&HFF000000,&H66000000,0,0,1,1,1/);
    assert.match(output, /\{\\fscx125\\fscy100\\bord1\\xbord1\.5\\ybord2\}caption/);
});

test('component alpha and eight-digit colour overrides use the specified text and outline opacity', () => {
    const input = ass(
        '&H7FFFFFFF',
        '&H7F000000',
        '{\\1a&HFF&\\2a&HAA&\\3a&H00&\\1c&HFF112233&\\2c&H00445566&\\3c&H7F8899AA&}caption',
    );
    const output = transform(input, style({ opacityPercent: 50, outlineOpacityPercent: 25 }));
    assert.match(output, /\\1a&H7F&\\2a&H7F&\\3a&HBF&/);
    assert.match(output, /\\1c&H7F112233&\\2c&H7F445566&\\3c&HBF8899AA&/);
    const opaque = transform(input, style());
    assert.match(opaque, /\\1a&H00&\\2a&H00&\\3a&H00&/);
});

test('background, shadow alpha, coordinates, ruby, and fade timing are preserved', () => {
    const text = '{\\pos(120,340)\\fad(250,500)\\4a&H55&\\4c&H66010203&\\rRuby}字幕';
    const input = ass('&H7FFFFFFF', '&H7F000000', text);
    const output = transform(input, style({ opacityPercent: 50, outlineOpacityPercent: 25 }));
    assert.match(output, /,&H66000000,0,0,1,2,1,2,10,10,20,1/);
    assert.match(output, /\{\\pos\(120,340\)\\fad\(250,500\)\\4a&H55&\\4c&H66010203&\\rRuby\}字幕/);
    assert.match(output, /Dialogue: 0,0:00:01\.00,0:00:03\.00,Default/);
});

test('six digit SRT converted ASS colours default to fully visible at opacity 100', () => {
    const input = ass('&HFFFFFF', '&H000000', 'converted');
    const output = transform(input, style());
    assert.match(output, /Style: Default,Arial,40,&H00FFFFFF,&H00FFFFFF,&H00000000,&H66000000/);
});

function loadTypeScript(relativePath, stubs = {}) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loaded = new Module(absolutePath, module);
    loaded.filename = absolutePath;
    loaded.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath && Object.hasOwn(stubs, request)) return stubs[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loaded.exports;
}

function loadSettingsStore(initial = {}) {
    const storage = new Map([['settings', JSON.stringify(initial)]]);
    global.localStorage = {
        getItem: key => storage.get(key) ?? null,
        setItem: (key, value) => storage.set(key, value),
    };
    return loadTypeScript('../../client/src/core/storage/settings.ts', {
        react: { useSyncExternalStore: (_subscribe, getSnapshot) => getSnapshot() },
        '../icons/appIcons': { isAppIconSetId: () => false },
        '../theme/themePresets': {
            defaultAppThemePresetId: 'default',
            defaultCustomThemeColor: '#000000',
            isAppThemePresetId: () => false,
            normalizeCustomThemeColor: () => '#000000',
        },
        '../navigation': {
            defaultSideNavigationOrder: [],
            normalizeHiddenSideNavigationItems: () => [],
            normalizeSideNavigationOrder: () => [],
        },
    });
}

test('subtitle opacity settings load and save as 0..100 while geometry keeps its wider ranges', () => {
    const defaultStore = loadSettingsStore().settingsStore;
    assert.equal(defaultStore.getSnapshot().watchStreamingSubtitleOpacityPercent, 100);

    const loaded = loadSettingsStore({
        watchStreamingSubtitleOpacityPercent: 0,
        watchStreamingSubtitleOutlineOpacityPercent: 150,
        watchStreamingSubtitleSizePercent: 250,
        watchStreamingSubtitleOutlineSizePercent: 300,
    }).settingsStore.getSnapshot();
    assert.equal(loaded.watchStreamingSubtitleOpacityPercent, 0);
    assert.equal(loaded.watchStreamingSubtitleOutlineOpacityPercent, 100);
    assert.equal(loaded.watchStreamingSubtitleSizePercent, 250);
    assert.equal(loaded.watchStreamingSubtitleOutlineSizePercent, 300);

    const store = loadSettingsStore().settingsStore;
    store.save({
        ...store.getSnapshot(),
        watchStreamingSubtitleOpacityPercent: 0,
        watchStreamingSubtitleOutlineOpacityPercent: 101,
    });
    assert.equal(store.getSnapshot().watchStreamingSubtitleOpacityPercent, 0);
    assert.equal(store.getSnapshot().watchStreamingSubtitleOutlineOpacityPercent, 100);
    assert.equal(JSON.parse(global.localStorage.getItem('settings')).watchStreamingSubtitleOpacityPercent, 0);
});

function loadEndpoint(relativePath, methodName) {
    const calls = [];
    const stream = new (require('node:events').EventEmitter)();
    stream.pipe = response => response;
    const model = {
        async [methodName](...args) {
            calls.push(args);
            return methodName === 'getRecordedVODHLSPlaylist' ? '#EXTM3U' : { stream, cleanup: async () => {} };
        },
    };
    const api = loadTypeScript(relativePath, {
        '../../../../../ApiOperation.js': {},
        '../../../../../../ApiOperation.js': {},
        '../../../../../../ModelContainer.js': { __esModule: true, default: { get: () => model } },
        '../../../../../../../ModelContainer.js': { __esModule: true, default: { get: () => model } },
        '../../../../../api.js': { responseServerError: (_res, _message) => {} },
        '../../../../../../api.js': { responseServerError: (_res, _message) => {} },
    });
    return { get: api.get, calls };
}

test('playlist and segment endpoints forward opacity query values and document the 0..100 range', async () => {
    const endpointCases = [
        ['../../src/model/service/api/streams/recorded/{videoFileId}/vodhls/playlist.ts', 'getRecordedVODHLSPlaylist'],
        [
            '../../src/model/service/api/streams/recorded/{videoFileId}/vodhls/segments/{sequence}.ts',
            'createRecordedVODHLSSegmentStream',
        ],
    ];
    for (const [file, method] of endpointCases) {
        const endpoint = loadEndpoint(file, method);
        for (const opacity of [0, 50, 100]) {
            const request = {
                params: { videoFileId: '12', sequence: '1' },
                query: {
                    ss: '0',
                    mode: '1',
                    subtitleOpacity: String(opacity),
                    subtitleOutlineOpacity: String(opacity),
                },
                on: () => {},
            };
            const response = { setHeader: () => response, status: () => response, send: () => response, end: () => {} };
            await endpoint.get(request, response);
            const options = endpoint.calls.at(-1)[0];
            assert.equal(options.subtitleOpacity, opacity);
            assert.equal(options.subtitleOutlineOpacity, opacity);
        }
        for (const name of ['subtitleOpacity', 'subtitleOutlineOpacity']) {
            const schema = endpoint.get.apiDoc.parameters.find(parameter => parameter.name === name).schema;
            assert.equal(schema.minimum, 0);
            assert.equal(schema.maximum, 100);
        }
    }
});
