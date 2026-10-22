const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/api/iptv/IptvDocumentRequestGuard.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);
const { completeIptvDocumentRequest } = loadedModule.exports;

class FakeResponse extends EventEmitter {
    destroyed = false;
    writableEnded = false;
}

test('a closed IPTV response stops a pending document and ignores its late result', async () => {
    const response = new FakeResponse();
    let finish;
    let failures = 0;
    let successCount = 0;
    let context;
    const completion = completeIptvDocumentRequest(response, {
        execute: requestContext => {
            context = requestContext;
            return new Promise(resolve => {
                finish = resolve;
            });
        },
        failure: () => failures++,
        success: () => successCount++,
    });

    response.emit('close');
    await completion;
    assert.throws(() => context.ensureActive(), /Terminated/);
    finish('late document');
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failures, 0);
    assert.equal(successCount, 0);
});

test('a late generation rejection after disconnect is ignored', async () => {
    const response = new FakeResponse();
    let rejectGeneration;
    let failures = 0;
    const completion = completeIptvDocumentRequest(response, {
        execute: () =>
            new Promise((_resolve, reject) => {
                rejectGeneration = reject;
            }),
        failure: () => failures++,
        success: () => assert.fail('disconnected response cannot succeed'),
    });

    response.emit('close');
    await completion;
    rejectGeneration(new Error('late failure'));
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(failures, 0);
});

test('the document deadline fails once and discards late completion', async () => {
    const originalSetTimeout = globalThis.setTimeout;
    const originalClearTimeout = globalThis.clearTimeout;
    let deadlineCallback;
    let deadlineDelay;
    globalThis.setTimeout = (callback, delay) => {
        deadlineCallback = callback;
        deadlineDelay = delay;
        return { fakeTimer: true };
    };
    globalThis.clearTimeout = () => {};
    try {
        const response = new FakeResponse();
        let finish;
        let failureMessage;
        let successCount = 0;
        const completion = completeIptvDocumentRequest(response, {
            execute: () =>
                new Promise(resolve => {
                    finish = resolve;
                }),
            failure: error => (failureMessage = error.message),
            success: () => successCount++,
        });

        assert.equal(deadlineDelay, 30_000);
        deadlineCallback();
        await completion;
        finish('late document');
        await new Promise(resolve => setImmediate(resolve));
        assert.match(failureMessage, /DeadlineExceeded/);
        assert.equal(successCount, 0);
    } finally {
        globalThis.setTimeout = originalSetTimeout;
        globalThis.clearTimeout = originalClearTimeout;
    }
});

test('an already closed response skips document generation and releases its listener', async () => {
    const response = new FakeResponse();
    response.destroyed = true;
    let executed = false;
    let failed = false;
    await completeIptvDocumentRequest(response, {
        execute: () => (executed = true),
        failure: () => (failed = true),
        success: () => assert.fail('closed response cannot succeed'),
    });
    assert.equal(executed, false);
    assert.equal(failed, false);
    assert.equal(response.listenerCount('close'), 0);
});
