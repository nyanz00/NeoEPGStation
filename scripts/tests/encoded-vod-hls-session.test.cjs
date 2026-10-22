'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const { PassThrough } = require('node:stream');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

let activeSpawnHarness;

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
        this.pipedTo = undefined;
        this.stdout.pipe = destination => {
            this.pipedTo = destination;
            return destination;
        };
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

const timingModule = loadTypeScript('../../src/model/service/stream/EncodedVodHlsTiming.ts');
const { default: WatchStreamProfileUtil } = loadTypeScript('../../src/model/service/stream/WatchStreamProfileUtil.ts', {
    '../../../util/ProcessUtil': { ROOT_PATH: process.cwd() },
    './EncodedVodHlsTiming': timingModule,
});
const { TestSession: EncodedVodHlsMuxSession } = loadTypeScript(
    '../../src/model/api/stream/StreamApiModel.ts',
    {
        child_process: {
            spawn: (...args) => {
                if (activeSpawnHarness === undefined) throw new Error('SpawnHarnessIsNotSet');
                return activeSpawnHarness.spawn(...args);
            },
        },
        '../../../util/ManagedProcess': {
            spawnManaged: (...args) => {
                if (activeSpawnHarness === undefined) throw new Error('SpawnHarnessIsNotSet');
                return activeSpawnHarness.spawn(...args);
            },
            killManaged: async child => child.kill('SIGTERM'),
        },
        '../../../util/ProcessUtil': {
            __esModule: true,
            default: {
                kill: async child => child.kill('SIGTERM'),
            },
        },
        '../../service/stream/WatchStreamProfileUtil': {
            __esModule: true,
            default: WatchStreamProfileUtil,
        },
        '../../service/stream/EncodedVodHlsTiming': timingModule,
    },
    'exports.TestSession = EncodedVodHlsMuxSession;',
);

function createSpawnHarness({ probeOutput, probeError } = {}) {
    const calls = [];
    return {
        calls,
        spawn(command, args, options) {
            const child = new FakeChildProcess(command, args, options);
            calls.push(child);
            if (command === 'ffprobe.exe' && (probeOutput !== undefined || probeError !== undefined)) {
                queueMicrotask(() => {
                    if (probeError !== undefined) {
                        child.emit('error', new Error(probeError));
                        return;
                    }
                    child.stdout.write(typeof probeOutput === 'string' ? probeOutput : JSON.stringify(probeOutput));
                    child.finish(0);
                });
            }
            return child;
        },
    };
}

function assertWithinTempRoot(root, target) {
    const relative = path.relative(path.resolve(root), path.resolve(target));
    assert.ok(
        relative === '' || (!path.isAbsolute(relative) && relative !== '..' && !relative.startsWith(`..${path.sep}`)),
    );
    const tempRelative = path.relative(path.resolve(os.tmpdir()), path.resolve(target));
    assert.ok(tempRelative !== '..' && !path.isAbsolute(tempRelative) && !tempRelative.startsWith(`..${path.sep}`));
}

async function createFixture(t, { startPosition = 0, subtitlePath, encoder = 'NVEncC', probeOutput, probeError } = {}) {
    const temporaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'encoded-vodhls-session-test-'));
    const spawnHarness = createSpawnHarness({ probeOutput, probeError });
    activeSpawnHarness = spawnHarness;
    const session = new EncodedVodHlsMuxSession({
        profileKey: 'test-profile',
        config: {
            ffmpeg: 'ffmpeg.exe',
            ffprobe: 'ffprobe.exe',
            watch: { encoder, nvEncC: 'NVEncC.exe' },
        },
        videoInfo: {
            filePath: path.join(temporaryDir, 'recording.mkv'),
            duration: 12,
            size: 1024,
            frameRate: 23.976,
            videoCodecName: 'h264',
            videoPixelFormat: 'yuv420p',
            startTime: 0,
        },
        segmentDuration: 4.004,
        segmentCount: 3,
        startPosition,
        startSequence: 0,
        qualityName: '720p',
        encoder,
        subtitlePath,
        subtitleStyle: {
            sizePercent: 100,
            opacityPercent: 100,
            outlineSizePercent: 100,
            outlineOpacityPercent: 100,
        },
        log: { stream: { debug() {}, info() {}, warn() {} } },
        temporaryDir,
    });
    const sessionDir = await session.directoryPromise;
    assertWithinTempRoot(temporaryDir, sessionDir);
    t.after(async () => {
        await session.cleanup();
        await fs.promises.rm(temporaryDir, { recursive: true, force: true });
    });
    return { session, sessionDir, spawnHarness, temporaryDir };
}

async function waitFor(predicate, description) {
    const deadline = Date.now() + 1500;
    while (predicate() === false) {
        if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${description}`);
        await new Promise(resolve => setTimeout(resolve, 5));
    }
}

async function assertRejectsPromptly(promise, expression) {
    let timeout;
    try {
        await Promise.race([
            assert.rejects(promise, expression),
            new Promise((_, reject) => {
                timeout = setTimeout(() => reject(new Error('Session rejection timed out')), 1000);
            }),
        ]);
    } finally {
        clearTimeout(timeout);
    }
}

test(
    'NVEncC without burn-in starts a producer and FFmpeg copy mux connected by one pipe',
    { timeout: 5000 },
    async t => {
        const { session, sessionDir, spawnHarness } = await createFixture(t);
        const pendingSegment = session.getSegment(0);
        pendingSegment.catch(() => {});
        await waitFor(() => spawnHarness.calls.length === 2, 'encoder and muxer spawn');

        const [mux, encoder] = spawnHarness.calls;
        assert.equal(mux.command, 'ffmpeg.exe');
        assert.ok(mux.args.includes('copy'));
        assert.equal(encoder.command, 'NVEncC.exe');
        assert.equal(encoder.pipedTo, mux.stdin);
        assert.ok(spawnHarness.calls.every(child => child.options.windowsHide === true));
        assert.ok(
            spawnHarness.calls.every(child => {
                assertWithinTempRoot(sessionDir, child.options.cwd);
                return true;
            }),
        );

        await session.cleanup();
        await assertRejectsPromptly(pendingSegment, /EncodedVodHlsSessionStopped/);
        assert.ok(spawnHarness.calls.every(child => child.signalCode !== null || child.exitCode !== null));
        assert.equal(fs.existsSync(sessionDir), false);
    },
);

test('subtitle burn-in keeps FFmpeg as the single process', { timeout: 5000 }, async t => {
    const temporaryDir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'encoded-vodhls-subtitle-test-'));
    const subtitlePath = path.join(temporaryDir, 'source.ass');
    await fs.promises.writeFile(subtitlePath, '[Script Info]\nTitle: Test\n', 'utf8');
    assertWithinTempRoot(os.tmpdir(), subtitlePath);
    const fixture = await createFixture(t, { subtitlePath });
    const pendingSegment = fixture.session.getSegment(0);
    pendingSegment.catch(() => {});
    await waitFor(() => fixture.spawnHarness.calls.length > 0, 'burn-in FFmpeg spawn');

    assert.equal(fixture.spawnHarness.calls.length, 1);
    assert.equal(fixture.spawnHarness.calls[0].command, 'ffmpeg.exe');
    assert.match(fixture.spawnHarness.calls[0].args.join(' '), /ass=subtitle\.ass/);
    await fixture.session.cleanup();
    await assertRejectsPromptly(pendingSegment, /EncodedVodHlsSessionStopped/);
    assert.equal(fs.existsSync(fixture.sessionDir), false);
    await fs.promises.rm(temporaryDir, { recursive: true, force: true });
});

test(
    'cleanup stops a pending ffprobe and waits for startup before removing its temp directory',
    { timeout: 5000 },
    async t => {
        const { session, sessionDir, spawnHarness } = await createFixture(t, { startPosition: 4.004 });
        const pendingSegment = session.getSegment(0);
        pendingSegment.catch(() => {});
        await waitFor(() => spawnHarness.calls.length === 1, 'pending ffprobe spawn');
        assert.equal(spawnHarness.calls[0].command, 'ffprobe.exe');

        const cleanup = session.cleanup();
        await cleanup;
        await assertRejectsPromptly(pendingSegment, /EncodedVodHlsSessionStopped/);
        assert.equal(spawnHarness.calls[0].signalCode, 'SIGTERM');
        assert.equal(fs.existsSync(sessionDir), false);
        assert.equal(spawnHarness.calls.length, 1);
    },
);

test(
    'NVEncC probe seeks relative to the first video PTS and keeps preroll aligned to the requested position',
    { timeout: 5000 },
    async t => {
        const { session, sessionDir, spawnHarness } = await createFixture(t, {
            startPosition: 12.012,
            probeOutput: {
                packets: [
                    { pts_time: '0.021', flags: 'K__' },
                    { pts_time: '10.448', flags: 'K__' },
                ],
            },
        });
        const pendingSegment = session.getSegment(0);
        pendingSegment.catch(() => {});
        await waitFor(() => spawnHarness.calls.length === 3, 'ffprobe, muxer, and encoder spawn');

        const [probe, mux, encoder] = spawnHarness.calls;
        assert.equal(probe.command, 'ffprobe.exe');
        const readIntervals = probe.args[probe.args.indexOf('-read_intervals') + 1];
        assert.equal(readIntervals, '0%+#1,12.012000%+#1');
        assert.equal(mux.command, 'ffmpeg.exe');
        assert.equal(encoder.command, 'NVEncC.exe');
        assert.equal(encoder.args[encoder.args.indexOf('--seek') + 1], '10.426000');
        assert.equal(mux.args[mux.args.indexOf('-ss') + 1], '1.584906');
        assert.equal(mux.args[mux.args.indexOf('-output_ts_offset') + 1], '12.012000');
        assert.ok((await fs.promises.readFile(path.join(sessionDir, 'keyframes.txt'), 'utf8')).startsWith('38\n'));

        await session.cleanup();
        await assertRejectsPromptly(pendingSegment, /EncodedVodHlsSessionStopped/);
        assert.ok([mux, encoder].every(child => child.signalCode !== null || child.exitCode !== null));
        assert.equal(fs.existsSync(sessionDir), false);
    },
);

test(
    'a missing or malformed probe falls back to decoding from the start without fast seek',
    { timeout: 10000 },
    async t => {
        for (const [failureKind, probeOptions] of [
            ['malformed JSON', { probeOutput: '{not-json' }],
            ['probe error', { probeError: 'simulated ffprobe error' }],
        ]) {
            await t.test(failureKind, { timeout: 4000 }, async subtest => {
                const { session, sessionDir, spawnHarness } = await createFixture(subtest, {
                    startPosition: 12.012,
                    ...probeOptions,
                });
                const pendingSegment = session.getSegment(0);
                pendingSegment.catch(() => {});
                await waitFor(() => spawnHarness.calls.length === 3, 'ffprobe, muxer, and encoder spawn');

                const [probe, mux, encoder] = spawnHarness.calls;
                assert.equal(probe.command, 'ffprobe.exe');
                assert.equal(encoder.args.includes('--seek'), false);
                assert.equal(
                    (await fs.promises.readFile(path.join(sessionDir, 'keyframes.txt'), 'utf8')).split('\n')[0],
                    '288',
                );
                assert.equal(mux.args[mux.args.indexOf('-ss') + 1], '12.011989');
                assert.equal(mux.args[mux.args.indexOf('-output_ts_offset') + 1], '12.012000');

                await session.cleanup();
                await assertRejectsPromptly(pendingSegment, /EncodedVodHlsSessionStopped/);
                assert.ok([mux, encoder].every(child => child.signalCode !== null || child.exitCode !== null));
                assert.equal(fs.existsSync(sessionDir), false);
            });
        }
    },
);

test(
    'producer and muxer errors or nonzero exits stop the peer and reject a waiting segment',
    { timeout: 10000 },
    async t => {
        for (const failedRole of ['muxer', 'producer']) {
            for (const failureKind of ['spawn error', 'nonzero exit']) {
                await t.test(`${failedRole} ${failureKind}`, { timeout: 3000 }, async subtest => {
                    const { session, spawnHarness } = await createFixture(subtest);
                    const pendingSegment = session.getSegment(0);
                    pendingSegment.catch(() => {});
                    await waitFor(() => spawnHarness.calls.length === 2, 'encoder and muxer spawn');

                    const failedProcess = spawnHarness.calls[failedRole === 'muxer' ? 0 : 1];
                    if (failureKind === 'spawn error') failedProcess.emit('error', new Error('simulated spawn error'));
                    else failedProcess.finish(1);

                    await assertRejectsPromptly(
                        pendingSegment,
                        failureKind === 'spawn error' ? /simulated spawn error/ : /EncodedVodHlsProcessFailed/,
                    );
                    await session.cleanup();
                    assert.ok(spawnHarness.calls.every(child => child.signalCode !== null || child.exitCode !== null));
                });
            }
        }
    },
);

test(
    'mux stdin EPIPE is consumed and fails the pending segment without an unhandled stream error',
    { timeout: 5000 },
    async t => {
        const { session, spawnHarness } = await createFixture(t);
        const pendingSegment = session.getSegment(0);
        pendingSegment.catch(() => {});
        await waitFor(() => spawnHarness.calls.length === 2, 'encoder and muxer spawn');
        const mux = spawnHarness.calls[0];

        assert.doesNotThrow(() => mux.stdin.emit('error', Object.assign(new Error('broken pipe'), { code: 'EPIPE' })));
        await assertRejectsPromptly(pendingSegment, /broken pipe/);
        await session.cleanup();
        assert.ok(spawnHarness.calls.every(child => child.signalCode !== null || child.exitCode !== null));
    },
);
