import { ChildProcess } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as apid from '../../../api.js';
import Recorded from '../../db/entities/Recorded.js';
import VideoFile from '../../db/entities/VideoFile.js';
import VideoFileKeyframeInfo from '../../db/entities/VideoFileKeyframeInfo.js';
import VideoFileTsInfo from '../../db/entities/VideoFileTsInfo.js';
import {
    KeyframePacketSample,
    parseKeyframePacketSample,
    planKeyframeSampleStages,
    summarizeKeyframeSamples,
} from '../../util/KeyframeIntervalUtil.js';
import { killManaged, spawnManaged } from '../../util/ManagedProcess.js';
import IDBOperator from '../db/IDBOperator.js';
import IConfiguration from '../IConfiguration.js';
import ILoggerModel from '../ILoggerModel.js';
import { acquireRecordedFileUse } from '../RecordedFileUse.js';
import IVideoUtil from '../api/video/IVideoUtil.js';
import IKeyframeAnalysisModel from './IKeyframeAnalysisModel.js';

export const KEYFRAME_ANALYSIS_VERSION = 2;
const RETRY_DELAY = 6 * 60 * 60 * 1000;
const BACKFILL_INTERVAL = 30_000;
type Summary = ReturnType<typeof summarizeKeyframeSamples>;
interface CachedResult extends Summary {
    version: number;
    sourceSize: number;
    sourceMtime: number;
    analyzedAt: number;
}

/** API processes only persist requests; the operator alone runs the serial sampler. */
@injectable()
export default class KeyframeAnalysisModel implements IKeyframeAnalysisModel {
    private timer: NodeJS.Timeout | null = null;
    private active: Promise<void> | null = null;
    private child: ChildProcess | null = null;
    private stopped = true;
    private nextBackfill = 0;

    constructor(
        @inject('IDBOperator') private readonly db: IDBOperator,
        @inject('IConfiguration') private readonly configuration: IConfiguration,
        @inject('IVideoUtil') private readonly videoUtil: IVideoUtil,
        @inject('ILoggerModel') private readonly logger: ILoggerModel,
    ) {}

    public async request(
        video: VideoFile,
        size: number,
        mtime: number,
        force = false,
    ): Promise<apid.VideoKeyframeAnalysis> {
        const repo = (await this.db.getConnection()).getRepository(VideoFileKeyframeInfo);
        let row = await repo.findOneBy({ videoFileId: video.id });
        if (row === null)
            await repo
                .createQueryBuilder()
                .insert()
                .values({
                    videoFileId: video.id,
                    version: KEYFRAME_ANALYSIS_VERSION,
                    status: 'pending',
                    sourceSize: size,
                    sourceMtime: mtime,
                    requestedAt: Date.now(),
                })
                .orIgnore()
                .execute();
        row ??= await repo.findOneByOrFail({ videoFileId: video.id });
        const sameSource =
            Number(row.sourceSize) === size &&
            Number(row.sourceMtime) === mtime &&
            row.version === KEYFRAME_ANALYSIS_VERSION;
        const busy = row.status === 'pending' || row.status === 'analyzing';
        const coolingDown = row.status === 'error' && Date.now() - Number(row.attemptedAt ?? 0) < RETRY_DELAY;
        const metadataRecovered =
            row.status === 'error' &&
            (row.error === 'Error: BasicVideoAnalysisUnavailable' ||
                row.error === 'Error: BasicVideoAnalysisOutdated') &&
            video.analysisError === null &&
            Number(video.analyzedSize) === size &&
            Number(video.analyzedMtime) === mtime;
        if (!sameSource || (force && !busy) || metadataRecovered || (!busy && !coolingDown && row.status === 'error')) {
            // Compare the request generation so concurrent refreshes cannot overwrite a newer request.
            await repo.update(
                { videoFileId: video.id, requestedAt: row.requestedAt, status: row.status },
                {
                    version: KEYFRAME_ANALYSIS_VERSION,
                    sourceSize: size,
                    sourceMtime: mtime,
                    status: 'pending',
                    requestedAt: Math.max(Date.now(), Number(row.requestedAt) + 1),
                    error: null,
                },
            );
            row = await repo.findOneByOrFail({ videoFileId: video.id });
        }
        const previous = this.readResult(row.result);
        return {
            status: row.status as apid.VideoKeyframeAnalysis['status'],
            version: previous?.version ?? row.version,
            currentVersion: KEYFRAME_ANALYSIS_VERSION,
            estimated: true,
            averageInterval: previous?.averageInterval ?? null,
            minInterval: previous?.minInterval ?? null,
            maxInterval: previous?.maxInterval ?? null,
            intervalCount: previous?.intervalCount ?? 0,
            keyframeCount: previous?.keyframeCount ?? 0,
            sampledDuration: previous?.sampledDuration ?? 0,
            sampleWindows: previous?.sampleWindows ?? [],
            analyzedAt: previous?.analyzedAt ?? null,
            error: row.error,
            stale:
                previous !== null &&
                (row.status === 'pending' ||
                    row.status === 'analyzing' ||
                    row.status === 'error' ||
                    previous.version !== KEYFRAME_ANALYSIS_VERSION ||
                    previous.sourceSize !== size ||
                    previous.sourceMtime !== mtime),
        };
    }

    public async start(): Promise<void> {
        if (!this.stopped) return;
        this.stopped = false;
        const repo = (await this.db.getConnection()).getRepository(VideoFileKeyframeInfo);
        await repo.update({ status: 'analyzing' }, { status: 'pending' });
        if (this.stopped) return;
        this.schedule(5_000);
    }

    public async stop(): Promise<void> {
        this.stopped = true;
        if (this.timer !== null) clearTimeout(this.timer);
        this.timer = null;
        if (this.child !== null) await killManaged(this.child, 0);
        await this.active;
    }

    private schedule(delay: number): void {
        if (this.stopped) return;
        this.timer = setTimeout(() => {
            this.timer = null;
            this.active = this.tick().catch(error =>
                this.logger.getLogger().system.warn(`keyframe analysis: ${String(error)}`),
            );
            void this.active.finally(() => {
                this.active = null;
                this.schedule(5_000);
            });
        }, delay);
        this.timer.unref();
    }

    private async tick(): Promise<void> {
        const connection = await this.db.getConnection();
        const repo = connection.getRepository(VideoFileKeyframeInfo);
        const pending = await repo
            .createQueryBuilder('k')
            .innerJoin(VideoFile, 'v', 'v.id = k.videoFileId')
            .innerJoin(Recorded, 'r', 'r.id = v.recordedId')
            .where('k.status = :status', { status: 'pending' })
            .andWhere('r.isRecording = :recording', { recording: this.db.convertBoolean(false) })
            .orderBy('k.requestedAt', 'ASC')
            .take(1)
            .getOne();
        if (this.stopped) return;
        if (pending !== null) {
            const claim = await repo.update(
                { videoFileId: pending.videoFileId, status: 'pending', requestedAt: pending.requestedAt },
                { status: 'analyzing', attemptedAt: Date.now() },
            );
            if (claim.affected === 1) await this.analyze(pending);
            return;
        }
        if (Date.now() < this.nextBackfill) return;
        this.nextBackfill = Date.now() + BACKFILL_INTERVAL;
        const candidate = await connection
            .getRepository(VideoFile)
            .createQueryBuilder('v')
            .innerJoin(Recorded, 'r', 'r.id = v.recordedId')
            .leftJoin(VideoFileKeyframeInfo, 'k', 'k.videoFileId = v.id')
            .where('r.isRecording = :recording', { recording: this.db.convertBoolean(false) })
            .andWhere('v.analyzedAt IS NOT NULL AND v.analysisError IS NULL')
            .andWhere('(k.videoFileId IS NULL OR k.version <> :version)', { version: KEYFRAME_ANALYSIS_VERSION })
            .orderBy('v.id', 'ASC')
            .take(1)
            .getOne();
        if (candidate === null || this.stopped) return;
        // Fingerprints are checked again against the file before reading packets.
        await this.request(candidate, Number(candidate.analyzedSize), Number(candidate.analyzedMtime));
    }

    private async analyze(request: VideoFileKeyframeInfo): Promise<void> {
        const connection = await this.db.getConnection();
        const repo = connection.getRepository(VideoFileKeyframeInfo);
        const generation = { videoFileId: request.videoFileId, requestedAt: request.requestedAt, status: 'analyzing' };
        let use: { release(): Promise<void> } | null = null;
        try {
            const video = await connection.getRepository(VideoFile).findOneByOrFail({ id: request.videoFileId });
            if (video.analysisError !== null) throw new Error('BasicVideoAnalysisUnavailable');
            use = await acquireRecordedFileUse({
                recordedId: video.recordedId,
                videoFileId: video.id,
                purpose: 'analysis',
            });
            if (this.stopped) {
                await repo.update(generation, { status: 'pending' });
                return;
            }
            const filePath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (filePath === null) throw new Error('VideoFilePathIsNull');
            const before = await fs.promises.stat(filePath);
            if (
                before.size !== Number(request.sourceSize) ||
                Math.trunc(before.mtimeMs) !== Number(request.sourceMtime)
            ) {
                await repo.update(generation, {
                    status: 'pending',
                    sourceSize: before.size,
                    sourceMtime: Math.trunc(before.mtimeMs),
                    requestedAt: Date.now(),
                });
                return;
            }
            // Duration and timestamp origin must describe this same file, especially
            // when a pending request was created while recording was still active.
            if (
                Number(video.analyzedSize) !== before.size ||
                Number(video.analyzedMtime) !== Math.trunc(before.mtimeMs)
            )
                throw new Error('BasicVideoAnalysisOutdated');
            const ts = await connection.getRepository(VideoFileTsInfo).findOneBy({ videoFileId: video.id });
            let stream = 'v:0';
            try {
                const streams = JSON.parse(video.streamInfo ?? '[]') as Array<{
                    index: number;
                    id?: number;
                    type: string;
                }>;
                const selected =
                    streams.find(s => s.type === 'video' && s.id === ts?.videoPid) ??
                    streams.find(s => s.type === 'video');
                if (selected && Number.isInteger(selected.index) && selected.index >= 0)
                    stream = String(selected.index);
            } catch {
                /* Older caches can lack a stream list. */
            }
            const startTime = Number.isFinite(video.startTime) ? Number(video.startTime) : 0;
            const samples = await this.sampleKeyframes(filePath, stream, Number(video.duration), startTime);
            const after = await fs.promises.stat(filePath);
            if (after.size !== before.size || after.mtimeMs !== before.mtimeMs)
                throw new Error('VideoFileChangedDuringAnalysis');
            const summary = summarizeKeyframeSamples(samples);
            const result: CachedResult = {
                ...summary,
                version: KEYFRAME_ANALYSIS_VERSION,
                sourceSize: before.size,
                sourceMtime: Math.trunc(before.mtimeMs),
                analyzedAt: Date.now(),
            };
            await repo.update(generation, {
                status: summary.intervalCount > 0 ? 'ready' : 'unavailable',
                result: JSON.stringify(result),
                error: null,
            });
        } catch (error) {
            // A failed refresh never destroys the last successful sample.
            await repo.update(generation, {
                status: this.stopped ? 'pending' : 'error',
                error: this.stopped ? null : String(error),
            });
        } finally {
            await use?.release();
        }
    }

    private async sampleKeyframes(
        filePath: string,
        stream: string,
        duration: number,
        startTime: number,
    ): Promise<KeyframePacketSample[]> {
        const plans = planKeyframeSampleStages(duration);
        if (plans.length === 0) throw new Error('VideoDurationUnavailable');
        const cache = new Map<string, KeyframePacketSample>();
        for (const stages of plans) {
            let sample: KeyframePacketSample | undefined;
            for (const window of stages) {
                if (this.stopped) throw new Error('KeyframeAnalysisStopped');
                const key = `${window.start}:${window.end}`;
                sample = cache.get(key);
                if (sample === undefined) {
                    const output = await this.probe(
                        filePath,
                        stream,
                        startTime + window.start,
                        window.end - window.start,
                    );
                    sample = parseKeyframePacketSample(output, window, startTime);
                    cache.set(key, sample);
                }
                // Keep all intervals in a sufficient window instead of stopping
                // after the first pair. At the limit even a single interval is useful.
                if (sample.keyframeTimes.length >= 3) break;
            }
        }
        // Container seeking may land before the requested start. Keep earlier
        // observations as well; the summary merges overlaps without double counting.
        return [...cache.values()];
    }

    private probe(filePath: string, stream: string, start: number, duration: number): Promise<string> {
        return new Promise((resolve, reject) => {
            const child = spawnManaged(
                this.configuration.getConfig().ffprobe,
                [
                    '-v',
                    'error',
                    '-select_streams',
                    stream,
                    '-read_intervals',
                    `${start}%+${duration}`,
                    '-show_packets',
                    '-show_entries',
                    'packet=pts_time,dts_time,flags',
                    '-of',
                    'json',
                    filePath,
                ],
                { stdio: ['ignore', 'pipe', 'pipe'] },
            );
            this.child = child;
            let output = '';
            let stderr = '';
            let failure: Error | null = null;
            let terminating = false;
            const terminate = (error: Error): void => {
                failure ??= error;
                if (terminating) return;
                terminating = true;
                void killManaged(child, 0).catch(err =>
                    this.logger.getLogger().system.error(`keyframe probe termination: ${String(err)}`),
                );
            };
            const timer = setTimeout(() => terminate(new Error('KeyframeProbeTimeout')), 20_000);
            child.stdout?.setEncoding('utf8');
            child.stdout?.on('data', (chunk: string) => {
                if (failure !== null) return;
                output += chunk;
                if (Buffer.byteLength(output) > 4 * 1024 * 1024) terminate(new Error('KeyframeProbeOutputLimit'));
            });
            child.stderr?.setEncoding('utf8');
            child.stderr?.on('data', (chunk: string) => {
                stderr = (stderr + chunk).slice(-2048);
            });
            child.once('error', error => {
                failure = error;
            });
            // Keep the file lease until close: timeout/cancel must not race deletion.
            child.once('close', code => {
                clearTimeout(timer);
                if (this.child === child) this.child = null;
                if (failure !== null) reject(failure);
                else if (code !== 0) reject(new Error(`KeyframeProbeFailed (${code}): ${stderr}`));
                else resolve(output);
            });
        });
    }

    private readResult(value: string | null): CachedResult | null {
        try {
            const parsed = JSON.parse(value ?? 'null') as CachedResult | null;
            return parsed && Array.isArray(parsed.sampleWindows) && Number.isFinite(parsed.analyzedAt) ? parsed : null;
        } catch {
            return null;
        }
    }
}
