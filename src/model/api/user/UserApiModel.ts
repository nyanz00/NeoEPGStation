import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import ITvUserDB from '../../db/ITvUserDB';
import IUserApiModel from './IUserApiModel';

@injectable()
export default class UserApiModel implements IUserApiModel {
    private userDB: ITvUserDB;

    constructor(@inject('ITvUserDB') userDB: ITvUserDB) {
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
}
