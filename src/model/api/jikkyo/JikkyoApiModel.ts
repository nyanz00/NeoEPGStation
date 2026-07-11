import axios from 'axios';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IChannelApiModel from '../channel/IChannelApiModel';
import IRecordedApiModel from '../recorded/IRecordedApiModel';
import IJikkyoApiModel from './IJikkyoApiModel';

interface KakologChat {
    no?: string | number;
    date?: string | number;
    date_usec?: string | number;
    user_id?: string;
    mail?: string;
    premium?: string | number;
    deleted?: string | number;
    content?: string;
}

interface KakologPacket {
    chat?: KakologChat;
}

const COLOR_CODES: { [command: string]: string } = {
    white: '#FFEAEA',
    red: '#F02840',
    pink: '#FD7E80',
    orange: '#FDA708',
    yellow: '#FFE133',
    green: '#64DD17',
    cyan: '#00D4F5',
    blue: '#4763FF',
    purple: '#D500F9',
    black: '#1E1310',
    white2: '#CCCC99',
    niconicowhite: '#CCCC99',
    red2: '#CC0033',
    truered: '#CC0033',
    pink2: '#FF33CC',
    orange2: '#FF6600',
    passionorange: '#FF6600',
    yellow2: '#999900',
    madyellow: '#999900',
    green2: '#00CC66',
    elementalgreen: '#00CC66',
    cyan2: '#00CCCC',
    blue2: '#3399FF',
    marineblue: '#3399FF',
    purple2: '#6633CC',
    nobleviolet: '#6633CC',
    black2: '#666666',
};

@injectable()
export default class JikkyoApiModel implements IJikkyoApiModel {
    private readonly configuration: IConfiguration;
    private readonly channelApiModel: IChannelApiModel;
    private readonly recordedApiModel: IRecordedApiModel;
    private readonly log: ILogger;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IChannelApiModel') channelApiModel: IChannelApiModel,
        @inject('IRecordedApiModel') recordedApiModel: IRecordedApiModel,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.configuration = configuration;
        this.channelApiModel = channelApiModel;
        this.recordedApiModel = recordedApiModel;
        this.log = logger.getLogger();
    }

    public async getRecordedComments(recordedId: apid.RecordedId): Promise<apid.RecordedJikkyoComments> {
        const recorded = await this.recordedApiModel.get(recordedId, false);
        if (recorded === null) {
            return this.failure('録画情報が見つかりません。');
        }

        const jikkyoInfo = await this.channelApiModel.getJikkyoInfo(recorded.channelId);
        if (jikkyoInfo.jikkyoId === null) {
            return this.failure('この放送局はNX-Jikkyoの過去ログに対応していません。');
        }

        const config = this.configuration.getConfig();
        const startTime = Math.floor(recorded.startAt / 1000) - config.timeSpecifiedStartMargin;
        const endTime = Math.ceil(recorded.endAt / 1000) + config.timeSpecifiedEndMargin;
        this.log.stream.info(
            `request recorded NX-Jikkyo comments: recordedId=${recordedId.toString(10)}, ` +
                `jk=${jikkyoInfo.jikkyoId.toString()}, start=${startTime.toString(10)}, end=${endTime.toString(10)}`,
        );
        const response = await axios
            .get(`https://jikkyo.tsukumijima.net/api/kakolog/${jikkyoInfo.jikkyoId}`, {
                params: {
                    starttime: startTime,
                    endtime: endTime,
                    format: 'json',
                },
                timeout: 30000,
                validateStatus: () => true,
            })
            .catch(() => null);

        if (response === null) {
            this.log.stream.warn(`recorded NX-Jikkyo request failed: recordedId=${recordedId.toString(10)}`);
            return this.failure('NX-Jikkyo過去ログAPIに接続できませんでした。');
        }
        if (response.status !== 200) {
            this.log.stream.warn(
                `recorded NX-Jikkyo response error: recordedId=${recordedId.toString(10)}, status=${response.status.toString(10)}`,
            );
            return this.failure(`NX-Jikkyo過去ログAPIでエラーが発生しました。(HTTP ${response.status.toString(10)})`);
        }
        if (typeof response.data?.error === 'string') {
            this.log.stream.warn(
                `recorded NX-Jikkyo response error: recordedId=${recordedId.toString(10)}, ` +
                    `detail=${response.data.error}`,
            );
            return this.failure(response.data.error);
        }

        const packets: KakologPacket[] = Array.isArray(response.data?.packet) === true ? response.data.packet : [];
        const comments: apid.RecordedJikkyoComment[] = [];
        for (const packet of packets) {
            const chat = packet.chat;
            if (
                typeof chat?.content !== 'string' ||
                chat.content.length === 0 ||
                `${chat.deleted ?? ''}` === '1' ||
                (this.isSpecialCommand(chat.content) === true && `${chat.premium ?? ''}` === '3')
            ) {
                continue;
            }

            const postedAtSeconds = Number(chat.date);
            const postedAtMicroseconds = Number(chat.date_usec ?? 0);
            if (Number.isFinite(postedAtSeconds) === false || Number.isFinite(postedAtMicroseconds) === false) {
                continue;
            }

            const command = this.parseCommand(chat.mail);
            const commentId = Number(chat.no ?? comments.length);
            comments.push({
                id: Number.isFinite(commentId) === true ? commentId : comments.length,
                time: postedAtSeconds - startTime + postedAtMicroseconds / 1000000,
                text: chat.content,
                color: command.color,
                position: command.position,
                size: command.size,
                userId: String(chat.user_id ?? ''),
                postedAt: postedAtSeconds * 1000 + postedAtMicroseconds / 1000,
            });
        }
        comments.sort((left, right) => left.time - right.time);
        this.log.stream.info(
            `received recorded NX-Jikkyo comments: recordedId=${recordedId.toString(10)}, ` +
                `packets=${packets.length.toString(10)}, comments=${comments.length.toString(10)}`,
        );

        return {
            isSuccess: comments.length > 0,
            comments,
            detail:
                comments.length > 0
                    ? 'NX-Jikkyoの過去ログコメントを取得しました。'
                    : 'この録画の過去ログコメントは存在しません。',
        };
    }

    private failure(detail: string): apid.RecordedJikkyoComments {
        return {
            isSuccess: false,
            comments: [],
            detail,
        };
    }

    private isSpecialCommand(comment: string): boolean {
        return /^\/[a-z][a-z0-9_-]*(?:\s|$)/i.test(comment);
    }

    private parseCommand(mail: string | undefined): {
        color: string;
        position: apid.JikkyoCommentPosition;
        size: apid.JikkyoCommentSize;
    } {
        let color = '#FFEAEA';
        let position: apid.JikkyoCommentPosition = 'right';
        let size: apid.JikkyoCommentSize = 'medium';

        for (const command of (mail ?? '').split(/\s+/)) {
            if (/^#[0-9a-f]{6}$/i.test(command) === true) {
                color = command;
            } else if (typeof COLOR_CODES[command] !== 'undefined') {
                color = COLOR_CODES[command];
            } else if (command === 'ue') {
                position = 'top';
            } else if (command === 'shita') {
                position = 'bottom';
            } else if (command === 'naka') {
                position = 'right';
            } else if (command === 'big' || command === 'medium' || command === 'small') {
                size = command;
            }
        }

        return { color, position, size };
    }
}
