import { execFile } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../api';
import VideoFile from '../../db/entities/VideoFile';
import VideoFileTsInfo from '../../db/entities/VideoFileTsInfo';
import Recorded from '../../db/entities/Recorded';
import Channel from '../../db/entities/Channel';
import StrUtil from '../../util/StrUtil';
import IDBOperator from '../db/IDBOperator';
import IVideoFileDB from '../db/IVideoFileDB';
import IConfigFile from '../IConfigFile';
import IConfiguration from '../IConfiguration';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import ITsInfoAnalyzer from '../recorded/ts/ITsInfoAnalyzer';
import IVideoUtil from '../api/video/IVideoUtil';
import IVideoAnalysisModel, { VideoAnalysis, VideoStreamAnalysis } from './IVideoAnalysisModel';

interface ProbeResult {
    format?: Record<string, unknown>;
    streams?: Array<Record<string, any>>;
}

@injectable()
export default class VideoAnalysisModel implements IVideoAnalysisModel {
    private readonly config: IConfigFile;
    private readonly pending = new Map<number, boolean>();
    private running = false;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IDBOperator') private readonly db: IDBOperator,
        @inject('IVideoFileDB') private readonly videoFileDB: IVideoFileDB,
        @inject('IVideoUtil') private readonly videoUtil: IVideoUtil,
        @inject('ITsInfoAnalyzer') private readonly tsAnalyzer: ITsInfoAnalyzer,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.config = configuration.getConfig();
        this.log = logger.getLogger();
    }

    private readonly log: ILogger;

    public enqueue(videoFileId: apid.VideoFileId, includeEit = false): void {
        this.pending.set(videoFileId, (this.pending.get(videoFileId) ?? false) || includeEit);
        void this.pump();
    }

    private async pump(): Promise<void> {
        if (this.running) return;
        this.running = true;
        try {
            while (this.pending.size > 0) {
                const first = this.pending.entries().next().value as [number, boolean] | undefined;
                if (first === undefined) break;
                this.pending.delete(first[0]);
                await this.get(first[0], false, first[1]).catch(err => {
                    this.log.system.warn(`video analysis failed: videoFileId=${first[0]} ${String(err)}`);
                });
            }
        } finally {
            this.running = false;
        }
    }

    public async get(videoFileId: apid.VideoFileId, force = false, includeEit = false): Promise<VideoAnalysis> {
        let video = await this.videoFileDB.findId(videoFileId);
        if (video === null) throw new Error('VideoFileIsNull');
        const filePath = this.videoUtil.getFullFilePathFromVideoFile(video);
        if (filePath === null) throw new Error('VideoFilePathIsNull');
        const stat = await fs.promises.stat(filePath);
        const mtime = Math.trunc(stat.mtimeMs);
        const valid =
            force === false &&
            Number(video.analyzedSize) === stat.size &&
            Number(video.analyzedMtime) === mtime &&
            video.analyzedAt !== null &&
            video.analysisError === null;

        if (!valid) {
            try {
                const probe = await this.probe(filePath);
                const streams = this.mapStreams(probe.streams ?? []);
                const primaryVideo = streams.find(stream => stream.type === 'video');
                const format = probe.format ?? {};
                const connection = await this.db.getConnection();
                await connection.getRepository(VideoFile).update(
                    { id: videoFileId },
                    {
                        size: stat.size,
                        duration: this.number(format.duration),
                        startTime: this.number(format.start_time),
                        formatName: this.string(format.format_long_name) ?? this.string(format.format_name),
                        videoCodec: primaryVideo?.codec ?? null,
                        videoProfile: primaryVideo?.profile ?? null,
                        width: primaryVideo?.width ?? null,
                        height: primaryVideo?.height ?? null,
                        frameRate: primaryVideo?.frameRate ?? null,
                        pixelFormat: primaryVideo?.pixelFormat ?? null,
                        bitDepth: primaryVideo?.bitDepth ?? null,
                        hdr: primaryVideo?.hdr ?? null,
                        bitRate: this.number(format.bit_rate),
                        streamInfo: JSON.stringify(streams),
                        analyzedSize: stat.size,
                        analyzedMtime: mtime,
                        analyzedAt: Date.now(),
                        analysisError: null,
                    },
                );
                video = (await this.videoFileDB.findId(videoFileId))!;
            } catch (err) {
                const connection = await this.db.getConnection();
                await connection.getRepository(VideoFile).update(
                    { id: videoFileId },
                    {
                        analyzedSize: stat.size,
                        analyzedMtime: mtime,
                        analyzedAt: Date.now(),
                        analysisError: String(err),
                    },
                );
                video = (await this.videoFileDB.findId(videoFileId))!;
            }
        }

        if (path.extname(filePath).toLowerCase() === '.ts' || path.extname(filePath).toLowerCase() === '.m2ts') {
            await this.ensureTsInfo(videoFileId, filePath, stat.size, mtime, force, includeEit);
        }
        return await this.toResult(video);
    }

    private async ensureTsInfo(
        videoFileId: number,
        filePath: string,
        size: number,
        mtime: number,
        force: boolean,
        includeEit: boolean,
    ): Promise<void> {
        const connection = await this.db.getConnection();
        const repo = connection.getRepository(VideoFileTsInfo);
        const cached = await repo.findOne({ where: { videoFileId } });
        if (
            !force &&
            cached !== null &&
            Number(cached.analyzedSize) === size &&
            Number(cached.analyzedMtime) === mtime &&
            cached.analysisError === null &&
            (includeEit === false || cached.eventId !== null)
        )
            return;
        try {
            const currentVideo = await this.videoFileDB.findId(videoFileId);
            const recorded =
                currentVideo === null
                    ? null
                    : await connection.getRepository(Recorded).findOne({ where: { id: currentVideo.recordedId } });
            const channel =
                recorded === null
                    ? null
                    : await connection.getRepository(Channel).findOne({ where: { id: recorded.channelId } });
            const info = await this.tsAnalyzer.analyze(filePath, {
                includeEit,
                maxReadBytes: includeEit ? 64 * 1024 * 1024 : 16 * 1024 * 1024,
                timeoutMs: includeEit ? 15000 : 5000,
                expectedServiceId: channel?.serviceId,
            });
            const genres = includeEit ? info.genres : [];
            let cachedStreams: VideoStreamAnalysis[] = [];
            try {
                cachedStreams = currentVideo?.streamInfo == null ? [] : JSON.parse(currentVideo.streamInfo);
            } catch {
                cachedStreams = [];
            }
            const subtitlePid = cachedStreams.find(stream => stream.type === 'subtitle')?.id ?? null;
            await repo.save(
                repo.create({
                    videoFileId,
                    networkId: info.networkId,
                    transportStreamId: info.transportStreamId,
                    serviceId: info.serviceId,
                    serviceType: info.serviceType,
                    serviceName: info.serviceName,
                    serviceProviderName: info.serviceProviderName,
                    networkName: info.networkName,
                    eventId: includeEit ? info.eventId : null,
                    eventName: includeEit ? info.eventName : null,
                    eventDescription: includeEit ? info.eventDescription : null,
                    eventExtended: includeEit ? info.eventExtended : null,
                    eventStartAt: includeEit ? info.eventStartAt : null,
                    eventDuration: includeEit ? info.eventDuration : null,
                    genre1: genres[0]?.lv1 ?? null,
                    subGenre1: genres[0]?.lv2 ?? null,
                    genre2: genres[1]?.lv1 ?? null,
                    subGenre2: genres[1]?.lv2 ?? null,
                    genre3: genres[2]?.lv1 ?? null,
                    subGenre3: genres[2]?.lv2 ?? null,
                    videoStreamType: info.videoStreamType,
                    videoPid: info.videoPid,
                    audioStreamType: info.audioStreamType,
                    audioPid: info.audioPid,
                    pmtPid: info.pmtPid,
                    pcrPid: info.pcrPid,
                    subtitlePid,
                    firstTdtAt: info.firstTdtAt,
                    analyzedSize: size,
                    analyzedMtime: mtime,
                    analyzedAt: Date.now(),
                    analysisError: null,
                }),
            );
            if (includeEit) {
                const video = await this.videoFileDB.findId(videoFileId);
                const uploadedRecorded =
                    video === null
                        ? null
                        : await connection.getRepository(Recorded).findOne({ where: { id: video.recordedId } });
                if (uploadedRecorded !== null) {
                    const patch: Partial<Recorded> = {};
                    if (info.eventName !== null && uploadedRecorded.name.trim().length === 0) {
                        patch.name = info.eventName;
                        patch.halfWidthName = StrUtil.toHalf(info.eventName);
                    }
                    if (info.eventDescription !== null && (uploadedRecorded.description ?? '').trim().length === 0) {
                        patch.description = info.eventDescription;
                        patch.halfWidthDescription = StrUtil.toHalf(info.eventDescription);
                    }
                    if (info.eventExtended !== null && (uploadedRecorded.extended ?? '').trim().length === 0) {
                        patch.extended = info.eventExtended;
                        patch.halfWidthExtended = StrUtil.toHalf(info.eventExtended);
                    }
                    if (uploadedRecorded.genre1 === null || uploadedRecorded.genre1 === undefined) {
                        patch.genre1 = genres[0]?.lv1 ?? null;
                        patch.subGenre1 = genres[0]?.lv2 ?? null;
                        patch.genre2 = genres[1]?.lv1 ?? null;
                        patch.subGenre2 = genres[1]?.lv2 ?? null;
                        patch.genre3 = genres[2]?.lv1 ?? null;
                        patch.subGenre3 = genres[2]?.lv2 ?? null;
                    }
                    if (uploadedRecorded.videoType === null || uploadedRecorded.videoType === undefined) {
                        patch.videoType = info.videoType;
                        patch.videoResolution = info.videoResolution;
                        patch.videoStreamContent = info.videoStreamContent;
                        patch.videoComponentType = info.videoComponentType;
                    }
                    if (
                        uploadedRecorded.audioSamplingRate === null ||
                        uploadedRecorded.audioSamplingRate === undefined
                    ) {
                        patch.audioSamplingRate = info.audioSamplingRate;
                        patch.audioComponentType = info.audioComponentType;
                    }
                    if (Object.keys(patch).length > 0)
                        await connection.getRepository(Recorded).update({ id: uploadedRecorded.id }, patch);
                }
            }
        } catch (err) {
            await repo.save(
                repo.create({
                    videoFileId,
                    analyzedSize: size,
                    analyzedMtime: mtime,
                    analyzedAt: Date.now(),
                    analysisError: String(err),
                }),
            );
        }
    }

    private probe(filePath: string): Promise<ProbeResult> {
        return new Promise((resolve, reject) =>
            execFile(
                this.config.ffprobe,
                ['-v', 'error', '-show_format', '-show_streams', '-of', 'json', filePath],
                { maxBuffer: 16 * 1024 * 1024 },
                (err, stdout) => {
                    if (err) reject(err);
                    else {
                        try {
                            resolve(JSON.parse(stdout));
                        } catch (e) {
                            reject(e);
                        }
                    }
                },
            ),
        );
    }

    private mapStreams(streams: Array<Record<string, any>>): VideoStreamAnalysis[] {
        return streams.map(stream => {
            const transfer = this.string(stream.color_transfer);
            const hdr = transfer === 'smpte2084' ? 'HDR10/PQ' : transfer === 'arib-std-b67' ? 'HLG' : null;
            return {
                index: Number(stream.index),
                id: this.streamId(stream.id) ?? undefined,
                type: this.string(stream.codec_type) ?? 'unknown',
                codec: this.string(stream.codec_name) ?? this.string(stream.codec_long_name) ?? undefined,
                profile: this.string(stream.profile) ?? undefined,
                language: this.string(stream.tags?.language) ?? undefined,
                title: this.string(stream.tags?.title) ?? undefined,
                channels: this.number(stream.channels) ?? undefined,
                sampleRate: this.number(stream.sample_rate) ?? undefined,
                width: this.number(stream.width) ?? undefined,
                height: this.number(stream.height) ?? undefined,
                frameRate: this.ratio(stream.avg_frame_rate ?? stream.r_frame_rate) ?? undefined,
                pixelFormat: this.string(stream.pix_fmt) ?? undefined,
                bitDepth:
                    this.number(stream.bits_per_raw_sample) ??
                    this.pixelBitDepth(this.string(stream.pix_fmt)) ??
                    undefined,
                hdr: hdr ?? undefined,
                isDefault: Number(stream.disposition?.default) === 1,
                isForced: Number(stream.disposition?.forced) === 1,
            };
        });
    }

    private async toResult(video: VideoFile): Promise<VideoAnalysis> {
        const connection = await this.db.getConnection();
        const ts = await connection.getRepository(VideoFileTsInfo).findOne({ where: { videoFileId: video.id } });
        let streams: VideoStreamAnalysis[] = [];
        try {
            streams = video.streamInfo === null ? [] : JSON.parse(video.streamInfo);
        } catch {
            streams = [];
        }
        return {
            videoFileId: video.id,
            fileName: video.name,
            formatName: video.formatName,
            size: Number(video.size),
            duration: video.duration,
            startTime: video.startTime,
            bitRate: video.bitRate,
            videoCodec: video.videoCodec,
            videoProfile: video.videoProfile,
            width: video.width,
            height: video.height,
            frameRate: video.frameRate,
            pixelFormat: video.pixelFormat,
            bitDepth: video.bitDepth,
            hdr: video.hdr,
            streams,
            analyzedAt: video.analyzedAt === null ? null : Number(video.analyzedAt),
            analysisError: video.analysisError,
            ts: ts === null ? null : { ...ts, analyzedAt: Number(ts.analyzedAt) },
        };
    }

    private string(value: unknown): string | null {
        return typeof value === 'string' && value.length > 0 ? value : null;
    }
    private number(value: unknown): number | null {
        const n = Number(value);
        return Number.isFinite(n) ? n : null;
    }
    private ratio(value: unknown): number | null {
        if (typeof value !== 'string') return this.number(value);
        const [a, b] = value.split('/').map(Number);
        return Number.isFinite(a) && Number.isFinite(b) && b !== 0 ? a / b : null;
    }
    private pixelBitDepth(value: string | null): number | null {
        const m = value?.match(/(?:p|le|be)(\d{2})(?:le|be)?$/);
        return m === null || m === undefined ? null : Number(m[1]);
    }
    private streamId(value: unknown): number | null {
        if (typeof value === 'string' && /^0x[0-9a-f]+$/i.test(value)) return parseInt(value.slice(2), 16);
        return this.number(value);
    }
}
