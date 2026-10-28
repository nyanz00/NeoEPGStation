'use strict';

require('./ts-cjs-compat.cjs');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

function loadTypeScript(sourcePath, stubs = {}) {
    const absolutePath = path.resolve(__dirname, sourcePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            experimentalDecorators: true,
            emitDecoratorMetadata: true,
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const load = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath) {
            if (Object.prototype.hasOwnProperty.call(stubs, request)) return stubs[request];
            if (request.startsWith('.')) return {};
        }
        return load.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = load;
    }
    return loadedModule.exports;
}

const { default: StreamApiModel } = loadTypeScript('../../src/model/api/stream/StreamApiModel.ts', {
    inversify: {
        injectable: () => target => target,
        inject: () => () => {},
    },
    '../../../util/ManagedProcess': { spawnManaged() {}, killManaged: async () => {} },
    '../../../util/MpegTsTimeUtil': { findMpegTsByteOffset: async () => 0 },
    '../../../util/StreamResourceSampler': {
        streamResourceSampler: { start: () => ({ stop() {} }) },
    },
    '../../RecordedUseClient': {
        recordedUseClient: { acquire: async () => ({ release: async () => {} }) },
    },
});

function createModel() {
    const model = Object.create(StreamApiModel.prototype);
    Object.assign(model, {
        vodRequestOrder: 0,
        vodRequests: new Map(),
        vodFailures: new Map(),
        failedVodSessions: new WeakSet(),
        vodHlsClients: new Map(),
        managedVodHlsSessions: new Set(),
        recordedVodHlsSessions: new Map(),
        encodedVodHlsSessions: new Map(),
        cleaningVodHlsSessions: new Set(),
        vodSessionCleanup: new WeakMap(),
        vodHlsCleanupPromises: new Map(),
        creatingVodSessions: new Map(),
        vodUses: new Map(),
        videoFileDB: { findId: async id => ({ id, recordedId: 7 }) },
        configure: { getConfig: () => ({}) },
        log: { stream: { info() {}, warn() {}, error() {} } },
    });
    return model;
}

function createSession(name, { profileKey = 'profile', startSequence = 0, usable = true } = {}) {
    return {
        name,
        profileKey,
        startSequence,
        lastAccess: 0,
        usable,
        cleanupCount: 0,
        keepCount: 0,
        isUsable() {
            return this.usable;
        },
        keep() {
            this.keepCount += 1;
        },
        cleanup: async function () {
            this.cleanupCount += 1;
            this.usable = false;
        },
    };
}

function option(playPosition, vodSessionId = 'client-session') {
    return { videoFileId: 42, mode: 0, playPosition, vodSessionId };
}

test('backward playlist requests can associate a session with an older sequence', () => {
    const model = createModel();
    const forwardSession = createSession('forward');
    const backwardSession = createSession('backward');
    const forwardRequest = model.beginVodRequest(option(120), true);
    model.registerRecordedVODHLSClient('client-session', forwardSession, forwardRequest);

    const backwardRequest = model.beginVodRequest(option(0), true);
    model.registerRecordedVODHLSClient('client-session', backwardSession, backwardRequest);

    assert.equal(backwardRequest.accepted, true);
    assert.equal(model.vodHlsClients.get('client-session').session, backwardSession);
});

test('a delayed older request token cannot replace the latest playlist association', () => {
    const model = createModel();
    const olderSession = createSession('older');
    const latestSession = createSession('latest');
    const olderRequest = model.beginVodRequest(option(20));
    const latestRequest = model.beginVodRequest(option(80), true);

    model.registerRecordedVODHLSClient('client-session', latestSession, latestRequest);
    model.registerRecordedVODHLSClient('client-session', olderSession, olderRequest);

    assert.equal(model.vodHlsClients.get('client-session').session, latestSession);
    assert.equal(model.managedVodHlsSessions.has(olderSession), true);
    assert.equal(model.hasVodHlsClient(olderSession), false);

    model.cleanupVodHlsSessions();

    assert.equal(olderSession.cleanupCount, 1);
    assert.equal(model.managedVodHlsSessions.has(olderSession), false);
});

test('same-source segment requests associate in request order rather than completion order', () => {
    const model = createModel();
    const firstSession = createSession('first');
    const secondSession = createSession('second');
    const firstRequest = model.beginVodRequest(option(40));
    const secondRequest = model.beginVodRequest(option(40));

    model.registerRecordedVODHLSClient('client-session', secondSession, secondRequest);
    model.registerRecordedVODHLSClient('client-session', firstSession, firstRequest);

    assert.equal(firstRequest.accepted, true);
    assert.equal(secondRequest.accepted, true);
    assert.equal(model.vodHlsClients.get('client-session').session, secondSession);
});

test('an old-source segment request is rejected and cannot replace a newer session association', async () => {
    const model = createModel();
    const newSession = createSession('new');
    const newRequest = model.beginVodRequest(option(90), true);

    model.registerRecordedVODHLSClient('client-session', newSession, newRequest);
    await assert.rejects(model.createRecordedVODHLSSegmentStream(option(10), 0), /RecordedVodHlsRequestSuperseded/);

    assert.equal(model.vodHlsClients.get('client-session').session, newSession);
});

function leaseHarness(model, optionValue, segmentDuration = 6) {
    const videoInfo = { filePath: 'recording.ts', duration: 120, size: 1000 };
    const profile = model.createRecordedVodHlsSessionProfileKey(optionValue, videoInfo.filePath, segmentDuration);
    const key = model.createRecordedVodHlsSessionKey(optionValue, profile, segmentDuration);
    return {
        videoInfo,
        profile,
        key,
        lease: create => model.getLeasedVodSession('recorded', optionValue, videoInfo, segmentDuration, create),
    };
}

test('an unusable cached VOD session is cleaned up and recreated', async () => {
    const model = createModel();
    const request = option(0);
    const { key, lease } = leaseHarness(model, request);
    const unusableSession = createSession('unusable', { usable: false });
    const replacementSession = createSession('replacement');
    model.recordedVodHlsSessions.set(key, unusableSession);

    const result = await lease(async () => replacementSession);

    assert.equal(result, replacementSession);
    assert.equal(unusableSession.cleanupCount, 1);
    assert.equal(model.recordedVodHlsSessions.has(key), false);
});

test('each failed session counts once, retry is limited for 30 seconds, then allowed', async t => {
    const originalNow = Date.now;
    let now = 1_800_000_000_000;
    Date.now = () => now;
    t.after(() => {
        Date.now = originalNow;
    });

    const model = createModel();
    const request = option(0);
    const { key, profile, lease } = leaseHarness(model, request);
    const firstFailure = createSession('first failure', { profileKey: profile });
    const secondFailure = createSession('second failure', { profileKey: profile });
    model.noteVodFailure(firstFailure);
    model.noteVodFailure(firstFailure);
    assert.equal(model.vodFailures.get(key).count, 1);

    model.noteVodFailure(secondFailure);
    assert.equal(model.vodFailures.get(key).count, 2);
    await assert.rejects(
        lease(async () => createSession('too early')),
        /RecordedVodHlsRetryLimit/,
    );

    now += 30_001;
    const recovered = createSession('recovered', { profileKey: profile });
    assert.equal(await lease(async () => recovered), recovered);
});
