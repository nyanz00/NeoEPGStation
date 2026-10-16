const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/util/ProcessShutdown.ts');

function loadProcessShutdown(fakeProcess) {
    const source = fs.readFileSync(sourcePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: sourcePath,
    }).outputText;
    const loadedModule = { exports: {} };
    vm.runInNewContext(
        compiled,
        {
            exports: loadedModule.exports,
            module: loadedModule,
            process: fakeProcess,
            setTimeout,
            clearTimeout,
        },
        { filename: sourcePath },
    );
    return loadedModule.exports.default;
}

function createFakeProcess() {
    const process = new EventEmitter();
    process.exitCalls = [];
    process.exit = code => process.exitCalls.push(code);
    return process;
}

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((resolvePromise, rejectPromise) => {
        resolve = resolvePromise;
        reject = rejectPromise;
    });
    return { promise, resolve, reject };
}

const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

test('requests close once and expose started state synchronously', async () => {
    const fakeProcess = createFakeProcess();
    const closeResult = deferred();
    const closeCalls = [];
    const errors = [];
    const ProcessShutdown = loadProcessShutdown(fakeProcess);
    const shutdown = new ProcessShutdown(
        reason => {
            closeCalls.push(reason);
            return closeResult.promise;
        },
        error => errors.push(error),
        100,
    );

    assert.equal(shutdown.isStarted, false);
    shutdown.request('Web UI update');
    assert.equal(shutdown.isStarted, true);
    shutdown.request('duplicate request');
    await Promise.resolve();

    assert.deepEqual(closeCalls, ['Web UI update']);
    assert.deepEqual(fakeProcess.exitCalls, []);
    closeResult.resolve();
    await wait(0);

    assert.deepEqual(fakeProcess.exitCalls, [0]);
    assert.deepEqual(errors, []);
});

test('SIGTERM, SIGINT, and a web request share one shutdown', async () => {
    const fakeProcess = createFakeProcess();
    const closeResult = deferred();
    const closeCalls = [];
    const ProcessShutdown = loadProcessShutdown(fakeProcess);
    const shutdown = new ProcessShutdown(
        reason => {
            closeCalls.push(reason);
            return closeResult.promise;
        },
        () => {},
        100,
    );

    fakeProcess.emit('SIGTERM');
    shutdown.request('Web UI update');
    fakeProcess.emit('SIGINT');
    await Promise.resolve();
    assert.deepEqual(closeCalls, ['SIGTERM']);

    closeResult.resolve();
    await wait(0);
    assert.deepEqual(fakeProcess.exitCalls, [0]);
});

test('a rejected close reports the error and exits unsuccessfully once', async () => {
    const fakeProcess = createFakeProcess();
    const errors = [];
    const failure = new Error('database close failed');
    const ProcessShutdown = loadProcessShutdown(fakeProcess);
    const shutdown = new ProcessShutdown(
        () => Promise.reject(failure),
        error => errors.push(error),
        100,
    );

    shutdown.request('SIGTERM');
    await wait(0);

    assert.deepEqual(errors, [failure]);
    assert.deepEqual(fakeProcess.exitCalls, [1]);
});

test('a close rejected with undefined still exits unsuccessfully', async () => {
    const fakeProcess = createFakeProcess();
    const errors = [];
    const ProcessShutdown = loadProcessShutdown(fakeProcess);
    const shutdown = new ProcessShutdown(
        () => Promise.reject(undefined),
        error => errors.push(error),
        100,
    );

    shutdown.request('SIGTERM');
    await wait(0);

    assert.deepEqual(errors, [undefined]);
    assert.deepEqual(fakeProcess.exitCalls, [1]);
});

test('a synchronous close throw is reported and exits unsuccessfully', async () => {
    const fakeProcess = createFakeProcess();
    const errors = [];
    const failure = new Error('synchronous database close failure');
    const ProcessShutdown = loadProcessShutdown(fakeProcess);
    const shutdown = new ProcessShutdown(
        () => {
            throw failure;
        },
        error => errors.push(error),
        100,
    );

    shutdown.request('SIGTERM');
    await wait(0);

    assert.deepEqual(errors, [failure]);
    assert.deepEqual(fakeProcess.exitCalls, [1]);
});

test('a timed out close reports the timeout and late completion does not exit twice', async () => {
    const fakeProcess = createFakeProcess();
    const closeResult = deferred();
    const errors = [];
    const ProcessShutdown = loadProcessShutdown(fakeProcess);
    const shutdown = new ProcessShutdown(
        () => closeResult.promise,
        error => errors.push(error),
        10,
    );

    shutdown.request('SIGTERM');
    await wait(25);
    assert.equal(errors.length, 1);
    assert.equal(errors[0].name, 'Error');
    assert.equal(errors[0].message, 'process shutdown timed out after 10 ms');
    assert.deepEqual(fakeProcess.exitCalls, [1]);

    closeResult.resolve();
    await wait(0);
    assert.deepEqual(fakeProcess.exitCalls, [1]);
    assert.equal(errors.length, 1);
});

test('successful close releases its timeout', async () => {
    const fakeProcess = createFakeProcess();
    const errors = [];
    const ProcessShutdown = loadProcessShutdown(fakeProcess);
    const shutdown = new ProcessShutdown(
        async () => {},
        error => errors.push(error),
        20,
    );

    shutdown.request('SIGINT');
    await wait(0);
    assert.deepEqual(fakeProcess.exitCalls, [0]);
    await wait(30);

    assert.deepEqual(fakeProcess.exitCalls, [0]);
    assert.deepEqual(errors, []);
});
