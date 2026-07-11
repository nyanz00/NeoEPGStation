<template>
    <div class="recorded-detail-select-stream">
        <v-dialog v-if="isRemove === false" v-model="dialogState.isOpen" max-width="400" scrollable>
            <v-card v-if="dialogState.title !== null">
                <div class="pa-4 pb-0">
                    <div>{{ dialogState.title }}</div>
                    <div class="d-flex">
                        <v-select
                            :items="dialogState.streamTypeItems"
                            v-model="dialogState.selectedStreamType"
                            v-on:change="updateModeItems"
                            style="max-width: 120px"
                            :menu-props="{ auto: true }"
                        ></v-select>
                        <v-select
                            v-if="isHiddenStreamMode === false"
                            :items="dialogState.streamModeItems"
                            v-model="dialogState.selectedStreamMode"
                            :menu-props="{ auto: true }"
                        ></v-select>
                    </div>
                    <div v-if="dialogState.subtitleItems.length > 0" class="mt-2">
                        <v-select
                            v-model="selectedSubtitleIndex"
                            :items="dialogState.subtitleItems"
                            item-text="text"
                            item-value="value"
                            label="字幕焼き込み"
                            :menu-props="{ auto: true }"
                        ></v-select>
                        <div class="caption grey--text text--lighten-1">選んだ字幕トラックを映像に焼き込んで再生します</div>
                    </div>
                </div>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn color="primary" text v-on:click="cancel">キャンセル</v-btn>
                    <v-btn color="primary" text v-on:click="view">視聴</v-btn>
                </v-card-actions>
            </v-card>
        </v-dialog>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import IRecordedDetailSelectStreamState from '@/model/state/recorded/detail/IRecordedDetailSelectStreamState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class RecordedDetailSelectStreamDialog extends Vue {
    public dialogState: IRecordedDetailSelectStreamState = container.get<IRecordedDetailSelectStreamState>('IRecordedDetailSelectStreamState');
    public isRemove: boolean = false;
    public selectedSubtitleIndex: string = 'subtitle:none';
    // ストリーム視聴設定セレクタ再描画用
    public isHiddenStreamMode: boolean = false;

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private settingModel: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');

    public beforeDestroy(): void {
        this.dialogState.close();
    }

    public updateModeItems(): void {
        this.selectedSubtitleIndex = 'subtitle:none';
        this.dialogState
            .updateModeItems()
            .then(() => {
                this.applyDefaultSubtitleSelection();
            })
            .catch(err => {
                this.snackbarState.open({
                    color: 'error',
                    text: '字幕情報の取得に失敗しました',
                });
                console.error(err);
            });

        // 再描画
        this.isHiddenStreamMode = true;
        this.$nextTick(() => {
            this.isHiddenStreamMode = false;
        });
    }

    public cancel(): void {
        this.dialogState.isOpen = false;
    }

    public async view(): Promise<void> {
        if (typeof this.dialogState.selectedStreamType === 'undefined' || typeof this.dialogState.selectedStreamMode === 'undefined') {
            this.snackbarState.open({
                color: 'error',
                text: '配信設定が正しく入力されていません',
            });

            return;
        }

        const recordedId = this.dialogState.getRecordedId();
        if (recordedId === null) {
            this.snackbarState.open({
                color: 'error',
                text: '番組 ID が不正です',
            });

            return;
        }

        const videoFileId = this.dialogState.getVideoFileId();
        if (videoFileId === null) {
            this.snackbarState.open({
                color: 'error',
                text: 'ビデオファイル ID が不正です',
            });

            return;
        }

        const path = `/recorded/streaming/${videoFileId}`;
        const query: { [key: string]: string | undefined } = {
            recordedId: recordedId.toString(),
            streamingType: this.getStreamingType(),
            mode: this.dialogState.selectedStreamMode.toString(10),
            videoFileType: this.dialogState.getVideoFileType() ?? undefined,
            ...this.getWatchQuery(),
            timestamp: new Date().getTime().toString(10),
        };
        await this.prepareSelectedSubtitle(videoFileId, query);
        const params = new URLSearchParams();
        Object.keys(query).forEach(key => {
            const value = query[key];
            if (typeof value === 'string') {
                params.set(key, value);
            }
        });

        await this.$router.push(`${path}?${params.toString()}`);
    }

    private getStreamingType(): string {
        if (this.dialogState.selectedStreamType === 'M2TS-LL') {
            return 'm2tsll';
        }
        if (this.dialogState.selectedStreamType === 'HLS-TS') {
            return 'hls-ts';
        }

        return (this.dialogState.selectedStreamType ?? '').toLowerCase();
    }

    private getWatchQuery(): { [key: string]: string } {
        const query: { [key: string]: string } = {};
        const setting = this.settingModel.getSavedValue();
        const selectedItem = this.dialogState.streamModeItems.find(item => item.value === this.dialogState.selectedStreamMode);

        if (typeof selectedItem !== 'undefined') {
            query.quality = selectedItem.text;
        }
        if (setting.watchStreamEncoder !== 'Config') {
            query.encoder = setting.watchStreamEncoder;
        }
        query.hevc = setting.watchUseHevc === true ? '1' : '0';
        const subtitleIndex = this.getSelectedSubtitleIndex();
        if (subtitleIndex !== null) {
            query.subtitleIndex = subtitleIndex;
        }

        return query;
    }

    private async prepareSelectedSubtitle(videoFileId: number, query: { [key: string]: string | undefined }): Promise<void> {
        const subtitleIndex = this.getSelectedSubtitleIndex();
        if (subtitleIndex === null) {
            return;
        }

        query.subtitleIndex = subtitleIndex;
        if (subtitleIndex === '-1') {
            return;
        }

        const prepared = await this.videoApiModel.prepareSubtitle(videoFileId, parseInt(subtitleIndex, 10));
        query.subtitleFileKey = prepared.subtitleFileKey;
    }

    private getSelectedSubtitleIndex(): string | null {
        const prefix = 'subtitle:';
        const selected = this.getSelectedSubtitleValue();
        if (selected.startsWith(prefix) === false) {
            return null;
        }

        const value = selected.slice(prefix.length);

        return value === 'none' ? '-1' : value;
    }

    private getSelectedSubtitleValue(): string {
        const selected = this.selectedSubtitleIndex as unknown;
        if (typeof selected === 'string') {
            return selected;
        }

        const value = (selected as { value?: unknown })?.value;

        return typeof value === 'string' ? value : 'subtitle:none';
    }

    /**
     * dialog の表示状態が変更されたときに呼ばれる
     */
    @Watch('dialogState.isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.selectedSubtitleIndex = 'subtitle:none';
            this.$nextTick(async () => {
                await Util.sleep(100);
                this.applyDefaultSubtitleSelection();
            });
        }

        if (newState === false && oldState === true) {
            // close
            this.$nextTick(async () => {
                await Util.sleep(100);
                this.isRemove = true;
                this.$nextTick(() => {
                    this.isRemove = false;
                    this.dialogState.close();
                });
            });
        }
    }

    @Watch('dialogState.subtitleItems', { deep: true })
    public onSubtitleItemsChange(): void {
        this.applyDefaultSubtitleSelection();
    }

    private applyDefaultSubtitleSelection(): void {
        const selected = this.getSelectedSubtitleValue();
        if (selected !== 'none' && selected !== 'subtitle:none') {
            return;
        }

        const preferredKeyword = this.settingModel.getSavedValue().watchSubtitlePreferredKeyword.trim().toLowerCase();
        const preferredSubtitle =
            preferredKeyword.length === 0 ? undefined : this.dialogState.subtitleItems.find(item => item.text.toLowerCase().includes(preferredKeyword) === true);
        this.selectedSubtitleIndex = preferredSubtitle?.value ?? 'subtitle:none';
    }
}
</script>
