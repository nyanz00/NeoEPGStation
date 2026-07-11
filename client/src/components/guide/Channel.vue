<template>
    <div class="channels d-flex" v-bind:class="{ isDark: $vuetify.theme.dark === true }">
        <div class="item dummy">dummy</div>
        <div class="white--text item" v-for="channel in channelItems" v-bind:key="channel.index" v-on:click="onClick(channel.item)">
            <div v-if="isGuideChannel(channel)" class="channel-meta">
                <div class="channel-logo-box">
                    <img
                        v-if="isShowLogo(channel)"
                        :src="channel.logoSrc"
                        :alt="channel.name"
                        class="channel-logo"
                        loading="lazy"
                        decoding="async"
                        v-on:error.stop="onLogoError(channel.id)"
                    />
                </div>
                <div class="channel-type">
                    {{ channel.channelTypeName }}
                </div>
            </div>
            <div class="channel-name" v-bind:class="{ 'date-label': isGuideChannel(channel) === false }">
                {{ getDisplayChannelName(channel) }}
            </div>
        </div>
        <div class="item scrollbar">dummy</div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IGuideState from '@/model/state/guide/IGuideState';
import IOnAirSelectStreamState from '@/model/state/onair/IOnAirSelectStreamState';
import ChannelTypeUtil from '@/util/ChannelTypeUtil';
import DateUtil from '@/util/DateUtil';
import Util from '@/util/Util';
import { Component, Vue } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface DisplayChannelItem {
    name: string;
    id: apid.ChannelId;
    index: number | string;
    item: apid.ScheduleChannleItem;
    channelTypeName?: string;
    logoSrc?: string;
}

@Component({})
export default class Channel extends Vue {
    public guideState: IGuideState = container.get<IGuideState>('IGuideState');
    public failedLogoIds: { [channelId: number]: boolean } = {};

    private streamSelectDialog: IOnAirSelectStreamState = container.get<IOnAirSelectStreamState>('IOnAirSelectStreamState');

    get channelItems(): DisplayChannelItem[] {
        if (typeof this.$route.query.channelId === 'undefined') {
            return this.guideState.getChannels().map(c => {
                return {
                    name: c.name,
                    id: c.id,
                    index: c.id,
                    item: c,
                    channelTypeName: ChannelTypeUtil.getDisplayName(c.channelType),
                    logoSrc: c.hasLogoData === true ? `./api/channels/${c.id.toString(10)}/logo` : undefined,
                };
            });
        } else {
            let baseTime = this.guideState.getStartAt();

            return this.guideState.getChannels().map(c => {
                const name = DateUtil.format(DateUtil.getJaDate(new Date(baseTime)), 'MM/dd(w)');
                baseTime += 60 * 60 * 24 * 1000;

                return {
                    name: name,
                    id: c.id,
                    index: name,
                    item: c,
                };
            });
        }
    }

    public async onClick(item: apid.ScheduleChannleItem): Promise<void> {
        // 単局表示の場合は何もしない
        if (typeof this.$route.query.channelId !== 'undefined') {
            return;
        }

        this.streamSelectDialog.open(item);
    }

    public isShowLogo(channel: DisplayChannelItem): boolean {
        return typeof channel.logoSrc === 'string' && this.failedLogoIds[channel.id] !== true;
    }

    public isGuideChannel(channel: DisplayChannelItem): boolean {
        return typeof channel.channelTypeName === 'string';
    }

    public getDisplayChannelName(channel: DisplayChannelItem): string {
        if (this.isGuideChannel(channel) === false) {
            return channel.name;
        }

        return channel.name.replace(/[A-Za-z0-9]/g, c => {
            return String.fromCharCode(c.charCodeAt(0) + 0xfee0);
        });
    }

    public onLogoError(channelId: apid.ChannelId): void {
        this.$set(this.failedLogoIds, channelId, true);
    }
}
</script>

<style lang="sass" scoped>
$board-line: 1px solid #ccc
$board-line-dark: 1px solid #888888

.channels
    .item
        min-width: var(--channel-width)
        max-width: var(--channel-width)
        width: var(--channel-width)
        min-height: var(--channel-height)
        max-height: var(--channel-height)
        height: var(--channel-height)
        font-size: var(--channel-fontsize)
        font-weight: bold
        cursor: pointer
        overflow: hidden
        display: flex
        flex-direction: column
        justify-content: flex-start
        align-items: stretch
        gap: 3px
        padding: 2px 6px
        background: #999
        box-sizing: border-box
        border-left: $board-line
        border-right: $board-line

        .channel-meta
            display: flex
            align-items: center
            justify-content: space-between
            min-height: 28px

        .channel-logo-box
            flex: 0 0 auto
            width: 40px
            height: 30px
            overflow: hidden
            display: flex
            justify-content: flex-start
            align-items: center

        .channel-logo
            width: 100%
            height: 100%
            object-fit: contain

        .channel-type
            flex: 0 0 auto
            margin-left: 4px
            font-size: 12px
            line-height: 1
            color: rgba(255, 255, 255, 0.86)
            letter-spacing: 0

        .channel-name
            width: 100%
            overflow: hidden
            white-space: nowrap
            text-overflow: ellipsis
            line-height: 1.15
            text-align: left

            &.date-label
                text-align: center

    .item.dummy
        min-width: var(--timescale-width)
        max-width: var(--timescale-width)
        width: var(--timescale-width)
        visibility: hidden

    .item.scrollbar
        visibility: hidden

    &.isDark
        .item
            background: #393e46
            border-left: $board-line-dark
            border-right: $board-line-dark
</style>
