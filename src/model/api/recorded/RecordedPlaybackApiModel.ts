import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordedDB from '../../db/IRecordedDB';
import IRecordedPlaybackDB from '../../db/IRecordedPlaybackDB';
import ITvUserDB from '../../db/ITvUserDB';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IRecordedPlaybackApiModel from './IRecordedPlaybackApiModel';

@injectable()
export default class RecordedPlaybackApiModel implements IRecordedPlaybackApiModel {
    constructor(
        @inject('IRecordedPlaybackDB') private playbackDB: IRecordedPlaybackDB,
        @inject('IRecordedDB') private recordedDB: IRecordedDB,
        @inject('IRecordedItemUtil') private recordedItemUtil: IRecordedItemUtil,
        @inject('IEncodeManageModel') private encodeManage: IEncodeManageModel,
        @inject('ITvUserDB') private userDB: ITvUserDB,
    ) {}

    public async get(recordedId: apid.RecordedId, userId: number): Promise<apid.RecordedPlayback> {
        this.validateIds(recordedId, userId);
        if (!(await this.recordedDB.exists(recordedId))) throw new Error('録画番組が見つかりません');
        const value = await this.playbackDB.find(recordedId, userId);
        return value === null
            ? {
                  position: 0,
                  duration: 0,
                  watchedSeconds: 0,
              }
            : {
                  position: value.position,
                  duration: value.duration,
                  watchedSeconds: value.watchedSeconds,
                  updatedAt: value.updatedAt,
              };
    }

    public async getHistory(userId: number, isHalfWidth: boolean): Promise<apid.RecordedPlaybackHistory> {
        const user = await this.getUser(userId);
        const playbackItems = await this.playbackDB.findHistory(userId, user.recordedHistoryLimit);
        const records = await this.recordedDB.findIds(playbackItems.map(playback => playback.recordedId));
        const recordIndex = new Map(records.map(recorded => [recorded.id, recorded]));
        await this.encodeManage.waitUntilReady();
        const encodeIndex = this.encodeManage.getRecordedIndex();
        const items = playbackItems.flatMap((playback): apid.RecordedPlaybackHistoryItem[] => {
            const recorded = recordIndex.get(playback.recordedId);
            if (recorded === undefined) return [];
            return [
                {
                    recorded: this.recordedItemUtil.convertRecordedToRecordedItem(recorded, isHalfWidth, encodeIndex),
                    playback: {
                        position: playback.position,
                        duration: playback.duration,
                        watchedSeconds: playback.watchedSeconds,
                        updatedAt: playback.historyUpdatedAt ?? playback.updatedAt,
                    },
                },
            ];
        });
        return { items };
    }

    public async getHistorySettings(userId: number): Promise<apid.RecordedPlaybackHistorySettings> {
        const user = await this.getUser(userId);
        return { enabled: user.isRecordedHistoryEnabled, limit: user.recordedHistoryLimit };
    }

    public async updateHistorySettings(
        userId: number,
        option: apid.UpdateRecordedPlaybackHistorySettingsOption,
    ): Promise<apid.RecordedPlaybackHistorySettings> {
        const user = await this.getUser(userId);
        if (
            option === null ||
            typeof option !== 'object' ||
            (option.enabled === undefined && option.limit === undefined)
        ) {
            throw new Error('視聴履歴設定が不正です');
        }
        if (option.enabled !== undefined && typeof option.enabled !== 'boolean')
            throw new Error('視聴履歴設定が不正です');
        if (option.limit !== undefined) this.historyLimit(option.limit);
        await this.userDB.updateRecordedHistorySettings(userId, option);
        if (option.limit !== undefined && option.limit < user.recordedHistoryLimit)
            await this.playbackDB.trimHistory(userId, option.limit);
        return this.getHistorySettings(userId);
    }

    public async removeFromHistory(recordedId: apid.RecordedId, userId: number): Promise<void> {
        this.validateIds(recordedId, userId);
        await this.playbackDB.removeFromHistory(recordedId, userId);
    }

    public async update(
        recordedId: apid.RecordedId,
        userId: number,
        option: apid.UpdateRecordedPlaybackOption,
    ): Promise<apid.RecordedPlayback> {
        this.validateIds(recordedId, userId);
        if (!(await this.recordedDB.exists(recordedId))) throw new Error('録画番組が見つかりません');
        const user = await this.getUser(userId);
        const duration = this.finiteNumber(option.duration, '再生時間');
        if (duration <= 0 || duration > 24 * 60 * 60) throw new Error('再生時間が不正です');
        const position = Math.min(Math.max(this.finiteNumber(option.position, '再生位置'), 0), duration);
        const hasSession = option.sessionId !== undefined || option.sessionWatchedSeconds !== undefined;
        let sessionId: string | undefined;
        let sessionWatchedSeconds: number | undefined;
        if (hasSession) {
            if (typeof option.sessionId !== 'string' || !/^[a-z0-9-]{16,64}$/i.test(option.sessionId))
                throw new Error('視聴セッションIDが不正です');
            sessionId = option.sessionId;
            sessionWatchedSeconds = this.finiteNumber(option.sessionWatchedSeconds, '視聴時間');
            if (sessionWatchedSeconds < 0 || sessionWatchedSeconds > 30 * 24 * 60 * 60)
                throw new Error('視聴時間が不正です');
        }
        const watchedSecondsDelta = hasSession
            ? 0
            : Math.min(Math.max(this.finiteNumber(option.watchedSecondsDelta, '視聴時間'), 0), 30);
        const value = await this.playbackDB.update(recordedId, userId, {
            position,
            duration,
            watchedSecondsDelta,
            sessionId,
            sessionWatchedSeconds,
            // Ordering is intentionally based on the server receipt time. A device clock must not poison resume data.
            observedAt: Date.now(),
            historyLimit: user.recordedHistoryLimit,
            historyEnabled: user.isRecordedHistoryEnabled,
        });
        return {
            position: value.position,
            duration: value.duration,
            watchedSeconds: value.watchedSeconds,
            updatedAt: value.updatedAt,
        };
    }

    private historyLimit(value: unknown): number {
        if (typeof value !== 'number' || !Number.isInteger(value) || value < 1 || value > 200)
            throw new Error('視聴履歴の保存件数が不正です');
        return value;
    }

    private validateIds(recordedId: number, userId: number): void {
        if (!Number.isInteger(recordedId) || recordedId <= 0) throw new Error('録画IDが不正です');
        if (!Number.isInteger(userId) || userId <= 0) throw new Error('通常ユーザーを選択してください');
    }

    private async getUser(userId: number) {
        this.validateIds(1, userId);
        const user = await this.userDB.findId(userId);
        if (user === null) throw new Error('ユーザーが見つかりません');
        return user;
    }

    private finiteNumber(value: unknown, name: string): number {
        const number = Number(value);
        if (!Number.isFinite(number)) throw new Error(`${name}が不正です`);
        return number;
    }
}
