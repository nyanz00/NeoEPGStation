import * as apid from '../../../../../api.js';

export interface HLSFileDeleterOption {
    streamId: apid.StreamId;
    streamFilePath: string;
}

export default interface IHLSFileDeleterModel {
    setOption(option: HLSFileDeleterOption): void;
    deleteAllFiles(): Promise<void>;
}
