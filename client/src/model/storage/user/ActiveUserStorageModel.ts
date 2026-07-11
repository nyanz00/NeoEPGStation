import { inject, injectable } from 'inversify';
import AbstractStorageBaseModel from '../AbstractStorageBaseModel';
import IStorageOperationModel from '../IStorageOperationModel';
import { IActiveUserStorageModel, IActiveUserValue } from './IActiveUserStorageModel';

@injectable()
export default class ActiveUserStorageModel extends AbstractStorageBaseModel<IActiveUserValue> implements IActiveUserStorageModel {
    constructor(@inject('IStorageOperationModel') op: IStorageOperationModel) {
        super(op);
    }

    public getDefaultValue(): IActiveUserValue {
        return {
            userId: null,
        };
    }

    public getStorageKey(): string {
        return 'activeUser';
    }
}
