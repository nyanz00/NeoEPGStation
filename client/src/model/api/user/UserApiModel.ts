import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import IRepositoryModel from '../IRepositoryModel';
import IUserApiModel from './IUserApiModel';

@injectable()
export default class UserApiModel implements IUserApiModel {
    private repository: IRepositoryModel;

    constructor(@inject('IRepositoryModel') repository: IRepositoryModel) {
        this.repository = repository;
    }

    public async gets(): Promise<apid.Users> {
        const result = await this.repository.get('/users');

        return result.data;
    }

    public async add(option: apid.AddUserOption): Promise<apid.UserId> {
        const result = await this.repository.post('/users', option);

        return result.data.userId;
    }

    public async update(userId: apid.UserId, option: apid.UpdateUserOption): Promise<void> {
        await this.repository.put(`/users/${userId}`, option);
    }
}
