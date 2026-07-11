<template>
    <div class="watch-on-air-player">
        <div v-if="isLoading === true || isBuffering === true" class="watch-on-air-player-loading">
            <v-progress-circular indeterminate size="56" width="5"></v-progress-circular>
            <div class="watch-on-air-player-loading-text">{{ loadingText }}</div>
        </div>
        <div ref="player" class="watch-on-air-dplayer"></div>
    </div>
</template>

<script lang="ts">
import LiveMpegTsPlayerCore, { LiveMpegTsPlayerState } from '@/player/LiveMpegTsPlayerCore';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';

@Component({})
export default class WatchOnAirPlayer extends Vue {
    @Prop({ required: true })
    public src!: string;

    @Prop({ required: true })
    public channelId!: number;

    @Prop({ required: true })
    public lowLatency!: boolean;

    public isLoading: boolean = true;
    public isBuffering: boolean = false;
    public loadingText: string = 'プレイヤーを初期化中...';

    private playerCore: LiveMpegTsPlayerCore | null = null;

    public mounted(): void {
        const container = this.$refs.player as HTMLElement | undefined;
        if (container === undefined) {
            return;
        }

        this.playerCore = new LiveMpegTsPlayerCore({
            container,
            channelId: this.channelId,
            src: this.src,
            lowLatency: this.lowLatency,
            onStateChange: this.applyPlayerState,
            onError: err => {
                console.error(err);
            },
            onWarn: err => {
                console.warn('[WatchOnAirPlayer] playback recovery failed:', err);
            },
        });
        this.playerCore.init().catch(err => {
            console.error(err);
        });
    }

    public beforeDestroy(): void {
        this.playerCore?.destroy();
        this.playerCore = null;
    }

    @Watch('src')
    public onSrcChange(): void {
        this.playerCore?.setSource(this.src);
    }

    @Watch('channelId')
    public onChannelIdChange(): void {
        this.playerCore?.setChannelId(this.channelId);
    }

    @Watch('lowLatency')
    public onLowLatencyChange(): void {
        this.playerCore?.setLowLatency(this.lowLatency);
    }

    public restartPlayer(message: string = 'プレイヤーを再起動しています...'): void {
        this.playerCore?.restart(message);
    }

    private applyPlayerState(state: LiveMpegTsPlayerState): void {
        this.isLoading = state.isLoading;
        this.isBuffering = state.isBuffering;
        this.loadingText = state.loadingText;
    }
}
</script>

<style lang="sass" scoped>
.watch-on-air-player
    position: relative
    width: 100%
    background: black

    &::before
        content: ""
        display: block
        padding-top: 56.25%

.watch-on-air-player-loading
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

.watch-on-air-player-loading-text
    font-size: 14px
    font-weight: 700

.watch-on-air-dplayer
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
.watch-on-air-dplayer
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

    .dplayer-live-badge
        color: white

    .dplayer-comment-box, .dplayer-comment
        display: none !important

    .dplayer-notice
        border-radius: 4px
        background: rgba(0, 0, 0, 0.76)
</style>
