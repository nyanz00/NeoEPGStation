import * as apid from '../../../../api.js';

export default interface IMirakurunStatusApiModel {
    getStatus(): Promise<apid.SystemMirakurunInfo>;
}
