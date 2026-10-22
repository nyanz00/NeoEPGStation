/* eslint-disable no-control-regex */
/* eslint-disable no-irregular-whitespace */
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api.js';
import Program from '../../../db/entities/Program.js';
import DateUtil from '../../../util/DateUtil.js';
import IChannelDB from '../../db/IChannelDB.js';
import IProgramDB from '../../db/IProgramDB.js';
import IIPTVApiModel from './IIPTVApiModel.js';
import ChannelUtil from '../../../util/ChannelUtil.js';
import type { IptvRequestContext } from './IptvDocumentRequestGuard.js';

const IPTVDOCUMENT_YIELD_INTERVAL = 128;

const yieldToEventLoop = (): Promise<void> => new Promise(resolve => setImmediate(resolve));

@injectable()
class IPTVApiModel implements IIPTVApiModel {
    private channelDB: IChannelDB;
    private programDB: IProgramDB;

    constructor(@inject('IChannelDB') channelDB: IChannelDB, @inject('IProgramDB') programDB: IProgramDB) {
        this.channelDB = channelDB;
        this.programDB = programDB;
    }

    /**
     * channel list を生成
     * @param host: host
     * @param isSecure: https か
     * @param mode: transcode mode
     * @param isHalfWidth: 半角で取得するか
     * @return Promise<string>
     */
    public async getChannelList(
        host: string,
        isSecure: boolean,
        mode: number,
        isHalfWidth: boolean,
        subDirectory?: string,
        requestContext?: IptvRequestContext,
    ): Promise<string> {
        const channels = await this.channelDB.findAll(true);
        requestContext?.ensureActive();

        const channelIndex: { [key: string]: number } = {};

        let str = '#EXTM3U\n';
        for (let index = 0; index < channels.length; index++) {
            if (index > 0 && index % IPTVDOCUMENT_YIELD_INTERVAL === 0) {
                await yieldToEventLoop();
                requestContext?.ensureActive();
            }
            const channel = channels[index];
            requestContext?.ensureActive();
            if (!ChannelUtil.isMediaService(channel.type)) {
                continue;
            }

            let channelName = isHalfWidth === true ? channel.halfWidthName : channel.name;
            if (typeof channelIndex[channelName] === 'undefined') {
                channelIndex[channelName] = 0;
            } else {
                channelIndex[channelName] += 1;
                for (let i = 0; i <= channelIndex[channelName]; i++) {
                    channelName += ' ';
                }
            }

            let logo = '';
            const base = subDirectory === undefined ? host : `${host}${subDirectory}`;
            if (channel.hasLogoData) {
                logo = `tvg-logo="${isSecure ? 'https' : 'http'}://${base}/api/channels/${channel.id}/logo"`;
            }
            str += `#KODIPROP:mimetype=video/mp2t\n`;
            str += `#EXTINF:-1 tvg-id="${channel.id}" ${logo} group-title="${channel.channelType}",${channelName}　\n`;
            str += `${isSecure ? 'https' : 'http'}://${base}/api/streams/live/${channel.id}/m2ts?mode=${mode}\n`;
        }

        return str;
    }

    /**
     * 番組情報を生成
     * @param days: 取得する日数
     * @param isHalfWidth: 半角で取得するか
     * @return Promise<string>
     */
    public async getEpg(days: number, isHalfWidth: boolean, requestContext?: IptvRequestContext): Promise<string> {
        const now = new Date().getTime();
        const programs = await this.programDB.findSchedule({
            startAt: now,
            endAt: now + 1000 * 60 * 60 * 24 * days,
            isHalfWidth: isHalfWidth,
            types: ['GR', 'BS', 'CS', 'SKY', 'BS4K'],
        });
        requestContext?.ensureActive();
        const channels = await this.channelDB.findAll();
        requestContext?.ensureActive();

        // channelId ごとに programs をまとめる
        const programsIndex: { [key: number]: Program[] } = {};
        for (let index = 0; index < programs.length; index++) {
            if (index > 0 && index % IPTVDOCUMENT_YIELD_INTERVAL === 0) {
                await yieldToEventLoop();
                requestContext?.ensureActive();
            }
            const program = programs[index];
            requestContext?.ensureActive();
            if (typeof programsIndex[program.channelId] === 'undefined') {
                programsIndex[program.channelId] = [];
            }

            program.name = this.replaceStr(program.name);
            if (program.description !== null) {
                program.description = this.replaceStr(program.description);
                if (program.extended !== null) {
                    program.description += this.replaceStr(program.extended);
                }
            }
            programsIndex[program.channelId].push(program);
        }

        let str =
            '<?xml version="1.0" encoding="UTF-8"?>' +
            '<!DOCTYPE tv SYSTEM "xmltv.dtd">' +
            '<tv generator-info-name="EPGStation">';
        let renderedPrograms = 0;
        for (let index = 0; index < channels.length; index++) {
            if (index > 0 && index % IPTVDOCUMENT_YIELD_INTERVAL === 0) {
                await yieldToEventLoop();
                requestContext?.ensureActive();
            }
            const channel = channels[index];
            requestContext?.ensureActive();
            if (typeof programsIndex[channel.id] === 'undefined') {
                continue;
            }
            str += `<channel id="${channel.id}" tp="${channel.channel}">`;
            str += `<display-name lang="ja_JP">${
                isHalfWidth === true ? channel.halfWidthName : channel.name
            }</display-name>`;
            str += `<service_id>${channel.serviceId}</service_id>`;
            str += '</channel>\n';
            for (const program of programsIndex[channel.id]) {
                if (renderedPrograms > 0 && renderedPrograms % IPTVDOCUMENT_YIELD_INTERVAL === 0) {
                    await yieldToEventLoop();
                    requestContext?.ensureActive();
                }
                renderedPrograms++;
                str += `<programme start="${this.getTimeStr(program.startAt)}" stop="${this.getTimeStr(
                    program.endAt,
                )}" channel="${program.channelId}">`;
                str += `<title lang="ja_JP">${program.name}</title>`;
                if (program.description !== null) {
                    str += `    <desc lang="ja_JP">${program.description}</desc>`;
                }
                str += '</programme>';
            }
        }
        str += '</tv>';

        return str;
    }

    /**
     * xml での禁止文字列を置き換える
     * @param str: string
     * @return string
     */
    private replaceStr(str: string): string {
        return str
            .replace(/</g, '＜')
            .replace(/>/g, '＞')
            .replace(/&/g, '＆')
            .replace(/"/g, '”')
            .replace(/'/g, '’')
            .replace(/\x1a/g, '');
    }

    /**
     * 時刻文字列を生成する
     * @param time: apid.UnixtimeMS
     * @return string
     */
    private getTimeStr(time: apid.UnixtimeMS): string {
        return DateUtil.format(new Date(time), `yyyyMMddhhmmss ${IPTVApiModel.TIMEZONE}`);
    }
}

namespace IPTVApiModel {
    export const TIMEZONE = new Date().toString().replace(/^.*GMT([+-]\d{4}).*$/, '$1');
}

export default IPTVApiModel;
