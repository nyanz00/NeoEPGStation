import * as apid from '../../../../../api';
import ProcessUtil from '../../../../util/ProcessUtil';
import IStreamBaseModel from './IStreamBaseModel';

export type LiveStreamModelProvider = () => Promise<ILiveStreamBaseModel>;
export type LiveHLSStreamModelProvider = () => Promise<ILiveStreamBaseModel>;

export interface LiveStreamOption {
    channelId: apid.ChannelId;
    cmd?: string;
    preprocessor?: ProcessUtil.Cmds;
}

export default interface ILiveStreamBaseModel extends IStreamBaseModel<LiveStreamOption> {
    setOption(option: LiveStreamOption, mode: number): void;
}
