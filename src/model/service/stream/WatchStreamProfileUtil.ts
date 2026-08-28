import * as fs from 'fs';
import * as path from 'path';
import IConfigFile, { WatchStreamConfig, WatchStreamEncoder, WatchStreamQuality } from '../../IConfigFile';
import ProcessUtil from '../../../util/ProcessUtil';

interface LiveCommandOption {
    type: 'm2ts' | 'm2tsll';
    mode: number;
    channelType?: string;
    qualityName?: string;
    encoder?: WatchStreamEncoder;
    isHevc?: boolean;
}

interface RecordedCommandOption {
    type: 'webm' | 'mp4' | 'hls' | 'm2ts' | 'm2tsll';
    mode: number;
    qualityName?: string;
    encoder?: WatchStreamEncoder;
    isHevc?: boolean;
    isEncodedVideo: boolean;
}

interface RecordedVodHlsSegmentCommandOption {
    start: number;
    duration: number;
    qualityName?: string;
    encoder?: WatchStreamEncoder;
    isHevc?: boolean;
}

interface RecordedVodHlsContinuousCommandOption extends Omit<RecordedVodHlsSegmentCommandOption, 'duration'> {
    preroll: number;
}

interface EncodedVodHlsSegmentCommandOption extends RecordedVodHlsSegmentCommandOption {
    input: string;
    subtitleIndex?: number;
}

interface EncodedVodHlsContinuousCommandOption extends Omit<RecordedVodHlsSegmentCommandOption, 'duration'> {
    input: string;
    inputVideoCodec?: string;
    inputPixelFormat?: string;
    playlistPath: string;
    segmentDuration: number;
    segmentPath: string;
    startSequence: number;
    subtitlePath?: string;
}

interface WatchQuality extends WatchStreamQuality {
    isHevc: boolean;
    is60fps: boolean;
    videoBitrateMax: string;
}

namespace WatchStreamProfileUtil {
    const DEFAULT_LIVE_QUALITIES = ['1080p', '720p', '480p'];

    const DEFAULT_RECORDED_QUALITIES = DEFAULT_LIVE_QUALITIES;

    const DEFAULT_QUALITIES: { [quality: string]: WatchQuality } = {
        '1080p-60fps': {
            isHevc: false,
            is60fps: true,
            width: 1440,
            height: 1080,
            videoBitrate: '9500K',
            videoBitrateMax: '13000K',
            audioBitrate: '256K',
        },
        '1080p-60fps-hevc': {
            isHevc: true,
            is60fps: true,
            width: 1440,
            height: 1080,
            videoBitrate: '3500K',
            videoBitrateMax: '5200K',
            audioBitrate: '192K',
        },
        '1080p': {
            isHevc: false,
            is60fps: false,
            width: 1440,
            height: 1080,
            videoBitrate: '9500K',
            videoBitrateMax: '13000K',
            audioBitrate: '256K',
        },
        '1080p-hevc': {
            isHevc: true,
            is60fps: false,
            width: 1440,
            height: 1080,
            videoBitrate: '3000K',
            videoBitrateMax: '4500K',
            audioBitrate: '192K',
        },
        '810p': {
            isHevc: false,
            is60fps: false,
            width: 1440,
            height: 810,
            videoBitrate: '5500K',
            videoBitrateMax: '7600K',
            audioBitrate: '192K',
        },
        '810p-hevc': {
            isHevc: true,
            is60fps: false,
            width: 1440,
            height: 810,
            videoBitrate: '2500K',
            videoBitrateMax: '3700K',
            audioBitrate: '192K',
        },
        '720p': {
            isHevc: false,
            is60fps: false,
            width: 1280,
            height: 720,
            videoBitrate: '4500K',
            videoBitrateMax: '6200K',
            audioBitrate: '192K',
        },
        '720p-hevc': {
            isHevc: true,
            is60fps: false,
            width: 1280,
            height: 720,
            videoBitrate: '2000K',
            videoBitrateMax: '3000K',
            audioBitrate: '192K',
        },
        '540p': {
            isHevc: false,
            is60fps: false,
            width: 960,
            height: 540,
            videoBitrate: '3000K',
            videoBitrateMax: '4100K',
            audioBitrate: '192K',
        },
        '540p-hevc': {
            isHevc: true,
            is60fps: false,
            width: 960,
            height: 540,
            videoBitrate: '1400K',
            videoBitrateMax: '2100K',
            audioBitrate: '192K',
        },
        '480p': {
            isHevc: false,
            is60fps: false,
            width: 854,
            height: 480,
            videoBitrate: '2000K',
            videoBitrateMax: '2800K',
            audioBitrate: '192K',
        },
        '480p-hevc': {
            isHevc: true,
            is60fps: false,
            width: 854,
            height: 480,
            videoBitrate: '1050K',
            videoBitrateMax: '1750K',
            audioBitrate: '192K',
        },
        '360p': {
            isHevc: false,
            is60fps: false,
            width: 640,
            height: 360,
            videoBitrate: '1100K',
            videoBitrateMax: '1800K',
            audioBitrate: '128K',
        },
        '360p-hevc': {
            isHevc: true,
            is60fps: false,
            width: 640,
            height: 360,
            videoBitrate: '750K',
            videoBitrateMax: '1250K',
            audioBitrate: '128K',
        },
        '240p': {
            isHevc: false,
            is60fps: false,
            width: 426,
            height: 240,
            videoBitrate: '550K',
            videoBitrateMax: '650K',
            audioBitrate: '128K',
        },
        '240p-hevc': {
            isHevc: true,
            is60fps: false,
            width: 426,
            height: 240,
            videoBitrate: '450K',
            videoBitrateMax: '650K',
            audioBitrate: '128K',
        },
    };

    export const isEnabled = (config: IConfigFile): boolean => {
        return config.watch?.enabled === true;
    };

    export const getLiveQualityNames = (config: IConfigFile): string[] => {
        return getQualityNames(config.watch?.liveQualities, config.watch?.defaultLiveQuality, DEFAULT_LIVE_QUALITIES);
    };

    export const getLiveDisplayQualityNames = (config: IConfigFile): string[] => {
        return getDisplayQualityNames(getLiveQualityNames(config), config.watch?.defaultLiveQuality);
    };

    export const getRecordedQualityNames = (config: IConfigFile): string[] => {
        return getQualityNames(
            config.watch?.recordedQualities,
            config.watch?.defaultRecordedQuality,
            DEFAULT_RECORDED_QUALITIES,
        );
    };

    export const getRecordedDisplayQualityNames = (config: IConfigFile): string[] => {
        return getDisplayQualityNames(getRecordedQualityNames(config), config.watch?.defaultRecordedQuality);
    };

    export const getAvailableEncoders = (config: IConfigFile): WatchStreamEncoder[] => {
        const watch = config.watch;
        const result: WatchStreamEncoder[] = ['FFmpeg'];

        if (hasEncoderPath(watch, 'QSVEncC')) {
            result.push('QSVEncC');
        }
        if (hasEncoderPath(watch, 'NVEncC')) {
            result.push('NVEncC');
        }
        if (hasEncoderPath(watch, 'VCEEncC')) {
            result.push('VCEEncC');
        }

        return result;
    };

    export const buildLiveMpegTsCommand = (config: IConfigFile, option: LiveCommandOption): string => {
        const qualityName = option.qualityName ?? getLiveDisplayQualityNames(config)[option.mode];
        if (typeof qualityName === 'undefined') {
            throw new Error('ConfigIsUndefined');
        }

        const quality = getQualityForRequest(config.watch, qualityName, option.isHevc);
        const encoder = getEncoder(config, option.encoder);
        if (encoder === 'FFmpeg') {
            return buildFFmpegLiveCommand(config.ffmpeg, quality, option.type === 'm2tsll');
        }

        return buildHWEncCLiveCommand(
            getEncoderPath(config.watch, encoder),
            encoder,
            quality,
            config.watch,
            option.channelType,
        );
    };

    export const buildTsreadexLiveCommand = (config: IConfigFile, serviceId: number): ProcessUtil.Cmds | undefined => {
        const tsreadex = getTsreadexPath(config);
        if (tsreadex === undefined) {
            return undefined;
        }

        return {
            bin: tsreadex,
            args: [
                '-x',
                '18/38/39',
                '-n',
                serviceId.toString(10),
                '-a',
                '13',
                '-b',
                '5',
                '-c',
                '5',
                '-u',
                '1',
                '-d',
                '9',
                '-',
            ],
        };
    };

    export const buildRecordedCommand = (config: IConfigFile, option: RecordedCommandOption): string => {
        const qualityName = option.qualityName ?? getRecordedDisplayQualityNames(config)[option.mode];
        if (typeof qualityName === 'undefined') {
            throw new Error('ConfigIsUndefined');
        }

        const quality = getQualityForRequest(config.watch, qualityName, option.isHevc);
        const encoder = getEncoder(config, option.encoder);
        if ((option.type === 'mp4' || option.type === 'm2ts' || option.type === 'm2tsll') && encoder !== 'FFmpeg') {
            return buildHWEncCRecordedMp4Command(
                getEncoderPath(config.watch, encoder),
                encoder,
                quality,
                config.watch,
                option.isEncodedVideo,
                option.type === 'mp4' ? 'mp4' : 'mpegts',
            );
        }

        return buildFFmpegRecordedCommand(config.ffmpeg, option.type, quality, option.isEncodedVideo, encoder);
    };

    export const buildRecordedVodHlsSegmentCommand = (
        config: IConfigFile,
        option: RecordedVodHlsSegmentCommandOption,
    ): string => {
        const qualityName = option.qualityName ?? getRecordedDisplayQualityNames(config)[0];
        if (typeof qualityName === 'undefined') {
            throw new Error('ConfigIsUndefined');
        }

        const quality = getQualityForRequest(config.watch, qualityName, option.isHevc);
        const encoder = getEncoder(config, option.encoder);
        if (encoder !== 'FFmpeg') {
            return buildHWEncCRecordedVodHlsSegmentCommand(
                getEncoderPath(config.watch, encoder),
                encoder,
                quality,
                config.watch,
                option,
            );
        }

        const videoCodec = getFFmpegVideoCodec(encoder, quality);
        const videoFilter = `yadif=mode=0:parity=-1:deint=1,scale=${quality.width}:${quality.height}`;
        const videoOptions = [
            `-c:v ${videoCodec}`,
            `-vf ${videoFilter}`,
            `-b:v ${quality.videoBitrate}`,
            `-maxrate ${quality.videoBitrateMax}`,
            ...getFFmpegVideoCodecOptions(encoder, quality, 'hls'),
        ].join(' ');

        return [
            config.ffmpeg,
            '-dual_mono_mode main',
            '-f mpegts -analyzeduration 500000 -i pipe:0',
            `-t ${Math.max(0.001, option.duration).toFixed(3)}`,
            '-map 0:v:0 -map 0:a:0? -map 0:a:1? -map 0:d? -ignore_unknown',
            '-fflags nobuffer -flags low_delay -max_delay 0 -tune zerolatency -threads 0 -max_muxing_queue_size 1024',
            `-c:a aac -ar 48000 -b:a ${quality.audioBitrate} -ac 2`,
            '-c:d copy',
            videoOptions,
            `-output_ts_offset ${Math.max(0, option.start).toFixed(3)}`,
            '-muxdelay 0 -muxpreload 0 -y -f mpegts pipe:1',
        ].join(' ');
    };

    export const buildRecordedVodHlsContinuousCommand = (
        config: IConfigFile,
        option: RecordedVodHlsContinuousCommandOption,
    ): string => {
        const qualityName = option.qualityName ?? getRecordedDisplayQualityNames(config)[0];
        if (typeof qualityName === 'undefined') {
            throw new Error('ConfigIsUndefined');
        }

        const quality = getQualityForRequest(config.watch, qualityName, option.isHevc);
        const encoder = getEncoder(config, option.encoder);
        if (encoder !== 'FFmpeg') {
            return buildHWEncCRecordedVodHlsContinuousCommand(
                getEncoderPath(config.watch, encoder),
                encoder,
                quality,
                config.watch,
                option,
            );
        }

        const videoCodec = getFFmpegVideoCodec(encoder, quality);
        const videoFilter = `yadif=mode=0:parity=-1:deint=1,scale=${quality.width}:${quality.height}`;
        const videoOptions = [
            `-c:v ${videoCodec}`,
            `-vf ${videoFilter}`,
            `-b:v ${quality.videoBitrate}`,
            `-maxrate ${quality.videoBitrateMax}`,
            ...getFFmpegVideoCodecOptions(encoder, quality, 'hls'),
        ].join(' ');

        return [
            config.ffmpeg,
            '-dual_mono_mode main',
            '-f mpegts -analyzeduration 10000000 -probesize 32000000 -i pipe:0',
            option.preroll > 0 ? `-ss ${option.preroll.toFixed(3)}` : '',
            '-map 0:v:0 -map 0:a:0? -map 0:a:1? -map 0:d? -ignore_unknown',
            '-fflags nobuffer -flags low_delay -max_delay 0 -tune zerolatency -threads 0 -max_muxing_queue_size 1024',
            `-c:a aac -ar 48000 -b:a ${quality.audioBitrate} -ac 2`,
            '-c:d copy',
            videoOptions,
            `-output_ts_offset ${Math.max(0, option.start).toFixed(3)}`,
            '-muxdelay 0 -muxpreload 0 -y -f mpegts pipe:1',
        ].join(' ');
    };

    export const buildEncodedVodHlsSegmentCommand = (
        config: IConfigFile,
        option: EncodedVodHlsSegmentCommandOption,
    ): string => {
        const qualityName = option.qualityName ?? getRecordedDisplayQualityNames(config)[0];
        if (typeof qualityName === 'undefined') {
            throw new Error('ConfigIsUndefined');
        }

        const quality = getQualityForRequest(config.watch, qualityName, option.isHevc);
        const encoder = getEncoder(config, option.encoder);
        const videoCodec = getFFmpegVideoCodec(encoder, quality);
        const escapedInput = option.input.replace(/"/g, '\\"');
        const videoFilter = buildEncodedVideoFilter(option.input, quality, option.subtitleIndex, option.start);
        const videoOptions = [
            `-c:v ${videoCodec}`,
            `-vf ${videoFilter}`,
            `-b:v ${quality.videoBitrate}`,
            `-maxrate ${quality.videoBitrateMax}`,
            ...getFFmpegVideoCodecOptions(encoder, quality, 'hls'),
        ].join(' ');

        return [
            config.ffmpeg,
            '-dual_mono_mode main',
            `-ss ${Math.max(0, option.start).toFixed(3)}`,
            `-i "${escapedInput}"`,
            `-t ${Math.max(0.001, option.duration).toFixed(3)}`,
            '-map 0:v:0 -map 0:a:0? -ignore_unknown',
            typeof option.subtitleIndex === 'undefined'
                ? '-sn -fflags +genpts -threads 0 -max_muxing_queue_size 1024'
                : '-fflags +genpts -threads 0 -max_muxing_queue_size 1024',
            `-c:a aac -ar 48000 -b:a ${quality.audioBitrate} -ac 2`,
            videoOptions,
            `-output_ts_offset ${Math.max(0, option.start).toFixed(3)}`,
            '-muxdelay 0 -muxpreload 0 -y -f mpegts pipe:1',
        ].join(' ');
    };

    export const buildEncodedVodHlsContinuousCommand = (
        config: IConfigFile,
        option: EncodedVodHlsContinuousCommandOption,
    ): ProcessUtil.Cmds => {
        const qualityName = option.qualityName ?? getRecordedDisplayQualityNames(config)[0];
        if (typeof qualityName === 'undefined') {
            throw new Error('ConfigIsUndefined');
        }

        const quality = getQualityForRequest(config.watch, qualityName, option.isHevc);
        const encoder = getEncoder(config, option.encoder);
        const videoCodec = getFFmpegVideoCodec(encoder, quality);
        const hardwareDecode = getHardwareDecodeConfig(encoder, option.inputVideoCodec, option.inputPixelFormat);
        const videoFilter = buildEncodedVideoFilter(
            option.subtitlePath,
            quality,
            undefined,
            option.start,
            hardwareDecode?.filterType,
        );
        const args = [
            '-hide_banner',
            '-loglevel',
            'warning',
            ...(hardwareDecode?.globalOptions ?? []),
            '-dual_mono_mode',
            'main',
            '-fflags',
            '+genpts',
            '-ss',
            Math.max(0, option.start).toFixed(3),
            ...(hardwareDecode?.inputOptions ?? []),
            '-i',
            option.input,
            '-map',
            '0:v:0',
            '-map',
            '0:a:0?',
            '-ignore_unknown',
            '-sn',
            '-threads',
            '0',
            '-max_muxing_queue_size',
            '1024',
            '-c:a',
            'aac',
            '-ar',
            '48000',
            '-b:a',
            quality.audioBitrate,
            '-ac',
            '2',
            '-c:v',
            videoCodec,
            '-vf',
            videoFilter,
            '-b:v',
            quality.videoBitrate,
            '-maxrate',
            quality.videoBitrateMax,
            ...flatCommandOptions(getFFmpegVideoCodecOptions(encoder, quality, 'hls')),
            '-force_key_frames',
            `expr:gte(t,n_forced*${option.segmentDuration.toFixed(6)})`,
            '-muxdelay',
            '0',
            '-muxpreload',
            '0',
            '-f',
            'hls',
            '-hls_time',
            option.segmentDuration.toFixed(6),
            '-hls_list_size',
            '0',
            '-hls_playlist_type',
            'vod',
            '-hls_segment_type',
            'mpegts',
            '-hls_flags',
            'independent_segments',
            '-start_number',
            option.startSequence.toString(10),
            '-output_ts_offset',
            Math.max(0, option.start).toFixed(3),
            '-hls_segment_filename',
            option.segmentPath,
            '-y',
            option.playlistPath,
        ];

        return {
            bin: config.ffmpeg,
            args: args,
        };
    };

    const getTsreadexPath = (config: IConfigFile): string | undefined => {
        if (config.watch?.tsreadex !== undefined) {
            return config.watch.tsreadex;
        }

        const extension = process.platform === 'win32' ? '.exe' : '.elf';
        const bundledPath = path.join(ProcessUtil.ROOT_PATH, 'thirdparty', 'tsreadex', `tsreadex${extension}`);
        if (fs.existsSync(bundledPath)) {
            return bundledPath;
        }

        return undefined;
    };

    const flatCommandOptions = (options: string[]): string[] => {
        return options.reduce<string[]>((result, option) => {
            result.push(...option.split(/\s+/).filter(item => item.length > 0));

            return result;
        }, []);
    };

    const buildEncodedVideoFilter = (
        subtitleSource: string | undefined,
        quality: WatchQuality,
        subtitleIndex?: number,
        subtitleTimeOffset = 0,
        hardwareFilter?: HardwareFilterType,
    ): string => {
        const filters: string[] = [];
        const hardwareScale =
            hardwareFilter === 'qsv'
                ? `scale_qsv=w=${quality.width}:h=${quality.height}:format=nv12`
                : hardwareFilter === 'cuda'
                  ? `scale_cuda=w=${quality.width}:h=${quality.height}:format=nv12`
                  : undefined;
        if (typeof subtitleSource !== 'undefined' && typeof hardwareScale !== 'undefined') {
            // Resize and convert on the GPU first. libass still needs a software
            // frame, but downloading the final-size NV12 frame is substantially
            // cheaper than copying the source frame and scaling it on the CPU.
            filters.push(hardwareScale, 'hwdownload', 'format=nv12');
        }
        if (typeof subtitleSource !== 'undefined') {
            const offset = Math.max(0, subtitleTimeOffset);
            if (offset > 0) {
                // Input seeking resets video PTS to zero. Temporarily restore the original
                // program timeline while libass selects events, then return to zero-based PTS.
                filters.push(`setpts=PTS+${offset.toFixed(3)}/TB`);
            }
            if (typeof subtitleIndex === 'undefined') {
                filters.push(`ass=${escapeFFmpegFilterPath(subtitleSource)}`);
            } else {
                const subtitleOption = [`filename='${escapeFFmpegFilterPath(subtitleSource)}'`];
                subtitleOption.push(`si=${subtitleIndex.toString(10)}`);
                filters.push(`subtitles=${subtitleOption.join(':')}`);
            }
            if (offset > 0) {
                filters.push(`setpts=PTS-${offset.toFixed(3)}/TB`);
            }
        }
        if (typeof subtitleSource === 'undefined' && typeof hardwareScale !== 'undefined') {
            filters.push(hardwareScale);
        } else if (typeof hardwareScale === 'undefined') {
            filters.push(`scale=${quality.width}:${quality.height}`);
        }

        return filters.join(',');
    };

    type HardwareFilterType = 'qsv' | 'cuda';

    interface HardwareDecodeConfig {
        filterType: HardwareFilterType;
        globalOptions: string[];
        inputOptions: string[];
    }

    const getHardwareDecodeConfig = (
        encoder: WatchStreamEncoder,
        codecName: string | undefined,
        pixelFormat: string | undefined,
    ): HardwareDecodeConfig | undefined => {
        if (
            (encoder !== 'QSVEncC' && encoder !== 'NVEncC') ||
            typeof codecName === 'undefined' ||
            typeof pixelFormat === 'undefined'
        ) {
            return undefined;
        }

        const supportedCodecs =
            encoder === 'QSVEncC'
                ? new Set(['av1', 'h264', 'hevc', 'mjpeg', 'mpeg2video', 'vp9'])
                : new Set(['av1', 'h264', 'hevc', 'mjpeg', 'mpeg1video', 'mpeg2video', 'mpeg4', 'vc1', 'vp8', 'vp9']);
        if (supportedCodecs.has(codecName.toLowerCase()) === false) {
            return undefined;
        }

        const normalizedPixelFormat = pixelFormat.toLowerCase();
        const is8Bit420 = normalizedPixelFormat === 'nv12' || normalizedPixelFormat === 'yuv420p';
        const is10Bit420 = normalizedPixelFormat === 'p010le' || normalizedPixelFormat === 'yuv420p10le';
        if (is8Bit420 === false && is10Bit420 === false) {
            return undefined;
        }

        const filterType: HardwareFilterType = encoder === 'QSVEncC' ? 'qsv' : 'cuda';
        const deviceName = filterType;
        return {
            filterType,
            globalOptions: ['-init_hw_device', `${filterType}=${deviceName}`, '-filter_hw_device', deviceName],
            inputOptions: ['-hwaccel', filterType, '-hwaccel_device', deviceName, '-hwaccel_output_format', filterType],
        };
    };

    const escapeFFmpegFilterPath = (value: string): string => {
        return value
            .replace(/\\/g, '\\\\')
            .replace(/:/g, '\\:')
            .replace(/'/g, "\\'")
            .replace(/,/g, '\\,')
            .replace(/\[/g, '\\[')
            .replace(/\]/g, '\\]');
    };

    const getQualityNames = (
        configured: string[] | undefined,
        preferred: string | undefined,
        fallback: string[],
    ): string[] => {
        const isConfigured = configured !== undefined && configured.length > 0;
        const base = isConfigured ? configured : fallback;
        const result = base.filter((item, index) => base.indexOf(item) === index);
        if (isConfigured === true && preferred !== undefined && result.includes(preferred)) {
            return [preferred, ...result.filter(q => q !== preferred)];
        }

        return result;
    };

    const getDisplayQualityNames = (qualities: string[], preferred: string | undefined): string[] => {
        const result = qualities
            .map(q => stripHevcSuffix(q))
            .filter((item, index, base) => base.indexOf(item) === index);
        const preferredBase = preferred === undefined ? undefined : stripHevcSuffix(preferred);
        if (preferredBase !== undefined && result.includes(preferredBase)) {
            return [preferredBase, ...result.filter(q => q !== preferredBase)];
        }

        return result;
    };

    const stripHevcSuffix = (qualityName: string): string => {
        return qualityName.endsWith('-hevc') ? qualityName.substring(0, qualityName.length - 5) : qualityName;
    };

    const getQualityForRequest = (
        watch: WatchStreamConfig | undefined,
        qualityName: string,
        isHevc: boolean | undefined,
    ): WatchQuality => {
        const baseName = stripHevcSuffix(qualityName);
        const resolvedName = isHevc === true ? `${baseName}-hevc` : baseName;
        const custom = watch?.qualities?.[resolvedName] ?? (isHevc === true ? watch?.qualities?.[baseName] : undefined);
        const base =
            custom ?? DEFAULT_QUALITIES[resolvedName] ?? (isHevc === true ? DEFAULT_QUALITIES[baseName] : undefined);
        if (typeof base === 'undefined') {
            throw new Error('WatchQualityIsUndefined');
        }

        return {
            ...base,
            isHevc: isHevc === true ? true : base.isHevc === true,
            is60fps: base.is60fps === true,
            videoBitrateMax: base.videoBitrateMax ?? base.videoBitrate,
        };
    };

    const getEncoder = (config: IConfigFile, requested: WatchStreamEncoder | undefined): WatchStreamEncoder => {
        if (typeof requested !== 'undefined') {
            if (getAvailableEncoders(config).includes(requested) === false) {
                throw new Error('WatchEncoderIsUnavailable');
            }

            return requested;
        }

        return config.watch?.encoder ?? 'FFmpeg';
    };

    const getEncoderPath = (
        watch: WatchStreamConfig | undefined,
        encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>,
    ): string => {
        const path =
            watch?.encoderPath ??
            (encoder === 'QSVEncC' ? watch?.qsvEncC : encoder === 'NVEncC' ? getNVEncCPath(watch) : watch?.vceEncC);
        if (typeof path === 'undefined') {
            throw new Error('WatchEncoderPathIsUndefined');
        }

        return path;
    };

    const hasEncoderPath = (
        watch: WatchStreamConfig | undefined,
        encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>,
    ): boolean => {
        const encoderPath =
            encoder === 'QSVEncC' ? watch?.qsvEncC : encoder === 'NVEncC' ? getNVEncCPath(watch) : watch?.vceEncC;

        return (
            typeof encoderPath !== 'undefined' ||
            (watch?.encoder === encoder && typeof watch?.encoderPath !== 'undefined')
        );
    };

    const getNVEncCPath = (watch: WatchStreamConfig | undefined): string | undefined => {
        return watch?.nvEncC ?? watch?.nvencc;
    };

    const buildFFmpegLiveCommand = (ffmpeg: string, quality: WatchQuality, isLowLatency: boolean): string => {
        const videoCodec = quality.isHevc === true ? 'libx265' : 'libx264';
        const frameFilter =
            quality.is60fps === true ? 'yadif=mode=1:parity=-1:deint=1' : 'yadif=mode=0:parity=-1:deint=1';
        const latencyOptions = isLowLatency
            ? '-fflags nobuffer -flags low_delay -max_delay 250000 -max_interleave_delta 1'
            : '-fflags +genpts';

        return [
            ffmpeg,
            '-f mpegts -analyzeduration 500000 -i pipe:0',
            '-map 0:v:0 -map 0:a:0? -map 0:a:1? -map 0:s? -map 0:d? -c:s copy -c:d copy -ignore_unknown',
            latencyOptions,
            '-threads 0',
            `-c:a aac -ar 48000 -b:a ${quality.audioBitrate} -ac 2`,
            `-c:v ${videoCodec} -flags +cgop -vf ${frameFilter},scale=${quality.width}:${quality.height}`,
            `-b:v ${quality.videoBitrate} -maxrate ${quality.videoBitrateMax}`,
            '-preset veryfast -y -f mpegts pipe:1',
        ].join(' ');
    };

    const buildHWEncCLiveCommand = (
        encoderPath: string,
        encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>,
        quality: WatchQuality,
        watch: WatchStreamConfig | undefined,
        channelType: string | undefined,
    ): string => {
        const isBS4K = channelType === 'BS4K';
        const options: string[] = [
            '--input-format mpegts --input-probesize 1000K --input-analyze 0.7',
            isBS4K ? '' : '--fps 30000/1001',
            '--input -',
            encoder === 'VCEEncC' ? '--avsw' : '--avhw',
            '--audio-stream 1?:stereo --audio-stream 2?:stereo --data-copy timed_id3',
            '-m avioflags:direct -m fflags:nobuffer+flush_packets -m flush_packets:1 -m max_delay:250000',
            '-m max_interleave_delta:500K --output-thread 0 --lowlatency',
            encoder === 'QSVEncC' && watch?.fps24 !== true ? '--disable-opencl' : '',
            encoder === 'NVEncC' ? '--disable-nvml 1 --disable-dx11 --disable-vulkan' : '',
            '--log-level debug',
            quality.isHevc === true ? '--codec hevc' : '--codec h264',
            quality.isHevc === true && encoder === 'QSVEncC'
                ? `--qvbr ${quality.videoBitrate} --fallback-rc`
                : `--vbr ${quality.videoBitrate}`,
            `--max-bitrate ${quality.videoBitrateMax}`,
            ...buildHWEncCQualityOptions(encoder, quality),
            encoder === 'VCEEncC' ? '' : '--repeat-headers',
            ...buildHWEncCHlsGopOptions(encoder),
            getHWEncCPresetOption(encoder),
            quality.isHevc === true ? '--profile main' : '--profile high',
            '--dar 16:9',
            encoder === 'NVEncC' ? '--vpp-deband' : '',
            quality.isHevc === true && watch?.hevc10bit === true && (encoder === 'QSVEncC' || encoder === 'NVEncC')
                ? '--output-depth 10 --fallback-bitdepth'
                : '',
            ...buildHWEncCInterlaceOptions(encoder, quality, watch, isBS4K),
            `--output-res ${quality.width}x${quality.height}`,
            `--audio-codec aac:aac_coder=twoloop --audio-bitrate ${quality.audioBitrate}`,
            '--audio-samplerate 48000 --audio-filter volume=2.0 --audio-ignore-decode-error 30',
            '--output-format mpegts',
            '--output -',
        ].filter(option => option.length > 0);

        return [encoderPath, ...options].join(' ');
    };

    const buildFFmpegRecordedCommand = (
        ffmpeg: string,
        type: 'webm' | 'mp4' | 'hls' | 'm2ts' | 'm2tsll',
        quality: WatchQuality,
        isEncodedVideo: boolean,
        encoder: WatchStreamEncoder,
    ): string => {
        const input = isEncodedVideo === true ? '-ss %SS% -i %INPUT%' : '-f mpegts -analyzeduration 500000 -i pipe:0';
        const deinterlace = isEncodedVideo === true ? '' : 'yadif=mode=0:parity=-1:deint=1,';
        const videoFilter = `${deinterlace}scale=${quality.width}:${quality.height}`;

        if (type === 'webm') {
            return [
                ffmpeg,
                '-dual_mono_mode main',
                input,
                '-sn -threads 0',
                `-c:a libopus -ar 48000 -b:a ${quality.audioBitrate} -ac 2`,
                `-c:v libvpx-vp9 -vf ${videoFilter} -b:v ${quality.videoBitrate}`,
                '-deadline realtime -cpu-used 4 -f webm pipe:1',
            ].join(' ');
        }

        const videoCodec = getFFmpegVideoCodec(encoder, quality);
        const videoOptions = [
            `-c:v ${videoCodec}`,
            `-vf ${videoFilter}`,
            `-b:v ${quality.videoBitrate}`,
            `-maxrate ${quality.videoBitrateMax}`,
            ...getFFmpegVideoCodecOptions(encoder, quality, type),
        ].join(' ');

        if (type === 'hls') {
            return [
                ffmpeg,
                '-dual_mono_mode main',
                input,
                '-sn -map 0 -threads 0 -ignore_unknown -max_muxing_queue_size 1024',
                `-c:a aac -ar 48000 -b:a ${quality.audioBitrate} -ac 2`,
                videoOptions,
                '-f hls -hls_time 3 -hls_list_size 0 -hls_allow_cache 1',
                '-hls_segment_filename %streamFileDir%/stream%streamNum%-%09d.ts',
                '-hls_flags delete_segments -flags +loop-global_header %OUTPUT%',
            ].join(' ');
        }

        if (type === 'm2ts' || type === 'm2tsll') {
            return [
                ffmpeg,
                '-dual_mono_mode main',
                input,
                '-sn -threads 0',
                `-c:a aac -ar 48000 -b:a ${quality.audioBitrate} -ac 2`,
                videoOptions,
                '-y -f mpegts pipe:1',
            ].join(' ');
        }

        return [
            ffmpeg,
            '-dual_mono_mode main',
            input,
            '-sn -threads 0',
            `-c:a aac -ar 48000 -b:a ${quality.audioBitrate} -ac 2`,
            videoOptions,
            '-movflags frag_keyframe+empty_moov+faststart+default_base_moof -y -f mp4 pipe:1',
        ].join(' ');
    };

    const getFFmpegVideoCodec = (encoder: WatchStreamEncoder, quality: WatchQuality): string => {
        if (encoder === 'QSVEncC') {
            return quality.isHevc === true ? 'hevc_qsv' : 'h264_qsv';
        }
        if (encoder === 'NVEncC') {
            return quality.isHevc === true ? 'hevc_nvenc' : 'h264_nvenc';
        }
        if (encoder === 'VCEEncC') {
            return quality.isHevc === true ? 'hevc_amf' : 'h264_amf';
        }

        return quality.isHevc === true ? 'libx265' : 'libx264';
    };

    const getFFmpegVideoCodecOptions = (
        encoder: WatchStreamEncoder,
        quality: WatchQuality,
        type: 'webm' | 'mp4' | 'hls' | 'm2ts' | 'm2tsll',
    ): string[] => {
        if (encoder === 'QSVEncC') {
            return ['-preset veryfast', quality.isHevc === true ? '-profile:v main' : '-profile:v high'];
        }
        if (encoder === 'NVEncC') {
            return ['-preset p4', quality.isHevc === true ? '-profile:v main' : '-profile:v high'];
        }
        if (encoder === 'VCEEncC') {
            return ['-quality balanced', quality.isHevc === true ? '-profile:v main' : '-profile:v high'];
        }
        if (quality.isHevc === true) {
            return ['-preset veryfast', '-profile:v main'];
        }

        return type === 'mp4'
            ? ['-profile:v baseline', '-preset veryfast', '-tune fastdecode,zerolatency']
            : ['-profile:v high', '-preset veryfast', '-tune fastdecode,zerolatency'];
    };

    const buildHWEncCRecordedMp4Command = (
        encoderPath: string,
        encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>,
        quality: WatchQuality,
        watch: WatchStreamConfig | undefined,
        isEncodedVideo: boolean,
        outputFormat: 'mp4' | 'mpegts' = 'mp4',
    ): string => {
        const inputOptions =
            isEncodedVideo === true
                ? ['--input %INPUT%', '--seek %SS%']
                : ['--input-format mpegts --input-probesize 1000K --input-analyze 0.7', '--input -'];
        const options: string[] = [
            ...inputOptions,
            encoder === 'VCEEncC' ? '--avsw' : '--avhw',
            '--audio-stream 1?:stereo --audio-stream 2?:stereo',
            isEncodedVideo === false && outputFormat === 'mpegts' ? '--data-copy timed_id3' : '',
            encoder === 'QSVEncC' && watch?.fps24 !== true ? '--disable-opencl' : '',
            encoder === 'NVEncC' ? '--disable-nvml 1 --disable-dx11 --disable-vulkan' : '',
            quality.isHevc === true ? '--codec hevc' : '--codec h264',
            quality.isHevc === true && encoder === 'QSVEncC'
                ? `--qvbr ${quality.videoBitrate} --fallback-rc`
                : `--vbr ${quality.videoBitrate}`,
            `--max-bitrate ${quality.videoBitrateMax}`,
            ...buildHWEncCQualityOptions(encoder, quality),
            encoder === 'VCEEncC' ? '' : '--repeat-headers',
            ...buildHWEncCHlsGopOptions(encoder),
            getHWEncCPresetOption(encoder),
            quality.isHevc === true ? '--profile main' : '--profile high',
            '--dar 16:9',
            encoder === 'NVEncC' ? '--vpp-deband' : '',
            quality.isHevc === true && watch?.hevc10bit === true && (encoder === 'QSVEncC' || encoder === 'NVEncC')
                ? '--output-depth 10 --fallback-bitdepth'
                : '',
            isEncodedVideo === true ? '' : '--interlace tff',
            isEncodedVideo === true
                ? ''
                : quality.is60fps === true
                  ? encoder === 'QSVEncC'
                      ? '--vpp-deinterlace bob'
                      : '--vpp-yadif mode=bob'
                  : encoder === 'QSVEncC'
                    ? '--vpp-deinterlace normal'
                    : '--vpp-afs preset=default',
            `--output-res ${quality.width}x${quality.height}`,
            `--audio-codec aac:aac_coder=twoloop --audio-bitrate ${quality.audioBitrate}`,
            '--audio-samplerate 48000 --audio-filter volume=2.0 --audio-ignore-decode-error 30',
            `--output-format ${outputFormat}`,
            '--output -',
        ].filter(option => option.length > 0);

        return [encoderPath, ...options].join(' ');
    };

    const buildHWEncCRecordedVodHlsSegmentCommand = (
        encoderPath: string,
        encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>,
        quality: WatchQuality,
        watch: WatchStreamConfig | undefined,
        option: RecordedVodHlsSegmentCommandOption,
    ): string => {
        const outputFps = quality.is60fps === true ? 60000 / 1001 : 30000 / 1001;
        const trimFrames = Math.max(1, Math.round(option.duration * outputFps));
        const options: string[] = [
            '--input-format mpegts --input-probesize 1000K --input-analyze 0.7',
            '--input -',
            encoder === 'VCEEncC' ? '--avsw' : '--avhw',
            '--audio-stream 1?:stereo --audio-stream 2?:stereo --data-copy timed_id3',
            '-m avioflags:direct -m fflags:nobuffer+flush_packets -m flush_packets:1 -m max_delay:0',
            '-m max_interleave_delta:5000K',
            encoder === 'QSVEncC' && watch?.fps24 !== true ? '--disable-opencl' : '',
            encoder === 'NVEncC' ? '--disable-nvml 1 --disable-dx11 --disable-vulkan' : '',
            quality.isHevc === true ? '--codec hevc' : '--codec h264',
            quality.isHevc === true && encoder === 'QSVEncC'
                ? `--qvbr ${quality.videoBitrate} --fallback-rc`
                : `--vbr ${quality.videoBitrate}`,
            `--max-bitrate ${quality.videoBitrateMax}`,
            ...buildHWEncCQualityOptions(encoder, quality),
            encoder === 'VCEEncC' ? '' : '--repeat-headers',
            getHWEncCPresetOption(encoder),
            quality.isHevc === true ? '--profile main' : '--profile high',
            '--dar 16:9',
            encoder === 'NVEncC' ? '--vpp-deband' : '',
            quality.isHevc === true && watch?.hevc10bit === true && (encoder === 'QSVEncC' || encoder === 'NVEncC')
                ? '--output-depth 10 --fallback-bitdepth'
                : '',
            ...buildHWEncCInterlaceOptions(encoder, quality, watch, false),
            `--output-res ${quality.width}x${quality.height}`,
            `--audio-codec aac:aac_coder=twoloop --audio-bitrate ${quality.audioBitrate}`,
            '--audio-samplerate 48000 --audio-filter volume=2.0 --audio-ignore-decode-error 30',
            `-m output_ts_offset:${Math.max(0, option.start).toFixed(3)}`,
            '--offset-video-dts-advance',
            `--trim 0:${trimFrames.toString(10)}`,
            '--output-format mpegts',
            '--output -',
        ].filter(item => item.length > 0);

        return [encoderPath, ...options].join(' ');
    };

    const buildHWEncCRecordedVodHlsContinuousCommand = (
        encoderPath: string,
        encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>,
        quality: WatchQuality,
        watch: WatchStreamConfig | undefined,
        option: RecordedVodHlsContinuousCommandOption,
    ): string => {
        const trimStartFrames = Math.max(0, Math.round(option.preroll * (30000 / 1001)));
        const options: string[] = [
            '--input-format mpegts --input-probesize 32000K --input-analyze 10',
            '--input -',
            encoder === 'VCEEncC' ? '--avsw' : '--avhw',
            '--audio-stream 1?:stereo --audio-stream 2?:stereo --data-copy timed_id3',
            '-m avioflags:direct -m fflags:nobuffer+flush_packets -m flush_packets:1 -m max_delay:0',
            '-m max_interleave_delta:5000K',
            encoder === 'QSVEncC' && watch?.fps24 !== true ? '--disable-opencl' : '',
            encoder === 'NVEncC' ? '--disable-nvml 1 --disable-dx11 --disable-vulkan' : '',
            quality.isHevc === true ? '--codec hevc' : '--codec h264',
            quality.isHevc === true && encoder === 'QSVEncC'
                ? `--qvbr ${quality.videoBitrate} --fallback-rc`
                : `--vbr ${quality.videoBitrate}`,
            `--max-bitrate ${quality.videoBitrateMax}`,
            ...buildHWEncCQualityOptions(encoder, quality),
            encoder === 'VCEEncC' ? '' : '--repeat-headers',
            getHWEncCPresetOption(encoder),
            quality.isHevc === true ? '--profile main' : '--profile high',
            '--dar 16:9',
            encoder === 'NVEncC' ? '--vpp-deband' : '',
            quality.isHevc === true && watch?.hevc10bit === true && (encoder === 'QSVEncC' || encoder === 'NVEncC')
                ? '--output-depth 10 --fallback-bitdepth'
                : '',
            ...buildHWEncCInterlaceOptions(encoder, quality, watch, false),
            `--output-res ${quality.width}x${quality.height}`,
            `--audio-codec aac:aac_coder=twoloop --audio-bitrate ${quality.audioBitrate}`,
            '--audio-samplerate 48000 --audio-filter volume=2.0 --audio-ignore-decode-error 30',
            `-m output_ts_offset:${Math.max(0, option.start).toFixed(3)}`,
            '--offset-video-dts-advance',
            trimStartFrames > 0 ? `--trim ${trimStartFrames.toString(10)}:0` : '',
            '--output-format mpegts',
            '--output -',
        ].filter(item => item.length > 0);

        return [encoderPath, ...options].join(' ');
    };

    const buildHWEncCQualityOptions = (
        encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>,
        quality: WatchQuality,
    ): string[] => {
        if (quality.isHevc !== true) {
            return [];
        }

        if (encoder === 'QSVEncC') {
            return [
                '--qvbr-quality 20 --extbrc --mbbrc --scenario-info game_streaming --tune perceptual',
                '--i-adapt --b-adapt --b-pyramid --weightp --weightb --adapt-ref --adapt-ltr --adapt-cqm',
            ];
        }

        if (encoder === 'NVEncC') {
            return ['--qp-min 23:26:30 --lookahead 16 --multipass 2pass-full --bref-mode middle --aq --aq-temporal'];
        }

        return [];
    };

    const getHWEncCPresetOption = (encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>): string => {
        if (encoder === 'QSVEncC') {
            return '--quality balanced';
        }
        if (encoder === 'NVEncC') {
            return '--preset default';
        }

        return '--preset balanced';
    };

    const buildHWEncCHlsGopOptions = (encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>): string[] => {
        if (encoder === 'QSVEncC') {
            return ['--strict-gop'];
        }
        if (encoder === 'NVEncC') {
            return ['--no-i-adapt'];
        }

        return [];
    };

    const buildHWEncCInterlaceOptions = (
        encoder: Exclude<WatchStreamEncoder, 'FFmpeg'>,
        quality: WatchQuality,
        watch: WatchStreamConfig | undefined,
        isBS4K: boolean,
    ): string[] => {
        const gopLength = quality.isHevc === true ? 2 : 0.5;
        if (isBS4K) {
            return [`--avsync vfr --gop-len ${Math.floor(gopLength * 60)}`];
        }

        const options = ['--interlace tff'];
        if (quality.is60fps === true) {
            options.push(encoder === 'QSVEncC' ? '--vpp-deinterlace bob' : '--vpp-yadif mode=bob');
            options.push(`--avsync vfr --gop-len ${Math.floor(gopLength * 60)}`);
            return options;
        }

        if (watch?.fps24 === true) {
            options.push('--vpp-afs preset=default,drop=on,smooth=on');
        } else {
            options.push(encoder === 'QSVEncC' ? '--vpp-deinterlace normal' : '--vpp-afs preset=default');
        }
        options.push(`--avsync vfr --gop-len ${Math.floor(gopLength * 30)}`);
        return options;
    };
}

export default WatchStreamProfileUtil;
