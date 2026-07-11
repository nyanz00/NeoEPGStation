<template>
    <v-main class="watch-recorded-play-main">
        <TitleBar title="視聴"></TitleBar>
        <transition name="page">
            <div class="video-container-wrap mx-auto px-3 py-3">
                <WatchRecordedPlayPlayer v-if="videoId !== null" v-bind:video-file-id="videoId"></WatchRecordedPlayPlayer>
                <WatchOnRecordedInfoCard v-if="recordedId !== null" v-bind:recordedId="recordedId"></WatchOnRecordedInfoCard>
                <div style="visibility: hidden">dummy</div>
            </div>
        </transition>
    </v-main>
</template>

<script lang="ts">
import WatchOnRecordedInfoCard from '@/components/recorded/watch/WatchRecordedInfoCard.vue';
import WatchRecordedPlayPlayer from '@/components/recorded/watch/WatchRecordedPlayPlayer.vue';
import TitleBar from '@/components/titleBar/TitleBar.vue';
import container from '@/model/ModelContainer';
import IScrollPositionState from '@/model/state/IScrollPositionState';
import INavigationState, { NavigationType } from '@/model/state/navigation/INavigationState';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../api';

Component.registerHooks(['beforeRouteUpdate', 'beforeRouteLeave']);

@Component({
    components: {
        TitleBar,
        WatchRecordedPlayPlayer,
        WatchOnRecordedInfoCard,
    },
})
export default class WatchRecorded extends Vue {
    public videoId: apid.VideoFileId | null = null;
    public recordedId: apid.RecordedId | null = null;

    private scrollState: IScrollPositionState = container.get<IScrollPositionState>('IScrollPositionState');
    private navigationState: INavigationState = container.get<INavigationState>('INavigationState');
    private savedNavigationState: {
        openState: boolean | null;
        type: NavigationType;
        isClipped: boolean;
    } | null = null;

    public created(): void {
        this.applyTheaterNavigation();
    }

    public beforeDestroy(): void {
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
        // 視聴パラメータセット
        const videoId = typeof this.$route.query.videoId !== 'string' ? null : parseInt(this.$route.query.videoId, 10);
        this.recordedId = typeof this.$route.query.recordedId !== 'string' ? null : parseInt(this.$route.query.recordedId, 10);

        this.$nextTick(async () => {
            this.videoId = videoId;

            // データ取得完了を通知
            await this.scrollState.emitDoneGetData();
        });
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
.watch-recorded-play-main
    min-height: 100vh
    background: #050505

.video-container-wrap
    max-width: 170vh
</style>
