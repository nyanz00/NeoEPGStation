<template>
    <v-main class="watch-main">
        <transition name="page">
            <div class="watch-page">
                <header class="watch-header">
                    <v-btn class="watch-header-button" icon dark title="メニュー" v-on:click="toggleNavigation">
                        <v-icon>mdi-menu</v-icon>
                    </v-btn>
                    <v-btn class="watch-header-button" icon dark to="/onair">
                        <v-icon>mdi-chevron-left</v-icon>
                    </v-btn>
                    <div class="watch-title">
                        <div class="watch-channel">{{ displayInfo === null ? '視聴' : displayInfo.channelName }}</div>
                        <div class="watch-program">{{ displayInfo === null ? '番組情報を取得中...' : displayInfo.name }}</div>
                    </div>
                    <div v-if="displayInfo !== null" class="watch-time">{{ displayInfo.time }}</div>
                    <v-spacer></v-spacer>
                    <v-btn class="watch-header-button" icon dark title="再読み込み" v-on:click="reloadPlayer">
                        <v-icon>mdi-refresh</v-icon>
                    </v-btn>
                    <v-btn class="watch-header-button" icon dark title="スクリーンショット" v-on:click="captureFrame">
                        <v-icon>mdi-camera</v-icon>
                    </v-btn>
                    <v-btn class="watch-header-button" icon dark title="番組情報" v-on:click="togglePanel">
                        <v-icon>{{ isPanelOpen === true ? 'mdi-chevron-right' : 'mdi-information-outline' }}</v-icon>
                    </v-btn>
                </header>
                <div class="watch-body" v-bind:class="{ 'is-panel-open': isPanelOpen === true }">
                    <section class="watch-player">
                        <div class="watch-player-inner">
                            <WatchOnAirPlayer
                                v-if="mpegTsSrc !== null && watchParam !== null"
                                v-bind:key="playerKey"
                                v-bind:channel-id="watchParam.channel"
                                v-bind:src="mpegTsSrc"
                                v-bind:lowLatency="isLowLatency"
                            ></WatchOnAirPlayer>
                            <VideoContainer v-else-if="videoParam !== null" v-bind:key="playerKey" class="watch-video" v-bind:videoParam="videoParam"></VideoContainer>
                        </div>
                    </section>
                    <aside v-if="isPanelOpen === true" class="watch-panel">
                        <div class="watch-panel-header">
                            <div class="watch-panel-title">番組情報</div>
                            <v-btn icon dark small v-on:click="togglePanel">
                                <v-icon>mdi-close</v-icon>
                            </v-btn>
                        </div>
                        <div v-if="displayInfo !== null" class="watch-panel-content">
                            <div class="watch-panel-channel">{{ displayInfo.channelName }}</div>
                            <div class="watch-panel-time">{{ displayInfo.time }}</div>
                            <div class="watch-panel-program">{{ displayInfo.name }}</div>
                            <div class="watch-panel-description">{{ displayInfo.description }}</div>
                        </div>
                        <div v-else class="watch-panel-empty">番組情報を取得中...</div>
                    </aside>
                </div>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchOnAirPlayer from '@/components/onair/watch/WatchOnAirPlayer.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import { BaseVideoParam, LiveHLSParam, NormalVideoParam } from '@/components/video/ViedoParam';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import INavigationState, { NavigationType } from '@/model/state/navigation/INavigationState';
import IWatchOnAirInfoState, { DsiplayWatchInfo } from '@/model/state/onair/watch/IWatchOnAirInfoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

interface WatchParam {
    type: string;
    channel: apid.ChannelId;
    mode: number;
    quality?: string;
    encoder?: string;
    hevc?: string;
}

@Component({
    components: {
        WatchOnAirPlayer,
        VideoContainer,
    },
})
export default class WatchOnAir extends Vue {
    public videoParam: BaseVideoParam | null = null;
    public mpegTsSrc: string | null = null;
    public displayInfo: DsiplayWatchInfo | null = null;
    public isPanelOpen: boolean = true;
    public isLowLatency: boolean = true;
    public playerKey: number = 0;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private infoState: IWatchOnAirInfoState = container.get<IWatchOnAirInfoState>('IWatchOnAirInfoState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');
    private savedNavigationState: {
        openState: boolean | null;
        type: NavigationType;
        isClipped: boolean;
    } | null = null;

    public watchParam: WatchParam | null = null;
    private updateTimer: number | null = null;
    private onUpdateStatusCallback = (async (): Promise<void> => {
        await this.updateInfo();
    }).bind(this);

    public created(): void {
        this.applyTheaterNavigation();
        this.socketIoModel.onUpdateState(this.onUpdateStatusCallback);
    }

    public beforeDestroy(): void {
        this.socketIoModel.offUpdateState(this.onUpdateStatusCallback);
        this.restoreNavigation();

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
    }

    public beforeRouteLeave(to: any, from: any, next: () => void): void {
        void to;
        void from;
        this.restoreNavigation();
        next();
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        // 視聴パラメータセット
        this.watchParam =
            typeof this.$route.query.type !== 'string' || typeof this.$route.query.channel !== 'string' || typeof this.$route.query.mode !== 'string'
                ? null
                : {
                      type: this.$route.query.type,
                      channel: parseInt(this.$route.query.channel, 10),
                      mode: parseInt(this.$route.query.mode, 10),
                      quality: typeof this.$route.query.quality === 'string' ? this.$route.query.quality : undefined,
                      encoder: typeof this.$route.query.encoder === 'string' ? this.$route.query.encoder : undefined,
                      hevc: typeof this.$route.query.hevc === 'string' ? this.$route.query.hevc : undefined,
                  };

        this.infoState.clear();
        this.displayInfo = null;
        this.videoParam = null;
        this.mpegTsSrc = null;

        this.$nextTick(async () => {
            if (this.watchParam !== null) {
                if (this.watchParam.type === 'hls') {
                    (this.videoParam as LiveHLSParam) = {
                        type: 'LiveHLS',
                        channelId: this.watchParam.channel,
                        mode: this.watchParam.mode,
                    };
                } else if (this.watchParam.type === 'm2ts' || this.watchParam.type === 'm2tsll') {
                    this.isLowLatency = this.watchParam.type === 'm2tsll';
                    const params = new URLSearchParams({
                        mode: this.watchParam.mode.toString(10),
                    });
                    if (typeof this.watchParam.quality !== 'undefined') {
                        params.set('quality', this.watchParam.quality);
                    }
                    if (typeof this.watchParam.encoder !== 'undefined') {
                        params.set('encoder', this.watchParam.encoder);
                    }
                    if (typeof this.watchParam.hevc !== 'undefined') {
                        params.set('hevc', this.watchParam.hevc);
                    }
                    this.mpegTsSrc =
                        `${window.location.origin}${Util.getSubDirectory()}/api/streams/live/` + `${this.watchParam.channel}/${this.watchParam.type}?${params.toString()}`;
                } else {
                    (this.videoParam as NormalVideoParam) = {
                        type: 'Normal',
                        src: `./api/streams/live/${this.watchParam.channel}/${this.watchParam.type}?mode=${this.watchParam.mode}`,
                    };
                }

                await this.updateInfo();
            } else {
                this.videoParam = null;
            }

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
    }

    public togglePanel(): void {
        this.isPanelOpen = !this.isPanelOpen;
    }

    public toggleNavigation(): void {
        this.navigationState.toggle();
    }

    public reloadPlayer(): void {
        this.playerKey++;
        this.snackbarState.open({
            color: 'success',
            text: 'プレイヤーを再読み込みしました。',
        });
    }

    public captureFrame(): void {
        const video = (this.$el as HTMLElement).querySelector('video') as HTMLVideoElement | null;
        if (video === null || video.videoWidth === 0 || video.videoHeight === 0) {
            this.snackbarState.open({
                color: 'error',
                text: 'スクリーンショットを取得できませんでした。',
            });
            return;
        }

        try {
            const canvas = document.createElement('canvas');
            canvas.width = video.videoWidth;
            canvas.height = video.videoHeight;
            const context = canvas.getContext('2d');
            if (context === null) {
                throw new Error('CanvasContextIsNull');
            }

            context.drawImage(video, 0, 0, canvas.width, canvas.height);

            const link = document.createElement('a');
            link.download = `${this.getCaptureFileName()}.png`;
            link.href = canvas.toDataURL('image/png');
            link.click();

            this.snackbarState.open({
                color: 'success',
                text: 'スクリーンショットを保存しました。',
            });
        } catch (err) {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: 'スクリーンショットを取得できませんでした。',
            });
        }
    }

    private async updateInfo(): Promise<void> {
        if (this.watchParam === null) {
            return;
        }

        await this.infoState.update(this.watchParam.channel, this.watchParam.mode).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: 'ストリーム情報取得に失敗',
            });
            console.error(err);
        });

        this.displayInfo = this.infoState.getInfo();

        if (this.updateTimer !== null) {
            clearTimeout(this.updateTimer);
        }
        this.updateTimer = setTimeout(() => {
            this.updateInfo();
        }, this.infoState.getUpdateTime());
    }

    private getCaptureFileName(): string {
        const now = new Date();
        const timestamp = [
            now.getFullYear().toString(10),
            this.zeroPadding(now.getMonth() + 1),
            this.zeroPadding(now.getDate()),
            this.zeroPadding(now.getHours()),
            this.zeroPadding(now.getMinutes()),
            this.zeroPadding(now.getSeconds()),
        ].join('');
        const name = this.displayInfo === null ? 'watch' : this.displayInfo.name;

        return `${timestamp}-${this.sanitizeFileName(name)}`;
    }

    private sanitizeFileName(name: string): string {
        const sanitized = name.replace(/[\\/:*?"<>|]/g, '_').trim();

        return sanitized.length === 0 ? 'watch' : sanitized.slice(0, 80);
    }

    private zeroPadding(value: number): string {
        return `0${value.toString(10)}`.slice(-2);
    }

    private applyTheaterNavigation(): void {
        if (this.savedNavigationState !== null) {
            return;
        }

        this.savedNavigationState = {
            openState: this.navigationState.openState,
            type: this.navigationState.type,
            isClipped: this.navigationState.isClipped,
        };
        this.navigationState.type = 'temporary';
        this.navigationState.isClipped = false;
        this.navigationState.openState = false;
    }

    private restoreNavigation(): void {
        if (this.savedNavigationState === null) {
            return;
        }

        this.navigationState.openState = this.savedNavigationState.openState;
        this.navigationState.type = this.savedNavigationState.type;
        this.navigationState.isClipped = this.savedNavigationState.isClipped;
        this.savedNavigationState = null;
    }
}
</script>

<style lang="sass" scoped>
.watch-main
    background: #050505

.watch-page
    min-height: calc(100vh - 64px)
    background: radial-gradient(circle at top left, #263241 0, #101114 38%, #050505 100%)
    color: white

.watch-header
    display: flex
    align-items: center
    min-height: 72px
    padding: 10px 18px
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0.18))

.watch-header-button
    flex: 0 0 auto

.watch-title
    min-width: 0
    margin-left: 8px

.watch-channel
    color: rgba(255, 255, 255, 0.72)
    font-size: 13px
    font-weight: 700
    line-height: 1.3

.watch-program
    max-width: 52vw
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
    font-size: 20px
    font-weight: 800
    line-height: 1.35

.watch-time
    flex: 0 0 auto
    margin-left: 18px
    color: rgba(255, 255, 255, 0.72)
    font-size: 13px
    font-weight: 700

.watch-body
    display: grid
    grid-template-columns: minmax(0, 1fr)
    gap: 16px
    padding: 0 18px 10px

    &.is-panel-open
        grid-template-columns: minmax(0, 1fr) 360px

.watch-player
    display: flex
    align-items: center
    justify-content: center
    min-width: 0
    min-height: calc(100vh - 136px)

.watch-player-inner
    width: 100%
    max-width: 170vh
    border-radius: 10px
    overflow: hidden
    background: black
    box-shadow: 0 18px 54px rgba(0, 0, 0, 0.52)

.watch-video
    width: 100%

.watch-panel
    display: flex
    flex-direction: column
    min-height: calc(100vh - 154px)
    max-height: calc(100vh - 154px)
    border-left: 1px solid rgba(255, 255, 255, 0.08)
    background: rgba(16, 17, 20, 0.92)
    overflow: hidden

.watch-panel-header
    display: flex
    align-items: center
    min-height: 56px
    padding: 0 14px 0 18px
    border-bottom: 1px solid rgba(255, 255, 255, 0.08)

.watch-panel-title
    flex: 1 1 auto
    font-size: 16px
    font-weight: 800

.watch-panel-content
    overflow-y: auto
    padding: 18px

.watch-panel-channel
    color: rgba(255, 255, 255, 0.72)
    font-size: 13px
    font-weight: 700

.watch-panel-time
    margin-top: 4px
    color: rgba(255, 255, 255, 0.56)
    font-size: 13px

.watch-panel-program
    margin-top: 16px
    font-size: 22px
    font-weight: 800
    line-height: 1.4

.watch-panel-description
    margin-top: 16px
    color: rgba(255, 255, 255, 0.78)
    font-size: 14px
    line-height: 1.8
    white-space: pre-wrap

.watch-panel-empty
    padding: 18px
    color: rgba(255, 255, 255, 0.62)

@media screen and (max-width: 1100px)
    .watch-body
        &.is-panel-open
            grid-template-columns: minmax(0, 1fr)

    .watch-player
        min-height: auto

    .watch-panel
        min-height: auto
        max-height: none
        border-left: 0
        border-top: 1px solid rgba(255, 255, 255, 0.08)

@media screen and (max-width: 700px)
    .watch-header
        padding: 8px 10px

    .watch-program
        max-width: 58vw
        font-size: 16px

    .watch-time
        display: none

    .watch-body
        padding: 0 8px 8px

    .watch-player-inner
        border-radius: 6px
</style>
