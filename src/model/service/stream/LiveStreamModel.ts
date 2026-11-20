import { injectable } from 'inversify';
import ILiveStreamBaseModel from './base/ILiveStreamBaseModel.js';
import LiveStreamBaseModel from './base/LiveStreamBaseModel.js';

@injectable()
export default class LiveStreamModel extends LiveStreamBaseModel implements ILiveStreamBaseModel {
    protected getStreamType(): 'LiveStream' {
        return 'LiveStream';
    }
}
