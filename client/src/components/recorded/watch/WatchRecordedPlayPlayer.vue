<template>
    <div class="watch-recorded-play-player">
        <div v-if="isLoading === true || isBuffering === true" class="watch-recorded-play-loading">
            <v-progress-circular indeterminate size="56" width="5"></v-progress-circular>
            <div class="watch-recorded-play-loading-text">{{ loadingText }}</div>
        </div>
        <div class="watch-recorded-play-subtitle-selects">
            <v-select
                v-if="isDPlayerNicoJkRenderer === true && danmakuSubtitleSelectItems.length > 0"
                v-model="selectedDanmakuSubtitleIndex"
                v-bind:items="danmakuSubtitleSelectItems"
                dense
                dark
                hide-details
                solo
                flat
                label="実況コメント"
            ></v-select>
            <v-select
                v-if="subtitleSelectItems.length > 1"
                v-model="selectedSubtitleIndex"
                v-bind:items="subtitleSelectItems"
                dense
                dark
                hide-details
                solo
                flat
                label="字幕"
            ></v-select>
        </div>
        <div ref="player" class="watch-recorded-play-dplayer"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IVideoApiModel from '@/model/api/video/IVideoApiModel';
import { ISettingStorageModel } from '@/model/storage/setting/ISettingStorageModel';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import RecordedStreamingPlayerCore, { RecordedStreamingPlayerState } from '@/player/RecordedStreamingPlayerCore';
import AssDanmakuCommentCore from '@/player/comment/AssDanmakuCommentCore';
import { preprocessAssSubtitle } from '@/player/subtitle/AssSubtitlePreprocessor';
import notoSansJpBoldUrl from '@/assets/fonts/noto-sans-jp-bold.ttf?url';
import notoSansSymbols2RegularUrl from '@/assets/fonts/noto-sans-symbols-2-regular.ttf?url';
import modernWasmUrl from 'jassub/dist/jassub-worker-modern.wasm?url';
import workerUrl from 'jassub/dist/jassub-worker.js?url';
import legacyWasmUrl from 'jassub/dist/jassub-worker.wasm.js?url';
import wasmUrl from 'jassub/dist/jassub-worker.wasm?url';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../../api';

type JASSUBInstance = import('jassub').default;

interface SubtitleSelectItem {
    text: string;
    value: number | null;
}

interface JassubFontData {
    bold: Uint8Array;
    symbols: Uint8Array;
}

@Component({})
export default class WatchRecordedPlayPlayer extends Vue {
    private static readonly NICOJK_RENDERER: 'jassub' | 'dplayer' = 'jassub';
    private static jassubFontDataPromise: Promise<JassubFontData> | null = null;

    @Prop({ required: true })
    public videoFileId!: apid.VideoFileId;

    public isLoading: boolean = true;
    public isBuffering: boolean = false;
    public loadingText: string = 'プレイヤーを初期化中...';
    public subtitleItems: apid.VideoSubtitle[] = [];
    public selectedSubtitleIndex: number | null = null;
    public selectedDanmakuSubtitleIndex: number | null = null;

    private playerCore: RecordedStreamingPlayerCore | null = null;
    private videoApiModel: IVideoApiModel = container.get<IVideoApiModel>('IVideoApiModel');
    private setting: ISettingStorageModel = container.get<ISettingStorageModel>('ISettingStorageModel');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private duration: number = 0;
    private assRenderer: JASSUBInstance | null = null;
    private assDanmakuCommentCore: AssDanmakuCommentCore | null = null;
    private videoElement: HTMLVideoElement | null = null;
    private initGeneration: number = 0;
    private subtitleGeneration: number = 0;
    private danmakuGeneration: number = 0;

    public get subtitleSelectItems(): SubtitleSelectItem[] {
        const items: SubtitleSelectItem[] = [
            {
                text: '字幕なし',
                value: null,
            },
        ];

        const subtitles = this.isDPlayerNicoJkRenderer === true ? this.subtitleItems.filter(item => this.isNicoJkSubtitle(item) === false) : this.subtitleItems;

        return items.concat(
            subtitles.map(item => {
                return {
                    text: item.displayName,
                    value: item.subtitleIndex,
                };
            }),
        );
    }

    public get danmakuSubtitleSelectItems(): SubtitleSelectItem[] {
        return this.subtitleItems
            .filter(item => this.isNicoJkSubtitle(item) === true)
            .map(item => {
                return {
                    text: item.displayName,
                    value: item.subtitleIndex,
                };
            });
    }

    public get isDPlayerNicoJkRenderer(): boolean {
        return WatchRecordedPlayPlayer.NICOJK_RENDERER === 'dplayer';
    }

    public mounted(): void {
        this.initialize().catch(err => {
            this.handleError(err, 'プレイヤーの初期化に失敗しました。');
        });
    }

    public beforeDestroy(): void {
        this.initGeneration++;
        this.subtitleGeneration++;
        this.danmakuGeneration++;
        this.unbindVideoEvents();
        this.destroyAssRenderer();
        this.destroyAssDanmakuCommentCore();
        this.playerCore?.destroy();
        this.playerCore = null;
    }

    @Watch('videoFileId')
    public onVideoFileIdChange(): void {
        this.initialize().catch(err => {
            this.handleError(err, 'プレイヤーの切り替えに失敗しました。');
        });
    }

    @Watch('selectedSubtitleIndex')
    public onSelectedSubtitleIndexChange(): void {
        this.applySelectedSubtitle().catch(err => {
            this.handleError(err, '字幕の準備に失敗しました。');
        });
    }

    @Watch('selectedDanmakuSubtitleIndex')
    public onSelectedDanmakuSubtitleIndexChange(): void {
        this.applySelectedDanmakuSubtitle().catch(err => {
            this.handleError(err, '実況コメントの準備に失敗しました。');
        });
    }

    private async initialize(): Promise<void> {
        const generation = ++this.initGeneration;
        this.applyPlayerState({
            isLoading: true,
            isBuffering: false,
            loadingText: '動画を準備中...',
        });
        this.destroyAssRenderer();
        this.destroyAssDanmakuCommentCore();
        this.selectedSubtitleIndex = null;
        this.selectedDanmakuSubtitleIndex = null;

        const [duration] = await Promise.all([this.fetchDuration(), this.fetchSubtitles()]);
        if (generation !== this.initGeneration) {
            return;
        }

        this.duration = duration;
        this.selectPreferredSubtitle();
        if (this.isDPlayerNicoJkRenderer === true) {
            this.selectDefaultDanmakuSubtitle();
        }

        const playerElement = this.$refs.player as HTMLElement | undefined;
        if (typeof playerElement === 'undefined') {
            return;
        }

        const src = `./api/videos/${this.videoFileId}`;
        if (this.playerCore === null) {
            this.playerCore = new RecordedStreamingPlayerCore({
                container: playerElement,
                src,
                type: 'normal',
                enableAribSubtitle: false,
                duration: this.duration,
                enableDanmaku: WatchRecordedPlayPlayer.NICOJK_RENDERER === 'dplayer',
                onStateChange: this.applyPlayerState,
                onError: err => {
                    console.error(err);
                },
            });
            await this.playerCore.init();
        } else {
            this.playerCore.setSource(src, 'normal', false, this.duration);
        }

        this.bindVideoEvents();
        await Promise.all([this.applySelectedSubtitle(), this.applySelectedDanmakuSubtitle()]);
    }

    private async fetchDuration(): Promise<number> {
        try {
            return await this.videoApiModel.getDuration(this.videoFileId);
        } catch (err) {
            console.error(err);

            return 0;
        }
    }

    private async fetchSubtitles(): Promise<void> {
        try {
            const result = await this.videoApiModel.getSubtitles(this.videoFileId);
            this.subtitleItems = result.items;
        } catch (err) {
            console.error(err);
            this.subtitleItems = [];
        }
    }

    private selectPreferredSubtitle(): void {
        const keyword = this.setting.getSavedValue().watchPlaySubtitlePreferredKeyword.trim().toLowerCase();
        if (keyword.length === 0) {
            return;
        }

        const subtitle = this.subtitleItems
            .filter(item => this.isDPlayerNicoJkRenderer === false || this.isNicoJkSubtitle(item) === false)
            .find(item => {
                return [item.displayName, item.title, item.language, item.codecName].some(value => {
                    return typeof value === 'string' && value.toLowerCase().includes(keyword) === true;
                });
            });
        if (typeof subtitle !== 'undefined') {
            this.selectedSubtitleIndex = subtitle.subtitleIndex;
        }
    }

    private selectDefaultDanmakuSubtitle(): void {
        const subtitle = this.subtitleItems.find(item => this.isNicoJkSubtitle(item) === true);
        this.selectedDanmakuSubtitleIndex = subtitle?.subtitleIndex ?? null;
    }

    private async applySelectedSubtitle(): Promise<void> {
        const generation = ++this.subtitleGeneration;
        this.destroyAssRenderer();

        if (this.selectedSubtitleIndex === null) {
            return;
        }

        this.applyPlayerState({
            isLoading: this.isLoading,
            isBuffering: this.isBuffering,
            loadingText: '字幕を準備中...',
        });

        const subtitle = await this.videoApiModel.getSubtitleText(this.videoFileId, this.selectedSubtitleIndex);
        const subtitleText = subtitle.subtitleText;
        if (generation !== this.subtitleGeneration) {
            return;
        }

        const video = this.videoElement ?? this.playerCore?.getVideoElement() ?? null;
        if (video === null) {
            return;
        }

        const [JASSUB, fontData] = await Promise.all([
            import(/* webpackChunkName: "jassub" */ 'jassub').then(module => module.default),
            WatchRecordedPlayPlayer.loadJassubFontData(),
        ]);
        if (generation !== this.subtitleGeneration) {
            return;
        }

        const subtitleItem = this.subtitleItems.find(item => item.subtitleIndex === this.selectedSubtitleIndex);
        const isNicoJk = typeof subtitleItem !== 'undefined' && this.isNicoJkSubtitle(subtitleItem) === true;
        this.assRenderer = new JASSUB({
            video,
            subContent: preprocessAssSubtitle(subtitleText, { isNicoJk }),
            workerUrl,
            wasmUrl,
            legacyWasmUrl,
            modernWasmUrl,
            fonts: [fontData.bold, fontData.symbols],
            availableFonts: {
                arial: fontData.bold,
                'liberation sans': fontData.bold,
                meiryo: fontData.bold,
                'ms gothic': fontData.bold,
                'ms pgothic': fontData.bold,
                'noto sans cjk jp': fontData.bold,
                'noto sans jp': fontData.bold,
                'noto sans jp thin': fontData.bold,
                'noto sans symbols 2': fontData.symbols,
                'yu gothic': fontData.bold,
                'yu gothic medium': fontData.bold,
            } as any,
            fallbackFont: 'noto sans jp',
            useLocalFonts: false,
            onDemandRender: isNicoJk === false,
            targetFps: isNicoJk === true ? 60 : 24,
        } as any);
    }

    private async applySelectedDanmakuSubtitle(): Promise<void> {
        const generation = ++this.danmakuGeneration;
        this.destroyAssDanmakuCommentCore();

        if (this.isDPlayerNicoJkRenderer === false) {
            return;
        }

        if (this.selectedDanmakuSubtitleIndex === null) {
            return;
        }

        const subtitle = await this.videoApiModel.getSubtitleText(this.videoFileId, this.selectedDanmakuSubtitleIndex);
        if (generation !== this.danmakuGeneration) {
            return;
        }

        const video = this.videoElement ?? this.playerCore?.getVideoElement() ?? null;
        if (video === null) {
            return;
        }

        this.assDanmakuCommentCore = new AssDanmakuCommentCore({
            ass: subtitle.subtitleText,
            video,
            onComment: comment => {
                this.playerCore?.drawDanmaku(comment);
            },
            onReset: () => {
                this.playerCore?.clearDanmaku();
            },
        });
        this.assDanmakuCommentCore.start();
    }

    private isNicoJkSubtitle(subtitle: apid.VideoSubtitle): boolean {
        return [subtitle.displayName, subtitle.title].some(value => {
            return typeof value === 'string' && value.toLowerCase().includes('nicojk') === true;
        });
    }

    private static async loadJassubFontData(): Promise<JassubFontData> {
        if (WatchRecordedPlayPlayer.jassubFontDataPromise === null) {
            WatchRecordedPlayPlayer.jassubFontDataPromise = Promise.all([
                fetch(notoSansJpBoldUrl).then(response => response.arrayBuffer()),
                fetch(notoSansSymbols2RegularUrl).then(response => response.arrayBuffer()),
            ]).then(([bold, symbols]) => {
                return {
                    bold: new Uint8Array(bold),
                    symbols: new Uint8Array(symbols),
                };
            });
        }

        return WatchRecordedPlayPlayer.jassubFontDataPromise;
    }

    private bindVideoEvents(): void {
        this.unbindVideoEvents();

        const video = this.playerCore?.getVideoElement() ?? null;
        if (video === null) {
            return;
        }

        this.videoElement = video;
    }

    private unbindVideoEvents(): void {
        if (this.videoElement === null) {
            return;
        }

        this.videoElement = null;
    }

    private destroyAssRenderer(): void {
        if (this.assRenderer === null) {
            return;
        }

        this.assRenderer.destroy();
        this.assRenderer = null;
    }

    private destroyAssDanmakuCommentCore(): void {
        this.assDanmakuCommentCore?.destroy();
        this.assDanmakuCommentCore = null;
    }

    private handleError(err: any, message: string): void {
        console.error(err);
        this.snackbarState.open({
            color: 'error',
            text: message,
        });
        this.applyPlayerState({
            isLoading: true,
            isBuffering: false,
            loadingText: message,
        });
    }

    private applyPlayerState(state: RecordedStreamingPlayerState): void {
        this.isLoading = state.isLoading;
        this.isBuffering = state.isBuffering;
        this.loadingText = state.loadingText;
    }
}
</script>

<style lang="sass" scoped>
.watch-recorded-play-player
    position: relative
    width: 100%
    background: black

    &::before
        content: ""
        display: block
        padding-top: 56.25%

.watch-recorded-play-loading
    z-index: 4
    position: absolute
    top: 0
    right: 0
    bottom: 0
    left: 0
    display: flex
    flex-direction: column
    align-items: center
    justify-content: center
    gap: 14px
    background: radial-gradient(circle at center, rgba(26, 32, 44, 0.72), rgba(0, 0, 0, 0.88))
    color: white

.watch-recorded-play-loading-text
    font-size: 14px
    font-weight: 700

.watch-recorded-play-subtitle-selects
    z-index: 24
    position: absolute
    top: 14px
    right: 14px
    width: min(360px, calc(100% - 28px))
    opacity: 0
    transition: opacity 160ms ease
    display: flex
    flex-direction: column
    gap: 8px

    &:focus-within
        opacity: 1

.watch-recorded-play-player:hover
    .watch-recorded-play-subtitle-selects
        opacity: 1

.watch-recorded-play-dplayer
    z-index: 1
    position: absolute
    top: 0
    right: 0
    bottom: 0
    left: 0
    width: 100%
    height: 100%

.watch-recorded-play-dplayer
    &.dplayer
        width: 100%
        height: 100%
        background: transparent

    .dplayer-video-wrap
        background: black !important

    .dplayer-video-wrap-aspect, video
        width: 100%
        height: 100%

    video
        object-fit: contain

    .dplayer-controller-mask
        height: 82px !important
        background: linear-gradient(to top, rgba(0, 0, 0, 0.86), transparent) !important

    .dplayer-controller
        bottom: 0 !important
        padding: 0 16px 10px !important

    .dplayer-icons
        align-items: center
</style>

<style lang="sass">
.watch-recorded-play-dplayer
    .dplayer-comment-box, .dplayer-comment
        display: none !important

    .dplayer-video-wrap
        position: relative

        .JASSUB
            z-index: 18
            position: absolute !important
            top: 0
            right: 0
            bottom: 0
            left: 0
            width: 100%
            height: 100%
            pointer-events: none

            canvas
                pointer-events: none
</style>
