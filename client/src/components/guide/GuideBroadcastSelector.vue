<template>
    <v-select v-if="items.length > 1" v-model="selectedType" :items="items" class="guide-broadcast-selector" dense dark hide-details outlined v-on:change="onChange"></v-select>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IServerConfigModel from '@/model/serverConfig/IServerConfigModel';
import ChannelTypeUtil from '@/util/ChannelTypeUtil';
import Util from '@/util/Util';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface BroadcastSelectorItem {
    text: string;
    value: apid.ChannelType | null;
}

@Component({})
export default class GuideBroadcastSelector extends Vue {
    public items: BroadcastSelectorItem[] = [];
    public selectedType: apid.ChannelType | null = null;

    private serverConfig: IServerConfigModel = container.get<IServerConfigModel>('IServerConfigModel');

    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.initItems();
        this.initValue();
    }

    public async onChange(): Promise<void> {
        const query: any = { ...this.$route.query };
        if (this.selectedType === null) {
            delete query.type;
        } else {
            query.type = this.selectedType;
        }

        await Util.move(this.$router, {
            path: '/guide',
            query,
        });
    }

    private initItems(): void {
        const config = this.serverConfig.getConfig();
        if (config === null) {
            this.items = [];
            return;
        }

        this.items = [
            {
                text: '全波',
                value: null,
            },
        ];

        for (const type of ChannelTypeUtil.broadcastTypes) {
            if (config.broadcast[type] !== true) {
                continue;
            }

            this.items.push({
                text: ChannelTypeUtil.getDisplayName(type),
                value: type,
            });
        }
    }

    private initValue(): void {
        if (typeof this.$route.query.type !== 'string') {
            this.selectedType = null;
            return;
        }

        const type = this.$route.query.type as apid.ChannelType;
        this.selectedType = this.items.some(item => item.value === type) === true ? type : null;
    }
}
</script>

<style lang="sass" scoped>
.guide-broadcast-selector
    width: 104px
    margin-right: 4px
</style>

<style lang="sass">
.guide-broadcast-selector
    .v-input__slot
        min-height: 32px !important
    .v-select__selection
        font-size: 14px
</style>
