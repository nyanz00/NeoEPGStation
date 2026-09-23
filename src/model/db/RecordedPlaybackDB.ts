import { inject, injectable } from 'inversify';
import RecordedPlayback from '../../db/entities/RecordedPlayback';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IRecordedPlaybackDB, { RecordedPlaybackUpdate } from './IRecordedPlaybackDB';

const MAX_TRACKED_SESSIONS = 128;

function applySessionProgress(
    stored: string | null,
    value: RecordedPlaybackUpdate,
): { watchedSecondsDelta: number; watchedSessions: string | null } {
    if (value.sessionId === undefined || value.sessionWatchedSeconds === undefined) {
        return { watchedSecondsDelta: value.watchedSecondsDelta, watchedSessions: stored };
    }

    const sessions: Record<string, number> = Object.create(null) as Record<string, number>;
    if (stored !== null) {
        const parsed: unknown = JSON.parse(stored);
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed))
            throw new Error('視聴セッション情報が不正です');
        for (const [id, total] of Object.entries(parsed)) {
            if (Number.isFinite(total) && typeof total === 'number' && total >= 0) sessions[id] = total;
        }
    }

    const previousTotal = sessions[value.sessionId] ?? 0;
    const watchedSecondsDelta = Math.min(30, Math.max(0, value.sessionWatchedSeconds - previousTotal));
    if (value.sessionWatchedSeconds > previousTotal) {
        delete sessions[value.sessionId];
        sessions[value.sessionId] = value.sessionWatchedSeconds;
        const sessionIds = Object.keys(sessions);
        for (const expiredId of sessionIds.slice(0, -MAX_TRACKED_SESSIONS)) delete sessions[expiredId];
    }
    return { watchedSecondsDelta, watchedSessions: JSON.stringify(sessions) };
}

@injectable()
export default class RecordedPlaybackDB implements IRecordedPlaybackDB {
    private readonly requests = new Map<string, Promise<RecordedPlayback>>();
    private readonly historyLimits = new Map<number, number>();

    constructor(
        @inject('IDBOperator') private op: IDBOperator,
        @inject('IPromiseRetry') private promiseRetry: IPromiseRetry,
    ) {}

    public async find(recordedId: number, userId: number): Promise<RecordedPlayback | null> {
        const repository = (await this.op.getConnection()).getRepository(RecordedPlayback);
        return (await this.promiseRetry.run(() => repository.findOne({ where: { recordedId, userId } }))) ?? null;
    }

    public async findHistory(userId: number, limit: number): Promise<RecordedPlayback[]> {
        const repository = (await this.op.getConnection()).getRepository(RecordedPlayback);
        return this.promiseRetry.run(() =>
            repository
                .createQueryBuilder('playback')
                .where('playback.userId = :userId', { userId })
                .andWhere('playback.historyUpdatedAt IS NOT NULL')
                .orderBy('playback.historyUpdatedAt', 'DESC')
                .addOrderBy('playback.id', 'DESC')
                .take(limit)
                .getMany(),
        );
    }

    public async trimHistory(userId: number, limit: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(RecordedPlayback);
        const records = await this.promiseRetry.run(() =>
            repository
                .createQueryBuilder('playback')
                .where('playback.userId = :userId', { userId })
                .andWhere('playback.historyUpdatedAt IS NOT NULL')
                .orderBy('playback.historyUpdatedAt', 'DESC')
                .addOrderBy('playback.id', 'DESC')
                .getMany(),
        );
        const expiredIds = records.slice(limit).map(record => record.id);
        if (expiredIds.length > 0) {
            await this.promiseRetry.run(() => repository.update(expiredIds, { historyUpdatedAt: null }));
        }
    }

    public async removeFromHistory(recordedId: number, userId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(RecordedPlayback);
        await this.promiseRetry.run(() => repository.update({ recordedId, userId }, { historyUpdatedAt: null }));
    }

    public async deleteRecordedId(recordedId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(RecordedPlayback);
        await this.promiseRetry.run(() => repository.delete({ recordedId }));
    }

    public async update(recordedId: number, userId: number, value: RecordedPlaybackUpdate): Promise<RecordedPlayback> {
        const key = `${recordedId}:${userId}`;
        const previous = this.requests.get(key);
        const request = (previous === undefined ? Promise.resolve() : previous.catch(() => undefined)).then(() =>
            this.updateOnce(recordedId, userId, value),
        );
        this.requests.set(key, request);
        try {
            return await request;
        } finally {
            if (this.requests.get(key) === request) this.requests.delete(key);
        }
    }

    private async updateOnce(
        recordedId: number,
        userId: number,
        value: RecordedPlaybackUpdate,
    ): Promise<RecordedPlayback> {
        const repository = (await this.op.getConnection()).getRepository(RecordedPlayback);
        let current = await this.find(recordedId, userId);
        const now = Date.now();
        if (current === null) {
            const progress = applySessionProgress(null, value);
            let inserted = false;
            try {
                await this.promiseRetry.run(() =>
                    repository.insert({
                        recordedId,
                        userId,
                        position: value.position,
                        duration: value.duration,
                        watchedSeconds: progress.watchedSecondsDelta,
                        watchedSessions: progress.watchedSessions,
                        lastObservedAt: value.observedAt,
                        createdAt: now,
                        updatedAt: now,
                        historyUpdatedAt: value.historyEnabled ? now : null,
                    }),
                );
                inserted = true;
            } catch (err) {
                current = await this.find(recordedId, userId);
                if (current === null) throw err;
            }
            if (inserted) {
                if (value.historyEnabled) {
                    await this.trimHistory(userId, value.historyLimit);
                    this.historyLimits.set(userId, value.historyLimit);
                }
                return (await this.find(recordedId, userId))!;
            }
        }

        if (current === null) throw new Error('Recorded playback progress was not found');

        const progress = applySessionProgress(current.watchedSessions, value);
        const isLatestPosition = value.observedAt >= current.lastObservedAt;
        await this.promiseRetry.run(() =>
            repository.update(current.id, {
                position: isLatestPosition ? value.position : current.position,
                duration: isLatestPosition ? value.duration : current.duration,
                watchedSeconds: Math.min(
                    Math.max(isLatestPosition ? value.duration : current.duration, 0),
                    Math.max(0, current.watchedSeconds + progress.watchedSecondsDelta),
                ),
                watchedSessions: progress.watchedSessions,
                lastObservedAt: isLatestPosition ? value.observedAt : current.lastObservedAt,
                updatedAt: now,
                historyUpdatedAt: value.historyEnabled ? now : current.historyUpdatedAt,
            }),
        );
        if (
            value.historyEnabled &&
            (current.historyUpdatedAt === null || this.historyLimits.get(userId) !== value.historyLimit)
        ) {
            await this.trimHistory(userId, value.historyLimit);
            this.historyLimits.set(userId, value.historyLimit);
        }
        return (await this.find(recordedId, userId))!;
    }
}
