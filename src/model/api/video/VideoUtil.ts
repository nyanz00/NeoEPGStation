import { execFile, spawn } from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
import { analyzeMpegTsTime } from '../../../util/MpegTsTimeUtil';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import IVideoUtil, {
    PreparedSubtitleInfo,
    SubtitleTextRange,
    VideoInfo,
    VideoRecordingTimeInfo,
    VideoSubtitleInfo,
} from './IVideoUtil';

interface PreparedSubtitleEntry {
    filePath: string;
    createdAt: number;
}

@injectable()
export default class VideoUtil implements IVideoUtil {
    private static readonly PREPARED_SUBTITLE_TTL = 60 * 60 * 1000;

    private config: IConfigFile;
    private preparedSubtitleRoot: string;
    private videoFileDB: IVideoFileDB;
    private preparedSubtitles: Map<string, PreparedSubtitleEntry> = new Map();
    private preparedSubtitleKeysBySource: Map<string, string> = new Map();
    private preparingSubtitlesBySource: Map<string, Promise<PreparedSubtitleInfo>> = new Map();

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
    ) {
        this.config = configuration.getConfig();
        this.preparedSubtitleRoot = path.join(this.config.temporaryDir ?? os.tmpdir(), 'epgstation-vodhls-subtitles');
        this.videoFileDB = videoFileDB;
        this.cleanupPreparedSubtitleRoot();
    }

    public async getFullFilePathFromId(videoFileId: apid.VideoFileId): Promise<string | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null) {
            return null;
        }

        const parentDir = this.getParentDirPath(video.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, video.filePath);
    }

    public getFullFilePathFromVideoFile(videoFile: VideoFile): string | null {
        const parentDir = this.getParentDirPath(videoFile.parentDirectoryName);

        return parentDir === null ? null : path.join(parentDir, videoFile.filePath);
    }

    public getParentDirPath(name: string): string | null {
        if (name === 'tmp' && typeof this.config.recordedTmp !== 'undefined') {
            return this.config.recordedTmp;
        }

        for (const r of this.config.recorded) {
            if (r.name === name) {
                return r.path;
            }
        }

        return null;
    }

    public getInfo(filePath: string): Promise<VideoInfo> {
        return new Promise<VideoInfo>((resolve, reject) => {
            execFile(
                this.config.ffprobe,
                [
                    '-v',
                    '0',
                    '-select_streams',
                    'v:0',
                    '-show_entries',
                    'format=duration,size,bit_rate:stream=codec_name,pix_fmt',
                    '-of',
                    'json',
                    filePath,
                ],
                (err, stdout) => {
                    if (err) {
                        reject(err);

                        return;
                    }

                    try {
                        const result = <any>JSON.parse(stdout);
                        const videoStream = Array.isArray(result.streams) ? result.streams[0] : undefined;
                        resolve({
                            duration: parseFloat(result.format.duration),
                            size: parseInt(result.format.size, 10),
                            bitRate: parseFloat(result.format.bit_rate),
                            videoCodecName:
                                typeof videoStream?.codec_name === 'string' ? videoStream.codec_name : undefined,
                            videoPixelFormat:
                                typeof videoStream?.pix_fmt === 'string' ? videoStream.pix_fmt : undefined,
                        });
                    } catch (err: any) {
                        reject(err);
                    }
                },
            );
        });
    }

    public async getMpegTsRecordingTime(filePath: string): Promise<VideoRecordingTimeInfo | null> {
        const timeInfo = await analyzeMpegTsTime(filePath);
        if (timeInfo === null) {
            return null;
        }

        let duration = timeInfo.pcrDuration;
        try {
            const videoInfo = await this.getInfo(filePath);
            if (Number.isFinite(videoInfo.duration) === true && videoInfo.duration > 0) {
                // KonomiTVと同様、通常はffprobeの動画長を使用し、取得できないTSではPCR差分へフォールバックする。
                duration = videoInfo.duration;
            }
        } catch {
            // ffprobeが録画中ファイルを解析できない場合も、TS内PCRから算出した長さは利用できる。
        }
        if (duration === null || Number.isFinite(duration) === false || duration <= 0) {
            return null;
        }

        return {
            startAt: timeInfo.startAt,
            endAt: timeInfo.startAt + duration * 1000,
            duration,
        };
    }

    public getMpegTsServiceId(filePath: string): Promise<number | null> {
        return new Promise<number | null>((resolve, reject) => {
            execFile(
                this.config.ffprobe,
                ['-v', 'error', '-show_programs', '-of', 'json', filePath],
                { maxBuffer: 4 * 1024 * 1024 },
                (err, stdout) => {
                    if (err) {
                        reject(err);

                        return;
                    }

                    try {
                        const result = <any>JSON.parse(stdout);
                        const programs: any[] = Array.isArray(result.programs) ? result.programs : [];
                        const program =
                            programs.find(item =>
                                Array.isArray(item.streams)
                                    ? item.streams.some((stream: any) => stream.codec_type === 'video')
                                    : false,
                            ) ?? programs[0];
                        const serviceId = Number(program?.program_id);
                        resolve(Number.isInteger(serviceId) === true && serviceId >= 0 ? serviceId : null);
                    } catch (err: any) {
                        reject(err);
                    }
                },
            );
        });
    }

    public getSubtitles(filePath: string): Promise<VideoSubtitleInfo[]> {
        return new Promise<VideoSubtitleInfo[]>((resolve, reject) => {
            execFile(
                this.config.ffprobe,
                ['-v', '0', '-select_streams', 's', '-show_streams', '-of', 'json', filePath],
                (err, stdout) => {
                    if (err) {
                        reject(err);

                        return;
                    }

                    try {
                        const result = <any>JSON.parse(stdout);
                        const streams: any[] = Array.isArray(result.streams) ? result.streams : [];
                        resolve(
                            streams.map((stream, subtitleIndex) => {
                                const language =
                                    typeof stream.tags?.language === 'string' ? stream.tags.language : undefined;
                                const title = typeof stream.tags?.title === 'string' ? stream.tags.title : undefined;
                                const codecName = typeof stream.codec_name === 'string' ? stream.codec_name : undefined;
                                const displayParts = [`字幕 ${subtitleIndex + 1}`, title, language, codecName].filter(
                                    (item): item is string => typeof item === 'string' && item.length > 0,
                                );

                                return {
                                    subtitleIndex: subtitleIndex,
                                    streamIndex:
                                        typeof stream.index === 'number'
                                            ? stream.index
                                            : parseInt(stream.index ?? subtitleIndex, 10),
                                    codecName: codecName,
                                    language: language,
                                    title: title,
                                    isDefault: stream.disposition?.default === 1,
                                    isForced: stream.disposition?.forced === 1,
                                    displayName: displayParts.join(' / '),
                                };
                            }),
                        );
                    } catch (err: any) {
                        reject(err);
                    }
                },
            );
        });
    }

    public async prepareSubtitle(filePath: string, subtitleIndex: number): Promise<PreparedSubtitleInfo> {
        if (subtitleIndex < 0 || Number.isFinite(subtitleIndex) === false) {
            throw new Error('SubtitleIndexIsInvalid');
        }

        this.cleanupPreparedSubtitles();

        await fs.promises.mkdir(this.preparedSubtitleRoot, { recursive: true });

        const sourceStat = await fs.promises.stat(filePath);
        const sourceKey = [
            path.resolve(filePath),
            sourceStat.size.toString(10),
            sourceStat.mtimeMs.toString(10),
            subtitleIndex.toString(10),
        ].join('|');
        const cachedKey = this.preparedSubtitleKeysBySource.get(sourceKey);
        if (typeof cachedKey !== 'undefined') {
            const cachedPath = this.getPreparedSubtitlePath(cachedKey);
            if (typeof cachedPath !== 'undefined') {
                return { key: cachedKey, filePath: cachedPath };
            }
            this.preparedSubtitleKeysBySource.delete(sourceKey);
        }

        const preparing = this.preparingSubtitlesBySource.get(sourceKey);
        if (typeof preparing !== 'undefined') return preparing;

        const promise = this.createPreparedSubtitle(filePath, subtitleIndex, sourceKey);
        this.preparingSubtitlesBySource.set(sourceKey, promise);
        try {
            return await promise;
        } finally {
            if (this.preparingSubtitlesBySource.get(sourceKey) === promise) {
                this.preparingSubtitlesBySource.delete(sourceKey);
            }
        }
    }

    private async createPreparedSubtitle(
        filePath: string,
        subtitleIndex: number,
        sourceKey: string,
    ): Promise<PreparedSubtitleInfo> {
        const key = crypto.randomBytes(16).toString('hex');
        const outputPath = path.join(this.preparedSubtitleRoot, `${key}.ass`);
        const args = [
            '-hide_banner',
            '-loglevel',
            'warning',
            '-y',
            '-i',
            filePath,
            '-map',
            `0:s:${subtitleIndex.toString(10)}`,
            '-c:s',
            'ass',
            outputPath,
        ];

        await new Promise<void>((resolve, reject) => {
            execFile(this.config.ffmpeg, args, (err, _stdout, stderr) => {
                if (err) {
                    reject(new Error(`SubtitlePrepareFailed: ${stderr}`));

                    return;
                }

                resolve();
            });
        });
        const stat = await fs.promises.stat(outputPath);
        if (stat.size <= 0) {
            await fs.promises.rm(outputPath, { force: true }).catch(() => {});
            throw new Error('PreparedSubtitleIsEmpty');
        }

        this.preparedSubtitles.set(key, {
            filePath: outputPath,
            createdAt: Date.now(),
        });
        this.preparedSubtitleKeysBySource.set(sourceKey, key);

        return {
            key: key,
            filePath: outputPath,
        };
    }

    public async getSubtitleText(filePath: string, subtitleIndex: number, range?: SubtitleTextRange): Promise<string> {
        if (subtitleIndex < 0 || Number.isFinite(subtitleIndex) === false) {
            throw new Error('SubtitleIndexIsInvalid');
        }
        if (
            range !== undefined &&
            (Number.isFinite(range.startAt) === false ||
                range.startAt < 0 ||
                Number.isFinite(range.duration) === false ||
                range.duration <= 0 ||
                range.duration > 60 * 60)
        ) {
            throw new Error('SubtitleTextRangeIsInvalid');
        }

        const args = [
            '-hide_banner',
            '-loglevel',
            'warning',
            ...(range !== undefined && range.startAt > 0 ? ['-copyts', '-ss', range.startAt.toFixed(3)] : []),
            '-i',
            filePath,
            ...(range !== undefined ? ['-t', range.duration.toFixed(3)] : []),
            '-map',
            `0:s:${subtitleIndex.toString(10)}`,
            '-c:s',
            'ass',
            '-f',
            'ass',
            'pipe:1',
        ];

        return new Promise<string>((resolve, reject) => {
            const process = spawn(this.config.ffmpeg, args, { windowsHide: true });
            const stdout: Buffer[] = [];
            const stderr: Buffer[] = [];
            process.stdout?.on('data', data => stdout.push(Buffer.from(data)));
            process.stderr?.on('data', data => stderr.push(Buffer.from(data)));
            process.on('error', reject);
            process.on('exit', code => {
                if (code !== 0) {
                    reject(new Error(`SubtitleReadFailed: ${Buffer.concat(stderr).toString('utf8')}`));

                    return;
                }

                const subtitleText = Buffer.concat(stdout).toString('utf8');
                if (subtitleText.length === 0) {
                    reject(new Error('SubtitleReadResultIsEmpty'));

                    return;
                }

                resolve(subtitleText);
            });
        });
    }

    public getPreparedSubtitlePath(key: string): string | undefined {
        this.cleanupPreparedSubtitles();

        const prepared = this.preparedSubtitles.get(key);
        if (typeof prepared === 'undefined') {
            return undefined;
        }

        if (fs.existsSync(prepared.filePath) === false) {
            this.preparedSubtitles.delete(key);
            this.deletePreparedSubtitleSourceKeys(key);

            return undefined;
        }

        prepared.createdAt = Date.now();

        return prepared.filePath;
    }

    private cleanupPreparedSubtitleRoot(): void {
        fs.rmSync(this.preparedSubtitleRoot, { force: true, recursive: true });
    }

    private cleanupPreparedSubtitles(): void {
        const now = Date.now();
        for (const [key, prepared] of this.preparedSubtitles.entries()) {
            if (
                now - prepared.createdAt > VideoUtil.PREPARED_SUBTITLE_TTL ||
                fs.existsSync(prepared.filePath) === false
            ) {
                fs.promises.rm(prepared.filePath, { force: true }).catch(() => {});
                this.preparedSubtitles.delete(key);
                this.deletePreparedSubtitleSourceKeys(key);
            }
        }
    }

    private deletePreparedSubtitleSourceKeys(preparedKey: string): void {
        for (const [sourceKey, key] of this.preparedSubtitleKeysBySource.entries()) {
            if (key === preparedKey) this.preparedSubtitleKeysBySource.delete(sourceKey);
        }
    }
}
