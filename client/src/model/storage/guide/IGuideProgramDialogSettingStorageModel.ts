import IStorageBaseModel from '../IStorageBaseModel';

export interface IGuideProgramDialogSettingValue {
    encode: string;
    isDeleteOriginalAfterEncode: boolean;
    updateThumbnail: boolean;
}

export const NONE_ENCODE_OPTION = 'TS';

export type IGuideProgramDialogSettingStorageModel = IStorageBaseModel<IGuideProgramDialogSettingValue>;
