import * as apid from '../../../../api';

export default interface IUserApiModel {
    gets(): Promise<apid.Users>;
    add(option: apid.AddUserOption): Promise<apid.UserId>;
    update(userId: apid.UserId, option: apid.UpdateUserOption): Promise<void>;
}
