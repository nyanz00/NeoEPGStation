import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRecordedDB, { FindAllOption } from '../../db/IRecordedDB';
import ITvUserDB from '../../db/ITvUserDB';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IRecordedApiModel from './IRecordedApiModel';

@injectable()
export default class RecordedApiModel implements IRecordedApiModel {
    private configuration: IConfiguration;
    private ipc: IIPCClient;
    private recordedDB: IRecordedDB;
    private userDB: ITvUserDB;
    private encodeManage: IEncodeManageModel;
    private recordedItemUtil: IRecordedItemUtil;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('ITvUserDB') userDB: ITvUserDB,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @inject('IRecordedItemUtil') recordedItemUtil: IRecordedItemUtil,
    ) {
        this.configuration = configuration;
        this.recordedDB = recordedDB;
        this.userDB = userDB;
        this.ipc = ipc;
        this.encodeManage = encodeManage;
        this.recordedItemUtil = recordedItemUtil;
    }

    /**
     * 録画情報の取得
     * @param option: GetRecordedOption
     * @return Promise<apid.Records>
     */
    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        (<FindAllOption>option).isRecording = false;
        this.setSearchVideoFileOption(option as FindAllOption);
        const [records, total] = await this.recordedDB.findAll(option, {
            isNeedVideoFiles: true,
            isNeedThumbnails: true,
            isNeedsDropLog: true,
            isNeedTags: false,
        });

        const encodeIndex = this.encodeManage.getRecordedIndex();

        return {
            records: records.map(r => {
                return this.recordedItemUtil.convertRecordedToRecordedItem(r, option.isHalfWidth, encodeIndex);
            }),
            total,
        };
    }

    /**
     * 指定した recorded id の録画情報を取得する
     * @param recordedId: apid.RecordedId
     * @param isHalfWidth: boolean 半角文字で返すか
     * @return Promise<apid.RecordedItem | null> null の場合録画情報が存在しない
     */
    public async get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null> {
        const item = await this.recordedDB.findId(recordedId);

        const encodeIndex = this.encodeManage.getRecordedIndex();

        return item === null
            ? null
            : this.recordedItemUtil.convertRecordedToRecordedItem(item, isHalfWidth, encodeIndex);
    }

    /**
     * recorded の検索オプションリストを取得する
     * @return Promise<apid.RecordedSearchOptionList>
     */
    public async getSearchOptionList(): Promise<apid.RecordedSearchOptions> {
        const channels = await this.recordedDB.findChannelList();
        const genres = await this.recordedDB.findGenreList();
        const encodedNames = await this.recordedDB.findEncodedNameList();
        const config = this.configuration.getConfig();
        const encodeItemIndex: { [name: string]: apid.RecordedEncodeListItem } = {};
        const encodeItems: apid.RecordedEncodeListItem[] = [];

        const pushEncodeItem = (item: apid.RecordedEncodeListItem): void => {
            if (
                typeof item.name !== 'string' ||
                item.name.length === 0 ||
                typeof encodeItemIndex[item.name] !== 'undefined'
            ) {
                return;
            }

            encodeItemIndex[item.name] = item;
            encodeItems.push(item);
        };

        for (const e of config.encode) {
            if (typeof e.name !== 'string' || e.name.length === 0) {
                continue;
            }

            pushEncodeItem({
                name: e.name,
                suffix: e.suffix,
            });
        }

        for (const name of encodedNames) {
            pushEncodeItem({
                name,
            });
        }

        return {
            channels: channels,
            genres: genres,
            encode: encodeItems,
        };
    }

    private setSearchVideoFileOption(option: FindAllOption): void {
        const encodeModes =
            typeof option.encodeModes !== 'undefined' && option.encodeModes.length > 0
                ? option.encodeModes
                : typeof option.encodeMode === 'string'
                  ? [option.encodeMode]
                  : [];

        if (encodeModes.length === 0) {
            return;
        }

        option.searchVideoFiles = encodeModes.map(mode => {
            if (mode === '__ts__') {
                return {
                    type: 'ts',
                };
            }

            return {
                type: 'encoded',
                name: mode,
            };
        });
    }

    /**
     *
     * @param recordedId: ReserveId
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId): Promise<void> {
        await this.encodeManage.cancelEncodeByRecordedId(recordedId);

        return this.ipc.recorded.delete(recordedId);
    }

    /**
     * recordedId を指定してエンコードを停止させる
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public stopEncode(recordedId: apid.RecordedId): Promise<void> {
        return this.encodeManage.cancelEncodeByRecordedId(recordedId);
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        return this.ipc.recorded.changeProtect(recordedId, isProtect);
    }

    /**
     * recorded のユーザーを変更する
     */
    public async changeUser(recordedId: apid.RecordedId, option: apid.UpdateRecordedUserOption): Promise<void> {
        const userId = Number(option.userId);
        if (Number.isInteger(userId) === false) {
            throw new Error('UserIsNull');
        }

        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }
        if ((await this.userDB.findId(userId)) === null) {
            throw new Error('UserIsNull');
        }

        await this.recordedDB.changeUser(recordedId, userId);
    }

    public createCleanupPlan(): Promise<apid.RecordedCleanupPlanResult> {
        return this.ipc.recorded.createCleanupPlan();
    }

    public executeCleanupPlan(planPath: string): Promise<apid.RecordedCleanupExecuteResult> {
        return this.ipc.recorded.executeCleanupPlan(planPath);
    }

    /**
     * ファイルのクリーンアップ
     */
    public async fileCleanup(): Promise<void> {
        await this.ipc.recorded.videoFileCleanup();
        await this.ipc.recorded.dropLogFileCleanup();
    }

    /**
     * upload されたビデオファイルを追加する
     * @param option: UploadedVideoFileInfo
     * @return Promise<void>
     */
    public async addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void> {
        await this.ipc.recorded.addUploadedVideoFile(option);
    }

    /**
     * 録画番組情報を新規作成
     * @param option: apid.CreateNewRecordedOption
     * @return Promise<apid.RecordedId>
     */
    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        return await this.ipc.recorded.createNewRecorded(option);
    }
}
