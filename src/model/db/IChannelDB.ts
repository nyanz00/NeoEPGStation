import * as apid from '../../../api.js';
import * as mapid from '../tuner/TunerApi.js';
import Channel from '../../db/entities/Channel.js';

export interface ChannelUpdateValues {
    insert: mapid.Service[];
    update: mapid.Service[];
    delete: mapid.ServiceId[];
}

export default interface IChannelDB {
    insert(channels: mapid.Service[]): Promise<void>;
    update(values: ChannelUpdateValues): Promise<void>;
    findId(channelId: apid.ChannelId): Promise<Channel | null>;
    findChannleTypes(types: apid.ChannelType[], needSort?: boolean): Promise<Channel[]>;
    findAll(needSort?: boolean): Promise<Channel[]>;
}
