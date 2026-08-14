import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordedDB, { FindAllOption } from '../../db/IRecordedDB';
import IIPCClient from '../../ipc/IIPCClient';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IRecordingApiModel from './IRecordingApiModel';

@injectable()
export default class RecordingApiModel implements IRecordingApiModel {
    private ipc: IIPCClient;
    private recordedDB: IRecordedDB;
    private recordedItemUtil: IRecordedItemUtil;

    constructor(
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IRecordedItemUtil') recordedItemUtil: IRecordedItemUtil,
    ) {
        this.ipc = ipc;
        this.recordedDB = recordedDB;
        this.recordedItemUtil = recordedItemUtil;
    }

    /**
     * 録画情報の取得
     * @param option: GetRecordedOption
     * @return Promise<apid.Records>
     */
    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        (<FindAllOption>option).isRecording = true;
        const [records, total] = await this.recordedDB.findAll(option, {
            isNeedVideoFiles: true,
            isNeedThumbnails: true,
            isNeedsDropLog: true,
            isNeedTags: false,
        });
        const liveDropLogFiles = await this.ipc.recording.getCurrentDropLogFiles();
        const liveDropLogFileIndex: { [recordedId: number]: apid.DropLogFile } = {};
        for (const dropLogFile of liveDropLogFiles) {
            liveDropLogFileIndex[dropLogFile.recordedId] = dropLogFile.dropLogFile;
        }

        return {
            records: records.map(r => {
                const item = this.recordedItemUtil.convertRecordedToRecordedItem(r, option.isHalfWidth);
                if (typeof liveDropLogFileIndex[item.id] !== 'undefined') {
                    item.dropLogFile = liveDropLogFileIndex[item.id];
                }

                return item;
            }),
            total,
        };
    }

    /**
     * 録画ファイルを残したまま録画を停止する
     * @param recordedId: recorded id
     */
    public async stop(recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null || recorded.isRecording === false) {
            throw new Error('RecordingIsNotFound');
        }
        if (recorded.reserveId === null) {
            throw new Error('ReserveIdIsNull');
        }

        // 予約取消の既存経路は recording.cancel(reserveId, false) を呼ぶため、
        // ここまで録画したファイルを残したまま正常な終了処理へ進む。
        await this.ipc.reserveation.cancel(recorded.reserveId);
    }

    /**
     * タイマーを再設定する
     * @return Promise<void>
     */
    public async resetTimer(): Promise<void> {
        await this.ipc.recording.resetTimer();
    }
}
