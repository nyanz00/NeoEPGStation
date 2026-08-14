import * as apid from '../../../api';
import TvUser from '../../db/entities/TvUser';

export default interface ITvUserDB {
    restore(items: TvUser[]): Promise<void>;
    findAll(): Promise<TvUser[]>;
    findId(userId: apid.UserId): Promise<TvUser | null>;
    insertOnce(name: string): Promise<apid.UserId>;
    updateOnce(userId: apid.UserId, name: string): Promise<void>;
    updateRecordedHistoryEnabled(userId: apid.UserId, enabled: boolean): Promise<void>;
    ensureDefaultUser(): Promise<TvUser>;
}
