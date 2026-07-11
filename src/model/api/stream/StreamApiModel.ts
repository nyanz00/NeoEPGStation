import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import { Readable } from 'stream';
import * as apid from '../../../../api';
import ProcessUtil from '../../../util/ProcessUtil';
import IChannelDB from '../../db/IChannelDB';
import IProgramDB from '../../db/IProgramDB';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { LiveHLSStreamModelProvider, LiveStreamModelProvider } from '../../service/stream/base/ILiveStreamBaseModel';
import {
    RecordedHLSStreamModelProvider,
    RecordedStreamModelProvider,
} from '../../service/stream/base/IRecordedStreamBaseModel';
import IStreamManageModel from '../../service/stream/manager/IStreamManageModel';
import WatchStreamProfileUtil from '../../service/stream/WatchStreamProfileUtil';
import IApiUtil from '../IApiUtil';
import IPlayList from '../IPlayList';
import IVideoUtil from '../video/IVideoUtil';
import IStreamApiModel, { SegmentStreamResponse, StreamResponse } from './IStreamApiModel';

interface StreamConfig {
    cmd?: string;
    preprocessor?: ProcessUtil.Cmds;
}

interface RecordedStreamConfig {
    cmd: string;
    preprocessor?: ProcessUtil.Cmds;
}

interface RecordedVODHLSVideoInfo {
    duration: number;
    filePath: string;
}

interface RecordedVodHlsMuxSessionOption {
    config: ReturnType<IConfiguration['getConfig']>;
    videoInfo: RecordedVODHLSVideoInfo;
    segmentDuration: number;
    segmentCount: number;
    preprocessor: ProcessUtil.Cmds;
    command: string;
    log: ILogger;
}

class RecordedVodHlsMuxSession {
    public lastAccess: number = Date.now();

    private static readonly SEGMENT_WAIT_TIMEOUT = 60 * 1000;

    private readonly option: RecordedVodHlsMuxSessionOption;
    private readonly directoryPromise: Promise<string>;
    private readonly processes: ChildProcess[] = [];
    private fileStream: fs.ReadStream | null = null;
    private isCompleted: boolean = false;
    private startPromise: Promise<void> | null = null;

    constructor(option: RecordedVodHlsMuxSessionOption) {
        this.option = option;
        this.directoryPromise = fs.promises.mkdtemp(path.join(os.tmpdir(), 'epgstation-vodhls-'));
    }

    public async getSegment(sequence: number): Promise<Buffer> {
        this.touch();
        if (sequence < 0 || sequence >= this.option.segmentCount) {
            throw new Error('OutOfRange');
        }

        await this.start();
        const segmentPath = await this.waitSegmentFile(sequence);

        return fs.promises.readFile(segmentPath);
    }

    public prefetch(_sequence: number): void {
        this.touch();
        this.start().catch((err: Error) => {
            this.option.log.stream.warn(`start recorded VOD HLS mux session failed: ${err.message}`);
        });
    }

    public async prepareUntil(sequence: number): Promise<void> {
        this.touch();
        const target = Math.min(Math.max(sequence, 0), this.option.segmentCount - 1);
        await this.start();
        await this.waitSegmentFile(target);
    }

    public async cleanup(): Promise<void> {
        this.fileStream?.destroy();

        await Promise.all(this.processes.map(process => ProcessUtil.kill(process).catch(() => {})));

        const dir = await this.directoryPromise.catch(() => null);
        if (dir !== null) {
            await fs.promises.rm(dir, { force: true, recursive: true }).catch(() => {});
        }
    }

    private touch(): void {
        this.lastAccess = Date.now();
    }

    private async start(): Promise<void> {
        if (this.startPromise !== null) {
            return this.startPromise;
        }

        this.startPromise = this.startMuxer();

        return this.startPromise;
    }

    private async startMuxer(): Promise<void> {
        const dir = await this.directoryPromise;
        const segmentPath = path.join(dir, 'segment-%d.ts');
        const playlistPath = path.join(dir, 'playlist.m3u8');
        const preprocessor = this.option.preprocessor;
        const config = this.option.config;

        this.fileStream = fs.createReadStream(this.option.videoInfo.filePath);
        const preProcessProcess = spawn(preprocessor.bin, preprocessor.args, {
            windowsHide: true,
        });
        const encodeProcess = spawn(this.option.command, {
            shell: true,
            windowsHide: true,
        });
        const hlsMuxProcess = spawn(
            config.ffmpeg,
            [
                '-hide_banner',
                '-loglevel',
                'warning',
                '-fflags',
                '+genpts',
                '-f',
                'mpegts',
                '-i',
                'pipe:0',
                '-map',
                '0',
                '-c',
                'copy',
                '-hls_time',
                this.option.segmentDuration.toFixed(6),
                '-hls_list_size',
                '0',
                '-hls_playlist_type',
                'vod',
                '-hls_segment_type',
                'mpegts',
                '-hls_flags',
                'independent_segments',
                '-hls_segment_filename',
                segmentPath,
                '-y',
                playlistPath,
            ],
            {
                windowsHide: true,
            },
        );

        this.processes.push(preProcessProcess, encodeProcess, hlsMuxProcess);
        this.option.log.stream.info(
            `create recorded VOD HLS TS continuous preprocessor: ${preprocessor.bin} ${preprocessor.args.join(' ')}`,
        );
        this.option.log.stream.info(`create recorded VOD HLS TS continuous process: ${this.option.command}`);
        this.option.log.stream.info(`create recorded VOD HLS TS muxer: ${config.ffmpeg}`);

        const captureProcess = (name: string, process: ChildProcess): void => {
            let stderr = '';
            process.stderr?.on('data', (data: Buffer) => {
                if (stderr.length < 16 * 1024) {
                    stderr += data.toString();
                }
            });
            process.on('exit', (code, signal) => {
                const detail = stderr.trim();
                const message = `recorded VOD HLS TS ${name} exited: code=${String(code)}, signal=${String(signal)}`;
                if (code === 0 || (code === null && signal === null)) {
                    this.option.log.stream.info(message);
                } else {
                    this.option.log.stream.warn(message + (detail.length === 0 ? '' : `\n${detail}`));
                }
            });
        };

        captureProcess('preprocessor', preProcessProcess);
        captureProcess('encoder', encodeProcess);
        captureProcess('muxer', hlsMuxProcess);

        if (
            this.fileStream === null ||
            preProcessProcess.stdin === null ||
            preProcessProcess.stdout === null ||
            encodeProcess.stdin === null ||
            encodeProcess.stdout === null ||
            hlsMuxProcess.stdin === null
        ) {
            await this.cleanup();
            throw new Error('SegmentStreamIsNull');
        }

        const ignorePipeError = (err: NodeJS.ErrnoException): void => {
            if (err.code !== 'EPIPE' && err.code !== 'ERR_STREAM_PREMATURE_CLOSE') {
                this.option.log.stream.warn(`recorded VOD HLS mux stream error: ${err.message}`);
            }
        };

        this.fileStream.on('error', ignorePipeError);
        preProcessProcess.stdin.on('error', ignorePipeError);
        preProcessProcess.stdout.on('error', ignorePipeError);
        encodeProcess.stdin.on('error', ignorePipeError);
        encodeProcess.stdout.on('error', ignorePipeError);
        hlsMuxProcess.stdin.on('error', ignorePipeError);

        this.fileStream.pipe(preProcessProcess.stdin);
        preProcessProcess.stdout.pipe(encodeProcess.stdin);
        encodeProcess.stdout.pipe(hlsMuxProcess.stdin);

        hlsMuxProcess.on('exit', () => {
            this.isCompleted = true;
        });
    }

    private async waitSegmentFile(sequence: number): Promise<string> {
        const dir = await this.directoryPromise;
        const segmentPath = path.join(dir, `segment-${sequence.toString(10)}.ts`);
        const startedAt = Date.now();

        while (Date.now() - startedAt < RecordedVodHlsMuxSession.SEGMENT_WAIT_TIMEOUT) {
            if (fs.existsSync(segmentPath) === true && (await this.isFileStable(segmentPath)) === true) {
                return segmentPath;
            }

            if (this.isCompleted === true && fs.existsSync(segmentPath) === false) {
                throw new Error('SegmentIsNotFound');
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error('SegmentWaitTimeout');
    }

    private async isFileStable(filePath: string): Promise<boolean> {
        try {
            const first = await fs.promises.stat(filePath);
            if (first.size <= 0) {
                return false;
            }

            await new Promise(resolve => setTimeout(resolve, 150));
            const second = await fs.promises.stat(filePath);

            return first.size === second.size && second.size > 0;
        } catch {
            return false;
        }
    }
}

interface EncodedVodHlsMuxSessionOption {
    config: ReturnType<IConfiguration['getConfig']>;
    videoInfo: RecordedVODHLSVideoInfo;
    segmentDuration: number;
    segmentCount: number;
    qualityName?: string;
    encoder?: apid.RecordedStreanOption['encoder'];
    isHevc?: boolean;
    subtitleIndex?: number;
    subtitlePath?: string;
    log: ILogger;
}

class EncodedVodHlsMuxSession {
    public lastAccess: number = Date.now();

    private static readonly SEGMENT_WAIT_TIMEOUT = 60 * 1000;

    private readonly option: EncodedVodHlsMuxSessionOption;
    private readonly directoryPromise: Promise<string>;
    private process: ChildProcess | null = null;
    private isCompleted: boolean = false;
    private startPromise: Promise<void> | null = null;

    constructor(option: EncodedVodHlsMuxSessionOption) {
        this.option = option;
        this.directoryPromise = fs.promises.mkdtemp(path.join(os.tmpdir(), 'epgstation-encoded-vodhls-'));
    }

    public async getSegment(sequence: number): Promise<Buffer> {
        this.touch();
        if (sequence < 0 || sequence >= this.option.segmentCount) {
            throw new Error('OutOfRange');
        }

        await this.start();
        const segmentPath = await this.waitSegmentFile(sequence);

        return fs.promises.readFile(segmentPath);
    }

    public prefetch(): void {
        this.touch();
        this.start().catch((err: Error) => {
            this.option.log.stream.warn(`start encoded VOD HLS mux session failed: ${err.message}`);
        });
    }

    public async prepareUntil(sequence: number): Promise<void> {
        this.touch();
        const target = Math.min(Math.max(sequence, 0), this.option.segmentCount - 1);
        await this.start();
        await this.waitSegmentFile(target);
    }

    public async cleanup(): Promise<void> {
        if (this.process !== null) {
            await ProcessUtil.kill(this.process).catch(() => {});
            this.process = null;
        }

        const dir = await this.directoryPromise.catch(() => null);
        if (dir !== null) {
            await fs.promises.rm(dir, { force: true, recursive: true }).catch(() => {});
        }
    }

    private touch(): void {
        this.lastAccess = Date.now();
    }

    private async start(): Promise<void> {
        if (this.startPromise !== null) {
            return this.startPromise;
        }

        this.startPromise = this.startMuxer();

        return this.startPromise;
    }

    private async startMuxer(): Promise<void> {
        const dir = await this.directoryPromise;
        const segmentPath = path.join(dir, 'segment-%d.ts');
        const playlistPath = path.join(dir, 'playlist.m3u8');
        const subtitlePath = await this.prepareSubtitleSource(dir);
        const command = WatchStreamProfileUtil.buildEncodedVodHlsContinuousCommand(this.option.config, {
            input: this.option.videoInfo.filePath,
            playlistPath: playlistPath,
            segmentDuration: this.option.segmentDuration,
            segmentPath: segmentPath,
            qualityName: this.option.qualityName,
            encoder: this.option.encoder,
            isHevc: this.option.isHevc,
            subtitlePath: subtitlePath,
        });

        this.option.log.stream.info(
            `create recorded VOD HLS encoded continuous process: ${command.bin} ${command.args.join(' ')}`,
        );

        const process = spawn(command.bin, command.args, {
            windowsHide: true,
            cwd: dir,
        });
        this.process = process;
        const stderr: Buffer[] = [];
        process.stderr?.on('data', data => {
            stderr.push(Buffer.from(data));
        });
        process.on('exit', code => {
            this.isCompleted = true;
            if (code !== 0 && stderr.length > 0) {
                this.option.log.stream.warn(
                    `encoded VOD HLS process failed: ${Buffer.concat(stderr).toString('utf8')}`,
                );
            }
        });
    }

    private async prepareSubtitleSource(dir: string): Promise<string | undefined> {
        if (typeof this.option.subtitlePath === 'undefined') {
            return this.extractSubtitle(dir);
        }

        const outputName = 'subtitle.ass';
        await fs.promises.copyFile(this.option.subtitlePath, path.join(dir, outputName));

        return outputName;
    }

    private async extractSubtitle(dir: string): Promise<string | undefined> {
        if (typeof this.option.subtitleIndex === 'undefined' || this.option.subtitleIndex < 0) {
            return undefined;
        }

        const outputName = 'subtitle.ass';
        const outputPath = path.join(dir, outputName);
        const args = [
            '-hide_banner',
            '-loglevel',
            'warning',
            '-y',
            '-i',
            this.option.videoInfo.filePath,
            '-map',
            `0:s:${this.option.subtitleIndex.toString(10)}`,
            '-c:s',
            'ass',
            outputPath,
        ];

        this.option.log.stream.info(
            `extract recorded VOD HLS subtitle: ${this.option.config.ffmpeg} ${args.join(' ')}`,
        );

        await new Promise<void>((resolve, reject) => {
            const process = spawn(this.option.config.ffmpeg, args, {
                windowsHide: true,
            });
            const stderr: Buffer[] = [];
            process.stderr?.on('data', data => {
                stderr.push(Buffer.from(data));
            });
            process.on('error', reject);
            process.on('exit', code => {
                if (code === 0) {
                    resolve();

                    return;
                }

                reject(new Error(`SubtitleExtractFailed: ${Buffer.concat(stderr).toString('utf8')}`));
            });
        });

        const stat = await fs.promises.stat(outputPath);
        if (stat.size <= 0) {
            throw new Error('SubtitleExtractedFileIsEmpty');
        }
        this.option.log.stream.info(
            `extracted recorded VOD HLS subtitle: ${outputName} ${stat.size.toString(10)} bytes`,
        );

        return outputName;
    }

    private async waitSegmentFile(sequence: number): Promise<string> {
        const dir = await this.directoryPromise;
        const segmentPath = path.join(dir, `segment-${sequence.toString(10)}.ts`);
        const startedAt = Date.now();

        while (Date.now() - startedAt < EncodedVodHlsMuxSession.SEGMENT_WAIT_TIMEOUT) {
            if (fs.existsSync(segmentPath) === true && (await this.isFileStable(segmentPath)) === true) {
                return segmentPath;
            }

            if (this.isCompleted === true && fs.existsSync(segmentPath) === false) {
                throw new Error('SegmentIsNotFound');
            }

            await new Promise(resolve => setTimeout(resolve, 100));
        }

        throw new Error('SegmentWaitTimeout');
    }

    private async isFileStable(filePath: string): Promise<boolean> {
        try {
            const first = await fs.promises.stat(filePath);
            if (first.size <= 0) {
                return false;
            }

            await new Promise(resolve => setTimeout(resolve, 150));
            const second = await fs.promises.stat(filePath);

            return first.size === second.size && second.size > 0;
        } catch {
            return false;
        }
    }
}

@injectable()
export default class StreamApiModel implements IStreamApiModel {
    private static readonly TS_VOD_HLS_SEGMENT_DURATION = 180 / (30000 / 1001);
    private static readonly ENCODED_VOD_HLS_SEGMENT_DURATION = 4;
    private static readonly VOD_HLS_SESSION_TTL = 10 * 60 * 1000;

    private configure: IConfiguration;
    private liveStreamProvider: LiveStreamModelProvider;
    private liveHLSStreamProvider: LiveHLSStreamModelProvider;
    private recordedStreamProvider: RecordedStreamModelProvider;
    private recordedHLSStreamProvider: RecordedHLSStreamModelProvider;
    private streamManageModel: IStreamManageModel;
    private programDB: IProgramDB;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private channelDB: IChannelDB;
    private apiUtil: IApiUtil;
    private videoUtil: IVideoUtil;
    private log: ILogger;
    private recordedVodHlsSessions: Map<string, RecordedVodHlsMuxSession> = new Map();
    private encodedVodHlsSessions: Map<string, EncodedVodHlsMuxSession> = new Map();

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('LiveStreamModelProvider') liveStreamProvider: LiveStreamModelProvider,
        @inject('LiveHLSStreamModelProvider') liveHLSStreamProvider: LiveHLSStreamModelProvider,
        @inject('RecordedStreamModelProvider') recordedStreamProvider: RecordedStreamModelProvider,
        @inject('RecordedHLSStreamModelProvider') recordedHLSStreamProvider: RecordedHLSStreamModelProvider,
        @inject('IStreamManageModel') streamManageModel: IStreamManageModel,
        @inject('IProgramDB') programDB: IProgramDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IApiUtil') apiUtil: IApiUtil,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.configure = configure;
        this.liveStreamProvider = liveStreamProvider;
        this.liveHLSStreamProvider = liveHLSStreamProvider;
        this.recordedStreamProvider = recordedStreamProvider;
        this.recordedHLSStreamProvider = recordedHLSStreamProvider;
        this.streamManageModel = streamManageModel;
        this.programDB = programDB;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.channelDB = channelDB;
        this.apiUtil = apiUtil;
        this.videoUtil = videoUtil;
        this.log = logger.getLogger();
    }

    /**
     * m2ts 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const conf = await this.getTsLiveConfig('m2ts', option);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: conf.cmd,
                preprocessor: conf.preprocessor,
            },
            option.mode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * m2ts Low Latency (mpegts.js 用) 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveM2TsLLStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const conf = await this.getTsLiveConfig('m2tsll', option);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: conf.cmd,
                preprocessor: conf.preprocessor,
            },
            option.mode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * webm 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveWebmStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const conf = await this.getTsLiveConfig('webm', option);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: conf.cmd,
            },
            option.mode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * mp4 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startMp4Stream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        const conf = await this.getTsLiveConfig('mp4', option);

        // stream 生成
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: conf.cmd,
            },
            option.mode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * HLS 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<apid.StreamId>
     */
    public async startLiveHLSStream(option: apid.LiveStreamOption): Promise<apid.StreamId> {
        const conf = await this.getTsLiveConfig('hls', option);

        // stream 生成
        const stream = await this.liveHLSStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: conf.cmd,
            },
            option.mode,
        );

        // manager に登録
        return await this.streamManageModel.start(stream);
    }

    /**
     * config から指定した live stream コマンドを取り出す
     * @param type: 'm2ts' | 'm2tsll' | 'webm' | 'mp4' | 'hls'
     * @param option: Live stream option
     * @return Promise<StreamConfig>
     */
    private async getTsLiveConfig(
        type: 'm2ts' | 'm2tsll' | 'webm' | 'mp4' | 'hls',
        option: apid.LiveStreamOption,
    ): Promise<StreamConfig> {
        const config = this.configure.getConfig();

        if (WatchStreamProfileUtil.isEnabled(config) && (type === 'm2ts' || type === 'm2tsll')) {
            const channel = await this.channelDB.findId(option.channelId);
            return {
                cmd: WatchStreamProfileUtil.buildLiveMpegTsCommand(config, {
                    type: type,
                    mode: option.mode,
                    channelType: channel?.channelType,
                    qualityName: option.quality,
                    encoder: option.encoder,
                    isHevc: option.isHevc,
                }),
                preprocessor:
                    channel === null
                        ? undefined
                        : WatchStreamProfileUtil.buildTsreadexLiveCommand(config, channel.serviceId),
            };
        }

        if (
            typeof config.stream === 'undefined' ||
            typeof config.stream.live === 'undefined' ||
            typeof config.stream.live.ts === 'undefined' ||
            typeof config.stream.live.ts[type] === 'undefined' ||
            typeof (config.stream.live.ts[type] as any)[option.mode] === 'undefined'
        ) {
            throw new Error('ConfigIsUndefined');
        }

        return {
            cmd: (config.stream.live.ts[type] as any)[option.mode].cmd,
        };
    }

    /**
     * M2TS Low Latency 形式の Recorded streaming を開始する
     * @param option: apid.RecordedStreanOption
     * @return Promise<StreamResponse>
     */
    public async startRecordedM2TsLLStream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const conf = await this.getRecordedVideoConfig('m2tsll', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: conf.cmd,
                preprocessor: conf.preprocessor,
            },
            option.mode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * WebM 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startRecordedWebMStream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const conf = await this.getRecordedVideoConfig('webm', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: conf.cmd,
            },
            option.mode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * WebM 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startRecordedMp4Stream(option: apid.RecordedStreanOption): Promise<StreamResponse> {
        const conf = await this.getRecordedVideoConfig('mp4', option);

        // stream 生成
        const stream = await this.recordedStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: conf.cmd,
            },
            option.mode,
        );

        // manager に登録
        const streamId = await this.streamManageModel.start(stream);

        return {
            streamId: streamId,
            stream: stream.getStream(),
        };
    }

    /**
     * HLS 形式の Recorded streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<apid.StreamId>
     */
    public async startRecordedHLSStream(option: apid.RecordedStreanOption): Promise<apid.StreamId> {
        const conf = await this.getRecordedVideoConfig('hls', option);

        // stream 生成
        const stream = await this.recordedHLSStreamProvider();
        stream.setOption(
            {
                videoFileId: option.videoFileId,
                playPosition: option.playPosition,
                cmd: conf.cmd,
            },
            option.mode,
        );

        // manager に登録
        return await this.streamManageModel.start(stream);
    }

    public async getRecordedVODHLSPlaylist(option: apid.RecordedStreanOption): Promise<string> {
        const videoInfo = await this.getRecordedVODHLSVideoInfo(option.videoFileId);
        const isEncodedVideo = await this.isEncodedVideo(option.videoFileId);
        const streamOption = isEncodedVideo === true ? this.resolveEncodedVodHlsSubtitleOption(option) : option;
        const segmentDuration = this.getRecordedVODHLSSegmentDurationByType(isEncodedVideo);
        const segmentCount = Math.max(1, Math.ceil(videoInfo.duration / segmentDuration));
        const targetDuration = Math.ceil(segmentDuration);
        const params = this.createRecordedVODHLSQuery(streamOption);
        const lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:6',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            `#EXT-X-TARGETDURATION:${targetDuration}`,
            '#EXT-X-MEDIA-SEQUENCE:0',
        ];

        const prepareSegment = Math.min(2, segmentCount - 1);
        if (isEncodedVideo === true) {
            const subtitle =
                typeof streamOption.subtitleFileKey !== 'undefined'
                    ? 'prepared'
                    : typeof streamOption.subtitleIndex === 'number' && streamOption.subtitleIndex >= 0
                      ? `track:${streamOption.subtitleIndex.toString(10)}`
                      : 'none';
            this.log.stream.info(
                `recorded VOD HLS encoded playlist option: videoFileId=${streamOption.videoFileId.toString(10)}, subtitle=${subtitle}`,
            );
            const session = await this.getEncodedVodHlsSession(streamOption, videoInfo, segmentDuration);
            await session.prepareUntil(prepareSegment);
        } else {
            const session = await this.getRecordedVodHlsSession(streamOption, videoInfo, segmentDuration);
            await session.prepareUntil(prepareSegment);
        }

        for (let sequence = 0; sequence < segmentCount; sequence++) {
            const start = sequence * segmentDuration;
            const duration = Math.min(segmentDuration, Math.max(videoInfo.duration - start, 0.001));
            lines.push(`#EXTINF:${duration.toFixed(6)},`);
            lines.push(`segments/${sequence.toString(10)}?${params}`);
        }

        lines.push('#EXT-X-ENDLIST');

        return `${lines.join('\n')}\n`;
    }

    public async createRecordedVODHLSSegmentStream(
        option: apid.RecordedStreanOption,
        sequence: number,
    ): Promise<SegmentStreamResponse> {
        const videoInfo = await this.getRecordedVODHLSVideoInfo(option.videoFileId);
        const isEncodedVideo = await this.isEncodedVideo(option.videoFileId);
        const segmentDuration = this.getRecordedVODHLSSegmentDurationByType(isEncodedVideo);
        const start = sequence * segmentDuration;

        if (sequence < 0 || start >= videoInfo.duration + 0.001) {
            throw new Error('OutOfRange');
        }

        if (isEncodedVideo === true) {
            const streamOption = this.resolveEncodedVodHlsSubtitleOption(option);
            const session = await this.getEncodedVodHlsSession(streamOption, videoInfo, segmentDuration);
            const buffer = await session.getSegment(sequence);

            return {
                process: null,
                processes: [],
                cleanup: async () => {},
                stream: Readable.from(buffer),
            };
        }

        const session = await this.getRecordedVodHlsSession(option, videoInfo, segmentDuration);
        const buffer = await session.getSegment(sequence);

        return {
            process: null,
            processes: [],
            cleanup: async () => {},
            stream: Readable.from(buffer),
        };
    }

    private async getRecordedVodHlsSession(
        option: apid.RecordedStreanOption,
        videoInfo: RecordedVODHLSVideoInfo,
        segmentDuration: number,
    ): Promise<RecordedVodHlsMuxSession> {
        this.cleanupRecordedVodHlsSessions();

        const sessionKey = this.createRecordedVodHlsSessionKey(option, videoInfo.filePath, segmentDuration);
        const exists = this.recordedVodHlsSessions.get(sessionKey);
        if (typeof exists !== 'undefined') {
            exists.lastAccess = Date.now();

            return exists;
        }

        const config = this.configure.getConfig();
        const preprocessor = await this.buildRecordedTsPreprocessor(option.videoFileId);
        if (typeof preprocessor === 'undefined') {
            throw new Error('RecordedVODHLSPreprocessorIsUndefined');
        }
        const command = WatchStreamProfileUtil.buildRecordedVodHlsContinuousCommand(config, {
            qualityName: option.quality,
            encoder: option.encoder,
            isHevc: option.isHevc,
        });

        const segmentCount = Math.max(1, Math.ceil(videoInfo.duration / segmentDuration));
        const session = new RecordedVodHlsMuxSession({
            config: config,
            videoInfo: videoInfo,
            segmentDuration: segmentDuration,
            segmentCount: segmentCount,
            preprocessor: preprocessor,
            command: command,
            log: this.log,
        });

        this.recordedVodHlsSessions.set(sessionKey, session);
        session.prefetch(0);

        return session;
    }

    private async getEncodedVodHlsSession(
        option: apid.RecordedStreanOption,
        videoInfo: RecordedVODHLSVideoInfo,
        segmentDuration: number,
    ): Promise<EncodedVodHlsMuxSession> {
        this.cleanupEncodedVodHlsSessions();

        const sessionKey = this.createRecordedVodHlsSessionKey(option, videoInfo.filePath, segmentDuration);
        const exists = this.encodedVodHlsSessions.get(sessionKey);
        if (typeof exists !== 'undefined') {
            exists.lastAccess = Date.now();

            return exists;
        }

        const preparedSubtitlePath =
            typeof option.subtitleFileKey === 'undefined'
                ? undefined
                : this.videoUtil.getPreparedSubtitlePath(option.subtitleFileKey);
        if (typeof option.subtitleFileKey !== 'undefined' && typeof preparedSubtitlePath === 'undefined') {
            throw new Error('PreparedSubtitleIsNotFound');
        }

        const segmentCount = Math.max(1, Math.ceil(videoInfo.duration / segmentDuration));
        const session = new EncodedVodHlsMuxSession({
            config: this.configure.getConfig(),
            videoInfo: videoInfo,
            segmentDuration: segmentDuration,
            segmentCount: segmentCount,
            qualityName: option.quality,
            encoder: option.encoder,
            isHevc: option.isHevc,
            subtitleIndex: option.subtitleIndex,
            subtitlePath: preparedSubtitlePath,
            log: this.log,
        });

        this.encodedVodHlsSessions.set(sessionKey, session);
        session.prefetch();

        return session;
    }

    private resolveEncodedVodHlsSubtitleOption(option: apid.RecordedStreanOption): apid.RecordedStreanOption {
        if (typeof option.subtitleIndex !== 'undefined' && option.subtitleIndex < 0) {
            return {
                ...option,
                subtitleFileKey: undefined,
            };
        }

        if (typeof option.subtitleFileKey !== 'undefined') {
            return option;
        }

        if (typeof option.subtitleIndex !== 'undefined') {
            return option;
        }

        return option;
    }

    private createRecordedVodHlsSessionKey(
        option: apid.RecordedStreanOption,
        filePath: string,
        segmentDuration: number,
    ): string {
        return [
            option.videoFileId,
            filePath,
            segmentDuration,
            option.mode,
            option.quality ?? '',
            option.encoder ?? '',
            typeof option.isHevc === 'undefined' ? '' : option.isHevc === true ? 'hevc' : 'h264',
            typeof option.subtitleIndex === 'undefined' ? '' : option.subtitleIndex.toString(10),
            option.subtitleFileKey ?? '',
        ].join('|');
    }

    private cleanupRecordedVodHlsSessions(): void {
        const now = Date.now();
        for (const [key, session] of this.recordedVodHlsSessions.entries()) {
            if (now - session.lastAccess > StreamApiModel.VOD_HLS_SESSION_TTL) {
                session.cleanup().catch(() => {});
                this.recordedVodHlsSessions.delete(key);
            }
        }
    }

    private cleanupEncodedVodHlsSessions(): void {
        const now = Date.now();
        for (const [key, session] of this.encodedVodHlsSessions.entries()) {
            if (now - session.lastAccess > StreamApiModel.VOD_HLS_SESSION_TTL) {
                session.cleanup().catch(() => {});
                this.encodedVodHlsSessions.delete(key);
            }
        }
    }

    /**
     * config から指定した stream コマンドを取り出す
     * @param type: 'webm' | 'mp4' | 'hls'
     * @param option apid.RecordedStreanOption
     * @return Promise<StreamConfig>
     */
    private async getRecordedVideoConfig(
        type: 'webm' | 'mp4' | 'hls' | 'm2tsll',
        option: apid.RecordedStreanOption,
    ): Promise<RecordedStreamConfig> {
        const isEncodedVideo = await this.isEncodedVideo(option.videoFileId);

        // config が存在するか
        const config = this.configure.getConfig();
        if (typeof config.stream === 'undefined' || typeof config.stream.recorded === 'undefined') {
            throw new Error('ConfigIsUndefined');
        }

        let cmd: string;
        if (
            WatchStreamProfileUtil.isEnabled(config) === true &&
            (typeof option.quality !== 'undefined' ||
                typeof option.encoder !== 'undefined' ||
                typeof option.isHevc !== 'undefined')
        ) {
            cmd = WatchStreamProfileUtil.buildRecordedCommand(config, {
                type: type,
                mode: option.mode,
                qualityName: option.quality,
                encoder: option.encoder,
                isHevc: option.isHevc,
                isEncodedVideo: isEncodedVideo,
            });
        } else if (type === 'm2tsll') {
            throw new Error('ConfigIsUndefined');
        } else if (isEncodedVideo === true) {
            if (
                typeof config.stream.recorded.encoded === 'undefined' ||
                typeof config.stream.recorded.encoded[type] === 'undefined' ||
                typeof (config.stream.recorded.encoded[type] as any)[option.mode] === 'undefined'
            ) {
                throw new Error('ConfigIsUndefined');
            }

            cmd = (config.stream.recorded.encoded[type] as any)[option.mode].cmd;
        } else {
            if (
                typeof config.stream.recorded.ts === 'undefined' ||
                typeof config.stream.recorded.ts[type] === 'undefined' ||
                typeof (config.stream.recorded.ts[type] as any)[option.mode] === 'undefined'
            ) {
                throw new Error('ConfigIsUndefined');
            }

            cmd = (config.stream.recorded.ts[type] as any)[option.mode].cmd;
        }

        if (typeof cmd === 'undefined') {
            throw new Error('CmdIsUndefined');
        }

        const preprocessor =
            isEncodedVideo === false && WatchStreamProfileUtil.isEnabled(config) === true
                ? await this.buildRecordedTsPreprocessor(option.videoFileId)
                : undefined;

        return {
            cmd: cmd,
            preprocessor: preprocessor,
        };
    }

    private async getRecordedVODHLSVideoInfo(videoFileId: apid.VideoFileId): Promise<RecordedVODHLSVideoInfo> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('GetVideoFilePathError');
        }

        const videoInfo = await this.videoUtil.getInfo(filePath);
        if (Number.isFinite(videoInfo.duration) === false || videoInfo.duration <= 0) {
            throw new Error('VideoDurationIsInvalid');
        }

        return {
            duration: videoInfo.duration,
            filePath: filePath,
        };
    }

    private getRecordedVODHLSSegmentDurationByType(isEncodedVideo: boolean): number {
        return isEncodedVideo === true
            ? StreamApiModel.ENCODED_VOD_HLS_SEGMENT_DURATION
            : StreamApiModel.TS_VOD_HLS_SEGMENT_DURATION;
    }

    private createRecordedVODHLSQuery(option: apid.RecordedStreanOption): string {
        const params = new URLSearchParams({
            mode: option.mode.toString(10),
            ss: option.playPosition.toString(10),
        });

        if (typeof option.quality !== 'undefined') {
            params.set('quality', option.quality);
        }
        if (typeof option.encoder !== 'undefined') {
            params.set('encoder', option.encoder);
        }
        if (typeof option.isHevc !== 'undefined') {
            params.set('hevc', option.isHevc === true ? '1' : '0');
        }
        if (typeof option.subtitleIndex !== 'undefined') {
            params.set('subtitleIndex', option.subtitleIndex.toString(10));
        }
        if (typeof option.subtitleFileKey !== 'undefined') {
            params.set('subtitleFileKey', option.subtitleFileKey);
        }

        return params.toString();
    }

    private async buildRecordedTsPreprocessor(videoFileId: apid.VideoFileId): Promise<ProcessUtil.Cmds | undefined> {
        const config = this.configure.getConfig();
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            return undefined;
        }

        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) {
            return undefined;
        }

        const channel = await this.channelDB.findId(recorded.channelId);
        if (channel === null) {
            return undefined;
        }

        const filePath = this.videoUtil.getFullFilePathFromVideoFile(video);
        let serviceId = channel.serviceId;
        if (filePath !== null) {
            try {
                const detectedServiceId = await this.videoUtil.getMpegTsServiceId(filePath);
                if (detectedServiceId !== null) {
                    serviceId = detectedServiceId;
                }
            } catch (err: any) {
                this.log.stream.warn(`recorded TS service id detection failed: ${err.message}`);
            }
        }

        this.log.stream.info(
            `recorded TS service id: videoFileId=${videoFileId.toString(10)}, detected=${serviceId.toString(10)}, ` +
                `database=${channel.serviceId.toString(10)}`,
        );

        return WatchStreamProfileUtil.buildTsreadexLiveCommand(config, serviceId);
    }

    /**
     * 指定された video file が エンコードされたものなのか返す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<boolean>
     */
    private async isEncodedVideo(videoFileId: apid.VideoFileId): Promise<boolean> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            throw new Error('VideoFileIsNotFound');
        }

        return video.type === 'encoded';
    }

    /**
     * 指定した m2ts 形式のライブストリーミングの m3u8 形式のプレイリスト文字列を取得する
     * @param host: string host
     * @param isSecure boolean https 通信か
     * @param option: apid.LiveStreamOption
     * @return Promise<IPlayList | null>
     */
    public async getLiveM2TsStreamM3u8(
        host: string,
        isSecure: boolean,
        option: apid.LiveStreamOption,
    ): Promise<IPlayList | null> {
        const channel = await this.channelDB.findId(option.channelId);
        if (channel === null) {
            return null;
        }

        return {
            name: encodeURIComponent(channel.name + '.m3u8'),
            playList: this.apiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: channel.name,
                duration: 0,
                baseUrl: `/api/streams/live/${option.channelId.toString(10)}/m2ts?${this.buildLiveStreamQuery(option)}`,
            }),
        };
    }

    private buildLiveStreamQuery(option: apid.LiveStreamOption): string {
        const params = new URLSearchParams({
            mode: option.mode.toString(10),
        });
        if (typeof option.quality !== 'undefined') {
            params.set('quality', option.quality);
        }
        if (typeof option.encoder !== 'undefined') {
            params.set('encoder', option.encoder);
        }
        if (typeof option.isHevc !== 'undefined') {
            params.set('hevc', option.isHevc === true ? '1' : '0');
        }

        return params.toString();
    }

    /**
     * 指定した stream id のストリームを停止
     * @param streamId: apid.StreamId
     * @param isForce?: boolean 強制的に停止させるか
     * @return Promise<void>
     */
    public async stop(streamId: apid.StreamId, isForce: boolean = false): Promise<void> {
        await this.streamManageModel.stop(streamId, isForce);
    }

    /**
     * すべてのストリームを停止
     * @return Promise<void>
     */
    public async stopAll(): Promise<void> {
        await this.streamManageModel.stopAll();
    }

    /**
     * 指定したストリームを停止しないように停止タイマー情報を更新させる
     * @param streamId: apid.StreamId
     */
    public keep(streamId: apid.StreamId): void {
        this.streamManageModel.keep(streamId);
    }

    /**
     * ストリーム情報を返す
     * @param isHalfWidth: boolean 半角文字で取得するか true なら半角文字
     * @return apid.StreamInfo
     */
    public async getStreamInfos(isHalfWidth: boolean): Promise<apid.StreamInfo> {
        const infos = this.streamManageModel.getStreamInfos();

        const items: (apid.LiveStreamInfoItem | apid.VideoFileStreamInfoItem)[] = [];
        const now = new Date().getTime();
        for (const info of infos) {
            if (info.info.type === 'LiveStream' || info.info.type === 'LiveHLS') {
                // ライブストリーミング
                const item: apid.LiveStreamInfoItem = {
                    streamId: info.streamId,
                    type: info.info.type,
                    mode: info.info.mode,
                    isEnable: info.info.isEnable,
                    channelId: info.info.channelId,
                    name: '',
                    startAt: 0,
                    endAt: 0,
                };
                const program = await this.programDB.findChannelIdAndTime(info.info.channelId, now);
                if (program !== null) {
                    item.name = isHalfWidth === true ? program.halfWidthName : program.name;
                    item.startAt = program.startAt;
                    item.endAt = program.endAt;
                    if (program.description !== null && program.halfWidthDescription !== null) {
                        item.description = isHalfWidth === true ? program.halfWidthDescription : program.description;
                    }
                    if (program.extended !== null && program.halfWidthExtended !== null) {
                        item.extended = isHalfWidth === true ? program.halfWidthExtended : program.extended;
                    }
                    if (program.rawExtended !== null && program.rawHalfWidthExtended !== null) {
                        item.rawExtended =
                            isHalfWidth === true
                                ? JSON.parse(program.rawHalfWidthExtended)
                                : JSON.parse(program.rawExtended);
                    }
                }

                items.push(item);
            } else if (info.info.type === 'RecordedStream' || info.info.type === 'RecordedHLS') {
                // ビデオストリーミング
                const item: apid.VideoFileStreamInfoItem = {
                    streamId: info.streamId,
                    type: info.info.type,
                    mode: info.info.mode,
                    isEnable: info.info.isEnable,
                    channelId: 0,
                    name: '',
                    startAt: 0,
                    endAt: 0,
                    viodeFileId: info.info.videoFileId,
                    recordedId: 0,
                };

                const videoFile = await this.videoFileDB.findId(info.info.videoFileId);
                if (videoFile !== null) {
                    item.recordedId = videoFile.recordedId;
                    const recorded = await this.recordedDB.findId(videoFile.recordedId);
                    if (recorded !== null) {
                        item.channelId = recorded.channelId;
                        item.name = recorded.name;
                        item.startAt = recorded.startAt;
                        item.endAt = recorded.endAt;
                        if (recorded.description !== null && recorded.halfWidthDescription !== null) {
                            item.description =
                                isHalfWidth === true ? recorded.halfWidthDescription : recorded.description;
                        }
                        if (recorded.extended !== null && recorded.halfWidthExtended !== null) {
                            item.extended = isHalfWidth === true ? recorded.halfWidthExtended : recorded.extended;
                        }
                        if (recorded.rawExtended !== null && recorded.rawHalfWidthExtended !== null) {
                            item.rawExtended =
                                isHalfWidth === true
                                    ? JSON.parse(recorded.rawHalfWidthExtended)
                                    : JSON.parse(recorded.rawExtended);
                        }
                    }
                }

                items.push(item);
            } else {
                throw new Error('StreamInfoTypeError');
            }
        }

        return {
            items: items,
        };
    }
}
