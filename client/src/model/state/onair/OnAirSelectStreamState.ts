import { inject, injectable } from 'inversify';
import * as apid from '../../../../../api';
import UaUtil from '../../../util/UaUtil';
import URLSchemeUtil from '../../../util/URLSchemeUtil';
import Util from '../../../util/Util';
import IServerConfigModel from '../../serverConfig/IServerConfigModel';
import { IOnAirSelectStreamSettingStorageModel } from '../../storage/onair/IOnAirSelectStreamSettingStorageModel';
import { ISettingStorageModel } from '../../storage/setting/ISettingStorageModel';
import IOnAirSelectStreamState, { LiveStreamType, StreamConfigItem } from './IOnAirSelectStreamState';

@injectable()
export default class OnAirSelectStreamState implements IOnAirSelectStreamState {
    public isOpen: boolean = false;
    public useURLScheme: boolean = false;
    public streamTypes: LiveStreamType[] = [];
    public streamConfigItems: StreamConfigItem[] = [];
    public selectedStreamType: LiveStreamType | undefined;
    public selectedStreamConfig: number | undefined;

    private serverConfig: IServerConfigModel;
    private settingModel: ISettingStorageModel;
    private streamSelectSetting: IOnAirSelectStreamSettingStorageModel;
    private channelItem: apid.ScheduleChannleItem | null = null;
    private streamConfig: { [type: string]: string[] } = {};

    constructor(
        @inject('IServerConfigModel') serverConfig: IServerConfigModel,
        @inject('ISettingStorageModel') settingModel: ISettingStorageModel,
        @inject('IOnAirSelectStreamSettingStorageModel') streamSelectSetting: IOnAirSelectStreamSettingStorageModel,
    ) {
        this.serverConfig = serverConfig;
        this.settingModel = settingModel;
        this.streamSelectSetting = streamSelectSetting;
    }

    /**
     * ダイアログを開く
     * @param channelItem: apid.ScheduleChannleItem
     */
    public open(channelItem: apid.ScheduleChannleItem): void {
        this.isOpen = true;
        this.channelItem = channelItem;

        this.useURLScheme = this.streamSelectSetting.getSavedValue().useURLScheme;
        this.updateStreamTypes(true);
        this.updateStreamConfig(true);
    }

    /**
     * ダイアログを閉じる
     */
    public close(): void {
        // ストリームの選択情報を保存
        if (typeof this.selectedStreamType !== 'undefined' && typeof this.selectedStreamConfig !== 'undefined') {
            this.streamSelectSetting.tmp.useURLScheme = this.useURLScheme;
            this.streamSelectSetting.tmp.type = this.selectedStreamType as string;
            this.streamSelectSetting.tmp.mode = typeof this.selectedStreamConfig === 'undefined' ? 0 : this.selectedStreamConfig;
            this.streamSelectSetting.save();
        }

        this.isOpen = false;
        this.channelItem = null;
    }

    /**
     * セットされている channel 情報を取得する
     * @return apid.ScheduleChannleItem | null
     */
    public getChannelItem(): apid.ScheduleChannleItem | null {
        return this.channelItem;
    }

    /**
     * 配信方式の更新
     */
    public updateStreamTypes(isInit: boolean = false): void {
        this.streamTypes = [];
        this.streamConfig = {};

        const config = this.serverConfig.getConfig();
        if (
            config !== null &&
            config.isEnableTSLiveStream === true &&
            typeof config.streamConfig !== 'undefined' &&
            typeof config.streamConfig.live !== 'undefined' &&
            typeof config.streamConfig.live.ts !== 'undefined'
        ) {
            if (this.useURLScheme === true) {
                // URL Scheme 使用時
                if (typeof config.streamConfig.live.ts.m2ts !== 'undefined' && config.streamConfig.live.ts.m2ts.length > 0) {
                    this.streamTypes.push('M2TS');
                    this.streamConfig['M2TS'] = config.streamConfig.live.ts.m2ts.map(c => {
                        return c.name;
                    });
                }
            } else {
                // web 上での再生
                const defaultStreamType = this.getDefaultWatchStreamType();
                if (defaultStreamType === 'M2TS-LL') {
                    this.addM2TSLLStreamConfig(config);
                    this.addM2TSStreamConfig(config);
                } else {
                    this.addM2TSStreamConfig(config);
                    this.addM2TSLLStreamConfig(config);
                }
            }
        }

        if (isInit === true) {
            if (this.useURLScheme === false) {
                const defaultStreamType = this.getDefaultWatchStreamType();
                this.selectedStreamType = this.streamTypes.includes(defaultStreamType) ? defaultStreamType : this.streamTypes[0];
            } else if (typeof this.selectedStreamType === 'undefined') {
                const savedType = this.streamSelectSetting.getSavedValue().type;
                const newSelectedStreamType = this.streamTypes.find(type => {
                    return type === savedType;
                });
                this.selectedStreamType = typeof newSelectedStreamType === 'undefined' ? this.streamTypes[0] : newSelectedStreamType;
            }
        } else {
            this.selectedStreamType = this.streamTypes[0];
        }
    }

    private addM2TSStreamConfig(config: apid.Config): void {
        if (
            typeof config.streamConfig !== 'undefined' &&
            typeof config.streamConfig.live !== 'undefined' &&
            typeof config.streamConfig.live.ts !== 'undefined' &&
            typeof config.streamConfig.live.ts.m2ts !== 'undefined' &&
            this.streamTypes.includes('M2TS') === false
        ) {
            this.streamTypes.push('M2TS');
            this.streamConfig['M2TS'] = config.streamConfig.live.ts.m2ts.map(c => {
                return c.name;
            });
        }
    }

    private addM2TSLLStreamConfig(config: apid.Config): void {
        if (
            typeof config.streamConfig !== 'undefined' &&
            typeof config.streamConfig.live !== 'undefined' &&
            typeof config.streamConfig.live.ts !== 'undefined' &&
            typeof config.streamConfig.live.ts.m2tsll !== 'undefined' &&
            this.streamTypes.includes('M2TS-LL') === false
        ) {
            this.streamTypes.push('M2TS-LL');
            this.streamConfig['M2TS-LL'] = config.streamConfig.live.ts.m2tsll;
        }
    }

    /**
     * ストリーム設定の更新
     */
    public updateStreamConfig(isInit: boolean = false): void {
        this.streamConfigItems = this.getStreamConfig().map((c, i) => {
            return {
                text: c,
                value: i,
            };
        });

        if (isInit === true) {
            this.selectedStreamConfig = this.streamSelectSetting.getSavedValue().mode;
            const defaultQuality = this.settingModel.getSavedValue().watchDefaultQuality;
            if (defaultQuality !== null) {
                const defaultIndex = this.streamConfigItems.findIndex(item => item.text === defaultQuality);
                if (defaultIndex >= 0) {
                    this.selectedStreamConfig = defaultIndex;
                }
            }
        }

        if (typeof this.selectedStreamConfig === 'undefined' || typeof this.streamConfigItems[this.selectedStreamConfig] === 'undefined') {
            this.selectedStreamConfig = 0;
        }
    }

    /**
     * 指定された形式の視聴設定を返す
     * @param type: LiveStreamType
     * @return string[]
     */
    private getStreamConfig(): string[] {
        const result = typeof this.selectedStreamType === 'undefined' ? [] : this.streamConfig[this.selectedStreamType];

        return typeof result === 'undefined' ? [] : result;
    }

    public getWatchStreamType(): 'm2ts' | 'm2tsll' {
        return this.selectedStreamType === 'M2TS-LL' ? 'm2tsll' : 'm2ts';
    }

    private getDefaultWatchStreamType(): LiveStreamType {
        return this.settingModel.getSavedValue().watchLowLatency === true ? 'M2TS-LL' : 'M2TS';
    }

    public getWatchQuery(): { [key: string]: string } {
        const query: { [key: string]: string } = {
            mode: (typeof this.selectedStreamConfig === 'undefined' ? 0 : this.selectedStreamConfig).toString(10),
        };
        const quality = this.getSelectedQualityName();
        const setting = this.settingModel.getSavedValue();
        if (quality !== null) {
            query.quality = quality;
        }
        if (setting.watchStreamEncoder !== 'Config') {
            query.encoder = setting.watchStreamEncoder;
        }
        query.hevc = setting.watchUseHevc === true ? '1' : '0';

        return query;
    }

    private getSelectedQualityName(): string | null {
        if (typeof this.selectedStreamConfig === 'undefined') {
            return null;
        }

        const item = this.streamConfigItems.find(config => config.value === this.selectedStreamConfig);
        return typeof item === 'undefined' ? null : item.text;
    }

    /**
     * m2ts 形式のライブ視聴 URL 生成
     * @return string | null URL Scheme の設定が見つからない場合は null を返す
     */
    public getM2TSURL(): string | null {
        const channel = this.getChannelItem();
        if (typeof this.selectedStreamConfig === 'undefined' || channel === null) {
            return null;
        }

        const config = this.serverConfig.getConfig();
        let urlScheme: string | null = null;
        const settingURLScheme = this.settingModel.getSavedValue().onAirM2TSViewURLScheme;

        if (settingURLScheme !== null && settingURLScheme.length > 0) {
            urlScheme = settingURLScheme;
        } else if (config !== null) {
            if (UaUtil.isiOS() === true && typeof config.urlscheme.m2ts.ios !== 'undefined') {
                urlScheme = config.urlscheme.m2ts.ios;
            } else if (UaUtil.isAndroid() === true && typeof config.urlscheme.m2ts.android !== 'undefined') {
                urlScheme = config.urlscheme.m2ts.android;
            } else if (UaUtil.isMac() === true && typeof config.urlscheme.m2ts.mac !== 'undefined') {
                urlScheme = config.urlscheme.m2ts.mac;
            } else if (UaUtil.isWindows() === true && typeof config.urlscheme.m2ts.win !== 'undefined') {
                urlScheme = config.urlscheme.m2ts.win;
            }
        }

        if (urlScheme === null) {
            // URL Schema 設定が見つからないので通常の URL を返す
            return null;
        }

        // URL Schemeの準備
        const params = new URLSearchParams(this.getWatchQuery());
        const viewURL = location.host + Util.getSubDirectory() + `/api/streams/live/${channel.id.toString(10)}/m2ts?${params.toString()}`;
        return URLSchemeUtil.build(urlScheme, viewURL);
    }

    /**
     * m2ts 形式のプレイリストダウンロード URL 生成
     * @return string | null URL Scheme の設定が見つからない場合は null を返す
     */
    public getM2TPlayListURL(): string | null {
        const channel = this.getChannelItem();
        if (typeof this.selectedStreamConfig === 'undefined' || channel === null) {
            return null;
        }

        const params = new URLSearchParams(this.getWatchQuery());
        return `/api/streams/live/${channel.id.toString(10)}/m2ts/playlist?${params.toString()}`;
    }
}
