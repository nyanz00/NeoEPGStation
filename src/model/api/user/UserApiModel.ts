import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import AnnictEpisodeWatch from '../../../db/entities/AnnictEpisodeWatch';
import AnnictRuleLink from '../../../db/entities/AnnictRuleLink';
import Recorded from '../../../db/entities/Recorded';
import RecordedPlayback from '../../../db/entities/RecordedPlayback';
import Reserve from '../../../db/entities/Reserve';
import Rule from '../../../db/entities/Rule';
import TvUser from '../../../db/entities/TvUser';
import ViewerCredential from '../../../db/entities/ViewerCredential';
import ViewerProfile from '../../../db/entities/ViewerProfile';
import ViewerProfileSession from '../../../db/entities/ViewerProfileSession';
import IDBOperator from '../../db/IDBOperator';
import ITvUserDB from '../../db/ITvUserDB';
import IUserApiModel from './IUserApiModel';

@injectable()
export default class UserApiModel implements IUserApiModel {
    private userDB: ITvUserDB;

    constructor(
        @inject('ITvUserDB') userDB: ITvUserDB,
        @inject('IDBOperator') private dbOperator: IDBOperator,
    ) {
        this.userDB = userDB;
    }

    public async gets(): Promise<apid.Users> {
        await this.userDB.ensureDefaultUser();
        const users = await this.userDB.findAll();

        return {
            users: users.map(user => {
                return {
                    id: user.id,
                    name: user.name,
                    createdAt: user.createdAt,
                };
            }),
        };
    }

    public async add(option: apid.AddUserOption): Promise<apid.UserId> {
        const name = option.name.trim();
        if (name.length === 0) {
            throw new Error('UserNameIsEmpty');
        }

        return this.userDB.insertOnce(name);
    }

    public async update(userId: apid.UserId, option: apid.UpdateUserOption): Promise<void> {
        const name = option.name.trim();
        if (name.length === 0) {
            throw new Error('UserNameIsEmpty');
        }
        if ((await this.userDB.findId(userId)) === null) {
            throw new Error('UserIsNull');
        }

        await this.userDB.updateOnce(userId, name);
    }

    public async delete(userId: apid.UserId): Promise<void> {
        const connection = await this.dbOperator.getConnection();
        const queryRunner = connection.createQueryRunner();
        await queryRunner.startTransaction();

        try {
            const userRepository = queryRunner.manager.getRepository(TvUser);
            const user = await userRepository.findOne({ where: { id: userId } });
            if (user === null || typeof user === 'undefined') throw new Error('削除するユーザーが見つかりません');
            if ((await userRepository.count()) <= 1) {
                throw new Error('最後のユーザーは削除できません');
            }

            const recordedCount = await queryRunner.manager.getRepository(Recorded).count({ where: { userId } });
            const ruleCount = await queryRunner.manager.getRepository(Rule).count({ where: { userId } });
            const reserveCount = await queryRunner.manager.getRepository(Reserve).count({ where: { userId } });
            if (recordedCount > 0 || ruleCount > 0 || reserveCount > 0) {
                const owned = [
                    recordedCount > 0 ? `録画済み${recordedCount}件` : '',
                    ruleCount > 0 ? `ルール${ruleCount}件` : '',
                    reserveCount > 0 ? `予約${reserveCount}件` : '',
                ].filter(value => value.length > 0);
                throw new Error(
                    `${owned.join('、')}を所有しているため削除できません。先に対象データを削除または別ユーザーへ移してください`,
                );
            }

            const profiles = await queryRunner.manager
                .getRepository(ViewerProfile)
                .find({ where: { tvUserId: userId } });
            for (const profile of profiles) {
                await queryRunner.manager.delete(AnnictEpisodeWatch, { viewerProfileId: profile.id });
                await queryRunner.manager.delete(AnnictRuleLink, { viewerProfileId: profile.id });
                await queryRunner.manager.delete(ViewerCredential, { viewerProfileId: profile.id });
                await queryRunner.manager.delete(ViewerProfileSession, { viewerProfileId: profile.id });
            }
            await queryRunner.manager.delete(ViewerProfile, { tvUserId: userId });
            await queryRunner.manager.delete(RecordedPlayback, { userId });
            await userRepository.delete(userId);
            await queryRunner.commitTransaction();
        } catch (error) {
            await queryRunner.rollbackTransaction();
            throw error;
        } finally {
            await queryRunner.release();
        }
    }
}
