import { inject, injectable } from 'inversify';
import AnnictEpisodeWatch from '../../db/entities/AnnictEpisodeWatch';
import AnnictRecordedEpisode from '../../db/entities/AnnictRecordedEpisode';
import IPromiseRetry from '../IPromiseRetry';
import IAnnictEpisodeDB, { AnnictEpisodeMatch } from './IAnnictEpisodeDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class AnnictEpisodeDB implements IAnnictEpisodeDB {
    constructor(
        @inject('IDBOperator') private op: IDBOperator,
        @inject('IPromiseRetry') private promiseRetry: IPromiseRetry,
    ) {}

    public async findRecorded(recordedId: number): Promise<AnnictRecordedEpisode | null> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRecordedEpisode);
        return (await this.promiseRetry.run(() => repository.findOne({ where: { recordedId } }))) ?? null;
    }

    public async findRecordedByEpisode(episodeAnnictId: number): Promise<AnnictRecordedEpisode | null> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRecordedEpisode);
        return (
            (await this.promiseRetry.run(() =>
                repository.findOne({
                    where: { episodeAnnictId, status: 'matched' },
                    order: { matchedAt: 'DESC', id: 'DESC' },
                }),
            )) ?? null
        );
    }

    public async upsertPending(recordedId: number, annictId: number): Promise<AnnictRecordedEpisode> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRecordedEpisode);
        const current = await this.findRecorded(recordedId);
        const now = Date.now();
        if (current !== null) {
            if (current.annictId !== annictId) {
                await this.promiseRetry.run(() =>
                    repository.update(current.id, {
                        annictId,
                        programAnnictId: null,
                        episodeAnnictId: null,
                        episodeNumber: null,
                        episodeNumberText: null,
                        episodeTitle: null,
                        status: 'pending',
                        pendingReason: 'not_checked',
                        lastCheckedAt: null,
                        matchedAt: null,
                        updatedAt: now,
                    }),
                );
                return (await this.findRecorded(recordedId))!;
            }
            return current;
        }

        try {
            await this.promiseRetry.run(() =>
                repository.insert({
                    recordedId,
                    annictId,
                    status: 'pending',
                    pendingReason: 'not_checked',
                    createdAt: now,
                    updatedAt: now,
                }),
            );
        } catch (err) {
            const inserted = await this.findRecorded(recordedId);
            if (inserted === null) throw err;
        }
        return (await this.findRecorded(recordedId))!;
    }

    public async setPending(recordedId: number, reason: string, checkedAt: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRecordedEpisode);
        await this.promiseRetry.run(() =>
            repository.update(
                { recordedId },
                {
                    programAnnictId: null,
                    episodeAnnictId: null,
                    episodeNumber: null,
                    episodeNumberText: null,
                    episodeTitle: null,
                    status: 'pending',
                    pendingReason: reason,
                    lastCheckedAt: checkedAt,
                    matchedAt: null,
                    updatedAt: checkedAt,
                },
            ),
        );
    }

    public async setMatched(recordedId: number, match: AnnictEpisodeMatch, checkedAt: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRecordedEpisode);
        await this.promiseRetry.run(() =>
            repository.update(
                { recordedId },
                {
                    programAnnictId: match.programAnnictId ?? null,
                    episodeAnnictId: match.episodeAnnictId,
                    episodeNumber: match.episodeNumber ?? null,
                    episodeNumberText: match.episodeNumberText ?? null,
                    episodeTitle: match.episodeTitle ?? null,
                    status: 'matched',
                    pendingReason: null,
                    lastCheckedAt: checkedAt,
                    matchedAt: checkedAt,
                    updatedAt: checkedAt,
                },
            ),
        );
    }

    public async findWatch(episodeAnnictId: number, viewerProfileId: number): Promise<AnnictEpisodeWatch | null> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        return (
            (await this.promiseRetry.run(() => repository.findOne({ where: { episodeAnnictId, viewerProfileId } }))) ??
            null
        );
    }

    public async findPendingWatches(limit: number, now: number): Promise<AnnictEpisodeWatch[]> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        return this.promiseRetry.run(() =>
            repository
                .createQueryBuilder('watch')
                .where(
                    '(watch.statusSyncPending = :pending OR watch.completionPending = :pending OR watch.ruleDisablePending = :pending)',
                    { pending: true },
                )
                .andWhere('(watch.nextRetryAt IS NULL OR watch.nextRetryAt <= :now)', { now })
                .orderBy('watch.nextRetryAt', 'ASC')
                .addOrderBy('watch.updatedAt', 'ASC')
                .take(limit)
                .getMany(),
        );
    }

    public async beginWatch(episodeAnnictId: number, viewerProfileId: number): Promise<AnnictEpisodeWatch> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        const current = await this.findWatch(episodeAnnictId, viewerProfileId);
        const now = Date.now();
        if (current !== null) {
            if (current.status !== 'watched') {
                await this.promiseRetry.run(() =>
                    repository.update(current.id, { status: 'pending', lastError: null, updatedAt: now }),
                );
            }
            return (await this.findWatch(episodeAnnictId, viewerProfileId))!;
        }
        try {
            await this.promiseRetry.run(() =>
                repository.insert({
                    episodeAnnictId,
                    viewerProfileId,
                    status: 'pending',
                    createdAt: now,
                    updatedAt: now,
                }),
            );
        } catch (err) {
            const inserted = await this.findWatch(episodeAnnictId, viewerProfileId);
            if (inserted === null) throw err;
        }
        return (await this.findWatch(episodeAnnictId, viewerProfileId))!;
    }

    public async setWatched(
        episodeAnnictId: number,
        viewerProfileId: number,
        annictRecordId: number | null,
        workAnnictId: number | null,
        statusSyncPending: boolean,
        watchedAt: number,
    ): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        await this.promiseRetry.run(() =>
            repository.update(
                { episodeAnnictId, viewerProfileId },
                {
                    annictRecordId,
                    workAnnictId,
                    statusSyncPending,
                    completionPending: false,
                    ruleDisablePending: false,
                    explicitFinalEpisode: false,
                    retryCount: 0,
                    nextRetryAt: null,
                    status: 'watched',
                    lastError: null,
                    watchedAt,
                    updatedAt: watchedAt,
                },
            ),
        );
    }

    public async clearWatchStatusSync(episodeAnnictId: number, viewerProfileId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        await this.promiseRetry.run(() =>
            repository.update(
                { episodeAnnictId, viewerProfileId },
                {
                    statusSyncPending: false,
                    retryCount: 0,
                    nextRetryAt: null,
                    lastError: null,
                    updatedAt: Date.now(),
                },
            ),
        );
    }

    public async setCompletionPending(
        episodeAnnictId: number,
        viewerProfileId: number,
        workAnnictId: number,
        disableRules: boolean,
        explicitFinalEpisode: boolean,
    ): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        await this.promiseRetry.run(() =>
            repository.update(
                { episodeAnnictId, viewerProfileId },
                {
                    workAnnictId,
                    completionPending: true,
                    ruleDisablePending: disableRules,
                    explicitFinalEpisode,
                    retryCount: 0,
                    nextRetryAt: null,
                    updatedAt: Date.now(),
                },
            ),
        );
    }

    public async clearWorkCompletionPending(episodeAnnictId: number, viewerProfileId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        const current = await this.findWatch(episodeAnnictId, viewerProfileId);
        const keepRetry = current?.ruleDisablePending === true;
        const retryCount = current?.retryCount ?? 0;
        const nextRetryAt = current?.nextRetryAt ?? null;
        const lastError = current?.lastError ?? null;
        await this.promiseRetry.run(() =>
            repository.update(
                { episodeAnnictId, viewerProfileId },
                {
                    completionPending: false,
                    retryCount: keepRetry ? retryCount : 0,
                    nextRetryAt: keepRetry ? nextRetryAt : null,
                    lastError: keepRetry ? lastError : null,
                    updatedAt: Date.now(),
                },
            ),
        );
    }

    public async clearRuleDisablePending(episodeAnnictId: number, viewerProfileId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        const current = await this.findWatch(episodeAnnictId, viewerProfileId);
        const keepRetry = current?.completionPending === true;
        const retryCount = current?.retryCount ?? 0;
        const nextRetryAt = current?.nextRetryAt ?? null;
        const lastError = current?.lastError ?? null;
        await this.promiseRetry.run(() =>
            repository.update(
                { episodeAnnictId, viewerProfileId },
                {
                    ruleDisablePending: false,
                    retryCount: keepRetry ? retryCount : 0,
                    nextRetryAt: keepRetry ? nextRetryAt : null,
                    lastError: keepRetry ? lastError : null,
                    updatedAt: Date.now(),
                },
            ),
        );
    }

    public async clearCompletionPending(episodeAnnictId: number, viewerProfileId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        await this.promiseRetry.run(() =>
            repository.update(
                { episodeAnnictId, viewerProfileId },
                {
                    completionPending: false,
                    ruleDisablePending: false,
                    explicitFinalEpisode: false,
                    retryCount: 0,
                    nextRetryAt: null,
                    updatedAt: Date.now(),
                },
            ),
        );
    }

    public async setUnwatched(episodeAnnictId: number, viewerProfileId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        await this.promiseRetry.run(() =>
            repository.update(
                { episodeAnnictId, viewerProfileId },
                {
                    annictRecordId: null,
                    statusSyncPending: false,
                    completionPending: false,
                    ruleDisablePending: false,
                    explicitFinalEpisode: false,
                    retryCount: 0,
                    nextRetryAt: null,
                    status: 'unwatched',
                    lastError: null,
                    watchedAt: null,
                    updatedAt: Date.now(),
                },
            ),
        );
    }

    public async setWatchFailed(episodeAnnictId: number, viewerProfileId: number, message: string): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        await this.promiseRetry.run(() =>
            repository.update(
                { episodeAnnictId, viewerProfileId },
                {
                    status: 'failed',
                    lastError: message.slice(0, 1000),
                    updatedAt: Date.now(),
                },
            ),
        );
    }

    public async scheduleWatchRetry(episodeAnnictId: number, viewerProfileId: number, message: string): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictEpisodeWatch);
        const current = await this.findWatch(episodeAnnictId, viewerProfileId);
        if (current === null) return;
        const retryCount = Math.min(Math.max(current.retryCount ?? 0, 0) + 1, 32);
        const delay = Math.min(15 * 60_000 * 2 ** Math.min(retryCount - 1, 5), 6 * 60 * 60_000);
        const now = Date.now();
        await this.promiseRetry.run(() =>
            repository.update(current.id, {
                retryCount,
                nextRetryAt: now + delay,
                lastError: message.slice(0, 1000),
                updatedAt: now,
            }),
        );
    }
}
