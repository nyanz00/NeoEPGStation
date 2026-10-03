import * as apid from '../../../api';

export default interface IAutoEncodeSettingsModel {
    getSettings(): Promise<apid.AutoEncodeSettings>;
    updateSettings(option: apid.UpdateAutoEncodeSettingsOption): Promise<apid.AutoEncodeSettings>;
}
