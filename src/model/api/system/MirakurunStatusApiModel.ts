import { inject, injectable } from 'inversify';
import * as mapid from '../../../../node_modules/mirakurun/api';
import * as apid from '../../../../api';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import IMirakurunStatusApiModel from './IMirakurunStatusApiModel';

@injectable()
export default class MirakurunStatusApiModel implements IMirakurunStatusApiModel {
    private mirakurunClientModel: IMirakurunClientModel;

    constructor(@inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel) {
        this.mirakurunClientModel = mirakurunClientModel;
    }

    public async getStatus(): Promise<apid.SystemMirakurunInfo> {
        const startedAt = Date.now();
        try {
            const client = this.mirakurunClientModel.getClient();
            const [status, tuners] = await Promise.all([client.getStatus(), client.getTuners()]);
            const sampledAt = Date.now();
            return {
                connected: true,
                sampledAt,
                responseTimeMs: sampledAt - startedAt,
                version: status.version,
                epg: {
                    gatheringNetworks: status.epg.gatheringNetworks,
                    storedEvents: status.epg.storedEvents,
                },
                streamCount: status.streamCount,
                errorCount: status.errorCount,
                tuners: tuners.map(tuner => this.mapTuner(tuner)),
            };
        } catch (err: any) {
            const sampledAt = Date.now();
            return {
                connected: false,
                sampledAt,
                responseTimeMs: sampledAt - startedAt,
                error: err instanceof Error ? err.message : String(err),
                tuners: [],
            };
        }
    }

    private mapTuner(tuner: mapid.TunerDevice): apid.SystemMirakurunTuner {
        return {
            index: tuner.index,
            name: tuner.name,
            types: tuner.types,
            pid: tuner.pid,
            isAvailable: tuner.isAvailable,
            isRemote: tuner.isRemote,
            isFree: tuner.isFree,
            isUsing: tuner.isUsing,
            isFault: tuner.isFault,
            users: tuner.users.map(user => {
                const streamInfo = Object.values(user.streamInfo ?? {});
                return {
                    id: user.id,
                    priority: user.priority,
                    agent: user.agent,
                    url: user.url,
                    channel: user.streamSetting?.channel
                        ? {
                              type: user.streamSetting.channel.type,
                              channel: user.streamSetting.channel.channel,
                              name: user.streamSetting.channel.name,
                          }
                        : undefined,
                    networkId: user.streamSetting?.networkId,
                    serviceId: user.streamSetting?.serviceId,
                    eventId: user.streamSetting?.eventId,
                    packetCount: streamInfo.reduce((sum, item) => sum + item.packet, 0),
                    dropCount: streamInfo.reduce((sum, item) => sum + item.drop, 0),
                };
            }),
        };
    }
}
