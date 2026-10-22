import { injectable } from 'inversify';
import ILiveStreamBaseModel from './base/ILiveStreamBaseModel.js';
import LiveStreamBaseModel from './base/LiveStreamBaseModel.js';

@injectable()
export default class LiveHLSStreamModel extends LiveStreamBaseModel implements ILiveStreamBaseModel {
    protected getStreamType(): 'LiveHLS' {
        return 'LiveHLS';
    }
}
