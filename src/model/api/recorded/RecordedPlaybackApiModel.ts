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

    public async getHistory(
        userId: number,
        isHalfWidth: boolean,
        limit: number,
    ): Promise<apid.RecordedPlaybackHistory> {
        this.validateIds(1, userId);
        const normalizedLimit = this.historyLimit(limit);
        const playbackItems = await this.playbackDB.findHistory(userId, normalizedLimit);
        const records = await this.recordedDB.findIds(playbackItems.map(playback => playback.recordedId));
        const recordIndex = new Map(records.map(recorded => [recorded.id, recorded]));
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
        return { enabled: user.isRecordedHistoryEnabled };
    }

    public async updateHistorySettings(
        userId: number,
        option: apid.RecordedPlaybackHistorySettings,
    ): Promise<apid.RecordedPlaybackHistorySettings> {
        await this.getUser(userId);
        if (typeof option.enabled !== 'boolean') throw new Error('視聴履歴設定が不正です');
        await this.userDB.updateRecordedHistoryEnabled(userId, option.enabled);
        return { enabled: option.enabled };
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
        const watchedSecondsDelta = Math.min(
            Math.max(this.finiteNumber(option.watchedSecondsDelta, '視聴時間'), 0),
            30,
        );
        const value = await this.playbackDB.update(recordedId, userId, {
            position,
            duration,
            watchedSecondsDelta,
            // Ordering is intentionally based on the server receipt time. A device clock must not poison resume data.
            observedAt: Date.now(),
            historyLimit: this.historyLimit(option.historyLimit),
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
        const limit = Number(value ?? 50);
        if (!Number.isInteger(limit) || limit < 1 || limit > 200) throw new Error('視聴履歴の保存件数が不正です');
        return limit;
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
