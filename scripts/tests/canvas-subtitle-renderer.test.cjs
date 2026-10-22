const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const { test } = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function loadSource(name, imports = {}) {
    const filename = path.resolve(__dirname, '../../client/src/core/player', name + '.ts');
    const compiled = ts.transpileModule(fs.readFileSync(filename, 'utf8'), {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    loaded.require = name => (Object.hasOwn(imports, name) ? imports[name] : module.require(name));
    loaded._compile(compiled, filename);
    return loaded.exports;
}

const layout = loadSource('CanvasSubtitleLayout');
const fonts = loadSource('subtitleFont');
const { CanvasSubtitleRenderer } = loadSource('CanvasSubtitleRenderer', {
    './CanvasSubtitleLayout': layout,
    './subtitleFont': { getSubtitleFontFamily: () => fonts.getSubtitleFontFamily('Windows Firefox') },
});

const header = '[Script Info]\nPlayResX: 640\nPlayResY: 360\n[Events]\n';
const track = header + 'Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\pos(20,300)}最初\n';

test('Canvas lifecycle keeps paused/seeking captions current, resizes letterboxes and removes old tracks', async t => {
    const frames = new Map();
    const observers = [];
    const painted = [];
    const scales = [];
    const context = {
        save() {},
        restore() {},
        clearRect() {
            painted.length = 0;
            scales.length = 0;
        },
        setTransform() {},
        scale(x, y) {
            scales.push({ x, y });
        },
        translate() {},
        fillRect() {},
        beginPath() {},
        rect() {},
        fill() {},
        strokeText() {},
        fillText(text) {
            painted.push(text);
        },
        measureText() {
            return { width: 20, actualBoundingBoxAscent: 16, actualBoundingBoxDescent: 4 };
        },
    };
    const window = new EventTarget();
    let nextFrame = 0;
    window.requestAnimationFrame = callback => {
        frames.set(++nextFrame, callback);
        return nextFrame;
    };
    window.cancelAnimationFrame = id => frames.delete(id);
    window.devicePixelRatio = 1;
    window.document = {
        fonts: new EventTarget(),
        createElement: () => ({
            width: 0,
            height: 0,
            parentElement: null,
            style: {},
            setAttribute() {},
            getContext: () => context,
            remove() {
                const children = this.parentElement.children;
                children.splice(children.indexOf(this), 1);
                this.parentElement = null;
            },
        }),
    };
    const previousWindow = global.window;
    const previousObserver = global.ResizeObserver;
    const renderer = new CanvasSubtitleRenderer();
    global.window = window;
    global.ResizeObserver = class {
        constructor(callback) {
            this.callback = callback;
            this.connected = true;
            observers.push(this);
        }
        observe() {}
        disconnect() {
            this.connected = false;
        }
    };
    t.after(() => {
        renderer.destroy();
        global.window = previousWindow;
        global.ResizeObserver = previousObserver;
    });

    const makeVideo = () => {
        const video = new EventTarget();
        Object.assign(video, {
            currentTime: 2,
            paused: true,
            ended: false,
            readyState: 1,
            videoWidth: 1920,
            videoHeight: 1080,
            clientWidth: 800,
            clientHeight: 600,
            offsetLeft: 0,
            offsetTop: 0,
            parentElement: {
                children: [],
                appendChild(canvas) {
                    canvas.parentElement = this;
                    this.children.push(canvas);
                },
            },
        });
        return video;
    };
    const video = makeVideo();
    await renderer.setSubtitle(video, track, false);
    const canvas = video.parentElement.children[0];
    assert.equal(canvas.className, 'neo-player-ass-canvas', 'the screenshot compositor can find this canvas');
    assert.equal(canvas.style.top, '75px');
    assert.equal(canvas.style.width, '800px');
    assert.equal(canvas.style.height, '450px');
    assert.equal(canvas.height, 450);
    assert.equal(painted.join(''), '最初');
    assert.equal(frames.size, 0, 'paused captions do not leave an animation loop running');

    video.currentTime = 4;
    video.dispatchEvent(new Event('seeked'));
    assert.deepEqual(painted, [], 'the end timestamp is exclusive, including a paused seek');
    video.currentTime = 2;
    video.dispatchEvent(new Event('seeking'));
    assert.equal(painted.join(''), '最初');

    await renderer.setSubtitle(video, track.replace('最初', '切替'), false);
    assert.equal(video.parentElement.children.length, 1);
    assert.equal(painted.join(''), '切替', 'same-time track updates must invalidate the old frame');
    const srtTrack = track
        .replace('PlayResX: 640', 'PlayResX: 384')
        .replace('PlayResY: 360', 'PlayResY: 288')
        .replace('{\\pos(20,300)}', '');
    await renderer.setSubtitle(video, srtTrack, false);
    assert.equal(scales[0].x, scales[0].y, 'a generic 4:3 SRT script must not stretch glyphs on a 16:9 video');
    video.clientWidth = 400;
    video.clientHeight = 225;
    observers[0].callback();
    assert.equal(canvas.width, 400);
    assert.equal(canvas.style.top, '0px');

    video.paused = false;
    video.dispatchEvent(new Event('play'));
    assert.equal(frames.size, 1);
    video.dispatchEvent(new Event('timeupdate'));
    assert.equal(frames.size, 1, 'media events cannot create duplicate loops');
    renderer.clear();
    assert.equal(frames.size, 0);
    assert.equal(video.parentElement.children.length, 0);
    assert.equal(observers[0].connected, false);
    video.dispatchEvent(new Event('play'));
    assert.equal(frames.size, 0, 'destroyed video listeners must not restart rendering');

    const nextVideo = makeVideo();
    await renderer.setSubtitle(nextVideo, track, false);
    assert.equal(nextVideo.parentElement.children.length, 1);
    video.currentTime = 8;
    video.dispatchEvent(new Event('seeked'));
    assert.equal(painted.join(''), '最初', 'the previous player cannot clear the next player');
    renderer.destroy();
    assert.equal(nextVideo.parentElement.children.length, 0);
});

test('native caption font order matches Windows Firefox and other ARIB routes', () => {
    assert.equal(
        fonts.getSubtitleFontFamily('Windows Firefox'),
        '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif',
    );
    assert.equal(fonts.getSubtitleFontFamily('Windows Chrome'), fonts.getSubtitleFontFamily('iPhone Safari'));
    assert.match(fonts.getSubtitleFontFamily('iPhone Safari'), /^"Windows TV MaruGothic", "Hiragino Maru Gothic Pro"/);
});
