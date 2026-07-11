<template>
    <div class="watch-recorded-player">
        <div v-if="isLoading === true || isBuffering === true" class="watch-recorded-player-loading">
            <v-progress-circular indeterminate size="56" width="5"></v-progress-circular>
            <div class="watch-recorded-player-loading-text">{{ loadingText }}</div>
        </div>
        <div ref="player" class="watch-recorded-dplayer"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedStreamingVideoState from '@/model/state/recorded/streaming/IRecordedStreamingVideoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import RecordedStreamingPlayerCore, { RecordedStreamingPlayerState } from '@/player/RecordedStreamingPlayerCore';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../../api';

type PlayerType = 'hls' | 'mpegts' | 'normal';

@Component({})
export default class WatchRecordedStreamingPlayer extends Vue {
    @Prop({ required: true })
    public recordedId!: apid.RecordedId;

    @Prop({ required: true })
    public videoFileId!: apid.VideoFileId;

    @Prop({ required: true })
    public mode!: number;

    @Prop({ required: true })
    public streamingType!: string;

    @Prop({ default: undefined })
    public quality?: string;

    @Prop({ default: undefined })
    public encoder?: string;

    @Prop({ default: undefined })
    public hevc?: string;

    @Prop({ default: undefined })
    public subtitleIndex?: string;

    @Prop({ default: undefined })
    public subtitleFileKey?: string;

    public isLoading: boolean = true;
    public isBuffering: boolean = false;
    public loadingText: string = 'プレイヤーを初期化中...';

    private playerCore: RecordedStreamingPlayerCore | null = null;
    private videoState: IRecordedStreamingVideoState = container.get<IRecordedStreamingVideoState>('IRecordedStreamingVideoState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private initGeneration: number = 0;

    public mounted(): void {
        this.initialize().catch(err => {
            this.handleError(err, 'プレイヤーの初期化に失敗しました。');
        });
    }

    public beforeDestroy(): void {
        this.initGeneration++;
        this.playerCore?.destroy();
        this.playerCore = null;
    }

    @Watch('recordedId')
    @Watch('videoFileId')
    @Watch('mode')
    @Watch('streamingType')
    @Watch('quality')
    @Watch('encoder')
    @Watch('hevc')
    @Watch('subtitleIndex')
    @Watch('subtitleFileKey')
    public onParamChange(): void {
        this.initialize().catch(err => {
            this.handleError(err, 'ストリームの切り替えに失敗しました。');
        });
    }

    public reload(): void {
        this.initialize().catch(err => {
            this.handleError(err, 'プレイヤーの再読み込みに失敗しました。');
        });
    }

    private async initialize(): Promise<void> {
        const generation = ++this.initGeneration;
        this.applyPlayerState({
            isLoading: true,
            isBuffering: false,
            loadingText: 'ストリームを準備中...',
        });

        await this.videoState.clear();
        await this.videoState.fetchInfo(this.recordedId, this.videoFileId);

        const sourceInfo = await this.prepareSource();
        if (sourceInfo === null || generation !== this.initGeneration) {
            return;
        }

        const container = this.$refs.player as HTMLElement | undefined;
        if (container === undefined) {
            return;
        }

        if (this.playerCore === null) {
            this.playerCore = new RecordedStreamingPlayerCore({
                container,
                src: sourceInfo.src,
                type: sourceInfo.type,
                enableAribSubtitle: sourceInfo.enableAribSubtitle,
                duration: this.videoState.getDuration(),
                jikkyoCommentsUrl: this.getJikkyoCommentsUrl(),
                onStateChange: this.applyPlayerState,
                onError: err => {
                    console.error(err);
                },
            });
            await this.playerCore.init();
        } else {
            this.playerCore.setSource(sourceInfo.src, sourceInfo.type, sourceInfo.enableAribSubtitle, this.videoState.getDuration(), this.getJikkyoCommentsUrl());
        }
    }

    private getJikkyoCommentsUrl(): string | undefined {
        return this.streamingType === 'hls-ts' ? `./api/recorded/${this.recordedId.toString(10)}/jikkyo` : undefined;
    }

    private async prepareSource(): Promise<{ src: string; type: PlayerType; enableAribSubtitle: boolean } | null> {
        if (this.streamingType === 'hls' || this.streamingType === 'hls-ts') {
            const subtitleIndex = await this.resolveSubtitleIndex();
            return {
                src: `./api/streams/recorded/${this.videoFileId}/vodhls/playlist?${this.buildStreamQuery(0, subtitleIndex)}`,
                type: 'hls',
                enableAribSubtitle: this.streamingType === 'hls-ts',
            };
        }

        return {
            src: `./api/streams/recorded/${this.videoFileId}/m2tsll?${this.buildStreamQuery(0)}`,
            type: 'mpegts',
            enableAribSubtitle: true,
        };
    }

    private async resolveSubtitleIndex(): Promise<string | undefined> {
        if (this.streamingType !== 'hls') {
            return undefined;
        }

        const requestedSubtitleIndex = this.getRequestedSubtitleIndex();
        if (typeof requestedSubtitleIndex !== 'undefined') {
            return requestedSubtitleIndex === 'none' ? '-1' : requestedSubtitleIndex;
        }

        return '-1';
    }

    private buildStreamQuery(playPosition: number, subtitleIndex: string | undefined = this.subtitleIndex): string {
        const params = new URLSearchParams({
            mode: this.mode.toString(10),
            ss: playPosition.toString(10),
        });
        if (typeof this.quality !== 'undefined') {
            params.set('quality', this.quality);
        }
        if (typeof this.encoder !== 'undefined') {
            params.set('encoder', this.encoder);
        }
        if (typeof this.hevc !== 'undefined') {
            params.set('hevc', this.hevc);
        }
        const usesSubtitle = typeof subtitleIndex === 'string' && subtitleIndex !== 'none' && subtitleIndex !== '-1';
        if (usesSubtitle === true && typeof subtitleIndex === 'string') {
            params.set('subtitleIndex', subtitleIndex);
        }
        if (usesSubtitle === false && subtitleIndex === '-1') {
            params.set('subtitleIndex', subtitleIndex);
        }
        if (usesSubtitle === true && typeof this.subtitleFileKey !== 'undefined') {
            params.set('subtitleFileKey', this.subtitleFileKey);
        }

        return params.toString();
    }

    private getRequestedSubtitleIndex(): string | undefined {
        if (typeof this.subtitleIndex !== 'undefined') {
            return this.subtitleIndex;
        }

        return typeof this.$route.query.subtitleIndex === 'string' ? this.$route.query.subtitleIndex : undefined;
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
.watch-recorded-player
    position: relative
    width: 100%
    background: black

    &::before
        content: ""
        display: block
        padding-top: 56.25%

.watch-recorded-player-loading
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

.watch-recorded-player-loading-text
    font-size: 14px
    font-weight: 700

.watch-recorded-dplayer
    z-index: 1
    position: absolute
    top: 0
    right: 0
    bottom: 0
    left: 0
    width: 100%
    height: 100%
</style>

<style lang="sass">
.watch-recorded-dplayer
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

    .dplayer-notice
        border-radius: 4px
        background: rgba(0, 0, 0, 0.76)
</style>
