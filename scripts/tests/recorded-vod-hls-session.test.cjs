'use strict';

require('./ts-cjs-compat.cjs');

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const ts = require('typescript');
const vm = require('node:vm');
require('reflect-metadata');

let activeSpawnHarness;
const inputStreams = [];
const resourceSubscriptions = [];

class FakeChildProcess extends EventEmitter {
    constructor(command, args, options) {
        super();
        this.command = command;
        this.args = args;
        this.options = options;
        this.stdin = new PassThrough();
        this.stdout = new PassThrough();
        this.stderr = new PassThrough();
        this.exitCode = null;
        this.signalCode = null;
        this.killSignals = [];
    }

    kill(signal = 'SIGTERM') {
        if (this.exitCode !== null || this.signalCode !== null) return false;
        this.killSignals.push(signal);
        this.signalCode = signal;
        this.emit('exit', null, signal);
        return true;
    }

    finish(code, signal = null) {
        if (this.exitCode !== null || this.signalCode !== null) return;
        this.exitCode = code;
        this.signalCode = signal;
        this.emit('exit', code, signal);
    }
}

function loadTypeScript(sourcePath, stubs = {}, append = '') {
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
        loadedModule._compile(`${compiled}\n${append}`, absolutePath);
    } finally {
        Module._load = load;
    }
    return loadedModule.exports;
}

const actualFs = require('node:fs');
const fakeFs = { ...actualFs };
fakeFs.createReadStream = (...args) => {
    const stream = new PassThrough();
    inputStreams.push({ args, stream });
    return stream;
};
const timingModule = loadTypeScript('../../src/model/service/stream/EncodedVodHlsTiming.ts');
const streamApiModelPath = path.resolve(__dirname, '../../src/model/api/stream/StreamApiModel.ts');
const streamApiModelSource = fs.readFileSync(streamApiModelPath, 'utf8');
const streamApiModelAst = ts.createSourceFile(
    streamApiModelPath,
    streamApiModelSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
);
const stopStreamProcessDeclaration = streamApiModelAst.statements
    .filter(ts.isVariableStatement)
    .flatMap(statement => statement.declarationList.declarations)
    .find(declaration => ts.isIdentifier(declaration.name) && declaration.name.text === 'stopStreamProcess');
assert.ok(stopStreamProcessDeclaration?.initializer, 'stopStreamProcess helper must be available for focused tests');
const stopStreamProcessJavaScript = ts.transpile(
    `const stopStreamProcess = ${stopStreamProcessDeclaration.initializer.getText(streamApiModelAst)};\nstopStreamProcess;`,
    { target: ts.ScriptTarget.ES2021 },
);

function loadStopStreamProcess({ platform = 'win32', execFile, killManaged }) {
    return vm.runInNewContext(stopStreamProcessJavaScript, {
        process: { platform },
        execFile,
        killManaged,
        stoppingStreamProcesses: new WeakMap(),
    });
}

const { TestSession: RecordedVodHlsMuxSession } = loadTypeScript(
    '../../src/model/api/stream/StreamApiModel.ts',
    {
        fs: fakeFs,
        '../../../util/ManagedProcess': {
            spawnManaged: (...args) => {
                if (activeSpawnHarness === undefined) throw new Error('SpawnHarnessIsNotSet');
                return activeSpawnHarness.spawn(...args);
            },
            killManaged: async child => {
                if (activeSpawnHarness === undefined) throw new Error('SpawnHarnessIsNotSet');
                return activeSpawnHarness.kill(child);
            },
        },
        '../../../util/StreamResourceSampler': {
            streamResourceSampler: {
                subscribe: () => {
                    const handle = {
                        disposed: false,
                        snapshot: () => [{ timestamp: 1 }],
                        dispose() {
                            this.disposed = true;
                        },
                    };
                    resourceSubscriptions.push(handle);
                    return handle;
                },
            },
        },
        '../../service/stream/WatchStreamProfileUtil': { __esModule: true, default: {} },
        '../../service/stream/EncodedVodHlsTiming': timingModule,
    },
    'exports.TestSession = RecordedVodHlsMuxSession;',
);

function createSpawnHarness() {
    const calls = [];
    return {
        calls,
        nextKillError: null,
        spawn(command, args, options) {
            const child = new FakeChildProcess(command, args, options);
            calls.push(child);
            return child;
        },
        kill(child) {
            if (this.nextKillError !== null) {
                const error = this.nextKillError;
                this.nextKillError = null;
                return Promise.reject(error);
            }
            return child.kill('SIGTERM');
        },
    };
}

async function createFixture(
    t,
    { fallbackCommand = 'legacy-encoder --legacy', disableFallback = false, startByte = 1234, startSequence = 2 } = {},
) {
    const temporaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'recorded-vodhls-session-test-'));
    const spawnHarness = createSpawnHarness();
    activeSpawnHarness = spawnHarness;
    inputStreams.length = 0;
    const diagnostics = [];
    const session = new RecordedVodHlsMuxSession({
        profileKey: 'test-profile',
        config: { ffmpeg: 'ffmpeg.exe', watch: { encoder: 'NVEncC' } },
        videoInfo: { filePath: path.join(temporaryDir, 'no-media-file-is-opened.ts'), duration: 20, size: 4096 },
        segmentDuration: 6.006,
        segmentCount: 6,
        startByte,
        startPosition: 12.012,
        startSequence,
        preprocessor: { bin: 'preprocessor.exe', args: ['--input', 'pipe:0'] },
        command: 'fast-encoder --fast',
        fallbackCommand: disableFallback ? undefined : fallbackCommand,
        log: {
            stream: {
                debug() {},
                info() {},
                warn(message) {
                    diagnostics.push(String(message));
                },
            },
        },
        temporaryDir,
        videoFileId: 42,
    });
    const sessionDir = await session.directoryPromise;
    t.after(async () => {
        await session.cleanup().catch(() => {});
        await fs.promises.rm(temporaryDir, { recursive: true, force: true });
    });
    return { session, sessionDir, spawnHarness, temporaryDir, diagnostics, startByte, startSequence };
}

async function waitFor(predicate, description) {
    const deadline = Date.now() + 2000;
    while (predicate() === false) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

test('a process spawn error stops every peer in the same pipeline generation', { timeout: 5000 }, async t => {
    const { session, spawnHarness } = await createFixture(t, { disableFallback: true });
    session.prefetch(2);
    await waitFor(() => spawnHarness.calls.length === 3, 'initial pipeline spawn');

    const [preprocessor, encoder, muxer] = spawnHarness.calls;
    encoder.emit('error', new Error('simulated encoder spawn error'));
    await waitFor(() => [preprocessor, muxer].every(child => child.signalCode === 'SIGTERM'), 'peer shutdown');

    assert.equal(session.isUsable(), false);
    assert.ok(spawnHarness.calls.every(child => child.signalCode !== null || child.exitCode !== null));
    assert.ok(
        spawnHarness.calls.every(child => child.options?.windowsHide === true || child.args?.windowsHide === true),
    );
});

test('a nonzero exit stops the other processes in that generation', { timeout: 5000 }, async t => {
    const { session, spawnHarness } = await createFixture(t, { disableFallback: true });
    session.prefetch(2);
    await waitFor(() => spawnHarness.calls.length === 3, 'initial pipeline spawn');

    const [preprocessor, encoder, muxer] = spawnHarness.calls;
    muxer.finish(1);
    await waitFor(() => [preprocessor, encoder].every(child => child.signalCode === 'SIGTERM'), 'peer shutdown');

    assert.equal(session.isUsable(), false);
});

test('a pipeline stream error stops the other processes in that generation', { timeout: 5000 }, async t => {
    const { session, spawnHarness } = await createFixture(t, { disableFallback: true });
    session.prefetch(2);
    await waitFor(() => spawnHarness.calls.length === 3, 'initial pipeline spawn');

    const [preprocessor, encoder, muxer] = spawnHarness.calls;
    encoder.stdout.emit('error', new Error('simulated pipe error'));
    await waitFor(() => [preprocessor, muxer].every(child => child.signalCode === 'SIGTERM'), 'peer shutdown');

    assert.equal(session.isUsable(), false);
    assert.ok(spawnHarness.calls.every(child => child.signalCode !== null || child.exitCode !== null));
});

test(
    'a failed fast attempt restarts the full pipeline once with the same byte and sequence offsets',
    { timeout: 7000 },
    async t => {
        const fixture = await createFixture(t);
        const pendingSegment = fixture.session.getSegment(fixture.startSequence);
        pendingSegment.catch(() => {});
        await waitFor(() => fixture.spawnHarness.calls.length === 3, 'initial pipeline spawn');
        const firstGeneration = fixture.spawnHarness.calls.slice(0, 3);
        const muxerArgs = firstGeneration[2].args;
        assert.equal(muxerArgs[muxerArgs.indexOf('-analyzeduration') + 1], '10000000');
        assert.equal(muxerArgs[muxerArgs.indexOf('-probesize') + 1], '32000000');

        firstGeneration[1].finish(1);
        await waitFor(() => fixture.spawnHarness.calls.length === 6, 'fallback pipeline spawn');
        const fallbackGeneration = fixture.spawnHarness.calls.slice(3, 6);

        assert.deepEqual(
            fallbackGeneration.map(child => child.command),
            ['preprocessor.exe', 'legacy-encoder --legacy', 'ffmpeg.exe'],
        );
        assert.ok(firstGeneration.every(child => child.signalCode !== null || child.exitCode !== null));
        assert.equal(inputStreams.length, 2);
        assert.deepEqual(
            inputStreams.map(item => item.args[1]),
            [{ start: fixture.startByte }, { start: fixture.startByte }],
        );
        assert.equal(
            fallbackGeneration[2].args[fallbackGeneration[2].args.indexOf('-start_number') + 1],
            String(fixture.startSequence),
        );

        const directory = await fixture.session.directoryPromise;
        await fs.promises.writeFile(path.join(directory, `segment-${fixture.startSequence}.ts`), 'fallback segment');
        assert.equal((await pendingSegment).toString(), 'fallback segment');
        assert.equal(fixture.session.isUsable(), true);
    },
);

test('a failed fallback rejects getSegment and makes the session unusable', { timeout: 7000 }, async t => {
    const fixture = await createFixture(t);
    const pendingSegment = fixture.session.getSegment(fixture.startSequence);
    pendingSegment.catch(() => {});
    await waitFor(() => fixture.spawnHarness.calls.length === 3, 'initial pipeline spawn');
    fixture.spawnHarness.calls[1].finish(1);
    await waitFor(() => fixture.spawnHarness.calls.length === 6, 'fallback pipeline spawn');

    fixture.spawnHarness.calls[5].finish(1);
    await assert.rejects(pendingSegment, /RecordedVodHlsmuxerFailed/);
    assert.equal(fixture.session.isUsable(), false);
    assert.equal(fixture.spawnHarness.calls.length, 6, 'fallback must not be retried');
    assert.ok(fixture.spawnHarness.calls.every(child => child.signalCode !== null || child.exitCode !== null));
    assert.ok(fixture.diagnostics.some(message => message.includes('recorded VOD HLS diagnostics')));
});

test('a late encoder failure after a successful muxer exit still records diagnostics', { timeout: 5000 }, async t => {
    const fixture = await createFixture(t, { disableFallback: true });
    fixture.session.prefetch(fixture.startSequence);
    await waitFor(() => fixture.spawnHarness.calls.length === 3, 'pipeline spawn');
    const [preprocessor, encoder, muxer] = fixture.spawnHarness.calls;

    muxer.finish(0);
    muxer.stdout.end();
    encoder.finish(1);
    await waitFor(() => preprocessor.signalCode === 'SIGTERM', 'remaining pipeline shutdown');

    assert.equal(fixture.session.isUsable(), false);
    assert.equal(fixture.diagnostics.filter(message => message.includes('recorded VOD HLS diagnostics')).length, 1);
    assert.ok(fixture.diagnostics.some(message => message.includes('RecordedVodHlsencoderFailed')));
});

test('successful fallback completion keeps only the initial failure diagnostic', { timeout: 7000 }, async t => {
    const fixture = await createFixture(t);
    const pendingSegment = fixture.session.getSegment(fixture.startSequence);
    pendingSegment.catch(() => {});
    await waitFor(() => fixture.spawnHarness.calls.length === 3, 'initial pipeline spawn');
    fixture.spawnHarness.calls[1].finish(1);
    await waitFor(() => fixture.spawnHarness.calls.length === 6, 'fallback pipeline spawn');
    const fallbackGeneration = fixture.spawnHarness.calls.slice(3, 6);
    fallbackGeneration.forEach(child => child.finish(0));

    const directory = await fixture.session.directoryPromise;
    await fs.promises.writeFile(path.join(directory, `segment-${fixture.startSequence}.ts`), 'complete');
    assert.equal((await pendingSegment).toString(), 'complete');
    assert.equal(fixture.session.isUsable(), true);
    assert.equal(fixture.diagnostics.filter(message => message.includes('recorded VOD HLS diagnostics')).length, 1);
    assert.equal(
        fixture.diagnostics.some(message => /exited: code=0/.test(message)),
        false,
    );
});

test('concurrent segment requests share one fallback pipeline', { timeout: 7000 }, async t => {
    const fixture = await createFixture(t);
    const firstSegment = fixture.session.getSegment(fixture.startSequence);
    const secondSegment = fixture.session.getSegment(fixture.startSequence + 1);
    firstSegment.catch(() => {});
    secondSegment.catch(() => {});
    await waitFor(() => fixture.spawnHarness.calls.length === 3, 'initial pipeline spawn');
    fixture.spawnHarness.calls[1].finish(1);
    await waitFor(() => fixture.spawnHarness.calls.length === 6, 'one shared fallback pipeline');

    const directory = await fixture.session.directoryPromise;
    await Promise.all([
        fs.promises.writeFile(path.join(directory, `segment-${fixture.startSequence}.ts`), 'segment one'),
        fs.promises.writeFile(path.join(directory, `segment-${fixture.startSequence + 1}.ts`), 'segment two'),
    ]);
    assert.deepEqual(
        [(await firstSegment).toString(), (await secondSegment).toString()],
        ['segment one', 'segment two'],
    );
    assert.equal(fixture.spawnHarness.calls.length, 6);
});

test('a failed stopManaged call prevents fallback pipeline creation', { timeout: 5000 }, async t => {
    const fixture = await createFixture(t);
    const pendingSegment = fixture.session.getSegment(fixture.startSequence);
    pendingSegment.catch(() => {});
    await waitFor(() => fixture.spawnHarness.calls.length === 3, 'initial pipeline spawn');
    fixture.spawnHarness.nextKillError = new Error('simulated stopManaged failure');
    fixture.spawnHarness.calls[1].finish(1);

    await assert.rejects(pendingSegment, /simulated stopManaged failure/);
    assert.equal(fixture.spawnHarness.calls.length, 3, 'fallback must wait for successful process shutdown');
    assert.equal(fixture.session.isUsable(), false);
    for (const child of fixture.spawnHarness.calls) child.kill('SIGTERM');
});

test('an old generation exit cannot fail a running fallback generation', { timeout: 7000 }, async t => {
    const fixture = await createFixture(t);
    const pendingSegment = fixture.session.getSegment(fixture.startSequence);
    pendingSegment.catch(() => {});
    await waitFor(() => fixture.spawnHarness.calls.length === 3, 'initial pipeline spawn');
    const oldEncoder = fixture.spawnHarness.calls[1];
    oldEncoder.finish(1);
    await waitFor(() => fixture.spawnHarness.calls.length === 6, 'fallback pipeline spawn');

    oldEncoder.emit('exit', 1, null);
    assert.equal(fixture.session.isUsable(), true);
    const directory = await fixture.session.directoryPromise;
    await fs.promises.writeFile(path.join(directory, `segment-${fixture.startSequence}.ts`), 'still usable');
    assert.equal((await pendingSegment).toString(), 'still usable');
});

test('a file stream error starts the fallback pipeline', { timeout: 7000 }, async t => {
    const fixture = await createFixture(t);
    const pendingSegment = fixture.session.getSegment(fixture.startSequence);
    pendingSegment.catch(() => {});
    await waitFor(() => fixture.spawnHarness.calls.length === 3, 'initial pipeline spawn');
    inputStreams[0].stream.emit('error', new Error('simulated source stream error'));
    await waitFor(() => fixture.spawnHarness.calls.length === 6, 'fallback pipeline spawn');

    assert.equal(fixture.session.isUsable(), true);
    const directory = await fixture.session.directoryPromise;
    await fs.promises.writeFile(path.join(directory, `segment-${fixture.startSequence}.ts`), 'source recovered');
    assert.equal((await pendingSegment).toString(), 'source recovered');
});

test('intentional cleanup does not emit failure diagnostics', { timeout: 5000 }, async t => {
    const fixture = await createFixture(t, { disableFallback: true });
    fixture.session.prefetch(2);
    await waitFor(() => fixture.spawnHarness.calls.length === 3, 'pipeline spawn');
    await fixture.session.cleanup();

    assert.ok(fixture.spawnHarness.calls.every(child => child.signalCode === 'SIGTERM'));
    assert.equal(
        fixture.diagnostics.some(message => message.includes('recorded VOD HLS diagnostics')),
        false,
    );
    assert.ok(resourceSubscriptions.at(-1)?.disposed);
});

test('Windows stop helper kills the process tree before confirming managed-process shutdown', async () => {
    const calls = [];
    const child = { pid: 4321, exitCode: null, signalCode: null };
    const stop = loadStopStreamProcess({
        execFile(command, args, options, callback) {
            calls.push({ kind: 'taskkill', command, args, options });
            callback(null);
        },
        async killManaged(process) {
            calls.push({ kind: 'managed', process });
        },
    });

    await stop(child);

    assert.equal(calls[0].kind, 'taskkill');
    assert.equal(calls[0].command, 'taskkill');
    assert.deepEqual(Array.from(calls[0].args), ['/PID', '4321', '/T', '/F']);
    assert.equal(calls[0].options.windowsHide, true);
    assert.equal(calls[0].options.timeout, 5000);
    assert.equal(calls[1].kind, 'managed');
    assert.equal(calls[1].process, child);
});

test('Windows stop helper rejects a failed tree kill while the owned process is still live', async () => {
    const calls = [];
    const child = { pid: 4321, exitCode: null, signalCode: null };
    const stop = loadStopStreamProcess({
        execFile(command, args, options, callback) {
            calls.push('taskkill');
            callback(new Error('taskkill failed'));
        },
        async killManaged() {
            calls.push('managed');
        },
    });

    await assert.rejects(stop(child), /taskkill failed/);
    assert.deepEqual(calls, ['taskkill']);
});

test('Windows stop helper skips tree kill for an already exited process', async () => {
    const calls = [];
    const child = { pid: 4321, exitCode: 0, signalCode: null };
    const stop = loadStopStreamProcess({
        execFile() {
            calls.push('taskkill');
        },
        async killManaged(process) {
            calls.push(['managed', process]);
        },
    });

    await stop(child);

    assert.equal(calls.length, 1);
    assert.deepEqual(calls[0], ['managed', child]);
});
