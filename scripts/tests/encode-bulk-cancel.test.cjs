'use strict';

const assert = require('node:assert/strict');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScriptModule(filename, imports = {}) {
    const compiled = ts.transpileModule(require('node:fs').readFileSync(filename, 'utf8'), {
        compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loaded = new Module(filename, module);
    loaded.filename = filename;
    loaded.paths = Module._nodeModulePaths(path.dirname(filename));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === filename && Object.hasOwn(imports, request)) return imports[request];
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loaded._compile(compiled, filename);
    } finally {
        Module._load = originalLoad;
    }
    return loaded.exports;
}

const cancelHelperPath = path.resolve(__dirname, '../../client/src/core/media/encodeBulkCancel.ts');
const { cancelEncodeBatch } = loadTypeScriptModule(cancelHelperPath);

test('cancels 284 encodes sequentially and remains pending until the first request settles', async () => {
    const ids = Array.from({ length: 284 }, (_, index) => index + 1);
    let releaseFirst;
    const firstRequest = new Promise(resolve => {
        releaseFirst = resolve;
    });
    const calls = [];
    const progress = [];
    let active = 0;
    let maxActive = 0;
    let settled = false;

    const pending = cancelEncodeBatch(
        ids,
        async id => {
            calls.push(id);
            active++;
            maxActive = Math.max(maxActive, active);
            try {
                if (id === ids[0]) await firstRequest;
            } finally {
                active--;
            }
        },
        completed => progress.push(completed),
    ).then(result => {
        settled = true;
        return result;
    });

    await new Promise(resolve => setImmediate(resolve));
    assert.deepEqual(calls, [ids[0]], 'later requests must wait for the first cancellation');
    assert.deepEqual(progress, [], 'progress must wait until a request settles');
    assert.equal(settled, false, 'the batch must remain pending while the first request is deferred');

    releaseFirst();
    const result = await pending;

    assert.deepEqual(calls, ids);
    assert.equal(maxActive, 1, 'at most one cancellation request may be active');
    assert.deepEqual(
        progress,
        ids.map((_, index) => index + 1),
    );
    assert.deepEqual(result, { succeeded: ids, failed: [] });
});

test('continues after a failed cancellation, reports its rejection, and retries only its id', async () => {
    const ids = [41, 42, 43];
    const failure = new Error('cancel request failed');
    const initialCalls = [];
    const progress = [];

    const result = await cancelEncodeBatch(
        ids,
        async id => {
            initialCalls.push(id);
            if (id === 42) throw failure;
        },
        completed => progress.push(completed),
    );

    assert.deepEqual(initialCalls, ids, 'a rejection must not stop later cancellations');
    assert.deepEqual(result.succeeded, [41, 43]);
    assert.equal(result.failed.length, 1);
    assert.equal(result.failed[0].id, 42);
    assert.equal(result.failed[0].result.status, 'rejected');
    assert.equal(result.failed[0].result.reason, failure);
    assert.deepEqual(progress, [1, 2, 3]);

    const retryCalls = [];
    const retryProgress = [];
    const retryIds = result.failed.map(item => item.id);
    const retryResult = await cancelEncodeBatch(
        retryIds,
        async id => retryCalls.push(id),
        completed => retryProgress.push(completed),
    );

    assert.deepEqual(retryCalls, [42], 'retry must send only the failed id');
    assert.deepEqual(retryProgress, [1]);
    assert.deepEqual(retryResult, { succeeded: [42], failed: [] });
});

test('cancelEncode disables only its request timeout and keeps the shared 30 second default', async () => {
    const clientPath = path.resolve(__dirname, '../../client/src/core/api/client.ts');
    const queriesPath = path.resolve(__dirname, '../../client/src/core/api/queries.ts');
    const deleteCalls = [];
    let sharedClientOptions;
    const fakeClient = {
        delete: async (...args) => {
            deleteCalls.push(args);
        },
        interceptors: {
            request: { use() {} },
            response: { use() {} },
        },
    };
    const clientModule = loadTypeScriptModule(clientPath, {
        axios: {
            create(options) {
                sharedClientOptions = options;
                return fakeClient;
            },
        },
        '../path': { withBasePath: value => value },
        '../storage/activeUser': { activeUserStore: { getSnapshot: () => null } },
        '../storage/viewerProfile': { viewerProfileStore: { headers: () => ({}) } },
    });
    const queriesModule = loadTypeScriptModule(queriesPath, { './client': clientModule });

    await queriesModule.api.cancelEncode(73);

    assert.equal(sharedClientOptions.timeout, 30_000, 'the shared API client must retain its default timeout');
    assert.deepEqual(deleteCalls, [['/encode/73', { timeout: 0 }]]);
});
