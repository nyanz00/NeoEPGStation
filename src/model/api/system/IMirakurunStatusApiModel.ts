import * as apid from '../../../../api';

export default interface IMirakurunStatusApiModel {
    getStatus(): Promise<apid.SystemMirakurunInfo>;
}
