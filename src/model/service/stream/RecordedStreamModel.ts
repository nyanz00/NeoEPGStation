import { injectable } from 'inversify';
import IRecordedStreamBaseModel from './base/IRecordedStreamBaseModel.js';
import RecordedStreamBaseModel from './base/RecordedStreamBaseModel.js';

@injectable()
export default class RecordedStreamModel extends RecordedStreamBaseModel implements IRecordedStreamBaseModel {
    protected getStreamType(): 'RecordedStream' {
        return 'RecordedStream';
    }
}
