const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

function loadManagedProcess(spawn, kill) {
    const absolutePath = path.resolve(__dirname, '../..', 'src/util/ManagedProcess.ts');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
        fileName: absolutePath,
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    const originalLoad = Module._load;
    Module._load = function (request, parent, isMain) {
        if (parent?.filename === absolutePath) {
            if (request === 'child_process') return { spawn };
            if (request === './ProcessUtil') return { __esModule: true, default: { kill } };
        }
        return originalLoad.call(this, request, parent, isMain);
    };
    try {
        loadedModule._compile(compiled, absolutePath);
    } finally {
        Module._load = originalLoad;
    }
    return loadedModule.exports;
}

class FakeChild extends EventEmitter {
    constructor(pid) {
        super();
        this.pid = pid;
        this.exitCode = null;
        this.signalCode = null;
        this.signals = [];
        this.stdin = null;
        this.stdout = null;
        this.stderr = null;
    }
    kill(signal) {
        this.signals.push(signal);
        return true;
    }
    finish() {
        this.exitCode = 0;
        this.emit('close', 0, null);
    }
}

async function withProcessState(platform, send, killProcess, callback) {
    const platformDescriptor = Object.getOwnPropertyDescriptor(process, 'platform');
    const sendDescriptor = Object.getOwnPropertyDescriptor(process, 'send');
    const killDescriptor = Object.getOwnPropertyDescriptor(process, 'kill');
    Object.defineProperty(process, 'platform', { configurable: true, value: platform });
    Object.defineProperty(process, 'send', { configurable: true, writable: true, value: send });
    Object.defineProperty(process, 'kill', { configurable: true, writable: true, value: killProcess });
    try {
        return await callback();
    } finally {
        if (platformDescriptor) Object.defineProperty(process, 'platform', platformDescriptor);
        if (sendDescriptor) Object.defineProperty(process, 'send', sendDescriptor);
        else delete process.send;
        if (killDescriptor) Object.defineProperty(process, 'kill', killDescriptor);
    }
}

test('POSIX spawn preserves options, forces a process group, and reports service child lifecycle', () => {
    const messages = [];
    const children = [];
    const calls = [];
    return withProcessState(
        'linux',
        (message, callback) => {
            messages.push(message);
            callback?.(null);
            return true;
        },
        process.kill,
        async () => {
            const managed = loadManagedProcess(
                (...args) => {
                    calls.push(args);
                    const child = new FakeChild(4101);
                    child.spawnOptions = args[2];
                    children.push(child);
                    return child;
                },
                async () => {},
            );
            const child = managed.spawnManaged('encoder', ['--input', 'file'], { detached: false, cwd: 'synthetic' });
            assert.equal(calls[0][2].detached, true);
            assert.equal(calls[0][2].cwd, 'synthetic');
            child.emit('spawn');
            child.finish();
            assert.deepEqual(messages, [
                { type: 'serviceProcessStarted', kind: 'stream', pid: 4101, pgid: 4101 },
                { type: 'serviceProcessEnded', pid: 4101 },
            ]);
            assert.equal(children.length, 1);
        },
    );
});

test('Windows spawn defaults windowsHide but preserves an explicit value and parent disconnect kills owned children', () => {
    const killedByProcessUtil = [];
    const children = [];
    return withProcessState(
        'win32',
        (message, callback) => {
            callback?.(null);
            return true;
        },
        process.kill,
        async () => {
            const managed = loadManagedProcess(
                (...args) => {
                    const child = new FakeChild(5101 + children.length);
                    child.spawnOptions = args[1];
                    children.push(child);
                    return child;
                },
                async child => killedByProcessUtil.push(child.pid),
            );
            managed.spawnManaged('first', { windowsHide: false }).emit('spawn');
            assert.equal(children[0] !== undefined, true);
            assert.equal(children[0].spawnOptions.windowsHide, false);
            managed.spawnManaged('second').emit('spawn');
            assert.equal(children[1].spawnOptions.windowsHide, true);
            assert.equal(killedByProcessUtil.length, 0);
            process.emit('disconnect');
            await new Promise(resolve => setImmediate(resolve));
            assert.deepEqual(killedByProcessUtil.sort(), [5101, 5102]);
            children.forEach(child => child.finish());
        },
    );
});

test('service IPC send failures trigger owned-child cleanup without throwing', async () => {
    const groupSignals = [];
    const child = new FakeChild(6101);
    let failSend = false;
    const managed = loadManagedProcess(
        () => child,
        async () => {},
    );
    await withProcessState(
        'linux',
        (_message, callback) => {
            if (failSend) callback?.(new Error('IPC disconnected'));
            else callback?.(null);
            return true;
        },
        (pid, signal) => {
            groupSignals.push([pid, signal]);
            return true;
        },
        async () => {
            const ownedChild = managed.spawnManaged('service-child');
            failSend = true;
            assert.doesNotThrow(() => ownedChild.emit('spawn'));
            assert.deepEqual(groupSignals, [[-6101, 'SIGKILL']]);
            process.emit('disconnect');
            assert.deepEqual(groupSignals, [[-6101, 'SIGKILL']]);
            child.finish();
        },
    );
});

test('operator spawn without IPC gets no service message or disconnect ownership', async () =>
    withProcessState('linux', undefined, process.kill, async () => {
        let child;
        const managed = loadManagedProcess(
            () => (child = new FakeChild(7101)),
            async () => {},
        );
        child = managed.spawnManaged('operator-child');
        child.emit('spawn');
        child.finish();
        assert.doesNotThrow(() => process.emit('disconnect'));
    }));

test('killManaged checks for a surviving POSIX group after normal child shutdown', async () => {
    const child = new FakeChild(8101);
    const killed = [];
    let groupKilled = false;
    const killProcess = (pid, signal) => {
        killed.push([pid, signal]);
        if (signal === 0) {
            if (groupKilled === true) {
                const error = new Error('gone');
                error.code = 'ESRCH';
                throw error;
            }
            return true;
        }
        groupKilled = true;
        return true;
    };
    const managed = loadManagedProcess(
        () => child,
        async () => {
            child.exitCode = 0;
        },
    );
    await withProcessState('darwin', undefined, killProcess, async () => {
        await managed.killManaged(child, 0);
        assert.deepEqual(killed, [
            [-8101, 0],
            [-8101, 'SIGKILL'],
            [-8101, 0],
        ]);
    });
});

test('killManaged ignores an already-gone POSIX group', async () => {
    const child = new FakeChild(9101);
    const managed = loadManagedProcess(
        () => child,
        async () => {
            child.exitCode = 0;
        },
    );
    await withProcessState(
        'darwin',
        undefined,
        () => {
            const error = new Error('gone');
            error.code = 'ESRCH';
            throw error;
        },
        async () => {
            await managed.killManaged(child, 0);
        },
    );
});

test('killManaged rejects when a force-killed POSIX group remains before the deadline', async () => {
    const child = new FakeChild(10101);
    const signals = [];
    const managed = loadManagedProcess(
        () => child,
        async () => {
            child.exitCode = 0;
        },
    );
    await withProcessState(
        'darwin',
        undefined,
        (pid, signal) => {
            signals.push([pid, signal]);
            return true;
        },
        async () => {
            await assert.rejects(managed.killManaged(child, 0, 30), { message: 'ManagedProcessStopTimeout' });
            assert.deepEqual(signals.slice(0, 2), [
                [-10101, 0],
                [-10101, 'SIGKILL'],
            ]);
            assert.ok(signals.length >= 3);
            assert.ok(signals.slice(2).every(([pid, signal]) => pid === -10101 && signal === 0));
        },
    );
});

test('killManaged confirms Windows child exit after ProcessUtil tree shutdown', async () => {
    const child = new FakeChild(11101);
    const managed = loadManagedProcess(
        () => child,
        async target => {
            target.exitCode = 0;
        },
    );
    await withProcessState('win32', undefined, process.kill, async () => {
        await managed.killManaged(child, 0, 30);
        assert.equal(child.exitCode, 0);
    });
});

test('killManaged rejects when the Windows tree-kill helper leaves its child running', async () => {
    const child = new FakeChild(12101);
    const managed = loadManagedProcess(
        () => child,
        async () => {},
    );
    await withProcessState('win32', undefined, process.kill, async () => {
        await assert.rejects(managed.killManaged(child, 0, 30), { message: 'ManagedProcessStopTimeout' });
    });
});
