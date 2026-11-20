import * as apid from '../../../../api.js';
import Recorded from '../../../db/entities/Recorded.js';
import Reserve from '../../../db/entities/Reserve.js';
import { OperatorErrorEncodeInfo, OperatorFinishEncodeInfo } from '../../event/IOperatorEncodeEvent.js';

export default interface IDiscordNotificationModel {
    getSettings(): Promise<apid.DiscordNotificationSettings>;
    updateSettings(settings: apid.UpdateDiscordNotificationSettings): Promise<apid.DiscordNotificationSettings>;
    testDestination(destinationId: string): Promise<void>;
    notifyRecordingStart(recorded: Recorded): void;
    notifyRecordingFinish(recorded: Recorded): void;
    notifyRecordingFailed(reserve: Reserve, recorded: Recorded | null): void;
    notifyEncodingFinish(info: OperatorFinishEncodeInfo): void;
    notifyEncodingFailed(info: OperatorErrorEncodeInfo): void;
}
