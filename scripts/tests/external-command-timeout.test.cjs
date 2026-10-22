const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadTypeScript(sourcePath, dependencies) {
    const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
        compilerOptions: {
            experimentalDecorators: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
    }).outputText;
    const loadedModule = new Module(sourcePath, module);
    loadedModule.filename = sourcePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === sourcePath) {
            if (request in dependencies) return dependencies[request];
            if (request === 'inversify') return { inject: () => () => {}, injectable: target => target };
            if (request.startsWith('.')) return {};
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, sourcePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports.default;
}

class FakeChild extends EventEmitter {
    exitCode = null;
    signalCode = null;
}

class PromiseQueue {
    queue = Promise.resolve();

    add(job) {
        const result = this.queue.then(job);
        this.queue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }
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

function installFakeTimeout(delay) {
    const originalSetTimeout = global.setTimeout;
    const originalClearTimeout = global.clearTimeout;
    const timers = [];
    global.setTimeout = (callback, requestedDelay, ...args) => {
        if (requestedDelay === delay) {
            const timer = { callback, args, cleared: false, fakeTimer: true };
            timers.push(timer);
            return timer;
        }
        return originalSetTimeout(callback, requestedDelay, ...args);
    };
    global.clearTimeout = timer => {
        if (timer?.fakeTimer) timer.cleared = true;
        else originalClearTimeout(timer);
    };
    return {
        timers,
        restore() {
            global.setTimeout = originalSetTimeout;
            global.clearTimeout = originalClearTimeout;
        },
    };
}

const spawnedChildren = [];
let killManaged;
const ExternalCommandManageModel = loadTypeScript(
    path.resolve(__dirname, '../../src/model/operator/externalCommand/ExternalCommandManageModel.ts'),
    {
        child_process: {
            spawn: () => {
                const child = new FakeChild();
                spawnedChildren.push(child);
                return child;
            },
        },
        '../../../util/ProcessUtil': { __esModule: true, default: { parseCmdStr: () => ({ bin: 'test', args: [] }) } },
        '../../../util/ManagedProcess': { killManaged: (...args) => killManaged(...args) },
    },
);

const getDiskUsage = async () => ({ available: 0 });
const StorageManageModel = loadTypeScript(
    path.resolve(__dirname, '../../src/model/operator/storage/StorageManageModel.ts'),
    {
        child_process: {
            spawn: () => {
                const child = new FakeChild();
                spawnedChildren.push(child);
                return child;
            },
        },
        '../../../util/DiskUsage': { getDiskUsage },
        '../../../util/ProcessUtil': { __esModule: true, default: { parseCmdStr: () => ({ bin: 'test', args: [] }) } },
        '../../../util/ManagedProcess': { killManaged: (...args) => killManaged(...args) },
    },
);

function makeExternalModel({ timeout = 10, errors = [] } = {}) {
    const model = Object.create(ExternalCommandManageModel.prototype);
    Object.assign(model, {
        config: { externalCommandTimeout: timeout, externalCommandMaxPending: 8 },
        maxPendingCommands: 8,
        pendingCommands: 0,
        queue: new PromiseQueue(),
        channelDB: { findId: async () => null },
        log: { system: { info() {}, error: value => errors.push(String(value)) } },
    });
    return model;
}

test('an external command timeout blocks queued commands until kill or exit confirms stopping', async () => {
    spawnedChildren.length = 0;
    const timers = installFakeTimeout(10);
    const errors = [];
    const killStarted = deferred();
    const rejectKill = deferred();
    const secondStarted = deferred();
    killManaged = async () => {
        killStarted.resolve();
        await rejectKill.promise;
    };
    const model = makeExternalModel({ errors });
    const originalCreate = model.createReserveCmd.bind(model);
    model.createReserveCmd = async (command, reserve) => {
        if (reserve.id === 2) secondStarted.resolve();
        return originalCreate(command, reserve);
    };

    try {
        model.addReserve('hook', { id: 1, channelId: 1 });
        model.addReserve('hook', { id: 2, channelId: 1 });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(spawnedChildren.length, 1);
        timers.timers[0].callback();
        await killStarted.promise;
        rejectKill.reject(new Error('kill did not confirm exit'));
        await new Promise(resolve => setImmediate(resolve));

        assert.equal(
            spawnedChildren.length,
            1,
            'the next queued command must wait while the first process remains alive',
        );
        assert.ok(errors.some(message => message.includes('failed to confirm process stop')));

        const firstChild = spawnedChildren[0];
        firstChild.exitCode = 1;
        firstChild.emit('exit', 1, null);
        await secondStarted.promise;
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(spawnedChildren.length, 2);
        const secondChild = spawnedChildren[1];
        secondChild.exitCode = 0;
        secondChild.emit('exit', 0, null);
        await model.queue.queue;
        assert.ok(errors.some(message => message.includes('execute cmd error: hook')));
        assert.equal(timers.timers[0].cleared, true);
    } finally {
        timers.restore();
    }
});

test('a natural external command exit clears its timeout', async () => {
    spawnedChildren.length = 0;
    const timers = installFakeTimeout(12);
    killManaged = async () => assert.fail('natural exit must not kill the process');
    const model = makeExternalModel({ timeout: 12 });

    try {
        const command = model.createReserveCmd('hook', { id: 3, channelId: 1 });
        await new Promise(resolve => setImmediate(resolve));
        const child = spawnedChildren[0];
        child.exitCode = 0;
        child.emit('exit', 0, null);
        await command;
        assert.equal(timers.timers[0].cleared, true);
    } finally {
        timers.restore();
    }
});

test('an exit racing with timeout waits for kill completion and rejects only once', async () => {
    spawnedChildren.length = 0;
    const timers = installFakeTimeout(13);
    const killStarted = deferred();
    const finishKill = deferred();
    killManaged = async () => {
        killStarted.resolve();
        await finishKill.promise;
    };
    const model = makeExternalModel({ timeout: 13 });

    try {
        const command = model.createReserveCmd('hook', { id: 4, channelId: 1 });
        await new Promise(resolve => setImmediate(resolve));
        timers.timers[0].callback();
        await killStarted.promise;
        const settled = command.then(
            () => 'resolved',
            error => error.message,
        );
        spawnedChildren[0].exitCode = 1;
        spawnedChildren[0].emit('exit', 1, null);
        assert.equal(
            await Promise.race([settled, new Promise(resolve => setImmediate(() => resolve('pending')))]),
            'pending',
        );

        finishKill.resolve();
        assert.equal(await settled, 'ExternalCommandTimeout');
        assert.equal(timers.timers[0].cleared, true);
    } finally {
        timers.restore();
    }
});

test('storage limit checks await the command and block overlapping checks until it exits', async () => {
    spawnedChildren.length = 0;
    const timers = installFakeTimeout(14);
    const errors = [];
    killManaged = async () => undefined;
    const model = Object.create(StorageManageModel.prototype);
    Object.assign(model, {
        config: { storageCommandTimeout: 14 },
        log: { system: { info() {}, error: value => errors.push(String(value)) } },
        recordedManage: {},
        recordedDB: {},
        isRunning: false,
        timerId: null,
    });
    model.getFreeSize = async () => 0;
    const list = [{ path: 'recorded', limitThreshold: 10, limitCmd: 'limit-command' }];

    try {
        const check = model.check(list);
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(spawnedChildren.length, 1);
        assert.equal(model.isRunning, true);
        await model.check(list);
        assert.equal(spawnedChildren.length, 1, 'the interval must not start a concurrent limit command');

        spawnedChildren[0].exitCode = 0;
        spawnedChildren[0].emit('exit', 0, null);
        await check;
        assert.equal(model.isRunning, false);
        assert.equal(timers.timers[0].cleared, true);
        assert.deepEqual(errors, []);
    } finally {
        timers.restore();
    }
});

test('storage timeout awaits kill before logging failure and continuing the check', async () => {
    spawnedChildren.length = 0;
    const timers = installFakeTimeout(15);
    const killStarted = deferred();
    const rejectKill = deferred();
    const errors = [];
    killManaged = async () => {
        killStarted.resolve();
        await rejectKill.promise;
    };
    const model = Object.create(StorageManageModel.prototype);
    Object.assign(model, {
        config: { storageCommandTimeout: 15 },
        log: { system: { info() {}, error: value => errors.push(String(value)) } },
        recordedManage: {},
        recordedDB: {},
        isRunning: false,
        timerId: null,
    });
    model.getFreeSize = async () => 0;
    const check = model.check([{ path: 'recorded', limitThreshold: 10, limitCmd: 'limit-command' }]);

    try {
        await new Promise(resolve => setImmediate(resolve));
        timers.timers[0].callback();
        await killStarted.promise;
        rejectKill.reject(new Error('kill failed'));
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(model.isRunning, true, 'the storage check must retain ownership while the command is alive');
        assert.ok(errors.some(message => message.includes('failed to confirm process stop')));

        spawnedChildren[0].exitCode = 1;
        spawnedChildren[0].emit('exit', 1, null);
        await check;
        assert.equal(model.isRunning, false);
        assert.ok(errors.some(message => message.includes('StorageCommandTimeout')));
    } finally {
        timers.restore();
    }
});
