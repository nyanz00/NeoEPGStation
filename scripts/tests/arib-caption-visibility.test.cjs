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

function createCanvasRenderer() {
    const track = new EventTarget();
    let showing = false;
    let drawn = false;
    let drawCount = 0;
    track.addEventListener('cuechange', () => {
        if (showing) {
            drawn = true;
            drawCount++;
        } else {
            drawn = false;
        }
    });
    return {
        b24Track: track,
        get drawCount() {
            return drawCount;
        },
        hide() {
            showing = false;
            drawn = false;
        },
        show() {
            showing = true;
            this.onResize();
        },
        onResize() {
            // aribb24.js draws from resize only after a cuechange has rendered.
            if (showing && drawn) drawCount++;
        },
    };
}

test('subtitle_show redraws a cue that arrived while the canvas renderer was hidden', () => {
    const renderer = createCanvasRenderer();
    const player = createPlayer(renderer);
    renderer.b24Track.dispatchEvent(new Event('cuechange'));
    assert.equal(renderer.drawCount, 0, 'the hidden renderer must not draw the cue');

    bindAribCaptionVisibility(player, () => player);
    player.showSubtitles();

    assert.equal(renderer.drawCount, 1, 'the synthetic cuechange must redraw the active cue');
});

test('does nothing when the caption renderer is unavailable', () => {
    const player = createPlayer(undefined);
    bindAribCaptionVisibility(player, () => player);
    assert.doesNotThrow(() => player.showSubtitles());
});

test('hide and show still work when the compatibility track is unavailable', () => {
    let hideCount = 0;
    let showCount = 0;
    const player = createPlayer({ hide: () => hideCount++, show: () => showCount++ });
    bindAribCaptionVisibility(player, () => player);

    assert.doesNotThrow(() => player.showSubtitles());
    assert.equal(hideCount, 1);
    assert.equal(showCount, 1);
});

test('does nothing when the renderer methods are unavailable or the player is destroyed', () => {
    const player = createPlayer({ hide() {} });
    bindAribCaptionVisibility(player, () => null);
    assert.doesNotThrow(() => player.showSubtitles());

    let eventCount = 0;
    const livePlayer = createPlayer({
        hide() {},
        show() {
            eventCount++;
        },
    });
    bindAribCaptionVisibility(livePlayer, () => null);
    livePlayer.showSubtitles();
    assert.equal(eventCount, 0);
});
