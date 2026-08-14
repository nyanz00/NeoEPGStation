import { inject, injectable } from 'inversify';
import ViewerCredential from '../../db/entities/ViewerCredential';
import ViewerProfile from '../../db/entities/ViewerProfile';
import ViewerProfileSession from '../../db/entities/ViewerProfileSession';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import IViewerProfileDB from './IViewerProfileDB';

@injectable()
export default class ViewerProfileDB implements IViewerProfileDB {
    constructor(
        @inject('IDBOperator') private op: IDBOperator,
        @inject('IPromiseRetry') private promiseRetry: IPromiseRetry,
    ) {}

    public async findAll(): Promise<ViewerProfile[]> {
        const repository = (await this.op.getConnection()).getRepository(ViewerProfile);
        return this.promiseRetry.run(() => repository.find({ order: { id: 'ASC' } }));
    }

    public async findId(profileId: number): Promise<ViewerProfile | null> {
        const repository = (await this.op.getConnection()).getRepository(ViewerProfile);
        const result = await this.promiseRetry.run(() => repository.findOne({ where: { id: profileId } }));
        return result ?? null;
    }

    public async findByTvUserId(tvUserId: number): Promise<ViewerProfile | null> {
        const repository = (await this.op.getConnection()).getRepository(ViewerProfile);
        const result = await this.promiseRetry.run(() =>
            repository.findOne({ where: { tvUserId }, order: { id: 'ASC' } }),
        );
        return result ?? null;
    }

    public async insert(name: string, tvUserId: number | null, pinSalt: string, pinHash: string): Promise<number> {
        const now = Date.now();
        const connection = await this.op.getConnection();
        const result = await this.promiseRetry.run(() =>
            connection
                .createQueryBuilder()
                .insert()
                .into(ViewerProfile)
                .values({ name, tvUserId, pinSalt, pinHash, createdAt: now, updatedAt: now })
                .execute(),
        );
        return Number(result.identifiers[0].id);
    }

    public async updateSecurity(
        profileId: number,
        pinSalt: string,
        pinHash: string,
        recoveryCodeSalt: string,
        recoveryCodeHash: string,
    ): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(ViewerProfile);
        await this.promiseRetry.run(() =>
            repository.update(profileId, {
                pinSalt,
                pinHash,
                recoveryCodeSalt,
                recoveryCodeHash,
                updatedAt: Date.now(),
            }),
        );
    }

    public async updateRecoveryCode(
        profileId: number,
        recoveryCodeSalt: string,
        recoveryCodeHash: string,
    ): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(ViewerProfile);
        await this.promiseRetry.run(() =>
            repository.update(profileId, {
                recoveryCodeSalt,
                recoveryCodeHash,
                updatedAt: Date.now(),
            }),
        );
    }

    public async findSession(profileId: number, tokenHash: string): Promise<ViewerProfileSession | null> {
        const repository = (await this.op.getConnection()).getRepository(ViewerProfileSession);
        const result = await this.promiseRetry.run(() =>
            repository.findOne({ where: { viewerProfileId: profileId, tokenHash } }),
        );
        return result ?? null;
    }

    public async insertSession(profileId: number, tokenHash: string): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(ViewerProfileSession);
        await this.promiseRetry.run(() =>
            repository.insert({ viewerProfileId: profileId, tokenHash, createdAt: Date.now() }),
        );
    }

    public async deleteSessions(profileId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(ViewerProfileSession);
        await this.promiseRetry.run(() => repository.delete({ viewerProfileId: profileId }));
    }

    public async findCredential(profileId: number, provider: string): Promise<ViewerCredential | null> {
        const repository = (await this.op.getConnection()).getRepository(ViewerCredential);
        const result = await this.promiseRetry.run(() =>
            repository.findOne({ where: { viewerProfileId: profileId, provider } }),
        );
        return result ?? null;
    }

    public async upsertCredential(
        profileId: number,
        provider: string,
        encryptedValue: string,
        iv: string,
        authTag: string,
    ): Promise<void> {
        const connection = await this.op.getConnection();
        const repository = connection.getRepository(ViewerCredential);
        const current = await this.findCredential(profileId, provider);
        const now = Date.now();
        if (current === null) {
            await this.promiseRetry.run(() =>
                repository.insert({
                    viewerProfileId: profileId,
                    provider,
                    encryptedValue,
                    iv,
                    authTag,
                    createdAt: now,
                    updatedAt: now,
                }),
            );
            return;
        }
        await this.promiseRetry.run(() =>
            repository.update(current.id, { encryptedValue, iv, authTag, updatedAt: now }),
        );
    }

    public async deleteCredential(profileId: number, provider: string): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(ViewerCredential);
        await this.promiseRetry.run(() => repository.delete({ viewerProfileId: profileId, provider }));
    }

    public async deleteCredentials(profileId: number): Promise<void> {
        const repository = (await this.op.getConnection()).getRepository(ViewerCredential);
        await this.promiseRetry.run(() => repository.delete({ viewerProfileId: profileId }));
    }
}
