import { inject, injectable } from 'inversify';
import AnnictRuleLink from '../../db/entities/AnnictRuleLink';
import IPromiseRetry from '../IPromiseRetry';
import IAnnictRuleLinkDB, { LegacyAnnictRuleLink } from './IAnnictRuleLinkDB';
import IDBOperator from './IDBOperator';

@injectable()
export default class AnnictRuleLinkDB implements IAnnictRuleLinkDB {
    constructor(
        @inject('IDBOperator') private op: IDBOperator,
        @inject('IPromiseRetry') private promiseRetry: IPromiseRetry,
    ) {}

    public async findAll(): Promise<AnnictRuleLink[]> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRuleLink);
        return this.promiseRetry.run(() => repository.find({ order: { ruleId: 'ASC' } }));
    }

    public async findRuleIds(ruleIds: number[]): Promise<AnnictRuleLink[]> {
        if (ruleIds.length === 0) return [];
        const repository = (await this.op.getConnection()).getRepository(AnnictRuleLink);
        return this.promiseRetry.run(() =>
            repository
                .createQueryBuilder('link')
                .where('link.ruleId IN (:...ruleIds)', { ruleIds })
                .orderBy('link.ruleId', 'ASC')
                .getMany(),
        );
    }

    public async findRuleId(ruleId: number): Promise<AnnictRuleLink | null> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRuleLink);
        const result = await this.promiseRetry.run(() => repository.findOne({ where: { ruleId } }));
        return result ?? null;
    }

    public async findWork(annictId: number, viewerProfileId?: number | null): Promise<AnnictRuleLink[]> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRuleLink);
        const query = repository.createQueryBuilder('link').where('link.annictId = :annictId', { annictId });
        if (viewerProfileId === undefined || viewerProfileId === null) {
            query.andWhere('link.viewerProfileId IS NULL');
        } else {
            query.andWhere('link.viewerProfileId = :viewerProfileId', { viewerProfileId });
        }
        return this.promiseRetry.run(() => query.orderBy('link.ruleId', 'ASC').getMany());
    }

    public async upsert(ruleId: number, annictId: number, viewerProfileId?: number | null): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRuleLink);
        const current = await this.findRuleId(ruleId);
        const now = Date.now();
        if (current !== null) {
            await this.promiseRetry.run(() =>
                repository.update(current.id, {
                    annictId,
                    viewerProfileId: viewerProfileId ?? null,
                    source: 'anime',
                    updatedAt: now,
                }),
            );
            return;
        }
        try {
            await this.promiseRetry.run(() =>
                repository.insert({
                    ruleId,
                    annictId,
                    viewerProfileId: viewerProfileId ?? null,
                    source: 'anime',
                    createdAt: now,
                    updatedAt: now,
                }),
            );
        } catch (err) {
            // A concurrent link request may have inserted the unique rule row first.
            const inserted = await this.findRuleId(ruleId);
            if (inserted === null) throw err;
            await this.promiseRetry.run(() =>
                repository.update(inserted.id, {
                    annictId,
                    viewerProfileId: viewerProfileId ?? null,
                    source: 'anime',
                    updatedAt: now,
                }),
            );
        }
    }

    public async insertLegacyIfMissing(links: LegacyAnnictRuleLink[]): Promise<number> {
        let imported = 0;
        for (const link of links) {
            if ((await this.findRuleId(link.ruleId)) !== null) continue;
            const now = Date.now();
            const repository = (await this.op.getConnection()).getRepository(AnnictRuleLink);
            try {
                await this.promiseRetry.run(() =>
                    repository.insert({
                        ruleId: link.ruleId,
                        annictId: link.annictId,
                        viewerProfileId: link.viewerProfileId ?? null,
                        source: 'legacy-json',
                        createdAt: now,
                        updatedAt: now,
                    }),
                );
                imported++;
            } catch (err) {
                // Treat a concurrent insert as success, but preserve every other DB failure.
                if ((await this.findRuleId(link.ruleId)) === null) throw err;
            }
        }
        return imported;
    }

    public async deleteRuleId(ruleId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(AnnictRuleLink);
        await this.promiseRetry.run(() => repository.delete({ ruleId }));
    }

    public async restore(links: LegacyAnnictRuleLink[], validRuleIds: number[]): Promise<void> {
        const connection = await this.op.getConnection();
        const validRuleIdSet = new Set(validRuleIds);
        const sanitized = links.filter(
            (link, index, items) =>
                Number.isSafeInteger(link.ruleId) &&
                link.ruleId > 0 &&
                Number.isSafeInteger(link.annictId) &&
                link.annictId > 0 &&
                validRuleIdSet.has(link.ruleId) &&
                items.findIndex(item => item.ruleId === link.ruleId) === index,
        );

        await this.promiseRetry.run(() =>
            connection.transaction(async manager => {
                const repository = manager.getRepository(AnnictRuleLink);
                await repository.clear();
                if (sanitized.length === 0) return;
                const now = Date.now();
                await repository.insert(
                    sanitized.map(link => ({
                        ruleId: link.ruleId,
                        annictId: link.annictId,
                        viewerProfileId:
                            typeof link.viewerProfileId === 'number' && Number.isSafeInteger(link.viewerProfileId)
                                ? link.viewerProfileId
                                : null,
                        source: 'backup',
                        createdAt: now,
                        updatedAt: now,
                    })),
                );
            }),
        );
    }
}
