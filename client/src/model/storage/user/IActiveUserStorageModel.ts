import * as apid from '../../../../../api';
import IStorageBaseModel from '../IStorageBaseModel';

export type ActiveUserId = apid.UserId | 'master' | null;

export interface IActiveUserValue {
    userId: ActiveUserId;
}

export type IActiveUserStorageModel = IStorageBaseModel<IActiveUserValue>;
