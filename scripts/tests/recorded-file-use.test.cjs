const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function loadTypeScript(absolutePath, mocks) {
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: absolutePath,
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath) {
            if (request === 'inversify') return { inject: () => () => {}, injectable: () => target => target };
            if (Object.hasOwn(mocks, request)) return mocks[request];
            if (request.startsWith('.')) return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports.default ?? loadedModule.exports;
}

function acquireTracker() {
    const events = [];
    return {
        events,
        acquire: async resource => {
            events.push({ type: 'acquire', resource });
            return {
                release: async () => events.push({ type: 'release' }),
            };
        },
    };
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function loadThumbnail(acquire) {
    const absolutePath = path.resolve(__dirname, '../..', 'src/model/operator/thumbnail/ThumbnailManageModel.ts');
    return loadTypeScript(absolutePath, { '../../RecordedFileUse': { acquireRecordedFileUse: acquire } });
}

function loadVideoAnalysis(acquire) {
    const absolutePath = path.resolve(__dirname, '../..', 'src/model/video/VideoAnalysisModel.ts');
    return loadTypeScript(absolutePath, { '../RecordedFileUse': { acquireRecordedFileUse: acquire } });
}

test('thumbnail creation holds its lease through the protected work and releases afterward', async () => {
    const use = acquireTracker();
    const ThumbnailManageModel = loadThumbnail(use.acquire);
    const model = Object.create(ThumbnailManageModel.prototype);
    model.videoFileDB = { findId: async () => ({ id: 17, recordedId: 5 }) };
    const work = deferred();
    model.createProtected = async () => work.promise;

    const creating = model.create(17);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(
        use.events.map(event => event.type),
        ['acquire'],
    );
    assert.deepEqual(use.events[0].resource, { recordedId: 5, videoFileId: 17, purpose: 'thumbnail' });
    work.resolve();
    await creating;
    assert.deepEqual(
        use.events.map(event => event.type),
        ['acquire', 'release'],
    );
});

test('thumbnail creation releases its lease when protected work fails and skips lease without metadata', async () => {
    const use = acquireTracker();
    const ThumbnailManageModel = loadThumbnail(use.acquire);
    const model = Object.create(ThumbnailManageModel.prototype);
    model.videoFileDB = { findId: async () => ({ id: 17, recordedId: 5 }) };
    model.createProtected = async () => {
        throw new Error('thumbnail failed');
    };

    await assert.rejects(model.create(17), { message: 'thumbnail failed' });
    assert.deepEqual(
        use.events.map(event => event.type),
        ['acquire', 'release'],
    );

    const noMetadata = Object.create(ThumbnailManageModel.prototype);
    noMetadata.videoFileDB = { findId: async () => null };
    await assert.rejects(noMetadata.create(17), { message: 'VideoFileIsNotFound' });
    assert.deepEqual(
        use.events.map(event => event.type),
        ['acquire', 'release'],
    );
});

test('video analysis holds its lease through protected analysis and releases afterward', async () => {
    const use = acquireTracker();
    const VideoAnalysisModel = loadVideoAnalysis(use.acquire);
    const model = Object.create(VideoAnalysisModel.prototype);
    model.videoFileDB = { findId: async () => ({ id: 19, recordedId: 6 }) };
    const work = deferred();
    model.getProtected = async () => work.promise;

    const getting = model.get(19, true, true);
    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(
        use.events.map(event => event.type),
        ['acquire'],
    );
    assert.deepEqual(use.events[0].resource, { recordedId: 6, videoFileId: 19, purpose: 'analysis' });
    work.resolve({ analysis: true });
    assert.deepEqual(await getting, { analysis: true });
    assert.deepEqual(
        use.events.map(event => event.type),
        ['acquire', 'release'],
    );
});

test('video analysis releases on failure and does not acquire without metadata', async () => {
    const use = acquireTracker();
    const VideoAnalysisModel = loadVideoAnalysis(use.acquire);
    const model = Object.create(VideoAnalysisModel.prototype);
    model.videoFileDB = { findId: async () => ({ id: 19, recordedId: 6 }) };
    model.getProtected = async () => {
        throw new Error('analysis failed');
    };

    await assert.rejects(model.get(19), { message: 'analysis failed' });
    assert.deepEqual(
        use.events.map(event => event.type),
        ['acquire', 'release'],
    );

    const noMetadata = Object.create(VideoAnalysisModel.prototype);
    noMetadata.videoFileDB = { findId: async () => null };
    await assert.rejects(noMetadata.get(19), { message: 'VideoFileIsNull' });
    assert.deepEqual(
        use.events.map(event => event.type),
        ['acquire', 'release'],
    );
});

test('recorded-file adapter uses local registry in the operator and IPC client in the service', async () => {
    const absolutePath = path.resolve(__dirname, '../..', 'src/model/RecordedFileUse.ts');
    const calls = [];
    const registry = {
        acquire: (peer, resource) => {
            calls.push({ type: 'registry-acquire', peer, resource });
            return 'lease-local';
        },
        release: (peer, lease) => calls.push({ type: 'registry-release', peer, lease }),
    };
    const client = {
        acquire: async resource => {
            calls.push({ type: 'client-acquire', resource });
            return { release: async () => calls.push({ type: 'client-release' }) };
        },
    };
    const adapter = loadTypeScript(absolutePath, {
        './RecordedUseClient': { recordedUseClient: client },
        './RecordedUseRegistry': { recordedUseRegistry: registry },
    });
    const originalSend = process.send;
    try {
        delete process.send;
        const localUse = await adapter.acquireRecordedFileUse({ recordedId: 3, purpose: 'test' });
        await localUse.release();
        process.send = () => true;
        const remoteUse = await adapter.acquireRecordedFileUse({ recordedId: 4, purpose: 'test' });
        await remoteUse.release();
    } finally {
        if (originalSend === undefined) delete process.send;
        else process.send = originalSend;
    }

    assert.deepEqual(
        calls.map(call => call.type),
        ['registry-acquire', 'registry-release', 'client-acquire', 'client-release'],
    );
    assert.equal(calls[0].peer, 'operator:reader');
});
