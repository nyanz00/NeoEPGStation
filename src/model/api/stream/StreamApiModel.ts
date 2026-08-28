import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import { PassThrough, Readable } from 'stream';
import * as apid from '../../../../api';
import ProcessUtil from '../../../util/ProcessUtil';
import { findMpegTsByteOffset } from '../../../util/MpegTsTimeUtil';
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

type SharedLiveStreamType = 'm2ts' | 'm2tsll';

interface SharedLiveStreamSlot {
    promise: Promise<SharedLiveStreamEntry>;
    entry: SharedLiveStreamEntry | null;
}

interface SharedLiveStreamEntry {
    key: string;
    slot: SharedLiveStreamSlot;
    streamId: apid.StreamId;
    source: Readable;
    subscribers: Set<PassThrough>;
    recentChunks: Buffer[];
    recentSize: number;
    stopTimer: NodeJS.Timeout | null;
    closed: boolean;
}

interface RecordedStreamConfig {
    cmd: string;
    preprocessor?: ProcessUtil.Cmds;
}

interface RecordedVODHLSVideoInfo {
    duration: number;
    filePath: string;
    size: number;
    videoCodecName?: string;
    videoPixelFormat?: string;
}

interface SubtitleBurnInStyle {
    sizePercent: number;
    opacityPercent: number;
    outlineSizePercent: number;
    outlineOpacityPercent: number;
}

const transformAssAlpha = (value: string, percent: number): string => {
    const match = /^(?:&H)?([0-9a-f]{2})?([0-9a-f]{6})&?$/i.exec(value.trim());
    if (match === null) return value;
    const currentAlpha = parseInt(match[1] ?? '00', 16);
    const currentOpacity = 255 - currentAlpha;
    const nextOpacity = Math.round((currentOpacity * percent) / 100);
    const nextAlpha = Math.max(0, Math.min(255, 255 - nextOpacity));
    return `&H${nextAlpha.toString(16).padStart(2, '0').toUpperCase()}${match[2].toUpperCase()}`;
};

const scaleAssNumber = (value: string, percent: number): string => {
    const number = Number(value);
    if (Number.isFinite(number) === false) return value;
    return ((number * percent) / 100)
        .toFixed(2)
        .replace(/\.00$/, '')
        .replace(/(\.\d)0$/, '$1');
};

const splitAssFields = (value: string, count: number): string[] => {
    const fields: string[] = [];
    let rest = value;
    for (let index = 1; index < count; index++) {
        const separator = rest.indexOf(',');
        if (separator < 0) break;
        fields.push(rest.substring(0, separator));
        rest = rest.substring(separator + 1);
    }
    fields.push(rest);
    return fields;
};

const transformAssInlineStyle = (text: string, style: SubtitleBurnInStyle): string => {
    let transformed = text;
    if (style.sizePercent !== 100) {
        transformed = transformed.replace(/\\(fsc[xy])(-?\d+(?:\.\d+)?)/gi, (_match, name: string, value: string) => {
            return `\\${name.toLowerCase()}${scaleAssNumber(value, style.sizePercent)}`;
        });
    }
    if (style.outlineSizePercent !== 100) {
        transformed = transformed.replace(/\\([xy]?bord)(-?\d+(?:\.\d+)?)/gi, (_match, name: string, value: string) => {
            return `\\${name.toLowerCase()}${scaleAssNumber(value, style.outlineSizePercent)}`;
        });
    }
    if (style.opacityPercent === 100 && style.outlineOpacityPercent === 100) return transformed;
    transformed = transformed.replace(
        /\\(alpha|[1-4]a)&H([0-9a-f]{2})&?/gi,
        (_match, component: string, alpha: string) => {
            const normalizedComponent = component.toLowerCase();
            const source = `&H${alpha}FFFFFF`;
            if (normalizedComponent === 'alpha') {
                const textAlpha = transformAssAlpha(source, style.opacityPercent).substring(2, 4);
                const outlineAlpha = transformAssAlpha(source, style.outlineOpacityPercent).substring(2, 4);
                return `\\1a&H${textAlpha}&\\2a&H${textAlpha}&\\3a&H${outlineAlpha}&\\4a&H${outlineAlpha}&`;
            }
            const opacity =
                normalizedComponent === '1a' || normalizedComponent === '2a'
                    ? style.opacityPercent
                    : style.outlineOpacityPercent;
            const nextAlpha = transformAssAlpha(source, opacity).substring(2, 4);
            return `\\${normalizedComponent}&H${nextAlpha}&`;
        },
    );
    return transformed.replace(/\\([1-4]?c)&H([0-9a-f]{8})&?/gi, (_match, component: string, color: string) => {
        const normalizedComponent = component.toLowerCase();
        const opacity =
            normalizedComponent === '3c' || normalizedComponent === '4c'
                ? style.outlineOpacityPercent
                : style.opacityPercent;
        return `\\${normalizedComponent}&H${transformAssAlpha(`&H${color}`, opacity).substring(2)}&`;
    });
};

export const transformAssSubtitleForStreaming = (content: string, style: SubtitleBurnInStyle): string => {
    if (Object.values(style).every(value => value === 100)) return content;
    let section = '';
    let format: string[] = [];
    return content
        .split(/(\r?\n)/)
        .map(line => {
            if (/^\r?\n$/.test(line)) return line;
            const sectionMatch = /^\s*\[([^\]]+)]/.exec(line);
            if (sectionMatch !== null) {
                section = sectionMatch[1].trim().toLowerCase();
                format = [];
                return line;
            }
            const formatMatch = /^\s*Format\s*:\s*(.*)$/i.exec(line);
            if (formatMatch !== null) {
                format = formatMatch[1].split(',').map(value => value.trim().toLowerCase());
                return line;
            }
            if (section.includes('styles')) {
                const styleMatch = /^(\s*Style\s*:\s*)(.*)$/i.exec(line);
                if (styleMatch === null || format.length === 0) return line;
                const fields = splitAssFields(styleMatch[2], format.length);
                if (fields.length !== format.length) return line;
                const updateNumber = (name: string, percent: number): void => {
                    const index = format.indexOf(name);
                    if (index >= 0) fields[index] = scaleAssNumber(fields[index], percent);
                };
                const updateAlpha = (name: string, percent: number): void => {
                    const index = format.indexOf(name);
                    if (index >= 0) fields[index] = transformAssAlpha(fields[index], percent);
                };
                if (format.includes('scalex') && format.includes('scaley')) {
                    updateNumber('scalex', style.sizePercent);
                    updateNumber('scaley', style.sizePercent);
                } else {
                    updateNumber('fontsize', style.sizePercent);
                }
                updateNumber('outline', style.outlineSizePercent);
                updateAlpha('primarycolour', style.opacityPercent);
                updateAlpha('secondarycolour', style.opacityPercent);
                updateAlpha('outlinecolour', style.outlineOpacityPercent);
                return `${styleMatch[1]}${fields.join(',')}`;
            }
            if (section === 'events') {
                const dialogueMatch = /^(\s*(?:Dialogue|Comment)\s*:\s*)(.*)$/i.exec(line);
                if (dialogueMatch === null || format.length === 0) return line;
                const fields = splitAssFields(dialogueMatch[2], format.length);
                const textIndex = format.indexOf('text');
                if (fields.length !== format.length || textIndex < 0) return line;
                fields[textIndex] = transformAssInlineStyle(fields[textIndex], style);
                return `${dialogueMatch[1]}${fields.join(',')}`;
            }
            return line;
        })
        .join('');
};

interface RecordedVODHLSVideoInfoCacheEntry {
    expiresAt: number;
    promise: Promise<RecordedVODHLSVideoInfo>;
}

const VOD_HLS_SEEK_REBASE_MAX_GAP = 2;
const RECORDED_VOD_HLS_TS_PREROLL_SEGMENTS = 1;

export const shouldRebaseRecordedVodHlsSession = (
    startSequence: number,
    highestReadySequence: number,
    requestedSequence: number,
    requestedSegmentExists: boolean,
): boolean => {
    if (requestedSequence < startSequence) return true;
    if (requestedSegmentExists) return false;

    // Keep the next couple of normal HLS read-ahead requests on the current
    // process, but rebase a seek that skips over not-yet-generated segments.
    return requestedSequence > Math.max(startSequence, highestReadySequence) + VOD_HLS_SEEK_REBASE_MAX_GAP;
};

interface RecordedVodHlsMuxSessionOption {
    profileKey: string;
    config: ReturnType<IConfiguration['getConfig']>;
    videoInfo: RecordedVODHLSVideoInfo;
    segmentDuration: number;
    segmentCount: number;
    startByte: number;
    startPosition: number;
    startSequence: number;
    preprocessor: ProcessUtil.Cmds;
    command: string;
    log: ILogger;
    temporaryDir: string;
}

class RecordedVodHlsMuxSession {
    public lastAccess: number = Date.now();
    public readonly profileKey: string;
    public readonly startSequence: number;

    private static readonly SEGMENT_WAIT_TIMEOUT = 60 * 1000;

    private readonly option: RecordedVodHlsMuxSessionOption;
    private readonly directoryPromise: Promise<string>;
    private readonly processes: ChildProcess[] = [];
    private fileStream: fs.ReadStream | null = null;
    private isCompleted: boolean = false;
    private isStopping: boolean = false;
    private startPromise: Promise<void> | null = null;
    private highestReadySequence: number;

    constructor(option: RecordedVodHlsMuxSessionOption) {
        this.option = option;
        this.profileKey = option.profileKey;
        this.startSequence = option.startSequence;
        this.highestReadySequence = option.startSequence - 1;
        this.directoryPromise = fs.promises
            .mkdir(option.temporaryDir, { recursive: true })
            .then(() => fs.promises.mkdtemp(path.join(option.temporaryDir, 'epgstation-vodhls-')));
    }

    public async getSegment(sequence: number): Promise<Buffer> {
        this.touch();
        if (sequence < this.option.startSequence || sequence >= this.option.segmentCount) {
            throw new Error('OutOfRange');
        }

        await this.start();
        const segmentPath = await this.waitSegmentFile(sequence);
        const buffer = await fs.promises.readFile(segmentPath);
        this.highestReadySequence = Math.max(this.highestReadySequence, sequence);

        return buffer;
    }

    public async shouldRebase(sequence: number): Promise<boolean> {
        const dir = await this.directoryPromise;
        const segmentPath = path.join(dir, `segment-${sequence.toString(10)}.ts`);

        return shouldRebaseRecordedVodHlsSession(
            this.option.startSequence,
            this.highestReadySequence,
            sequence,
            fs.existsSync(segmentPath),
        );
    }

    public prefetch(_sequence: number): void {
        this.touch();
        this.start().catch((err: Error) => {
            this.option.log.stream.warn(`start recorded VOD HLS mux session failed: ${err.message}`);
        });
    }

    public async prepareUntil(sequence: number): Promise<void> {
        this.touch();
        const target = Math.min(Math.max(sequence, this.option.startSequence), this.option.segmentCount - 1);
        await this.start();
        await this.waitSegmentFile(target);
        this.highestReadySequence = Math.max(this.highestReadySequence, target);
    }

    public keep(): void {
        this.touch();
    }

    public async cleanup(): Promise<void> {
        this.isStopping = true;
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

        this.fileStream = fs.createReadStream(this.option.videoInfo.filePath, { start: this.option.startByte });
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
                '-start_number',
                this.option.startSequence.toString(10),
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
        this.option.log.stream.debug(
            `create recorded VOD HLS TS continuous preprocessor: ${preprocessor.bin} ${preprocessor.args.join(' ')}`,
        );
        this.option.log.stream.debug(`create recorded VOD HLS TS continuous process: ${this.option.command}`);
        this.option.log.stream.debug(`create recorded VOD HLS TS muxer: ${config.ffmpeg}`);

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
                if (this.isStopping) {
                    this.option.log.stream.debug(message);
                } else if (code === 0 || (code === null && signal === null)) {
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
    profileKey: string;
    config: ReturnType<IConfiguration['getConfig']>;
    videoInfo: RecordedVODHLSVideoInfo;
    segmentDuration: number;
    segmentCount: number;
    startPosition: number;
    startSequence: number;
    qualityName?: string;
    encoder?: apid.RecordedStreanOption['encoder'];
    isHevc?: boolean;
    subtitleIndex?: number;
    subtitlePath?: string;
    subtitleStyle: SubtitleBurnInStyle;
    log: ILogger;
    temporaryDir: string;
}

class EncodedVodHlsMuxSession {
    public lastAccess: number = Date.now();
    public readonly profileKey: string;
    public readonly startSequence: number;

    private static readonly SEGMENT_WAIT_TIMEOUT = 60 * 1000;
    private static readonly STDERR_TAIL_MAX_BYTES = 256 * 1024;
    private static readonly STDERR_TAIL_MAX_LINES = 400;

    private readonly option: EncodedVodHlsMuxSessionOption;
    private readonly directoryPromise: Promise<string>;
    private process: ChildProcess | null = null;
    private subtitleProcess: ChildProcess | null = null;
    private isCompleted: boolean = false;
    private isStopping: boolean = false;
    private startPromise: Promise<void> | null = null;
    private highestReadySequence: number;

    constructor(option: EncodedVodHlsMuxSessionOption) {
        this.option = option;
        this.profileKey = option.profileKey;
        this.startSequence = option.startSequence;
        this.highestReadySequence = option.startSequence - 1;
        this.directoryPromise = fs.promises
            .mkdir(option.temporaryDir, { recursive: true })
            .then(() => fs.promises.mkdtemp(path.join(option.temporaryDir, 'epgstation-encoded-vodhls-')));
    }

    public async getSegment(sequence: number): Promise<Buffer> {
        this.touch();
        if (sequence < this.option.startSequence || sequence >= this.option.segmentCount) {
            throw new Error('OutOfRange');
        }

        await this.start();
        const segmentPath = await this.waitSegmentFile(sequence);
        const buffer = await fs.promises.readFile(segmentPath);
        this.highestReadySequence = Math.max(this.highestReadySequence, sequence);

        return buffer;
    }

    public async shouldRebase(sequence: number): Promise<boolean> {
        const dir = await this.directoryPromise;
        const segmentPath = path.join(dir, `segment-${sequence.toString(10)}.ts`);

        return shouldRebaseRecordedVodHlsSession(
            this.option.startSequence,
            this.highestReadySequence,
            sequence,
            fs.existsSync(segmentPath),
        );
    }

    public prefetch(): void {
        this.touch();
        this.start().catch((err: Error) => {
            this.option.log.stream.warn(`start encoded VOD HLS mux session failed: ${err.message}`);
        });
    }

    public async prepareUntil(sequence: number): Promise<void> {
        this.touch();
        const target = Math.min(Math.max(sequence, this.option.startSequence), this.option.segmentCount - 1);
        await this.start();
        await this.waitSegmentFile(target);
        this.highestReadySequence = Math.max(this.highestReadySequence, target);
    }

    public keep(): void {
        this.touch();
    }

    public async cleanup(): Promise<void> {
        this.isStopping = true;
        if (this.subtitleProcess !== null) {
            const subtitleProcess = this.subtitleProcess;
            this.subtitleProcess = null;
            await stopStreamProcess(subtitleProcess);
        }
        await this.startPromise?.catch(() => {});
        if (this.process !== null) {
            const process = this.process;
            this.process = null;
            await stopStreamProcess(process);
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
        if (this.isStopping) throw new Error('EncodedVodHlsSessionStopped');
        if (this.startPromise !== null) {
            return this.startPromise;
        }

        this.startPromise = this.startMuxer();

        return this.startPromise;
    }

    private async startMuxer(): Promise<void> {
        const dir = await this.directoryPromise;
        if (this.isStopping) throw new Error('EncodedVodHlsSessionStopped');
        const segmentPath = path.join(dir, 'segment-%d.ts');
        const playlistPath = path.join(dir, 'playlist.m3u8');
        const subtitlePath = await this.prepareSubtitleSource(dir);
        if (this.isStopping) throw new Error('EncodedVodHlsSessionStopped');
        const command = WatchStreamProfileUtil.buildEncodedVodHlsContinuousCommand(this.option.config, {
            input: this.option.videoInfo.filePath,
            playlistPath: playlistPath,
            segmentDuration: this.option.segmentDuration,
            segmentPath: segmentPath,
            start: this.option.startPosition,
            startSequence: this.option.startSequence,
            qualityName: this.option.qualityName,
            encoder: this.option.encoder,
            isHevc: this.option.isHevc,
            subtitlePath: subtitlePath,
            inputVideoCodec: this.option.videoInfo.videoCodecName,
            inputPixelFormat: this.option.videoInfo.videoPixelFormat,
        });

        this.option.log.stream.debug(
            `create recorded VOD HLS encoded continuous process: ${command.bin} ${command.args.join(' ')}`,
        );

        const process = spawn(command.bin, command.args, {
            windowsHide: true,
            cwd: dir,
        });
        this.process = process;
        let stderrTail = '';
        process.stderr?.on('data', data => {
            stderrTail = this.appendStderrTail(stderrTail, Buffer.from(data).toString('utf8'));
        });
        process.on('exit', code => {
            this.isCompleted = true;
            if (this.isStopping === false && code !== 0 && stderrTail.length > 0) {
                this.option.log.stream.warn(`encoded VOD HLS process failed: ${stderrTail}`);
            }
        });
    }

    private appendStderrTail(current: string, chunk: string): string {
        let tail = current + chunk;
        const lines = tail.split(/\r\n|\n|\r/);
        if (lines.length > EncodedVodHlsMuxSession.STDERR_TAIL_MAX_LINES) {
            tail = lines.slice(-EncodedVodHlsMuxSession.STDERR_TAIL_MAX_LINES).join('\n');
        }
        const bytes = Buffer.from(tail, 'utf8');
        if (bytes.length > EncodedVodHlsMuxSession.STDERR_TAIL_MAX_BYTES) {
            tail = bytes.subarray(bytes.length - EncodedVodHlsMuxSession.STDERR_TAIL_MAX_BYTES).toString('utf8');
        }

        return tail;
    }

    private async prepareSubtitleSource(dir: string): Promise<string | undefined> {
        const outputName =
            typeof this.option.subtitlePath === 'undefined'
                ? await this.extractSubtitle(dir)
                : await (async () => {
                      const name = 'subtitle.ass';
                      await fs.promises.copyFile(this.option.subtitlePath!, path.join(dir, name));
                      return name;
                  })();
        if (typeof outputName === 'undefined') return undefined;
        const outputPath = path.join(dir, outputName);
        const content = await fs.promises.readFile(outputPath, 'utf8');
        const transformed = transformAssSubtitleForStreaming(content, this.option.subtitleStyle);
        if (transformed !== content) await fs.promises.writeFile(outputPath, transformed, 'utf8');
        this.option.log.stream.info(
            `recorded VOD HLS subtitle style: size=${this.option.subtitleStyle.sizePercent.toString(10)}%, ` +
                `opacity=${this.option.subtitleStyle.opacityPercent.toString(10)}%, ` +
                `outlineSize=${this.option.subtitleStyle.outlineSizePercent.toString(10)}%, ` +
                `outlineOpacity=${this.option.subtitleStyle.outlineOpacityPercent.toString(10)}%, ` +
                `transformed=${transformed !== content}`,
        );
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

        this.option.log.stream.debug(
            `extract recorded VOD HLS subtitle: ${this.option.config.ffmpeg} ${args.join(' ')}`,
        );

        await new Promise<void>((resolve, reject) => {
            const process = spawn(this.option.config.ffmpeg, args, {
                windowsHide: true,
            });
            this.subtitleProcess = process;
            const stderr: Buffer[] = [];
            process.stderr?.on('data', data => {
                stderr.push(Buffer.from(data));
            });
            process.on('error', reject);
            process.on('exit', code => {
                if (this.subtitleProcess === process) this.subtitleProcess = null;
                if (code === 0) {
                    resolve();

                    return;
                }

                reject(new Error(`SubtitleExtractFailed: ${Buffer.concat(stderr).toString('utf8')}`));
            });
            if (this.isStopping) void stopStreamProcess(process);
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

const waitStreamProcessExit = (process: ChildProcess, timeout: number): Promise<boolean> => {
    if (process.exitCode !== null || process.signalCode !== null) return Promise.resolve(true);

    return new Promise(resolve => {
        let finished = false;
        const finish = (exited: boolean): void => {
            if (finished) return;
            finished = true;
            clearTimeout(timer);
            process.removeListener('exit', handleExit);
            resolve(exited);
        };
        const handleExit = (): void => finish(true);
        const timer = setTimeout(() => finish(false), timeout);
        timer.unref();
        process.once('exit', handleExit);
    });
};

const stopStreamProcess = async (process: ChildProcess): Promise<void> => {
    if (process.exitCode !== null || process.signalCode !== null) return;
    await ProcessUtil.kill(process).catch(() => {});
    if (await waitStreamProcessExit(process, 2_000)) return;
    try {
        if (process.exitCode === null && process.signalCode === null) process.kill('SIGKILL');
    } catch {
        // The process may have exited between the timeout and the forced stop.
    }
    await waitStreamProcessExit(process, 1_000);
};

@injectable()
export default class StreamApiModel implements IStreamApiModel {
    private static readonly TS_VOD_HLS_SEGMENT_DURATION = 180 / (30000 / 1001);
    private static readonly ENCODED_VOD_HLS_SEGMENT_DURATION = 4;
    private static readonly VOD_HLS_SESSION_TTL = 10 * 60 * 1000;
    private static readonly VOD_HLS_CLIENT_TTL = 30 * 1000;
    private static readonly VOD_HLS_RELEASE_GRACE = 2 * 1000;
    private static readonly VOD_HLS_CLEANUP_INTERVAL = 5 * 1000;
    private static readonly VOD_HLS_VIDEO_INFO_CACHE_TTL = 5 * 1000;
    private static readonly SHARED_LIVE_STREAM_RECENT_BYTES = 512 * 1024;
    private static readonly SHARED_LIVE_STREAM_SUBSCRIBER_MAX_BUFFER = 16 * 1024 * 1024;
    private static readonly SHARED_LIVE_STREAM_STOP_GRACE = 2 * 1000;

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
    private vodHlsClients: Map<
        string,
        { session: RecordedVodHlsMuxSession | EncodedVodHlsMuxSession; lastAccess: number }
    > = new Map();
    private managedVodHlsSessions: Set<RecordedVodHlsMuxSession | EncodedVodHlsMuxSession> = new Set();
    private cleaningVodHlsSessions: WeakSet<RecordedVodHlsMuxSession | EncodedVodHlsMuxSession> = new WeakSet();
    private vodHlsCleanupPromises: Map<string, Promise<void>> = new Map();
    private recordedVodHlsVideoInfoCache: Map<apid.VideoFileId, RecordedVODHLSVideoInfoCacheEntry> = new Map();
    private sharedLiveStreams: Map<string, SharedLiveStreamSlot> = new Map();

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
        const cleanupTimer = setInterval(() => this.cleanupVodHlsSessions(), StreamApiModel.VOD_HLS_CLEANUP_INTERVAL);
        cleanupTimer.unref();
    }

    /**
     * m2ts 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        return this.startSharedLiveMpegTsStream('m2ts', option);
    }

    /**
     * m2ts Low Latency (mpegts.js 用) 形式の live streaming を開始する
     * @param option: apid.LiveStreamOption
     * @return Promise<StreamResponse>
     */
    public async startLiveM2TsLLStream(option: apid.LiveStreamOption): Promise<StreamResponse> {
        return this.startSharedLiveMpegTsStream('m2tsll', option);
    }

    private async startSharedLiveMpegTsStream(
        type: SharedLiveStreamType,
        option: apid.LiveStreamOption,
    ): Promise<StreamResponse> {
        const key = this.createSharedLiveStreamKey(type, option);
        let slot = this.sharedLiveStreams.get(key);

        if (typeof slot === 'undefined') {
            const newSlot = {} as SharedLiveStreamSlot;
            newSlot.entry = null;
            newSlot.promise = this.createSharedLiveStream(type, option, key, newSlot);
            slot = newSlot;
            this.sharedLiveStreams.set(key, slot);
        }

        let entry: SharedLiveStreamEntry;
        try {
            entry = await slot.promise;
        } catch (err) {
            if (this.sharedLiveStreams.get(key) === slot) {
                this.sharedLiveStreams.delete(key);
            }
            throw err;
        }

        if (entry.closed === true) {
            if (this.sharedLiveStreams.get(key) === slot) {
                this.sharedLiveStreams.delete(key);
            }
            return this.startSharedLiveMpegTsStream(type, option);
        }

        if (entry.stopTimer !== null) {
            clearTimeout(entry.stopTimer);
            entry.stopTimer = null;
        }

        const subscriber = new PassThrough({ highWaterMark: 4 * 1024 * 1024 });
        subscriber.on('error', () => {});
        entry.subscribers.add(subscriber);
        for (const chunk of entry.recentChunks) {
            subscriber.write(chunk);
        }

        let isReleased = false;
        const release = async (): Promise<void> => {
            if (isReleased === true) return;
            isReleased = true;
            entry.subscribers.delete(subscriber);
            if (subscriber.destroyed === false) subscriber.destroy();
            this.scheduleSharedLiveStreamStop(entry);
        };
        subscriber.once('close', () => {
            void release();
        });

        this.log.stream.info(
            `shared live stream subscriber joined: streamId=${entry.streamId.toString(10)}, subscribers=${entry.subscribers.size.toString(10)}`,
        );

        return {
            streamId: entry.streamId,
            stream: subscriber,
            release,
        };
    }

    private createSharedLiveStreamKey(type: SharedLiveStreamType, option: apid.LiveStreamOption): string {
        return [
            type,
            option.channelId.toString(10),
            option.mode.toString(10),
            option.quality ?? '',
            option.encoder ?? '',
            typeof option.isHevc === 'boolean' ? (option.isHevc === true ? 'hevc' : 'h264') : '',
        ].join('|');
    }

    private async createSharedLiveStream(
        type: SharedLiveStreamType,
        option: apid.LiveStreamOption,
        key: string,
        slot: SharedLiveStreamSlot,
    ): Promise<SharedLiveStreamEntry> {
        const conf = await this.getTsLiveConfig(type, option);
        const stream = await this.liveStreamProvider();
        stream.setOption(
            {
                channelId: option.channelId,
                cmd: conf.cmd,
                preprocessor: conf.preprocessor,
            },
            option.mode,
        );

        const streamId = await this.streamManageModel.start(stream);
        const source = stream.getStream();
        const entry: SharedLiveStreamEntry = {
            key,
            slot,
            streamId,
            source,
            subscribers: new Set(),
            recentChunks: [],
            recentSize: 0,
            stopTimer: null,
            closed: false,
        };
        slot.entry = entry;

        source.on('data', (value: Buffer | string) => {
            if (entry.closed === true) return;
            const chunk = Buffer.isBuffer(value) ? value : Buffer.from(value);
            entry.recentChunks.push(chunk);
            entry.recentSize += chunk.length;
            while (entry.recentSize > StreamApiModel.SHARED_LIVE_STREAM_RECENT_BYTES && entry.recentChunks.length > 1) {
                const removed = entry.recentChunks.shift();
                if (typeof removed !== 'undefined') entry.recentSize -= removed.length;
            }

            for (const subscriber of entry.subscribers) {
                subscriber.write(chunk);
                if (subscriber.writableLength > StreamApiModel.SHARED_LIVE_STREAM_SUBSCRIBER_MAX_BUFFER) {
                    this.log.stream.warn(
                        `shared live stream slow subscriber disconnected: streamId=${entry.streamId.toString(10)}`,
                    );
                    subscriber.destroy();
                }
            }
        });
        source.once('end', () => this.closeSharedLiveStream(entry));
        source.once('close', () => this.closeSharedLiveStream(entry));
        source.once('error', err => {
            this.log.stream.warn(`shared live stream source error: streamId=${streamId.toString(10)}, ${err.message}`);
            this.closeSharedLiveStream(entry, err);
        });

        this.log.stream.info(`shared live stream created: streamId=${streamId.toString(10)}, key=${key}`);
        return entry;
    }

    private scheduleSharedLiveStreamStop(entry: SharedLiveStreamEntry): void {
        if (entry.closed === true || entry.subscribers.size > 0 || entry.stopTimer !== null) return;

        entry.stopTimer = setTimeout(() => {
            entry.stopTimer = null;
            if (entry.closed === true || entry.subscribers.size > 0) return;

            entry.closed = true;
            if (this.sharedLiveStreams.get(entry.key) === entry.slot) {
                this.sharedLiveStreams.delete(entry.key);
            }
            this.log.stream.info(
                `shared live stream stopped after last subscriber: streamId=${entry.streamId.toString(10)}`,
            );
            void this.streamManageModel.stop(entry.streamId, true).catch(err => {
                this.log.stream.warn(
                    `stop shared live stream failed: streamId=${entry.streamId.toString(10)}, ${err.message}`,
                );
            });
        }, StreamApiModel.SHARED_LIVE_STREAM_STOP_GRACE);
    }

    private closeSharedLiveStream(entry: SharedLiveStreamEntry, error?: Error): void {
        if (entry.closed === true && entry.subscribers.size === 0) return;
        entry.closed = true;
        if (entry.stopTimer !== null) {
            clearTimeout(entry.stopTimer);
            entry.stopTimer = null;
        }
        if (this.sharedLiveStreams.get(entry.key) === entry.slot) {
            this.sharedLiveStreams.delete(entry.key);
        }
        for (const subscriber of entry.subscribers) {
            if (typeof error === 'undefined') subscriber.end();
            else subscriber.destroy(error);
        }
        entry.subscribers.clear();
        entry.recentChunks = [];
        entry.recentSize = 0;
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

    public async getRecordedVODHLSPlaylist(
        option: apid.RecordedStreanOption,
        startupBufferSegments: number = 1,
    ): Promise<string> {
        const videoInfo = await this.getRecordedVODHLSVideoInfo(option.videoFileId);
        const isEncodedVideo = await this.isEncodedVideo(option.videoFileId);
        const streamOption = isEncodedVideo === true ? this.resolveEncodedVodHlsSubtitleOption(option) : option;
        const segmentDuration = this.getRecordedVODHLSSegmentDurationByType(isEncodedVideo);
        const segmentCount = Math.max(1, Math.ceil(videoInfo.duration / segmentDuration));
        const startPosition = Math.min(
            Math.max(Number.isFinite(option.playPosition) ? option.playPosition : 0, 0),
            Math.max(videoInfo.duration - 0.001, 0),
        );
        const startSequence = Math.min(Math.floor(startPosition / segmentDuration), segmentCount - 1);
        const targetDuration = Math.ceil(segmentDuration);
        const params = this.createRecordedVODHLSQuery(streamOption);
        const lines = [
            '#EXTM3U',
            '#EXT-X-VERSION:6',
            '#EXT-X-PLAYLIST-TYPE:VOD',
            `#EXT-X-TARGETDURATION:${targetDuration}`,
            '#EXT-X-MEDIA-SEQUENCE:0',
            `#EXT-X-START:TIME-OFFSET=${startPosition.toFixed(6)},PRECISE=YES`,
        ];

        const prepareSegment = Math.min(Math.max(Math.trunc(startupBufferSegments), 1), 3, segmentCount) - 1;
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
            this.registerRecordedVODHLSClient(streamOption.vodSessionId, session);
            if (prepareSegment > 0) await session.prepareUntil(startSequence + prepareSegment);
        } else {
            const session = await this.getRecordedVodHlsSession(streamOption, videoInfo, segmentDuration);
            this.registerRecordedVODHLSClient(streamOption.vodSessionId, session);
            if (prepareSegment > 0) await session.prepareUntil(startSequence + prepareSegment);
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
            const profileKey = this.createRecordedVodHlsSessionProfileKey(
                streamOption,
                videoInfo.filePath,
                segmentDuration,
            );
            let session =
                typeof option.vodSessionId === 'undefined'
                    ? undefined
                    : this.vodHlsClients.get(option.vodSessionId)?.session;
            if (!(session instanceof EncodedVodHlsMuxSession) || session.profileKey !== profileKey) {
                session = await this.findReusableRecordedVodHlsSession(
                    this.encodedVodHlsSessions.values(),
                    profileKey,
                    sequence,
                );
            }
            if (typeof session === 'undefined') {
                session = await this.getEncodedVodHlsSession(streamOption, videoInfo, segmentDuration);
            }
            if (await session.shouldRebase(sequence)) {
                const playPosition = sequence * segmentDuration;
                session = await this.getEncodedVodHlsSession(
                    {
                        ...streamOption,
                        playPosition: playPosition,
                    },
                    videoInfo,
                    segmentDuration,
                );
                this.log.stream.info(
                    `rebase recorded VOD HLS encoded session: videoFileId=${option.videoFileId.toString(10)}, ` +
                        `sequence=${sequence.toString(10)}, position=${playPosition.toFixed(3)}`,
                );
            }
            this.registerRecordedVODHLSClient(streamOption.vodSessionId, session);
            const buffer = await session.getSegment(sequence);

            return {
                process: null,
                processes: [],
                cleanup: async () => {},
                stream: Readable.from(buffer),
            };
        }

        const profileKey = this.createRecordedVodHlsSessionProfileKey(option, videoInfo.filePath, segmentDuration);
        let session =
            typeof option.vodSessionId === 'undefined'
                ? undefined
                : this.vodHlsClients.get(option.vodSessionId)?.session;
        if (!(session instanceof RecordedVodHlsMuxSession) || session.profileKey !== profileKey) {
            session = await this.findReusableRecordedVodHlsSession(
                this.recordedVodHlsSessions.values(),
                profileKey,
                sequence,
            );
        }
        if (typeof session === 'undefined') {
            session = await this.getRecordedVodHlsSession(option, videoInfo, segmentDuration);
        }
        if (await session.shouldRebase(sequence)) {
            const playPosition = sequence * segmentDuration;
            session = await this.getRecordedVodHlsSession(
                {
                    ...option,
                    playPosition: playPosition,
                },
                videoInfo,
                segmentDuration,
            );
            this.log.stream.info(
                `rebase recorded VOD HLS TS session: videoFileId=${option.videoFileId.toString(10)}, ` +
                    `sequence=${sequence.toString(10)}, position=${playPosition.toFixed(3)}`,
            );
        }
        this.registerRecordedVODHLSClient(option.vodSessionId, session);
        const buffer = await session.getSegment(sequence);

        return {
            process: null,
            processes: [],
            cleanup: async () => {},
            stream: Readable.from(buffer),
        };
    }

    public keepRecordedVODHLSSession(sessionId: string): void {
        const client = this.vodHlsClients.get(sessionId);
        if (typeof client === 'undefined') return;
        client.lastAccess = Date.now();
        client.session.keep();
    }

    public releaseRecordedVODHLSSession(sessionId: string): void {
        const client = this.vodHlsClients.get(sessionId);
        if (typeof client === 'undefined') return;
        this.vodHlsClients.delete(sessionId);
        const session = client.session;
        const timer = setTimeout(() => {
            if (this.hasVodHlsClient(session) === false) this.cleanupVodHlsSession(session);
        }, StreamApiModel.VOD_HLS_RELEASE_GRACE);
        timer.unref();
    }

    private registerRecordedVODHLSClient(
        sessionId: string | undefined,
        session: RecordedVodHlsMuxSession | EncodedVodHlsMuxSession,
    ): void {
        if (typeof sessionId === 'undefined' || sessionId.length === 0 || sessionId.length > 128) return;
        const current = this.vodHlsClients.get(sessionId)?.session;
        if (current?.profileKey === session.profileKey && current.startSequence > session.startSequence) {
            // A request for the old playback position can finish after a large
            // forward seek. Serve that request, but do not let it move the client
            // association backwards and make following requests rebase again.
            session.keep();
            return;
        }
        this.vodHlsClients.set(sessionId, { session: session, lastAccess: Date.now() });
        this.managedVodHlsSessions.add(session);
        session.keep();
    }

    private hasVodHlsClient(session: RecordedVodHlsMuxSession | EncodedVodHlsMuxSession): boolean {
        for (const client of this.vodHlsClients.values()) {
            if (client.session === session) return true;
        }
        return false;
    }

    private async findReusableRecordedVodHlsSession<T extends RecordedVodHlsMuxSession | EncodedVodHlsMuxSession>(
        sessions: Iterable<T>,
        profileKey: string,
        sequence: number,
    ): Promise<T | undefined> {
        const candidates = [...sessions]
            .filter(session => session.profileKey === profileKey)
            .sort((left, right) => right.lastAccess - left.lastAccess);
        for (const session of candidates) {
            if ((await session.shouldRebase(sequence)) === false) return session;
        }

        return undefined;
    }

    private cleanupVodHlsSession(session: RecordedVodHlsMuxSession | EncodedVodHlsMuxSession): void {
        if (this.cleaningVodHlsSessions.has(session)) return;
        this.cleaningVodHlsSessions.add(session);
        const cleanupKeys: string[] = [];
        for (const [key, value] of this.recordedVodHlsSessions.entries()) {
            if (value === session) {
                this.recordedVodHlsSessions.delete(key);
                cleanupKeys.push(`recorded:${key}`);
            }
        }
        for (const [key, value] of this.encodedVodHlsSessions.entries()) {
            if (value === session) {
                this.encodedVodHlsSessions.delete(key);
                cleanupKeys.push(`encoded:${key}`);
            }
        }
        for (const [sessionId, client] of this.vodHlsClients.entries()) {
            if (client.session === session) this.vodHlsClients.delete(sessionId);
        }
        this.managedVodHlsSessions.delete(session);
        const cleanupPromise = session.cleanup().catch(() => {});
        for (const key of cleanupKeys) {
            this.vodHlsCleanupPromises.set(key, cleanupPromise);
            void cleanupPromise.finally(() => {
                if (this.vodHlsCleanupPromises.get(key) === cleanupPromise) {
                    this.vodHlsCleanupPromises.delete(key);
                }
            });
        }
    }

    private cleanupVodHlsSessions(): void {
        const now = Date.now();
        for (const [sessionId, client] of this.vodHlsClients.entries()) {
            if (now - client.lastAccess > StreamApiModel.VOD_HLS_CLIENT_TTL) {
                this.vodHlsClients.delete(sessionId);
            }
        }
        for (const session of [...this.managedVodHlsSessions]) {
            if (this.hasVodHlsClient(session) === false) this.cleanupVodHlsSession(session);
        }
        this.cleanupRecordedVodHlsSessions();
        this.cleanupEncodedVodHlsSessions();
    }

    private async getRecordedVodHlsSession(
        option: apid.RecordedStreanOption,
        videoInfo: RecordedVODHLSVideoInfo,
        segmentDuration: number,
    ): Promise<RecordedVodHlsMuxSession> {
        this.cleanupRecordedVodHlsSessions();

        const profileKey = this.createRecordedVodHlsSessionProfileKey(option, videoInfo.filePath, segmentDuration);
        const sessionKey = this.createRecordedVodHlsSessionKey(option, profileKey, segmentDuration);
        await this.vodHlsCleanupPromises.get(`recorded:${sessionKey}`);
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
        const segmentCount = Math.max(1, Math.ceil(videoInfo.duration / segmentDuration));
        const requestedStartSequence = Math.min(
            Math.floor(
                Math.min(Math.max(option.playPosition, 0), Math.max(videoInfo.duration - 0.001, 0)) / segmentDuration,
            ),
            segmentCount - 1,
        );
        // A PCR points at an accurate transport-stream time, but not necessarily at an
        // MPEG-2 sequence header from which a hardware decoder can initialize. Start one
        // complete HLS segment earlier so the decoder sees the preceding GOP/header. The
        // muxer keeps the earlier sequence number and timestamp, therefore the requested
        // segment and timed metadata remain aligned instead of shifting by the preroll.
        const startSequence = Math.max(0, requestedStartSequence - RECORDED_VOD_HLS_TS_PREROLL_SEGMENTS);
        const startPosition = startSequence * segmentDuration;
        const command = WatchStreamProfileUtil.buildRecordedVodHlsContinuousCommand(config, {
            qualityName: option.quality,
            encoder: option.encoder,
            isHevc: option.isHevc,
            start: startPosition,
        });

        const pcrStartByte = await findMpegTsByteOffset(videoInfo.filePath, startPosition);
        const estimatedByte = Math.floor((videoInfo.size * startPosition) / videoInfo.duration);
        const startByte = pcrStartByte ?? Math.max(0, estimatedByte - (estimatedByte % 188));
        this.log.stream.info(
            `recorded VOD HLS TS seek: position=${(requestedStartSequence * segmentDuration).toFixed(3)}, ` +
                `sourcePosition=${startPosition.toFixed(3)}, byte=${startByte.toString(10)}, ` +
                `source=${pcrStartByte === null ? 'estimated' : 'pcr'}`,
        );
        const session = new RecordedVodHlsMuxSession({
            profileKey: profileKey,
            config: config,
            videoInfo: videoInfo,
            segmentDuration: segmentDuration,
            segmentCount: segmentCount,
            startByte: startByte,
            startPosition: startPosition,
            startSequence: startSequence,
            preprocessor: preprocessor,
            command: command,
            log: this.log,
            temporaryDir: config.temporaryDir ?? os.tmpdir(),
        });

        this.recordedVodHlsSessions.set(sessionKey, session);
        session.prefetch(requestedStartSequence);

        return session;
    }

    private async getEncodedVodHlsSession(
        option: apid.RecordedStreanOption,
        videoInfo: RecordedVODHLSVideoInfo,
        segmentDuration: number,
    ): Promise<EncodedVodHlsMuxSession> {
        this.cleanupEncodedVodHlsSessions();

        const profileKey = this.createRecordedVodHlsSessionProfileKey(option, videoInfo.filePath, segmentDuration);
        const sessionKey = this.createRecordedVodHlsSessionKey(option, profileKey, segmentDuration);
        await this.vodHlsCleanupPromises.get(`encoded:${sessionKey}`);
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
        const startSequence = Math.min(
            Math.floor(
                Math.min(Math.max(option.playPosition, 0), Math.max(videoInfo.duration - 0.001, 0)) / segmentDuration,
            ),
            segmentCount - 1,
        );
        const startPosition = startSequence * segmentDuration;
        const session = new EncodedVodHlsMuxSession({
            profileKey: profileKey,
            config: this.configure.getConfig(),
            videoInfo: videoInfo,
            segmentDuration: segmentDuration,
            segmentCount: segmentCount,
            startPosition: startPosition,
            startSequence: startSequence,
            qualityName: option.quality,
            encoder: option.encoder,
            isHevc: option.isHevc,
            subtitleIndex: option.subtitleIndex,
            subtitlePath: preparedSubtitlePath,
            subtitleStyle: {
                sizePercent: option.subtitleSize ?? 100,
                opacityPercent: option.subtitleOpacity ?? 100,
                outlineSizePercent: option.subtitleOutlineSize ?? 100,
                outlineOpacityPercent: option.subtitleOutlineOpacity ?? 100,
            },
            log: this.log,
            temporaryDir: this.configure.getConfig().temporaryDir ?? os.tmpdir(),
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

    private createRecordedVodHlsSessionProfileKey(
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
            option.subtitleSize ?? 100,
            option.subtitleOpacity ?? 100,
            option.subtitleOutlineSize ?? 100,
            option.subtitleOutlineOpacity ?? 100,
        ].join('|');
    }

    private createRecordedVodHlsSessionKey(
        option: apid.RecordedStreanOption,
        profileKey: string,
        segmentDuration: number,
    ): string {
        return `${profileKey}|${Math.max(0, Math.floor(option.playPosition / segmentDuration)).toString(10)}`;
    }

    private cleanupRecordedVodHlsSessions(): void {
        const now = Date.now();
        for (const session of this.recordedVodHlsSessions.values()) {
            if (now - session.lastAccess > StreamApiModel.VOD_HLS_SESSION_TTL) {
                this.cleanupVodHlsSession(session);
            }
        }
    }

    private cleanupEncodedVodHlsSessions(): void {
        const now = Date.now();
        for (const session of this.encodedVodHlsSessions.values()) {
            if (now - session.lastAccess > StreamApiModel.VOD_HLS_SESSION_TTL) {
                this.cleanupVodHlsSession(session);
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
        const now = Date.now();
        const cached = this.recordedVodHlsVideoInfoCache.get(videoFileId);
        if (typeof cached !== 'undefined' && cached.expiresAt > now) {
            return cached.promise;
        }

        const promise = this.loadRecordedVODHLSVideoInfo(videoFileId);
        const entry = {
            expiresAt: now + StreamApiModel.VOD_HLS_VIDEO_INFO_CACHE_TTL,
            promise,
        };
        this.recordedVodHlsVideoInfoCache.set(videoFileId, entry);
        promise.catch(() => {
            if (this.recordedVodHlsVideoInfoCache.get(videoFileId) === entry) {
                this.recordedVodHlsVideoInfoCache.delete(videoFileId);
            }
        });

        return promise;
    }

    private async loadRecordedVODHLSVideoInfo(videoFileId: apid.VideoFileId): Promise<RecordedVODHLSVideoInfo> {
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
            size: (await fs.promises.stat(filePath)).size,
            videoCodecName: videoInfo.videoCodecName,
            videoPixelFormat: videoInfo.videoPixelFormat,
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
        if (typeof option.subtitleSize !== 'undefined') {
            params.set('subtitleSize', option.subtitleSize.toString(10));
        }
        if (typeof option.subtitleOpacity !== 'undefined') {
            params.set('subtitleOpacity', option.subtitleOpacity.toString(10));
        }
        if (typeof option.subtitleOutlineSize !== 'undefined') {
            params.set('subtitleOutlineSize', option.subtitleOutlineSize.toString(10));
        }
        if (typeof option.subtitleOutlineOpacity !== 'undefined') {
            params.set('subtitleOutlineOpacity', option.subtitleOutlineOpacity.toString(10));
        }
        if (typeof option.vodSessionId !== 'undefined') {
            params.set('vodSessionId', option.vodSessionId);
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
