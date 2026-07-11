import { inject, injectable } from 'inversify';
import * as apid from '../../../api';
import TvUser from '../../db/entities/TvUser';
import IPromiseRetry from '../IPromiseRetry';
import IDBOperator from './IDBOperator';
import ITvUserDB from './ITvUserDB';

@injectable()
export default class TvUserDB implements ITvUserDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    public async restore(items: TvUser[]): Promise<void> {
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        await queryRunner.startTransaction();

        let hasError = false;
        try {
            await queryRunner.manager.clear(TvUser);
            for (const item of items) {
                await queryRunner.manager.insert(TvUser, item);
            }
            await queryRunner.commitTransaction();
        } catch (err: any) {
            console.error(err);
            hasError = true;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError) {
            throw new Error('restore error');
        }
    }

    public async findAll(): Promise<TvUser[]> {
        const connection = await this.op.getConnection();
        const repository = connection.getRepository(TvUser);

        return await this.promieRetry.run(() => {
            return repository.find({
                order: {
                    id: 'ASC',
                },
            });
        });
    }

    public async findId(userId: apid.UserId): Promise<TvUser | null> {
        const connection = await this.op.getConnection();
        const repository = connection.getRepository(TvUser);

        const result = await this.promieRetry.run(() => {
            return repository.findOne({
                where: { id: userId },
            });
        });

        return typeof result === 'undefined' ? null : result;
    }

    public async insertOnce(name: string): Promise<apid.UserId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(TvUser).values({
            name,
            createdAt: Date.now(),
        });

        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    public async updateOnce(userId: apid.UserId, name: string): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().update(TvUser).set({ name }).where({ id: userId });

        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    public async ensureDefaultUser(): Promise<TvUser> {
        const users = await this.findAll();
        if (users.length > 0) {
            return users[0];
        }

        const userId = await this.insertOnce('user1');
        const user = await this.findId(userId);
        if (user === null) {
            throw new Error('TvUserIsNull');
        }

        return user;
    }
}
