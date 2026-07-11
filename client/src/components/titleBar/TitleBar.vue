<template>
    <v-app-bar app :dark="$vuetify.theme.dark === false" :color="appBarColor" :clipped-left="navigationState.isClipped">
        <v-app-bar-nav-icon @click.stop="toggle"></v-app-bar-nav-icon>
        <v-toolbar-title class="title-content" v-bind:class="{ clickable: !!needsTitleClickEvent === true }" v-on:click="onTitle">
            <span>{{ title }}</span>
            <img v-if="showNyanzIcon === true" class="nyanz-smile" src="/icon/nyanz-smile.png" alt="" />
        </v-toolbar-title>
        <v-spacer></v-spacer>
        <slot name="menu"></slot>
        <template v-if="this.$slots.extension" v-slot:extension>
            <slot name="extension"></slot>
        </template>
    </v-app-bar>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import { Component, Prop, Vue, Watch } from 'vue-property-decorator';
import INavigationState from '../../model/state/navigation/INavigationState';

@Component({})
export default class TitleBar extends Vue {
    @Prop({ required: true })
    public title!: string;

    @Prop({ required: false })
    public needsTitleClickEvent: boolean | undefined;

    @Prop({ default: false })
    public showNyanzIcon!: boolean;

    public navigationState: INavigationState = container.get<INavigationState>('INavigationState');

    /**
     * title bar の色を返す
     */
    get appBarColor(): string | null {
        return this.$vuetify.theme.dark === true ? null : 'indigo';
    }

    public onTitle(): void {
        this.$emit('click');
    }

    public toggle(): void {
        this.navigationState.toggle();
    }

    @Watch('title', { immediate: true })
    private onTitleChanged(newTitle: string, old: string): void {
        document.title = newTitle;
    }
}
</script>

<style lang="sass">
.title-content
    display: flex
    align-items: center
    gap: 6px
    cursor: default
    user-select: none

    &.clickable
        cursor: pointer

    .nyanz-smile
        display: inline-block
        width: auto
        height: 24px
        object-fit: contain
</style>
