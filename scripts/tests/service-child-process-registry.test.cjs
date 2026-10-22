const assert = require('node:assert/strict');
const EventEmitter = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');
const { promisify } = require('node:util');

function loadRegistry({ identity = 'start-1', groups = new Set(), alivePids = new Set(), autoStop = true } = {}) {
    const absolutePath = path.resolve(__dirname, '../..', 'src/model/service/ServiceChildProcessRegistry.ts');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
        fileName: absolutePath,
    }).outputText;
    const sentSignals = [];
    const fakeProcess = {
        pid: 9000,
        platform: 'linux',
        kill(pid, signal) {
            if (typeof pid === 'number' && pid < 0 && signal === 'SIGKILL') {
                sentSignals.push({ pid, signal });
                if (autoStop) groups.delete(-pid);
            }
            if (typeof pid === 'number' && pid > 0 && signal === 0) {
                if (alivePids.has(pid)) return;
                const error = new Error('no such process');
                error.code = 'ESRCH';
                throw error;
            }
        },
    };
    let clock = 0;
    const childProcess = {
        execFile() {
            throw new Error('unexpected execFile');
        },
    };
    const fakeFs = {
        promises: {
            async readFile() {
                const fields = Array(20).fill('0');
                fields[0] = 'S';
                const currentIdentity = typeof identity === 'function' ? identity() : identity;
                if (currentIdentity === null) throw new Error('identity unavailable');
                fields[19] = currentIdentity;
                return `4101 (synthetic child) ${fields.join(' ')}`;
            },
        },
    };
    const fakeRequire = request => {
        if (request === 'child_process') return childProcess;
        if (request === 'fs') return fakeFs;
        if (request === 'util') return { promisify };
        if (request === '../../util/ManagedProcess') return { isProcessGroupAlive: pgid => groups.has(pgid) };
        return require(request);
    };
    const fakeSetTimeout = callback => {
        queueMicrotask(callback);
        return 0;
    };
    const wrapper = new Function(
        'exports',
        'require',
        'module',
        '__filename',
        '__dirname',
        'process',
        'setTimeout',
        'performance',
        compiled,
    );
    const module = { exports: {} };
    wrapper(
        module.exports,
        fakeRequire,
        module,
        absolutePath,
        path.dirname(absolutePath),
        fakeProcess,
        fakeSetTimeout,
        { now: () => (clock += 3000) },
    );
    return { ServiceChildProcessRegistry: module.exports.ServiceChildProcessRegistry, sentSignals };
}

function loadRegistryForRealProcesses() {
    const absolutePath = path.resolve(__dirname, '../..', 'src/model/service/ServiceChildProcessRegistry.ts');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { esModuleInterop: true, module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
        fileName: absolutePath,
    }).outputText;
    const wrapper = new Function('exports', 'require', 'module', '__filename', '__dirname', compiled);
    const module = { exports: {} };
    wrapper(
        module.exports,
        request => (request === '../../util/ManagedProcess' ? { isProcessGroupAlive: () => false } : require(request)),
        module,
        absolutePath,
        path.dirname(absolutePath),
    );
    return module.exports.ServiceChildProcessRegistry;
}

class FakeChild extends EventEmitter {
    pid = 7000;
}

function sendStarted(child, pid = 4101, pgid = pid) {
    child.emit('message', { type: 'serviceProcessStarted', kind: 'stream', pid, pgid });
}

test('tracks valid started PIDs and stops the reported process group', async () => {
    const child = new FakeChild();
    const groups = new Set([4101]);
    const { ServiceChildProcessRegistry, sentSignals } = loadRegistry({ groups });
    const registry = new ServiceChildProcessRegistry(child);
    sendStarted(child);

    await registry.stopOwnedProcesses();
    assert.deepEqual(sentSignals, [{ pid: -4101, signal: 'SIGKILL' }]);
    assert.equal(groups.has(4101), false);
});

test('ignores self, service, invalid, and mismatched process-group IDs', async () => {
    const child = new FakeChild();
    const groups = new Set([4101, 7000, 9000, 4200]);
    const { ServiceChildProcessRegistry, sentSignals } = loadRegistry({ groups });
    const registry = new ServiceChildProcessRegistry(child);
    sendStarted(child, 9000, 9000);
    sendStarted(child, 7000, 7000);
    sendStarted(child, -2, -2);
    sendStarted(child, 4101, 4200);

    await registry.stopOwnedProcesses();
    assert.deepEqual(sentSignals, []);
});

test('removes an ended PID when its process group is already stopped', async () => {
    const child = new FakeChild();
    const groups = new Set([4101]);
    const { ServiceChildProcessRegistry, sentSignals } = loadRegistry({ groups });
    const registry = new ServiceChildProcessRegistry(child);
    sendStarted(child);
    await new Promise(resolve => setImmediate(resolve));
    groups.delete(4101);
    child.emit('message', { type: 'serviceProcessEnded', pid: 4101 });

    await registry.stopOwnedProcesses();
    assert.deepEqual(sentSignals, []);
});

test('refuses to kill a process when a PID has been reused by a different identity', async () => {
    const child = new FakeChild();
    const groups = new Set([4101]);
    let identity = 'original-start';
    const { ServiceChildProcessRegistry, sentSignals } = loadRegistry({ groups, identity: () => identity });
    const registry = new ServiceChildProcessRegistry(child);
    sendStarted(child);
    await new Promise(resolve => setImmediate(resolve));
    identity = 'reused-pid-start';

    await assert.rejects(registry.stopOwnedProcesses(), { message: 'ServiceProcessIdentityUnconfirmed: 4101' });
    assert.equal(groups.has(4101), true);
    assert.deepEqual(sentSignals, []);
});

test('refuses to kill a live process when its identity cannot be read', async () => {
    const child = new FakeChild();
    const groups = new Set([4101]);
    const alivePids = new Set([4101]);
    let identity = 'original-start';
    const { ServiceChildProcessRegistry, sentSignals } = loadRegistry({
        groups,
        alivePids,
        identity: () => identity,
    });
    const registry = new ServiceChildProcessRegistry(child);
    sendStarted(child);
    await new Promise(resolve => setImmediate(resolve));
    identity = null;

    await assert.rejects(registry.stopOwnedProcesses(), { message: 'ServiceProcessIdentityUnconfirmed: 4101' });
    assert.equal(groups.has(4101), true);
    assert.deepEqual(sentSignals, []);
});

test('stops a known POSIX process group after its leader exits and identity becomes unavailable', async () => {
    const child = new FakeChild();
    const groups = new Set([4101]);
    let identityReads = 0;
    const { ServiceChildProcessRegistry, sentSignals } = loadRegistry({
        groups,
        identity: () => (identityReads++ === 0 ? 'original-start' : null),
    });
    const registry = new ServiceChildProcessRegistry(child);
    sendStarted(child);
    await new Promise(resolve => setImmediate(resolve));

    await registry.stopOwnedProcesses();
    assert.deepEqual(sentSignals, [{ pid: -4101, signal: 'SIGKILL' }]);
    assert.equal(groups.has(4101), false);
});

test('rejects when process-group termination cannot be confirmed', async () => {
    const child = new FakeChild();
    const groups = new Set([4101]);
    const { ServiceChildProcessRegistry, sentSignals } = loadRegistry({ groups, autoStop: false });
    const registry = new ServiceChildProcessRegistry(child);
    sendStarted(child);

    await assert.rejects(registry.stopOwnedProcesses(), { message: 'ServiceProcessStopUnconfirmed: 4101' });
    assert.deepEqual(sentSignals, [{ pid: -4101, signal: 'SIGKILL' }]);
    assert.equal(groups.has(4101), true);
});

test(
    'Windows taskkill confirms and terminates a real owned process tree',
    { skip: process.platform !== 'win32', timeout: 20000 },
    async () => {
        const { spawn, execFile } = require('node:child_process');
        const { promisify } = require('node:util');
        const execute = promisify(execFile);
        const child = new FakeChild();
        const ServiceChildProcessRegistry = loadRegistryForRealProcesses();
        const registry = new ServiceChildProcessRegistry(child);
        const workerCode = [
            "const {spawn}=require('node:child_process');",
            "const grandchild=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{stdio:'ignore'});",
            'console.log(String(grandchild.pid));',
            'setInterval(()=>{},1000);',
        ].join('');
        const worker = spawn(process.execPath, ['-e', workerCode], {
            stdio: ['ignore', 'pipe', 'ignore'],
            windowsHide: true,
        });
        let grandchildPid;

        try {
            grandchildPid = Number(
                await new Promise((resolve, reject) => {
                    let output = '';
                    const timer = setTimeout(() => reject(new Error('process tree startup timed out')), 5000);
                    worker.once('error', error => {
                        clearTimeout(timer);
                        reject(error);
                    });
                    worker.stdout.on('data', chunk => {
                        output += chunk.toString();
                        const line = output.split(/\r?\n/)[0];
                        if (/^\d+$/.test(line)) {
                            clearTimeout(timer);
                            resolve(line);
                        }
                    });
                }),
            );
            assert.ok(Number.isSafeInteger(grandchildPid) && grandchildPid > 0);
            child.emit('message', { type: 'serviceProcessStarted', kind: 'stream', pid: worker.pid });
            // A delayed or inaccurate ended notification must not bypass stopping a live tree.
            child.emit('message', { type: 'serviceProcessEnded', pid: worker.pid });

            await registry.stopOwnedProcesses();

            const deadline = Date.now() + 5000;
            while (Date.now() < deadline && (isWindowsPidAlive(worker.pid) || isWindowsPidAlive(grandchildPid))) {
                await new Promise(resolve => setTimeout(resolve, 50));
            }
            assert.equal(isWindowsPidAlive(worker.pid), false, 'owned process should be stopped');
            assert.equal(isWindowsPidAlive(grandchildPid), false, 'owned descendant should be stopped');
        } finally {
            if (worker.pid && isWindowsPidAlive(worker.pid)) {
                await execute('taskkill', ['/PID', String(worker.pid), '/T', '/F'], { windowsHide: true }).catch(
                    () => {},
                );
            }
            worker.stdout.destroy();
        }
    },
);

function isWindowsPidAlive(pid) {
    if (typeof pid !== 'number' || pid <= 0) return false;
    try {
        process.kill(pid, 0);
        return true;
    } catch (error) {
        return error.code !== 'ESRCH';
    }
}
