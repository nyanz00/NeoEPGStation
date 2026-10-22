'use strict';

require('./ts-cjs-compat.cjs');

const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');
require('reflect-metadata');

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
const { getEncodedVodHlsTiming } = timingModule;
const { default: WatchStreamProfileUtil } = loadTypeScript('../../src/model/service/stream/WatchStreamProfileUtil.ts', {
    '../../../util/ProcessUtil': { ROOT_PATH: process.cwd() },
    './EncodedVodHlsTiming': timingModule,
});
const { default: StreamApiModel, RecordedSession } = loadTypeScript(
    '../../src/model/api/stream/StreamApiModel.ts',
    {
        '../../service/stream/WatchStreamProfileUtil': { __esModule: true, default: WatchStreamProfileUtil },
        '../../service/stream/EncodedVodHlsTiming': timingModule,
        '../../../util/MpegTsTimeUtil': { findMpegTsByteOffset: async () => 0 },
        '../../RecordedUseClient': {
            recordedUseClient: { acquire: async () => ({ release: async () => {} }) },
        },
    },
    'exports.RecordedSession = RecordedVodHlsMuxSession;',
);
const { default: VideoAnalysisModel } = loadTypeScript('../../src/model/video/VideoAnalysisModel.ts');

const frameRates = [
    { source: 23.976, option: '24000/1001', gop: 96, duration: 4.004 },
    { source: 29.97, option: '30000/1001', gop: 120, duration: 4.004 },
    { source: 59.94, option: '60000/1001', gop: 240, duration: 4.004 },
    { source: 24, option: '24000000/1000000', gop: 96, duration: 4 },
    { source: 25, option: '25000000/1000000', gop: 100, duration: 4 },
    { source: 30, option: '30000000/1000000', gop: 120, duration: 4 },
    { source: undefined, option: '30000000/1000000', gop: 120, duration: 4 },
];

const config = (hevc10bit = false) => ({
    ffmpeg: 'ffmpeg.exe',
    watch: {
        encoder: 'NVEncC',
        nvEncC: 'NVEncC.exe',
        hevc10bit,
    },
});

const argumentValue = (args, option) => {
    const index = args.indexOf(option);
    assert.notEqual(index, -1, `missing ${option}: ${args.join(' ')}`);
    return args[index + 1];
};

const encodedCommandOption = (frameRate, segmentDuration, extra = {}) => ({
    input: 'recording.mkv',
    playlistPath: 'playlist.m3u8',
    segmentDuration,
    segmentPath: 'segment-%d.ts',
    start: 0,
    startSequence: 0,
    qualityName: '720p',
    encoder: 'NVEncC',
    frameRate,
    ...extra,
});

test('encoded VOD HLS timing uses a four-second GOP at each source frame rate', () => {
    for (const expected of frameRates) {
        const timing = getEncodedVodHlsTiming(expected.source);
        assert.equal(timing.frameRateOption, expected.option);
        assert.equal(timing.gopFrames, expected.gop);
        assert.ok(Math.abs(timing.segmentDuration - expected.duration) < 1e-12);
        assert.ok(Math.abs(timing.gopFrames / timing.frameRate - timing.segmentDuration) < 1e-12);
    }
});

test('FFmpeg encoded HLS command derives frame rate, GOP, and segment cut from one timing value', () => {
    for (const expected of frameRates) {
        const timing = getEncodedVodHlsTiming(expected.source);
        const command = WatchStreamProfileUtil.buildEncodedVodHlsContinuousCommand(
            config(),
            encodedCommandOption(expected.source, timing.segmentDuration),
        );
        const args = command.args;

        assert.equal(argumentValue(args, '-r'), expected.option);
        assert.equal(argumentValue(args, '-g'), expected.gop.toString(10));
        assert.equal(argumentValue(args, '-hls_time'), (expected.duration - 0.00001).toFixed(6));
        assert.equal(argumentValue(args, '-force_key_frames'), `expr:eq(mod(n,${expected.gop}),0)`);
        assert.equal(argumentValue(args, '-fps_mode'), 'cfr');
    }
});

test('iOS timing is opt-in on the FFmpeg transform path, including NVENC subtitle burn-in', () => {
    for (const encoder of ['FFmpeg', 'NVEncC']) {
        const option = encodedCommandOption(25, 4, { encoder, subtitlePath: 'subtitle.ass' });
        const web = WatchStreamProfileUtil.buildEncodedVodHlsContinuousCommand(config(), option);
        const ios = WatchStreamProfileUtil.buildEncodedVodHlsContinuousCommand(config(), { ...option, client: 'ios' });
        assert.equal(argumentValue(web.args, '-muxdelay'), '0');
        assert.equal(argumentValue(web.args, '-muxpreload'), '0');
        assert.equal(ios.args.includes('-muxdelay'), false);
        assert.equal(ios.args.includes('-muxpreload'), false);
        assert.equal(argumentValue(ios.args, '-c:v'), argumentValue(web.args, '-c:v'));
        assert.equal(argumentValue(ios.args, '-g'), argumentValue(web.args, '-g'));
    }
});

test('iOS request leaves native NVEncC encoding and copy-only HLS mux commands unchanged', () => {
    const option = encodedCommandOption(25, 4);
    assert.deepEqual(
        WatchStreamProfileUtil.buildEncodedVodHlsNVEncCommand(config(), { ...option, client: 'ios' }, 0, 'keys.txt'),
        WatchStreamProfileUtil.buildEncodedVodHlsNVEncCommand(config(), option, 0, 'keys.txt'),
    );
    assert.deepEqual(
        WatchStreamProfileUtil.buildEncodedVodHlsCopyMuxCommand(config(), { ...option, client: 'ios' }, 0),
        WatchStreamProfileUtil.buildEncodedVodHlsCopyMuxCommand(config(), option, 0),
    );
    assert.equal(WatchStreamProfileUtil.usesRecordedVodHlsFFmpeg(config(), 'FFmpeg'), true);
    assert.equal(WatchStreamProfileUtil.usesRecordedVodHlsFFmpeg(config(), 'NVEncC'), false);
    assert.equal(WatchStreamProfileUtil.usesRecordedVodHlsFFmpeg(config()), false);
    assert.equal(WatchStreamProfileUtil.usesRecordedVodHlsFFmpeg({ ...config(), watch: { encoder: 'FFmpeg' } }), true);
});

test('software-decoded 10-bit H.264 is converted to an 8-bit H.264 profile', () => {
    const command = WatchStreamProfileUtil.buildEncodedVodHlsContinuousCommand(
        config(true),
        encodedCommandOption(23.976, 4.004, {
            inputVideoCodec: 'h264',
            inputPixelFormat: 'yuv420p10le',
        }),
    );

    assert.equal(argumentValue(command.args, '-c:v'), 'h264_nvenc');
    assert.match(argumentValue(command.args, '-vf'), /format=yuv420p(?:,|$)/);
    assert.doesNotMatch(argumentValue(command.args, '-vf'), /yuv420p10le/);
    assert.equal(argumentValue(command.args, '-profile:v'), 'high');
});

test('HEVC 10-bit setting selects main10 and a 10-bit filter while disabled selects main and 8-bit', () => {
    const option = encodedCommandOption(29.97, 4.004, {
        isHevc: true,
        inputVideoCodec: 'h264',
        inputPixelFormat: 'yuv420p10le',
    });
    const tenBit = WatchStreamProfileUtil.buildEncodedVodHlsContinuousCommand(config(true), option);
    const eightBit = WatchStreamProfileUtil.buildEncodedVodHlsContinuousCommand(config(false), option);

    assert.equal(argumentValue(tenBit.args, '-c:v'), 'hevc_nvenc');
    assert.equal(argumentValue(tenBit.args, '-profile:v'), 'main10');
    assert.match(argumentValue(tenBit.args, '-vf'), /format=yuv420p10le(?:,|$)/);
    assert.equal(argumentValue(eightBit.args, '-profile:v'), 'main');
    assert.match(argumentValue(eightBit.args, '-vf'), /format=yuv420p(?:,|$)/);
    assert.doesNotMatch(argumentValue(eightBit.args, '-vf'), /yuv420p10le/);
});

test('NVEncC command fixes the GOP and keyframe file, and FFmpeg muxes with stream copy', () => {
    const timing = getEncodedVodHlsTiming(23.976);
    const option = encodedCommandOption(23.976, timing.segmentDuration, {
        start: timing.segmentDuration,
        startSequence: 1,
        isHevc: true,
    });
    const encode = WatchStreamProfileUtil.buildEncodedVodHlsNVEncCommand(config(true), option, 3.003, 'keyframes.txt');
    const mux = WatchStreamProfileUtil.buildEncodedVodHlsCopyMuxCommand(config(true), option, 24 / timing.frameRate);

    assert.equal(encode.bin, 'NVEncC.exe');
    assert.equal(argumentValue(encode.args, '--avsync'), 'forcecfr');
    assert.equal(argumentValue(encode.args, '--fps'), timing.frameRateOption);
    assert.equal(argumentValue(encode.args, '--codec'), 'hevc');
    assert.equal(argumentValue(encode.args, '--profile'), 'main10');
    assert.equal(argumentValue(encode.args, '--output-depth'), '10');
    assert.equal(argumentValue(encode.args, '--gop-len'), timing.gopFrames.toString(10));
    assert.equal(argumentValue(encode.args, '--bframes'), '0');
    assert.ok(encode.args.includes('--no-i-adapt'));
    assert.equal(argumentValue(encode.args, '--keyfile'), 'keyframes.txt');
    assert.equal(argumentValue(encode.args, '--seek'), '3.002000');
    assert.ok(encode.args.includes('--output-format'));
    assert.ok(encode.args.includes('mpegts'));
    assert.equal(mux.bin, 'ffmpeg.exe');
    assert.equal(argumentValue(mux.args, '-c'), 'copy');
    assert.equal(argumentValue(mux.args, '-ss'), (24 / timing.frameRate - 1 / 90000).toFixed(6));
    assert.equal(argumentValue(mux.args, '-hls_time'), (timing.segmentDuration - 0.00001).toFixed(6));
    assert.equal(argumentValue(mux.args, '-start_number'), '1');
    assert.equal(argumentValue(mux.args, '-output_ts_offset'), timing.segmentDuration.toFixed(6));
    assert.equal(mux.args.at(-1), 'playlist.m3u8');
    assert.ok(mux.args.includes('segment-%d.ts'));
    assert.equal(
        mux.args.some(arg => /^(?:h264|hevc|libx264|libx265|h264_nvenc|hevc_nvenc)$/.test(arg)),
        false,
    );
});

function createPlaylistModel(videoInfo, isEncodedVideo) {
    const model = Object.create(StreamApiModel.prototype);
    Object.assign(model, {
        getRecordedVODHLSVideoInfo: async () => videoInfo,
        isEncodedVideo: async () => isEncodedVideo,
        resolveEncodedVodHlsSubtitleOption: option => option,
        getEncodedVodHlsSession: async () => ({}),
        getRecordedVodHlsSession: async () => ({}),
        registerRecordedVODHLSClient() {},
        log: { stream: { info() {} } },
    });
    return model;
}

const playlistOption = {
    videoFileId: 42,
    mode: 0,
    playPosition: 0,
    vodSessionId: 'test-session',
};

test('iOS selection propagates to segment URLs and isolates the reusable session profile', async () => {
    const model = createPlaylistModel({ duration: 12, frameRate: 25 }, true);
    const ios = await model.getRecordedVODHLSPlaylist({ ...playlistOption, client: 'ios' });
    const web = await model.getRecordedVODHLSPlaylist(playlistOption);
    const segmentUrls = ios.split('\n').filter(line => line.startsWith('segments/'));
    assert.equal(segmentUrls.length, 3);
    for (const url of segmentUrls) assert.equal(new URL(url, 'http://localhost/').searchParams.get('client'), 'ios');
    assert.doesNotMatch(web, /client=/);
    assert.notEqual(
        model.createRecordedVodHlsSessionProfileKey(playlistOption, 'recording.mkv', 4),
        model.createRecordedVodHlsSessionProfileKey({ ...playlistOption, client: 'ios' }, 'recording.mkv', 4),
    );
});

test('TS HLS timestamp preservation is limited to explicit iOS requests using FFmpeg for conversion', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ios-ts-hls-options-'));
    const prefetch = RecordedSession.prototype.prefetch;
    RecordedSession.prototype.prefetch = () => {};
    t.after(() => {
        RecordedSession.prototype.prefetch = prefetch;
        fs.rmSync(directory, { recursive: true, force: true });
    });
    const model = Object.create(StreamApiModel.prototype);
    Object.assign(model, {
        configure: { getConfig: () => ({ ...config(), temporaryDir: directory }) },
        videoFileDB: { findId: async id => ({ id, recordedId: 8 }) },
        recordedVodHlsSessions: new Map(),
        encodedVodHlsSessions: new Map(),
        creatingVodSessions: new Map(),
        vodUses: new Map(),
        vodHlsCleanupPromises: new Map(),
        cleanupRecordedVodHlsSessions() {},
        cleanupEncodedVodHlsSessions() {},
        buildRecordedTsPreprocessor: async () => ({ bin: 'preprocessor', args: [] }),
        log: { stream: { info() {} } },
    });
    const info = { duration: 60, size: 1000, filePath: path.join(directory, 'recording.ts') };
    for (const encoder of ['FFmpeg', 'NVEncC']) {
        for (const client of [undefined, 'ios']) {
            const session = await model.getRecordedVodHlsSession({ ...playlistOption, encoder, client }, info, 6.006);
            assert.equal(session.option.preserveTimestamps, client === 'ios' && encoder === 'FFmpeg');
            await session.cleanup();
        }
    }
});

function playlistDurations(playlist) {
    return [...playlist.matchAll(/^#EXTINF:([0-9.]+),$/gm)].map(match => Number(match[1]));
}

test('encoded VOD manifest follows the rational GOP interval and keeps its final duration aligned', async () => {
    const videoInfo = { duration: 9.508, frameRate: 23.976 };
    const model = createPlaylistModel(videoInfo, true);
    const playlist = await model.getRecordedVODHLSPlaylist(playlistOption);
    const durations = playlistDurations(playlist);

    assert.match(playlist, /^#EXT-X-TARGETDURATION:5$/m);
    assert.equal(durations.length, 3);
    assert.deepEqual(durations, [4.004, 4.004, 1.5]);
    assert.equal(
        durations.reduce((sum, duration) => sum + duration, 0),
        videoInfo.duration,
    );
    assert.match(playlist, /#EXT-X-ENDLIST\n$/);
});

function createAnalysisBackedPlaylistModel(analysisResults) {
    const calls = [];
    const model = Object.create(StreamApiModel.prototype);
    Object.assign(model, {
        recordedVodHlsVideoInfoCache: new Map(),
        videoUtil: { getFullFilePathFromId: async () => 'recording.mkv' },
        videoAnalysis: {
            get: async (videoFileId, force) => {
                calls.push({ videoFileId, force });
                return analysisResults[force === true ? analysisResults.length - 1 : 0];
            },
        },
        isEncodedVideo: async () => true,
        toRecordedTsInputInfo: () => undefined,
        getEncodedVodHlsSession: async () => ({}),
        registerRecordedVODHLSClient() {},
        log: { stream: { info() {} } },
    });
    return { model, calls };
}

const videoAnalysis = ({ duration, streamDuration, frameRate = 23.976 }) => ({
    duration,
    size: 1024,
    frameRate,
    videoCodec: 'h264',
    pixelFormat: 'yuv420p',
    startTime: 0,
    streams: [{ type: 'video', duration: streamDuration }],
    ts: null,
});

test('encoded VOD manifest uses the frame-aligned video duration instead of container tail padding', async () => {
    const { model } = createAnalysisBackedPlaylistModel([videoAnalysis({ duration: 8.029, streamDuration: 8.008 })]);
    const playlist = await model.getRecordedVODHLSPlaylist(playlistOption);
    const durations = playlistDurations(playlist);

    assert.deepEqual(durations, [4.004, 4.004]);
    assert.equal(
        durations.reduce((sum, duration) => sum + duration, 0),
        8.008,
    );
    assert.match(playlist, /^#EXT-X-TARGETDURATION:5$/m);
});

test('undefined cached track duration triggers one refresh and a null refresh stays cached', async () => {
    const { model, calls } = createAnalysisBackedPlaylistModel([
        videoAnalysis({ duration: 8.029, streamDuration: undefined }),
        videoAnalysis({ duration: 8.029, streamDuration: null }),
    ]);

    const first = await model.getRecordedVODHLSVideoInfo(42);
    const second = await model.getRecordedVODHLSVideoInfo(42);

    assert.equal(first.duration, 8.029);
    assert.equal(second.duration, first.duration);
    assert.deepEqual(calls, [
        { videoFileId: 42, force: undefined },
        { videoFileId: 42, force: true },
    ]);
});

test('a known missing track duration does not trigger a forced re-probe', async () => {
    const { model, calls } = createAnalysisBackedPlaylistModel([
        videoAnalysis({ duration: 8.029, streamDuration: null }),
    ]);

    await model.getRecordedVODHLSVideoInfo(42);
    await model.getRecordedVODHLSVideoInfo(42);

    assert.deepEqual(calls, [{ videoFileId: 42, force: undefined }]);
});

test('video analysis maps MP4 stream duration, Matroska DURATION tags, and absent duration', () => {
    const model = Object.create(VideoAnalysisModel.prototype);
    const streams = model.mapStreams([
        { index: 0, codec_type: 'video', duration: '8.008' },
        { index: 1, codec_type: 'video', tags: { DURATION: '00:00:08.029000000' } },
        { index: 2, codec_type: 'video', duration: 'N/A' },
    ]);

    assert.deepEqual(
        streams.map(stream => stream.duration),
        [8.008, 8.029, null],
    );
});

test('transport stream VOD HLS keeps its existing 6.006-second segment interval', async () => {
    const videoInfo = { duration: 13.012, frameRate: 23.976 };
    const model = createPlaylistModel(videoInfo, false);
    const playlist = await model.getRecordedVODHLSPlaylist(playlistOption);
    const durations = playlistDurations(playlist);

    assert.match(playlist, /^#EXT-X-TARGETDURATION:7$/m);
    assert.equal(durations.length, 3);
    assert.deepEqual(durations, [6.006, 6.006, 1]);
    assert.equal(
        durations.reduce((sum, duration) => sum + duration, 0),
        videoInfo.duration,
    );
});

test('encoded VOD segment rebase uses the same frame-aligned sequence position', async () => {
    const timing = getEncodedVodHlsTiming(23.976);
    const oldSession = { shouldRebase: async sequence => sequence === 2 };
    const newSession = { getSegment: async () => Buffer.from('segment') };
    const model = Object.create(StreamApiModel.prototype);
    const rebases = [];
    Object.assign(model, {
        vodHlsClients: new Map(),
        encodedVodHlsSessions: new Map(),
        getRecordedVODHLSVideoInfo: async () => ({
            duration: 20,
            filePath: 'recording.mkv',
            frameRate: 23.976,
        }),
        isEncodedVideo: async () => true,
        resolveEncodedVodHlsSubtitleOption: option => option,
        findReusableRecordedVodHlsSession: async () => oldSession,
        getEncodedVodHlsSession: async (option, _videoInfo, segmentDuration) => {
            rebases.push({ option, segmentDuration });
            return newSession;
        },
        registerRecordedVODHLSClient() {},
        log: { stream: { info() {} } },
    });

    const response = await model.createRecordedVODHLSSegmentStream(playlistOption, 2);
    let body = '';
    for await (const chunk of response.stream) body += chunk.toString('utf8');

    assert.equal(body, 'segment');
    assert.equal(rebases.length, 1);
    assert.equal(rebases[0].segmentDuration, timing.segmentDuration);
    assert.equal(rebases[0].option.playPosition, 2 * timing.segmentDuration);
});
