import * as apid from '../../../../api';

export default interface IUserApiModel {
    gets(): Promise<apid.Users>;
    add(option: apid.AddUserOption): Promise<apid.UserId>;
    update(userId: apid.UserId, option: apid.UpdateUserOption): Promise<void>;
    updateAdmin(actorUserId: apid.UserId, userId: apid.UserId, option: apid.UpdateUserAdminOption): Promise<void>;
    delete(userId: apid.UserId): Promise<void>;
}
