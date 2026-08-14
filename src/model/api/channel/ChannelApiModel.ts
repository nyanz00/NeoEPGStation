import { inject, injectable } from 'inversify';
import axios from 'axios';
import * as fs from 'fs';
import mirakurun from 'mirakurun';
import * as apid from '../../../../api';
import IChannelDB from '../../db/IChannelDB';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
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

interface NxJikkyoThread {
    start_at?: unknown;
    end_at?: unknown;
    jikkyo_force?: unknown;
}

interface NxJikkyoChannel {
    id?: unknown;
    threads?: unknown;
}

@injectable()
class ChannelApiModel implements IChannelApiModel {
    private static readonly JIKKYO_STATUS_CACHE_TTL = 30 * 1000;
    private static readonly ACTIVE_JIKKYO_IDS = new Set([
        1, 2, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 101, 103, 141, 151, 161, 171, 181, 191, 192, 193, 200, 201, 211,
        222, 236, 252, 260, 263, 265, 333,
    ]);

    private channelDB: IChannelDB;
    private config: IConfiguration;
    private mirakurunClient: mirakurun;
    private log: ILogger;
    private jikkyoStatusCache: Map<string, number> = new Map();
    private jikkyoStatusUpdatedAt: number = 0;
    private jikkyoStatusRequest: Promise<void> | null = null;

    constructor(
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IConfiguration') config: IConfiguration,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.channelDB = channelDB;
        this.config = config;
        this.mirakurunClient = mirakurunClientModel.getClient();
        this.log = logger.getLogger();
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

        const jikkyoId = this.getJikkyoId(channel.networkId, channel.serviceId);
        if (jikkyoId === null) {
            return {
                jikkyoId: null,
                watchSessionUrl: null,
                commentSessionUrl: null,
            };
        }

        const baseUrl = `wss://nx-jikkyo.tsukumijima.net/api/v1/channels/${jikkyoId}/ws`;

        return {
            jikkyoId,
            watchSessionUrl: `${baseUrl}/watch`,
            commentSessionUrl: `${baseUrl}/comment`,
        };
    }

    /**
     * KonomiTV と同じ NX-Jikkyo channels API から現在スレッドの勢いを一括取得する。
     */
    public async getJikkyoStatuses(): Promise<apid.ChannelJikkyoStatus[]> {
        await this.updateJikkyoStatusCache();
        const channels = await this.channelDB.findAll(true);

        return channels.map(channel => {
            const jikkyoId = this.getJikkyoId(channel.networkId, channel.serviceId);

            return {
                channelId: channel.id,
                jikkyoId,
                force: jikkyoId === null ? null : (this.jikkyoStatusCache.get(jikkyoId) ?? null),
            };
        });
    }

    private getJikkyoId(networkId: number, serviceId: number): string | null {
        const definition = (jikkyoChannels as JikkyoChannelDefinition[]).find(item => {
            if (item.jikkyo_id < 0 || ChannelApiModel.ACTIVE_JIKKYO_IDS.has(item.jikkyo_id) === false) {
                return false;
            }

            const definitionServiceId = parseInt(item.service_id, 0);
            if (networkId === item.network_id && serviceId === definitionServiceId) {
                return true;
            }

            return (
                0x7880 <= networkId &&
                networkId <= 0x7fef &&
                item.network_id === 15 &&
                (serviceId === definitionServiceId ||
                    serviceId - 1 === definitionServiceId ||
                    serviceId - 2 === definitionServiceId)
            );
        });

        if (typeof definition === 'undefined') {
            return null;
        }

        return `jk${definition.jikkyo_id.toString(10)}`;
    }

    private async updateJikkyoStatusCache(): Promise<void> {
        if (Date.now() - this.jikkyoStatusUpdatedAt < ChannelApiModel.JIKKYO_STATUS_CACHE_TTL) {
            return;
        }
        if (this.jikkyoStatusRequest !== null) {
            return this.jikkyoStatusRequest;
        }

        this.jikkyoStatusRequest = this.fetchJikkyoStatuses().finally(() => {
            this.jikkyoStatusRequest = null;
        });

        return this.jikkyoStatusRequest;
    }

    private async fetchJikkyoStatuses(): Promise<void> {
        const response = await axios
            .get<NxJikkyoChannel[]>('https://nx-jikkyo.tsukumijima.net/api/v1/channels', {
                timeout: 5000,
                validateStatus: () => true,
            })
            .catch(() => null);
        if (response === null || response.status !== 200 || Array.isArray(response.data) === false) {
            this.log.stream.warn(
                `NX-Jikkyo channel status request failed${response === null ? '' : `: status=${response.status.toString(10)}`}`,
            );

            return;
        }

        const now = Date.now();
        const statuses = new Map<string, number>();
        for (const channel of response.data) {
            if (typeof channel.id !== 'string' || Array.isArray(channel.threads) === false) {
                continue;
            }
            const currentThread = (channel.threads as NxJikkyoThread[]).find(thread => {
                const startAt = typeof thread.start_at === 'string' ? Date.parse(thread.start_at) : NaN;
                const endAt = typeof thread.end_at === 'string' ? Date.parse(thread.end_at) : NaN;

                return Number.isFinite(startAt) && Number.isFinite(endAt) && startAt <= now && now <= endAt;
            });
            const force = Number(currentThread?.jikkyo_force);
            if (Number.isFinite(force) === true && force >= 0) {
                statuses.set(channel.id, force);
            }
        }
        this.jikkyoStatusCache = statuses;
        this.jikkyoStatusUpdatedAt = Date.now();
    }

    private getLogoCachePath(channelId: apid.ChannelId): string {
        return path.join(this.config.getConfig().channelLogo, `${channelId.toString(10)}.png`);
    }
}

export default ChannelApiModel;
