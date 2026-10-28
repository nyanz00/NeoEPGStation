const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function loadSampler() {
    const absolutePath = path.resolve(__dirname, '../../src/util/StreamResourceSampler.ts');
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2021,
        },
        fileName: absolutePath,
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    loadedModule._compile(compiled, absolutePath);
    return loadedModule.exports;
}

const { StreamResourceSampler, createSystemCollector } = loadSampler();

function deferred() {
    let resolve;
    let reject;
    const promise = new Promise((res, rej) => {
        resolve = res;
        reject = rej;
    });
    return { promise, resolve, reject };
}

function fakeTimers() {
    const timers = new Map();
    let nextId = 1;
    return {
        timers,
        setInterval(callback, delay) {
            const id = nextId++;
            timers.set(id, { callback, delay });
            return id;
        },
        clearInterval(id) {
            timers.delete(id);
        },
    };
}

const flush = async () => new Promise(resolve => setImmediate(resolve));

test('keeps only the newest twelve samples in memory', async () => {
    const timers = fakeTimers();
    let timestamp = 0;
    const sampler = new StreamResourceSampler({
        collect: async () => ({ totalRamBytes: 100 }),
        now: () => ++timestamp,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
    });
    const handle = sampler.subscribe(() => [11]);
    await flush();
    const timer = [...timers.timers.values()][0];
    assert.equal(timer.delay, 5000);
    for (let i = 0; i < 14; i++) {
        timer.callback();
        await flush();
    }
    assert.equal(handle.snapshot().length, 12);
    assert.deepEqual(
        handle.snapshot().map(sample => sample.timestamp),
        Array.from({ length: 12 }, (_, index) => index + 4),
    );
    handle.dispose();
});

test('allows only one collector and skips timer ticks while it is running', async () => {
    const timers = fakeTimers();
    const first = deferred();
    let calls = 0;
    const sampler = new StreamResourceSampler({
        collect: () => {
            calls++;
            return calls === 1 ? first.promise : Promise.resolve({ totalRamBytes: 1 });
        },
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
    });
    const handle = sampler.subscribe(() => [12]);
    await flush();
    const tick = [...timers.timers.values()][0].callback;
    tick();
    tick();
    assert.equal(calls, 1);
    first.resolve({ totalRamBytes: 1 });
    await flush();
    assert.equal(calls, 1);
    tick();
    await flush();
    assert.equal(calls, 2);
    assert.equal(handle.snapshot().length, 2);
    handle.dispose();
});

test('additional stream sessions share the five-second timer without extra collections', async () => {
    const timers = fakeTimers();
    const calls = [];
    const sampler = new StreamResourceSampler({
        collect: async pids => {
            calls.push(pids);
            return {};
        },
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
    });
    const first = sampler.subscribe(() => [101]);
    await flush();
    const second = sampler.subscribe(() => [102]);
    const third = sampler.subscribe(() => [103]);
    await flush();
    assert.equal(calls.length, 1);
    assert.equal(timers.timers.size, 1);
    [...timers.timers.values()][0].callback();
    await flush();
    assert.deepEqual(calls[1], [101, 102, 103]);
    first.dispose();
    second.dispose();
    third.dispose();
    assert.equal(timers.timers.size, 0);
});

test('last dispose stops the timer, clears history and ignores a late result across generations', async () => {
    const timers = fakeTimers();
    const first = deferred();
    let calls = 0;
    const sampledPids = [];
    const sampler = new StreamResourceSampler({
        collect: pids => {
            sampledPids.push(pids);
            return ++calls === 1 ? first.promise : Promise.resolve({ totalRamBytes: 2 });
        },
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
    });
    const oldHandle = sampler.subscribe(() => [13]);
    await flush();
    oldHandle.dispose();
    assert.equal(timers.timers.size, 0);
    assert.deepEqual(oldHandle.snapshot(), []);

    const newHandle = sampler.subscribe(() => [14]);
    assert.deepEqual(newHandle.snapshot(), []);
    first.resolve({ totalRamBytes: 999 });
    await flush();
    assert.deepEqual(
        newHandle.snapshot().map(sample => sample.totalRamBytes),
        [2],
    );
    assert.equal(calls, 2);
    assert.deepEqual(sampledPids, [[13], [14]]);
    newHandle.dispose();
});

test('records a fixed failure sample when collection rejects and continues sampling', async () => {
    const timers = fakeTimers();
    let calls = 0;
    const sampler = new StreamResourceSampler({
        collect: async () => {
            if (calls++ === 0) throw new Error('sensitive process details');
            return { availableRamBytes: 9 };
        },
        now: () => 42,
        setInterval: timers.setInterval,
        clearInterval: timers.clearInterval,
    });
    const handle = sampler.subscribe(() => [15]);
    await flush();
    assert.equal(handle.snapshot()[0].samplingError, 'sampling-failed');
    assert.deepEqual(handle.snapshot()[0].processes, []);
    [...timers.timers.values()][0].callback();
    await flush();
    assert.equal(handle.snapshot()[1].availableRamBytes, 9);
    assert.equal(handle.snapshot()[1].samplingError, null);
    handle.dispose();
});

test('Windows collector parses committed memory and process bytes without exposing process identity', async () => {
    let command;
    const collect = createSystemCollector({
        platform: 'win32',
        execPowerShell: async value => {
            command = value;
            return JSON.stringify({
                totalRamBytes: 1000,
                availableRamBytes: 400,
                committedBytes: 700,
                commitLimitBytes: 2000,
                processes: { pid: 21, workingSetBytes: 300, privateBytes: 250 },
            });
        },
    });
    const sample = await collect([21, 'bad;throw' /* ignored by strict PID validation */]);
    assert.deepEqual(sample, {
        totalRamBytes: 1000,
        availableRamBytes: 400,
        committedBytes: 700,
        commitLimitBytes: 2000,
        processes: [{ pid: 21, workingSetBytes: 300, privateBytes: 250 }],
    });
    assert.match(command, /Win32_Process/);
    assert.match(command, /Win32_PerfRawData_PerfOS_Memory/);
    assert.match(command, /Get-Process -Id/);
    assert.match(command, /if\(\$target\.Count -gt 0\).*else\{\$proc=@\(\)\}/);
    assert.match(command, /\$seed=@\(21\)/);
    assert.doesNotMatch(command, /bad;throw|CommandLine|ProcessName/);
});

test('Linux collector reads memory units and recursively includes child PIDs with private bytes unknown', async () => {
    const readPaths = [];
    const files = new Map([
        ['/proc/meminfo', 'MemTotal: 1000 kB\nMemAvailable: 250 kB\nCommitLimit: 900 kB\nCommitted_AS: 600 kB\n'],
        ['/proc/31/task/31/children', '32 33'],
        ['/proc/32/task/32/children', '34'],
        ['/proc/33/task/33/children', ''],
        ['/proc/34/task/34/children', ''],
        ['/proc/31/statm', '10 2 0'],
        ['/proc/31/status', 'Name:\tparent\nVmRSS:\t12 kB\n'],
        ['/proc/32/statm', '10 3 0'],
        ['/proc/32/status', 'VmRSS:\t20 kB\n'],
        ['/proc/33/statm', '10 4 0'],
        ['/proc/33/status', 'VmRSS:\t30 kB\n'],
        ['/proc/34/statm', '10 5 0'],
        ['/proc/34/status', 'VmRSS:\t40 kB\n'],
    ]);
    const collect = createSystemCollector({
        platform: 'linux',
        readFile: async file => {
            readPaths.push(file);
            if (!files.has(file)) throw new Error('missing');
            return files.get(file);
        },
    });
    const sample = await collect([31]);
    assert.equal(sample.totalRamBytes, 1000 * 1024);
    assert.equal(sample.availableRamBytes, 250 * 1024);
    assert.equal(sample.commitLimitBytes, 900 * 1024);
    assert.equal(sample.committedBytes, 600 * 1024);
    assert.deepEqual(
        sample.processes.map(process => process.pid),
        [31, 32, 33, 34],
    );
    assert.deepEqual(
        sample.processes.map(process => process.workingSetBytes),
        [12, 20, 30, 40].map(kb => kb * 1024),
    );
    assert.deepEqual(
        sample.processes.map(process => process.privateBytes),
        [null, null, null, null],
    );
    assert.ok(readPaths.includes('/proc/32/task/32/children'));
    assert.ok(readPaths.includes('/proc/34/task/34/children'));
});

test('unsupported platforms and failed Linux memory reads return nullable fields and fixed errors', async () => {
    const unsupported = await createSystemCollector({ platform: 'freebsd' })([]);
    assert.equal(unsupported.samplingError, 'platform-unsupported');

    const failed = await createSystemCollector({
        platform: 'linux',
        readFile: async () => {
            throw new Error('private path or details');
        },
    })([]);
    assert.equal(failed.totalRamBytes, null);
    assert.equal(failed.availableRamBytes, null);
    assert.equal(failed.committedBytes, null);
    assert.equal(failed.commitLimitBytes, null);
    assert.equal(failed.samplingError, 'linux-memory-read-failed');
});
