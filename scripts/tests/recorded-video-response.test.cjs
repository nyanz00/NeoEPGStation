const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
const { EventEmitter } = require('node:events');

function loadHelper({ videoFile = { recordedId: 12 }, acquire = async () => ({ release: async () => {} }) } = {}) {
    const absolutePath = path.resolve(__dirname, '../../src/model/service/RecordedVideoResponse.ts');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const container = { get: key => (key === 'IVideoFileDB' ? { findId: async () => videoFile } : undefined) };
    const api = {
        responseError(_res, error) {
            this.errors.push(error);
        },
        errors: [],
        responseFileCalls: 0,
        responseFile: (...args) => {
            api.responseFileCalls++;
            return api.responseFileImpl(...args);
        },
        responseFileImpl: () => ({ closed: Promise.resolve(), stop: async () => {} }),
    };
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (request === '../ModelContainer') return { __esModule: true, default: container };
        if (request === '../RecordedUseClient') return { recordedUseClient: { acquire } };
        if (request === './api') return api;
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    const res = new EventEmitter();
    res.destroyed = false;
    res.destroy = () => {
        res.destroyed = true;
        res.emit('close');
    };
    return { helper: loadedModule.exports.responseRecordedVideo, container, api, res };
}

function deferred() {
    let resolve;
    const promise = new Promise(res => (resolve = res));
    return { promise, resolve };
}

test('acquires before path resolution and keeps lease until the response closes', async () => {
    let acquiredResource;
    let released = false;
    const closed = deferred();
    const { helper, api, res } = loadHelper({
        acquire: async resource => {
            acquiredResource = resource;
            return { release: async () => (released = true) };
        },
    });
    api.responseFileImpl = () => ({ closed: closed.promise, stop: async () => {} });
    let pathWasResolved = false;
    const task = helper({ method: 'GET' }, res, 32, async () => {
        pathWasResolved = true;
        return { path: 'recording.ts', mime: 'video/mp2t' };
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(acquiredResource, { recordedId: 12, videoFileId: 32, purpose: 'play' });
    assert.equal(pathWasResolved, true);
    assert.equal(released, false);
    closed.resolve();
    await task;
    assert.equal(released, true);
});

test('does not touch path when metadata is missing or lease acquisition fails', async () => {
    let resolved = false;
    const missing = loadHelper({ videoFile: null });
    await missing.helper({}, missing.res, 41, async () => {
        resolved = true;
        return null;
    });
    assert.deepEqual(missing.api.errors, [{ code: 404, message: 'video file is not found' }]);
    assert.equal(resolved, false);

    const acquireFailure = new Error('lease unavailable');
    const unavailable = loadHelper({ acquire: async () => Promise.reject(acquireFailure) });
    await assert.rejects(
        unavailable.helper({}, unavailable.res, 42, async () => {
            resolved = true;
            return { path: 'never-read.ts', mime: 'video/mp2t' };
        }),
        acquireFailure,
    );
    assert.equal(resolved, false);
});

test('stop during slow path setup waits for setup and never starts the file response', async () => {
    const pathSetup = deferred();
    let stopCallback;
    let released = false;
    const { helper, api, res } = loadHelper({
        acquire: async (_resource, stop) => {
            stopCallback = stop;
            return { release: async () => (released = true) };
        },
    });
    let pathResolutionFinished = false;
    const task = helper({}, res, 52, async () => {
        await pathSetup.promise;
        pathResolutionFinished = true;
        return { path: 'remuxed.mp4', mime: 'video/mp4' };
    });

    await new Promise(resolve => setImmediate(resolve));
    let stopFinished = false;
    const stopping = stopCallback().then(() => (stopFinished = true));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(res.destroyed, true);
    assert.equal(stopFinished, false);
    assert.equal(released, false);

    pathSetup.resolve();
    await Promise.all([task, stopping]);
    assert.equal(pathResolutionFinished, true);
    assert.equal(api.responseFileCalls, 0);
    assert.equal(released, true);
});

test('not found after leasing and response setup failure both release the lease', async () => {
    let released = 0;
    const missing = loadHelper({ acquire: async () => ({ release: async () => released++ }) });
    await missing.helper({}, missing.res, 61, async () => null);
    assert.equal(released, 1);
    assert.deepEqual(missing.api.errors, [{ code: 404, message: 'video file is not found' }]);

    const failure = new Error('response setup failed');
    const setupFailure = loadHelper({ acquire: async () => ({ release: async () => released++ }) });
    setupFailure.api.responseFileImpl = () => {
        throw failure;
    };
    await assert.rejects(
        setupFailure.helper({}, setupFailure.res, 62, async () => ({ path: 'bad.ts', mime: 'video/mp2t' })),
        failure,
    );
    assert.equal(released, 2);
});
