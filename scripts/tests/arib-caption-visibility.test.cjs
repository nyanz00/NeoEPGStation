const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const absolutePath = path.resolve(__dirname, '../../client/src/core/player/AribCaptionVisibility.ts');
const compiled = ts.transpileModule(fs.readFileSync(absolutePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loadedModule = new Module(absolutePath, module);
loadedModule.filename = absolutePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
loadedModule._compile(compiled, absolutePath);
const { bindAribCaptionVisibility } = loadedModule.exports;

function createPlayer(renderer) {
    const listeners = new Map();
    return {
        plugins: renderer === undefined ? {} : { aribb24Caption: renderer },
        on(name, callback) {
            listeners.set(name, callback);
        },
        showSubtitles() {
            listeners.get('subtitle_show')?.();
        },
    };
}

test('subtitle_show requests a redraw from a show-only 2.x renderer', () => {
    let showCount = 0;
    const renderer = { show: () => showCount++ };
    const player = createPlayer(renderer);
    bindAribCaptionVisibility(player, () => player);

    player.showSubtitles();

    assert.equal(showCount, 1);
});

test('requests show without calling hide', () => {
    let showCount = 0;
    let hideCount = 0;
    const player = createPlayer({
        show: () => showCount++,
        hide: () => hideCount++,
    });
    bindAribCaptionVisibility(player, () => player);

    player.showSubtitles();

    assert.equal(showCount, 1);
    assert.equal(hideCount, 0);
});

test('does nothing when the renderer is unavailable at bind time or later', () => {
    const playerWithoutRenderer = createPlayer(undefined);
    bindAribCaptionVisibility(playerWithoutRenderer, () => playerWithoutRenderer);
    assert.doesNotThrow(() => playerWithoutRenderer.showSubtitles());

    let showCount = 0;
    const renderer = { show: () => showCount++ };
    const player = createPlayer(renderer);
    bindAribCaptionVisibility(player, () => player);
    delete player.plugins.aribb24Caption;
    player.showSubtitles();

    assert.equal(showCount, 0);
});

test('does nothing after the player is destroyed', () => {
    let showCount = 0;
    const player = createPlayer({ show: () => showCount++ });
    bindAribCaptionVisibility(player, () => null);

    player.showSubtitles();

    assert.equal(showCount, 0);
});

test('does nothing when the current player has been replaced', () => {
    let showCount = 0;
    const player = createPlayer({ show: () => showCount++ });
    const replacement = createPlayer({ show: () => showCount++ });
    bindAribCaptionVisibility(player, () => replacement);

    player.showSubtitles();

    assert.equal(showCount, 0);
});
