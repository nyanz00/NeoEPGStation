import { IRecordedSelectStreamSettingStorageModel } from '@/model/storage/recorded/IRecordedSelectStreamSettingStorageModel';
import { inject, injectable } from 'inversify';
import * as apid from '../../../../../../api';
import IVideoApiModel from '../../../api/video/IVideoApiModel';
import IServerConfigModel from '../../../serverConfig/IServerConfigModel';
import IRecordedDetailSelectStreamState, { RecordedStreamType, StreamConfigItem, SubtitleConfigItem } from './IRecordedDetailSelectStreamState';

@injectable()
export default class RecordedDetailSelectStreamState implements IRecordedDetailSelectStreamState {
    public isOpen: boolean = false;
    public streamTypeItems: RecordedStreamType[] = [];
    public streamModeItems: StreamConfigItem[] = [];
    public subtitleItems: SubtitleConfigItem[] = [];
    public selectedStreamType: RecordedStreamType | undefined;
    public title: string | null = null;
    public selectedStreamMode: number | undefined;
    public selectedSubtitleIndex: string = 'none';
    public isLoadingSubtitles: boolean = false;

    private serverConfig: IServerConfigModel;
    private streamSelectSetting: IRecordedSelectStreamSettingStorageModel;
    private videoApiModel: IVideoApiModel;
    private streamConfig: { [type: string]: string[] } = {};
    private videoFileId: apid.VideoFileId | null = null;
    private videoFileType: apid.VideoFileType | null = null;
    private recordedId: apid.RecordedId | null = null;

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('IVideoApiModel') videoApiModel: IVideoApiModel,
        @inject('IRecordedSelectStreamSettingStorageModel')
        streamSelectSetting: IRecordedSelectStreamSettingStorageModel,
    ) {
        this.serverConfig = serverConfig;
        this.videoApiModel = videoApiModel;
        this.streamSelectSetting = streamSelectSetting;
    }

    public async open(videoFile: apid.VideoFile, recordedId: apid.RecordedId): Promise<void> {
        this.isOpen = true;

        this.title = videoFile.name;
        this.videoFileId = videoFile.id;
        this.videoFileType = videoFile.type;
        this.recordedId = recordedId;
        this.streamTypeItems = [];
        this.streamModeItems = [];
        this.subtitleItems = [];
        this.selectedSubtitleIndex = 'none';
        this.isLoadingSubtitles = false;
        this.streamConfig = {};
        const config = this.serverConfig.getConfig();

        if (config !== null && typeof config.streamConfig !== 'undefined' && typeof config.streamConfig.recorded !== 'undefined') {
            // set streamTypeItems
            const ts = config.streamConfig.recorded.ts;
            const encoded = config.streamConfig.recorded.encoded;
            if (videoFile.type === 'ts' && config.isEnableTSRecordedStream === true && typeof ts !== 'undefined') {
                // VOD HLS for TS. This route keeps the tsreadex ARIB subtitle path.
                if (typeof ts.hls !== 'undefined' && ts.hls.length > 0) {
                    this.streamTypeItems.push('HLS-TS');
                    this.streamConfig['HLS-TS'] = ts.hls;
                } else if (typeof ts.m2tsll !== 'undefined' && ts.m2tsll.length > 0) {
                    this.streamTypeItems.push('M2TS-LL');
                    this.streamConfig['M2TS-LL'] = ts.m2tsll;
                }
            } else if (videoFile.type === 'encoded' && config.isEnableEncodedRecordedStream === true && typeof encoded !== 'undefined') {
                if (typeof encoded.hls !== 'undefined' && encoded.hls.length > 0) {
                    this.streamTypeItems.push('HLS');
                    this.streamConfig['HLS'] = encoded.hls;
                }
            } else {
                // ビデオの形式に適したストリーミングの設定が存在しない
                throw new Error('VideoTypeError');
            }

            if (videoFile.type === 'ts' && this.streamTypeItems.includes('HLS-TS')) {
                this.selectedStreamType = 'HLS-TS';
            } else if (videoFile.type === 'ts' && this.streamTypeItems.includes('M2TS-LL')) {
                this.selectedStreamType = 'M2TS-LL';
            } else {
                const savedType = this.streamSelectSetting.getSavedValue().type;
                const newSelectedStreamType = this.streamTypeItems.find(type => {
                    return type === savedType;
                });
                const currentSelectedStreamType = this.streamTypeItems.find(type => {
                    return type === this.selectedStreamType;
                });
                this.selectedStreamType =
                    typeof currentSelectedStreamType !== 'undefined'
                        ? currentSelectedStreamType
                        : typeof newSelectedStreamType === 'undefined'
                        ? this.streamTypeItems[0]
                        : newSelectedStreamType;
            }
        }

        await this.updateModeItems(true);
    }

    /**
     * ダイアログを閉じる
     */
    public close(): void {
        // ストリームの選択情報を保存
        if (typeof this.selectedStreamType !== 'undefined' && typeof this.selectedStreamMode !== 'undefined') {
            this.streamSelectSetting.tmp.type = this.selectedStreamType as string;
            this.streamSelectSetting.tmp.mode = typeof this.selectedStreamMode === 'undefined' ? 0 : this.selectedStreamMode;
            this.streamSelectSetting.save();
        }

        this.isOpen = false;
    }

    /**
     * 視聴設定の更新
     */
    public async updateModeItems(isInit: boolean = false): Promise<void> {
        this.streamModeItems = this.getModeItems().map((text, i) => {
            return {
                text: text,
                value: i,
            };
        });

        if (isInit === true) {
            this.selectedStreamMode = this.streamSelectSetting.getSavedValue().mode;
        }

        if (typeof this.selectedStreamMode === 'undefined' || typeof this.streamModeItems[this.selectedStreamMode] === 'undefined') {
            this.selectedStreamMode = 0;
        }

        await this.updateSubtitleItems();
    }

    /**
     * 視聴設定を返す
     * @return string[]
     */
    private getModeItems(): string[] {
        return typeof this.selectedStreamType === 'undefined' ? [] : this.streamConfig[this.selectedStreamType];
    }

    /**
     * VideoFile id を返す
     * @return apid.VideoFileId | null
     */
    public getVideoFileId(): apid.VideoFileId | null {
        return this.videoFileId;
    }

    /**
     * Recorded id を返す
     * @return apid.RecordedId | null
     */
    public getRecordedId(): apid.RecordedId | null {
        return this.recordedId;
    }

    public getVideoFileType(): apid.VideoFileType | null {
        return this.videoFileType;
    }

    private async updateSubtitleItems(): Promise<void> {
        this.subtitleItems = [];
        this.selectedSubtitleIndex = 'none';

        if (this.videoFileType !== 'encoded' || this.selectedStreamType !== 'HLS' || this.videoFileId === null) {
            return;
        }

        this.isLoadingSubtitles = true;
        try {
            const subtitles = await this.videoApiModel.getSubtitles(this.videoFileId);
            if (subtitles.items.length === 0) {
                return;
            }

            const items: SubtitleConfigItem[] = [
                {
                    text: '字幕なし',
                    value: 'subtitle:none',
                },
            ];
            subtitles.items.forEach(item => {
                items.push({
                    text: item.displayName,
                    value: `subtitle:${item.subtitleIndex.toString(10)}`,
                });
            });
            this.subtitleItems = items;
        } finally {
            this.isLoadingSubtitles = false;
        }
    }
}
