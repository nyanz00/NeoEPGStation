'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const test = require('node:test');
const { syncBuiltinESMExports } = require('node:module');
require('reflect-metadata');

const { default: Configuration } = require('../../dist/model/Configuration');
const { default: WatchStreamProfileUtil } = require('../../dist/model/service/stream/WatchStreamProfileUtil');

const ENCODERS = ['FFmpeg', 'QSVEncC', 'NVEncC', 'VCEEncC'];
const logger = {
    getLogger: () => ({
        system: { info() {}, warn() {}, error() {}, fatal() {} },
        stream: { warn() {} },
    }),
};

const makeConfig = (encoder, genericEncoderOnly = false) => ({
    port: 8888,
    apiServers: [],
    recorded: [{ name: 'recorded', path: './recorded' }],
    thumbnail: './thumbnail',
    channelLogo: './channel-logo',
    streamFilePath: './streamfiles',
    ffmpeg: 'C:\\Tools\\FFmpeg\\ffmpeg.EXE',
    watch: {
        ...(encoder === undefined ? {} : { encoder }),
        // Keep individual paths available so every encoder can be selected.
        ...(genericEncoderOnly
            ? {}
            : {
                  qsvEncC: 'C:\\Tools\\QSVEncC\\QSVEncC.EXE',
                  nvEncC: 'C:\\Tools\\NVEncC\\NVEncC.EXE',
                  vceEncC: 'C:\\Tools\\VCEEncC\\VCEEncC.EXE',
              }),
        // Generic path casing must be preserved exactly through normalization.
        encoderPath: 'C:\\EncoderTools\\MiXeD\\QSVEncC.ExE',
    },
});

test('normalizes watch.encoder on initial config load and fs.watchFile reload', async t => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'watch-encoder-config-'));
    const configPath = path.join(directory, 'config.yml');
    const templatePath = path.join(directory, 'missing-template.yml');
    const originalConfigPath = Configuration.CONFIG_FILE_PATH;
    const originalTemplatePath = Configuration.CONFIG_TEMPLATE_FILE_PATH;
    const reloads = [];

    Configuration.CONFIG_FILE_PATH = configPath;
    Configuration.CONFIG_TEMPLATE_FILE_PATH = templatePath;
    const watchFileMock = t.mock.method(fs, 'watchFile', (_path, callback) => reloads.push(callback));
    syncBuiltinESMExports();
    t.after(() => {
        fs.unwatchFile(configPath);
        watchFileMock.mock.restore();
        syncBuiltinESMExports();
        Configuration.CONFIG_FILE_PATH = originalConfigPath;
        Configuration.CONFIG_TEMPLATE_FILE_PATH = originalTemplatePath;
        fs.rmSync(directory, { recursive: true, force: true });
    });

    const load = async (encoder, expected, { initial = false, genericEncoderOnly = false } = {}) => {
        fs.writeFileSync(configPath, JSON.stringify(makeConfig(encoder, genericEncoderOnly)));
        let configuration;
        if (initial) {
            configuration = new Configuration(logger);
            assert.equal(reloads.length, 1);
        } else {
            assert.equal(reloads.length, 1);
            await reloads[0]();
        }
        const config = configuration?.getConfig() ?? activeConfiguration.getConfig();
        assert.equal(config.watch?.encoder, expected);
        assert.equal(config.watch?.encoderPath, 'C:\\EncoderTools\\MiXeD\\QSVEncC.ExE');
        return configuration;
    };

    let activeConfiguration = await load(' qSvEnCc ', 'QSVEncC', { initial: true });
    for (const encoder of ENCODERS) {
        const mixedCase = encoder.toLowerCase();
        await load(`  ${mixedCase}  `, encoder);
        await load(encoder, encoder);
    }

    for (const encoder of ENCODERS.slice(1)) {
        await load(` ${encoder.toLowerCase()} `, encoder, { genericEncoderOnly: true });
        assert.deepEqual(WatchStreamProfileUtil.getAvailableEncoders(activeConfiguration.getConfig()), [
            'FFmpeg',
            encoder,
        ]);
    }

    await load(undefined, undefined);
    let config = activeConfiguration.getConfig();
    assert.equal(config.watch.encoder, undefined);
    assert.deepEqual(WatchStreamProfileUtil.getAvailableEncoders(config), ['FFmpeg', 'QSVEncC', 'NVEncC', 'VCEEncC']);
    const defaultLive = WatchStreamProfileUtil.buildLiveMpegTsCommand(config, {
        type: 'm2ts',
        mode: 0,
        qualityName: '720p',
    });
    const defaultRecorded = WatchStreamProfileUtil.buildRecordedVodHlsSegmentCommand(config, {
        start: 0,
        duration: 2,
        qualityName: '720p',
    });
    assert.match(defaultLive, /C:\\Tools\\FFmpeg\\ffmpeg\.EXE/);
    assert.match(defaultRecorded, /C:\\Tools\\FFmpeg\\ffmpeg\.EXE/);

    for (const encoder of ENCODERS.slice(1)) {
        const loaded = await load(` ${encoder.toLowerCase()} `, encoder);
        if (loaded !== undefined) activeConfiguration = loaded;
        config = activeConfiguration.getConfig();
        assert.deepEqual(WatchStreamProfileUtil.getAvailableEncoders(config), ENCODERS);

        // A per-encoder path makes the requested encoder visible in each built command.
        const commandConfig = { ...config, watch: { ...config.watch } };
        delete commandConfig.watch.encoderPath;
        const commandPath = {
            QSVEncC: 'C:\\Tools\\QSVEncC\\QSVEncC.EXE',
            NVEncC: 'C:\\Tools\\NVEncC\\NVEncC.EXE',
            VCEEncC: 'C:\\Tools\\VCEEncC\\VCEEncC.EXE',
        }[encoder];

        const liveCommand = WatchStreamProfileUtil.buildLiveMpegTsCommand(commandConfig, {
            type: 'm2ts',
            mode: 0,
            qualityName: '720p',
        });
        const recordedCommand = WatchStreamProfileUtil.buildRecordedVodHlsSegmentCommand(commandConfig, {
            start: 0,
            duration: 2,
            qualityName: '720p',
        });
        assert.ok(liveCommand.startsWith(commandPath), liveCommand);
        assert.ok(recordedCommand.startsWith(commandPath), recordedCommand);
    }

    for (const unrecognized of ['qsv', ' nvencc-extra ']) {
        await load(unrecognized, unrecognized);
        assert.equal(activeConfiguration.getConfig().watch.encoder, unrecognized);
    }
});
