import * as apid from '../../../../api.js';

export default interface IConfigApiModel {
    getConfig(isSecure: boolean): Promise<apid.Config>;
}
