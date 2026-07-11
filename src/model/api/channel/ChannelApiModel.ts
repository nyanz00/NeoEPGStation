import { inject, injectable } from 'inversify';
import * as fs from 'fs';
import mirakurun from 'mirakurun';
import * as apid from '../../../../api';
import IChannelDB from '../../db/IChannelDB';
import IConfiguration from '../../IConfiguration';
import IMirakurunClientModel from '../../IMirakurunClientModel';
import FileUtil from '../../../util/FileUtil';
import * as path from 'path';
import IChannelApiModel, { IChannelApiModelError } from './IChannelApiModel';
import jikkyoChannels from './jikkyo_channels.json';

interface JikkyoChannelDefinition {
    jikkyo_id: number;
    network_id: number;
    service_id: string;
}

@injectable()
class ChannelApiModel implements IChannelApiModel {
    private static readonly ACTIVE_JIKKYO_IDS = new Set([
        1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 101, 103, 141, 151, 161, 171, 181, 191, 192, 193, 200, 201, 211,
        222, 236, 252, 260, 263, 265, 333,
    ]);

    private channelDB: IChannelDB;
    private config: IConfiguration;
    private mirakurunClient: mirakurun;

    constructor(
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IConfiguration') config: IConfiguration,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
    ) {
        this.channelDB = channelDB;
        this.config = config;
        this.mirakurunClient = mirakurunClientModel.getClient();
    }

    /**
     * チャンネル情報取得
     * @return Promise<ChannelItem[]>
     */
    public async getChannels(): Promise<apid.ChannelItem[]> {
        const channels = await this.channelDB.findAll(true);

        return channels.map(c => {
            const result: apid.ChannelItem = {
                id: c.id,
                serviceId: c.serviceId,
                networkId: c.networkId,
                name: c.name,
                halfWidthName: c.halfWidthName,
                hasLogoData: c.hasLogoData,
                channelType: <any>c.channelType,
                channel: c.channel,
                type: c.type,
            };

            if (c.remoteControlKeyId !== null) {
                result.remoteControlKeyId = c.remoteControlKeyId;
            }

            return result;
        });
    }

    /**
     * logo 取得
     * @param channelId: apid.ChannelId
     * @return Promise<Buffer>
     */
    public async getLogo(channelId: apid.ChannelId): Promise<Buffer> {
        const channel = await this.channelDB.findId(channelId);

        if (channel === null || channel.hasLogoData === false) {
            throw new Error(IChannelApiModelError.NOT_FOUND);
        }

        const logoPath = this.getLogoCachePath(channelId);
        try {
            return await fs.promises.readFile(logoPath);
        } catch (err: any) {
            if (err.code !== 'ENOENT') {
                throw err;
            }
        }

        const logo = await this.mirakurunClient.getLogoImage(channelId);
        await FileUtil.mkdir(path.dirname(logoPath));
        await fs.promises.writeFile(logoPath, logo);

        return logo;
    }

    public async getJikkyoInfo(channelId: apid.ChannelId): Promise<apid.ChannelJikkyoInfo> {
        const channel = await this.channelDB.findId(channelId);
        if (channel === null) {
            throw new Error(IChannelApiModelError.NOT_FOUND);
        }

        const definition = (jikkyoChannels as JikkyoChannelDefinition[]).find(item => {
            if (item.jikkyo_id < 0 || ChannelApiModel.ACTIVE_JIKKYO_IDS.has(item.jikkyo_id) === false) {
                return false;
            }

            const serviceId = parseInt(item.service_id, 0);
            if (channel.networkId === item.network_id && channel.serviceId === serviceId) {
                return true;
            }

            return (
                0x7880 <= channel.networkId &&
                channel.networkId <= 0x7fef &&
                item.network_id === 15 &&
                (channel.serviceId === serviceId ||
                    channel.serviceId - 1 === serviceId ||
                    channel.serviceId - 2 === serviceId)
            );
        });

        if (typeof definition === 'undefined') {
            return {
                jikkyoId: null,
                watchSessionUrl: null,
                commentSessionUrl: null,
            };
        }

        const jikkyoId = `jk${definition.jikkyo_id.toString(10)}`;
        const baseUrl = `wss://nx-jikkyo.tsukumijima.net/api/v1/channels/${jikkyoId}/ws`;

        return {
            jikkyoId,
            watchSessionUrl: `${baseUrl}/watch`,
            commentSessionUrl: `${baseUrl}/comment`,
        };
    }

    private getLogoCachePath(channelId: apid.ChannelId): string {
        return path.join(this.config.getConfig().channelLogo, `${channelId.toString(10)}.png`);
    }
}

export default ChannelApiModel;
