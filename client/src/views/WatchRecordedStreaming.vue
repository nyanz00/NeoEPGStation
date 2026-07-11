<template>
    <v-main class="watch-recorded-main">
        <transition name="page">
            <div class="watch-recorded-page">
                <header class="watch-recorded-header">
                    <v-btn class="watch-recorded-header-button" icon dark title="メニュー" v-on:click="toggleNavigation">
                        <v-icon>mdi-menu</v-icon>
                    </v-btn>
                    <v-btn class="watch-recorded-header-button" icon dark title="戻る" v-on:click="goBack">
                        <v-icon>mdi-chevron-left</v-icon>
                    </v-btn>
                    <div class="watch-recorded-title">
                        <div class="watch-recorded-channel">{{ displayInfo === null ? '録画視聴' : displayInfo.channelName }}</div>
                        <div class="watch-recorded-program">{{ displayInfo === null ? '番組情報を取得中...' : displayInfo.name }}</div>
                    </div>
                    <div v-if="displayInfo !== null" class="watch-recorded-time">{{ displayInfo.time }}</div>
                    <v-spacer></v-spacer>
                    <v-btn class="watch-recorded-header-button" icon dark title="再読み込み" v-on:click="reloadPlayer">
                        <v-icon>mdi-refresh</v-icon>
                    </v-btn>
                    <v-btn class="watch-recorded-header-button" icon dark title="スクリーンショット" v-on:click="captureFrame">
                        <v-icon>mdi-camera</v-icon>
                    </v-btn>
                    <v-btn class="watch-recorded-header-button" icon dark title="番組情報" v-on:click="togglePanel">
                        <v-icon>{{ isPanelOpen === true ? 'mdi-chevron-right' : 'mdi-information-outline' }}</v-icon>
                    </v-btn>
                </header>
                <div class="watch-recorded-body" v-bind:class="{ 'is-panel-open': isPanelOpen === true }">
                    <section class="watch-recorded-player-wrap">
                        <div class="watch-recorded-player-inner">
                            <WatchRecordedStreamingPlayer
                                v-if="watchParam !== null && isVodHlsStreaming === true"
                                v-bind:key="playerKey"
                                v-bind:recordedId="watchParam.recordedId"
                                v-bind:videoFileId="watchParam.videoFileId"
                                v-bind:mode="watchParam.mode"
                                v-bind:streamingType="watchParam.streamingType"
                                v-bind:quality="watchParam.quality"
                                v-bind:encoder="watchParam.encoder"
                                v-bind:hevc="watchParam.hevc"
                                v-bind:subtitle-index="watchParam.subtitleIndex"
                                v-bind:subtitle-file-key="watchParam.subtitleFileKey"
                            ></WatchRecordedStreamingPlayer>
                            <VideoContainer
                                v-else-if="videoParam !== null"
                                v-bind:key="playerKey"
                                class="watch-recorded-video-container"
                                v-bind:videoParam="videoParam"
                            ></VideoContainer>
                        </div>
                    </section>
                    <aside v-if="isPanelOpen === true" class="watch-recorded-panel">
                        <div class="watch-recorded-panel-header">
                            <div class="watch-recorded-panel-title">番組情報</div>
                            <v-btn icon dark small v-on:click="togglePanel">
                                <v-icon>mdi-close</v-icon>
                            </v-btn>
                        </div>
                        <div v-if="displayInfo !== null" class="watch-recorded-panel-content">
                            <div class="watch-recorded-panel-channel">{{ displayInfo.channelName }}</div>
                            <div class="watch-recorded-panel-time">{{ displayInfo.time }}</div>
                            <div class="watch-recorded-panel-program">{{ displayInfo.name }}</div>
                            <div class="watch-recorded-panel-description">{{ displayInfo.description }}</div>
                        </div>
                        <div v-else class="watch-recorded-panel-empty">番組情報を取得中...</div>
                    </aside>
                </div>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchRecordedStreamingPlayer from '@/components/recorded/watch/WatchRecordedStreamingPlayer.vue';
import VideoContainer from '@/components/video/VideoContainer.vue';
import * as VideoParam from '@/components/video/ViedoParam';
import container from '@/model/ModelContainer';
import ISocketIOModel from '@/model/socketio/ISocketIOModel';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import INavigationState, { NavigationType } from '@/model/state/navigation/INavigationState';
import IWatchRecordedInfoState, { DsiplayWatchInfo } from '@/model/state/recorded/watch/IWatchRecordedInfoState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

interface WatchRecordedStreamingParam {
    recordedId: apid.RecordedId;
    videoFileId: apid.VideoFileId;
    streamingType: string;
    mode: number;
    videoFileType: apid.VideoFileType;
    quality?: string;
    encoder?: string;
    hevc?: string;
    subtitleIndex?: string;
    subtitleFileKey?: string;
}

@Component({
    components: {
        WatchRecordedStreamingPlayer,
        VideoContainer,
    },
})
export default class WatchRecordedStreaming extends Vue {
    public watchParam: WatchRecordedStreamingParam | null = null;
    public videoParam: VideoParam.RecordedStreamingParam | VideoParam.RecordedHLSParam | null = null;
    public displayInfo: DsiplayWatchInfo | null = null;
    public isPanelOpen: boolean = true;
    public playerKey: number = 0;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');
    private infoState: IWatchRecordedInfoState = container.get<IWatchRecordedInfoState>('IWatchRecordedInfoState');
    private socketIoModel: ISocketIOModel = container.get<ISocketIOModel>('ISocketIOModel');
    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');
    private savedNavigationState: {
        openState: boolean | null;
        type: NavigationType;
        isClipped: boolean;
    } | null = null;
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
    }

    public beforeRouteLeave(to: any, from: any, next: () => void): void {
        void to;
        void from;
        this.restoreNavigation();
        next();
    }

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        const videoFileId = parseInt(this.$route.params.id, 10);
        const recordedId = typeof this.$route.query.recordedId !== 'string' ? NaN : parseInt(this.$route.query.recordedId, 10);
        const streamingType = typeof this.$route.query.streamingType !== 'string' ? null : this.$route.query.streamingType;
        const mode = typeof this.$route.query.mode !== 'string' ? NaN : parseInt(this.$route.query.mode, 10);
        const videoFileType = typeof this.$route.query.videoFileType !== 'string' ? null : this.$route.query.videoFileType;
        const quality = typeof this.$route.query.quality === 'string' ? this.$route.query.quality : undefined;
        const encoder = typeof this.$route.query.encoder === 'string' ? this.$route.query.encoder : undefined;
        const hevc = typeof this.$route.query.hevc === 'string' ? this.$route.query.hevc : undefined;
        const subtitleIndex = typeof this.$route.query.subtitleIndex === 'string' ? this.$route.query.subtitleIndex : undefined;
        const subtitleFileKey = typeof this.$route.query.subtitleFileKey === 'string' ? this.$route.query.subtitleFileKey : undefined;

        this.infoState.clear();
        this.displayInfo = null;
        this.watchParam = null;
        this.videoParam = null;

        this.$nextTick(async () => {
            if (
                Number.isNaN(videoFileId) === false &&
                Number.isNaN(recordedId) === false &&
                streamingType !== null &&
                Number.isNaN(mode) === false &&
                (videoFileType === 'ts' || videoFileType === 'encoded')
            ) {
                this.watchParam = {
                    recordedId: recordedId,
                    videoFileId: videoFileId,
                    streamingType: streamingType,
                    mode: mode,
                    videoFileType: videoFileType,
                    quality: quality,
                    encoder: encoder,
                    hevc: hevc,
                    subtitleIndex: subtitleIndex,
                    subtitleFileKey: subtitleFileKey,
                };
                this.videoParam = this.createLegacyVideoParam(this.watchParam);
                await this.updateInfo();
            }

            await this.scrollState.emitDoneGetData();
        });
    }

    public togglePanel(): void {
        this.isPanelOpen = !this.isPanelOpen;
    }

    public get isVodHlsStreaming(): boolean {
        return this.watchParam !== null && (this.watchParam.streamingType === 'hls' || this.watchParam.streamingType === 'hls-ts');
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

    public goBack(): void {
        if (this.watchParam === null) {
            this.$router.push('/recorded').catch(err => {});
            return;
        }

        this.$router.push({ name: 'recorded-detail', params: { id: this.watchParam.recordedId.toString(10) } }).catch(err => {});
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

        await this.infoState.update(this.watchParam.recordedId).catch(err => {
            this.snackbarState.open({
                color: 'error',
                text: '番組情報取得に失敗',
            });
            console.error(err);
        });

        this.displayInfo = this.infoState.getInfo();
    }

    private createLegacyVideoParam(watchParam: WatchRecordedStreamingParam): VideoParam.RecordedStreamingParam | VideoParam.RecordedHLSParam {
        if (watchParam.streamingType === 'hls') {
            return {
                type: 'RecordedHLS',
                recordedId: watchParam.recordedId,
                videoFileId: watchParam.videoFileId,
                mode: watchParam.mode,
            };
        }

        return {
            type: 'RecordedStreaming',
            recordedId: watchParam.recordedId,
            videoFileId: watchParam.videoFileId,
            streamingType: watchParam.streamingType,
            mode: watchParam.mode,
        };
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
        const name = this.displayInfo === null ? 'recorded' : this.displayInfo.name;

        return `${timestamp}-${this.sanitizeFileName(name)}`;
    }

    private sanitizeFileName(name: string): string {
        const sanitized = name.replace(/[\\/:*?"<>|]/g, '_').trim();

        return sanitized.length === 0 ? 'recorded' : sanitized.slice(0, 80);
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
.watch-recorded-main
    background: #050505

.watch-recorded-page
    min-height: calc(100vh - 64px)
    background: radial-gradient(circle at top left, #263241 0, #101114 38%, #050505 100%)
    color: white

.watch-recorded-header
    display: flex
    align-items: center
    min-height: 72px
    padding: 10px 18px
    background: linear-gradient(to bottom, rgba(0, 0, 0, 0.78), rgba(0, 0, 0, 0.18))

.watch-recorded-header-button
    flex: 0 0 auto

.watch-recorded-title
    min-width: 0
    margin-left: 8px

.watch-recorded-channel
    color: rgba(255, 255, 255, 0.72)
    font-size: 13px
    font-weight: 700
    line-height: 1.3

.watch-recorded-program
    max-width: 52vw
    overflow: hidden
    text-overflow: ellipsis
    white-space: nowrap
    font-size: 20px
    font-weight: 800
    line-height: 1.35

.watch-recorded-time
    flex: 0 0 auto
    margin-left: 18px
    color: rgba(255, 255, 255, 0.72)
    font-size: 13px
    font-weight: 700

.watch-recorded-body
    display: grid
    grid-template-columns: minmax(0, 1fr)
    gap: 16px
    padding: 0 18px 10px

    &.is-panel-open
        grid-template-columns: minmax(0, 1fr) 360px

.watch-recorded-player-wrap
    display: flex
    align-items: center
    justify-content: center
    min-width: 0
    min-height: calc(100vh - 136px)

.watch-recorded-player-inner
    width: 100%
    max-width: 170vh
    border-radius: 10px
    overflow: hidden
    background: black
    box-shadow: 0 18px 54px rgba(0, 0, 0, 0.52)

.watch-recorded-video-container
    width: 100%

.watch-recorded-panel
    display: flex
    flex-direction: column
    min-height: calc(100vh - 154px)
    max-height: calc(100vh - 154px)
    border-left: 1px solid rgba(255, 255, 255, 0.08)
    background: rgba(16, 17, 20, 0.92)
    overflow: hidden

.watch-recorded-panel-header
    display: flex
    align-items: center
    min-height: 56px
    padding: 0 14px 0 18px
    border-bottom: 1px solid rgba(255, 255, 255, 0.08)

.watch-recorded-panel-title
    flex: 1 1 auto
    font-size: 16px
    font-weight: 800

.watch-recorded-panel-content
    overflow-y: auto
    padding: 18px

.watch-recorded-panel-channel
    color: rgba(255, 255, 255, 0.72)
    font-size: 13px
    font-weight: 700

.watch-recorded-panel-time
    margin-top: 4px
    color: rgba(255, 255, 255, 0.56)
    font-size: 13px

.watch-recorded-panel-program
    margin-top: 16px
    font-size: 22px
    font-weight: 800
    line-height: 1.4

.watch-recorded-panel-description
    margin-top: 16px
    color: rgba(255, 255, 255, 0.78)
    font-size: 14px
    line-height: 1.8
    white-space: pre-wrap

.watch-recorded-panel-empty
    padding: 18px
    color: rgba(255, 255, 255, 0.62)

@media screen and (max-width: 1100px)
    .watch-recorded-body
        &.is-panel-open
            grid-template-columns: minmax(0, 1fr)

    .watch-recorded-player-wrap
        min-height: auto

    .watch-recorded-panel
        min-height: auto
        max-height: none
        border-left: 0
        border-top: 1px solid rgba(255, 255, 255, 0.08)

@media screen and (max-width: 700px)
    .watch-recorded-header
        padding: 8px 10px

    .watch-recorded-program
        max-width: 58vw
        font-size: 16px

    .watch-recorded-time
        display: none

    .watch-recorded-body
        padding: 0 8px 8px

    .watch-recorded-player-inner
        border-radius: 6px
</style>
