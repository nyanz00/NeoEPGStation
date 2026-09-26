const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../client/src/core/player/RecordedPlaybackTracker.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);
const { RecordedPlaybackTracker } = loadedModule.exports;

class FakeEventTarget {
    constructor() {
        this.listeners = new Map();
    }

    addEventListener(type, listener) {
        const listeners = this.listeners.get(type) ?? new Set();
        listeners.add(listener);
        this.listeners.set(type, listeners);
    }

    removeEventListener(type, listener) {
        this.listeners.get(type)?.delete(listener);
    }

    dispatch(type) {
        for (const listener of this.listeners.get(type) ?? []) listener();
    }
}

test('natural completion keeps the terminal resume position through tracker destruction', t => {
    const originalWindow = global.window;
    const fakeWindow = new FakeEventTarget();
    fakeWindow.setInterval = () => 1;
    fakeWindow.clearInterval = () => {};
    global.window = fakeWindow;
    t.after(() => {
        if (typeof originalWindow === 'undefined') delete global.window;
        else global.window = originalWindow;
    });

    const video = Object.assign(new FakeEventTarget(), {
        currentTime: 0,
        duration: 100,
        paused: true,
        seeking: false,
        playbackRate: 1,
    });
    const samples = [];
    const tracker = new RecordedPlaybackTracker({
        video,
        onStart: () => {},
        onProgress: sample => samples.push(sample),
    });

    video.paused = false;
    video.dispatch('play');
    for (let second = 1; second < video.duration; second++) {
        video.currentTime = second;
        video.dispatch('timeupdate');
    }

    // Browsers may already report paused when the natural ended event fires.
    video.currentTime = video.duration;
    video.paused = true;
    video.dispatch('ended');

    const endedSample = samples.at(-1);
    assert.ok(endedSample.position >= video.duration - 1);
    assert.ok(endedSample.watchedSecondsDelta >= video.duration - 2);
    assert.equal(video.currentTime, video.duration);

    tracker.destroy();

    const finalSample = samples.at(-1);
    assert.ok(finalSample.position >= video.duration - 1);
    assert.equal(finalSample.position, video.currentTime);
    assert.equal(video.currentTime, video.duration);
});
