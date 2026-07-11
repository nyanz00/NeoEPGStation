<template>
    <v-select
        class="encode-channel"
        :value="value"
        :items="items"
        :label="label"
        multiple
        clearable
        small-chips
        deletable-chips
        :menu-props="{ auto: true, closeOnContentClick: false }"
        v-on:input="onInput"
    >
        <template v-slot:item="{ item, attrs, on }">
            <v-list-item v-bind="attrs" v-on="on">
                <v-list-item-action>
                    <v-checkbox :input-value="attrs.inputValue" class="ma-0 pa-0" hide-details dense></v-checkbox>
                </v-list-item-action>
                <v-list-item-content>
                    <v-list-item-title>{{ item.text }}</v-list-item-title>
                </v-list-item-content>
            </v-list-item>
        </template>
        <template v-slot:selection="{ item, index }">
            <v-chip v-if="index < 2" small close v-on:click:close="remove(item.value)">
                {{ item.text }}
            </v-chip>
            <span v-else-if="index === 2" class="caption">+{{ value.length - 2 }}</span>
        </template>
    </v-select>
</template>

<script lang="ts">
import { Component, Prop, Vue } from 'vue-property-decorator';

interface SelectorItem {
    text: string;
    value: number;
}

@Component({})
export default class EncodeChannelMultiSelect extends Vue {
    @Prop({ required: true })
    public value!: number[];

    @Prop({ required: true })
    public items!: SelectorItem[];

    @Prop({ required: true })
    public label!: string;

    public onInput(value: number[] | null): void {
        this.$emit('input', Array.isArray(value) === true ? value : []);
    }

    public remove(value: number): void {
        this.$emit(
            'input',
            this.value.filter(id => id !== value),
        );
    }
}
</script>
