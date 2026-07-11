<template>
    <v-card class="mx-auto" max-width="800">
        <div class="pa-4">
            <SearchOptionRow title="放送局※" :required="true">
                <v-text-field v-model="channelFilter" class="channel-filter" label="channel filter" clearable hide-details></v-text-field>
                <v-select
                    label="channel"
                    :items="uploadState.getChannelItems(channelFilter)"
                    v-model="uploadState.programOption.channelId"
                    clearable
                    :menu-props="{ auto: true }"
                ></v-select>
            </SearchOptionRow>
            <SearchOptionRow title="ジャンル">
                <div class="d-flex">
                    <v-select
                        label="genre"
                        :items="uploadState.getGenreItems()"
                        v-model="uploadState.programOption.genre1"
                        clearable
                        :menu-props="{ auto: true }"
                        style="width: 50%"
                    ></v-select>
                    <v-select
                        label="sub genre"
                        :items="uploadState.getSubGenreItems()"
                        v-model="uploadState.programOption.subGenre1"
                        clearable
                        :menu-props="{ auto: true }"
                        style="width: 50%"
                    ></v-select>
                </div>
            </SearchOptionRow>
            <SearchOptionRow title="ルール">
                <v-autocomplete
                    v-model="uploadState.programOption.ruleId"
                    :loading="ruleLoading"
                    :items="uploadState.ruleItems"
                    :search-input.sync="ruleSearchInput"
                    item-text="keyword"
                    item-value="id"
                    cache-items
                    flat
                    hide-no-data
                    hide-details
                    clearable
                    label="ルール"
                    class="pb-2"
                ></v-autocomplete>
            </SearchOptionRow>
            <SearchOptionRow title="ユーザー">
                <UserSelector v-model="uploadState.userId" :includeMaster="false"></UserSelector>
            </SearchOptionRow>
            <SearchOptionRow title="日付※" :required="true">
                <div v-if="uploadState.isShowPeriod === true" class="start-at-fields">
                    <v-menu v-model="isStartDatePickerOpen" :close-on-content-click="false" offset-y min-width="290px">
                        <template v-slot:activator>
                            <v-text-field
                                ref="startDateInputField"
                                v-model="startDateInput"
                                label="開始日"
                                placeholder="2026/06/26"
                                hint="yyyy/MM/dd"
                                persistent-hint
                                clearable
                                append-icon="mdi-calendar"
                                v-on:click:append="isStartDatePickerOpen = true"
                            ></v-text-field>
                        </template>
                        <v-date-picker
                            v-model="startDatePickerValue"
                            :dark="$vuetify.theme.dark"
                            :first-day-of-week="1"
                            locale="ja-jp"
                            v-on:input="onStartDatePickerInput"
                        ></v-date-picker>
                    </v-menu>
                    <v-text-field
                        ref="startTimeInputField"
                        v-model="startTimeInput"
                        label="開始時刻"
                        placeholder="23:30"
                        hint="24時間表記 HH:mm"
                        persistent-hint
                        clearable
                        :error="isInvalidStartTime"
                        v-on:keydown="onStartTimeKeydown"
                        v-on:paste.prevent="onStartTimePaste"
                    ></v-text-field>
                </div>
            </SearchOptionRow>
            <SearchOptionRow title="長さ※" :required="true">
                <v-text-field v-model.number="uploadState.programOption.duration" min="1" label="長さ(分)" type="number" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="番組名※" :required="true">
                <v-text-field v-model="uploadState.programOption.name" label="name" clearable></v-text-field>
            </SearchOptionRow>
            <SearchOptionRow title="概要">
                <v-textarea label="description" v-model="uploadState.programOption.description"></v-textarea>
            </SearchOptionRow>
            <SearchOptionRow title="詳細">
                <v-textarea label="extended" v-model="uploadState.programOption.extended"></v-textarea>
            </SearchOptionRow>
            <div v-for="video in uploadState.videoFileItems" v-bind:key="video.key">
                <SearchOptionRow :title="`ビデオファイル${video.key + 1}`">
                    <v-text-field v-model="video.viewName" label="name" clearable class="view-name"></v-text-field>
                    <v-select class="file-type" v-model="video.fileType" :items="uploadState.getFileTypeItems()" label="file type" :menu-props="{ auto: true }"></v-select>

                    <v-select
                        class="directory"
                        v-model="video.parentDirectoryName"
                        :items="uploadState.getPrentDirectoryItems()"
                        label="directory"
                        :menu-props="{ auto: true }"
                    ></v-select>
                    <v-text-field v-model="video.subDirectory" label="sub directory" clearable></v-text-field>
                    <v-file-input v-model="video.file" label="video file"></v-file-input>
                </SearchOptionRow>
            </div>
        </div>
        <v-divider></v-divider>
        <v-card-actions>
            <v-spacer></v-spacer>
            <v-btn v-on:click="reset" text color="error">リセット</v-btn>
            <v-btn v-on:click="upload" text color="primary">アップロード</v-btn>
        </v-card-actions>
    </v-card>
</template>

<script lang="ts">
import SearchOptionRow from '@/components/search/SearchOptionRow.vue';
import UserSelector from '@/components/user/UserSelector.vue';
import container from '@/model/ModelContainer';
import IRecordedUploadState from '@/model/state/recorded/upload/IRecordedUploadState';
import { Component, Vue, Watch } from 'vue-property-decorator';

@Component({
    components: {
        SearchOptionRow,
        UserSelector,
    },
})
export default class RecordedUploadForm extends Vue {
    public uploadState: IRecordedUploadState = container.get<IRecordedUploadState>('IRecordedUploadState');
    public ruleLoading: boolean = false;
    public ruleSearchInput: string | null = null;
    public channelFilter: string | null = null;
    public isStartDatePickerOpen: boolean = false;
    public startDateInput: string | null = null;
    public startDatePickerValue: string | null = null;
    public startTimeInput: string | null = null;

    private isSyncingStartAt: boolean = false;
    private isUpdatingStartAtFromInput: boolean = false;

    public get isInvalidStartTime(): boolean {
        if (typeof this.startTimeInput !== 'string' || this.startTimeInput.length === 0) {
            return false;
        }

        return this.parseTimeInput(this.startTimeInput) === null;
    }

    @Watch('ruleSearchInput', { immediate: true })
    public async onChangeSearch(newKeyword: string): Promise<void> {
        if (newKeyword === null || newKeyword === this.uploadState.ruleKeyword) {
            return;
        }

        this.uploadState.ruleKeyword = newKeyword;
        await this.uploadState.updateRuleItems();
    }

    @Watch('uploadState.programOption.startAt', { immediate: true })
    public onChangeStartAt(startAt: Date | null): void {
        if (this.isUpdatingStartAtFromInput === true) {
            return;
        }

        this.isSyncingStartAt = true;

        if (startAt === null) {
            this.startDateInput = null;
            this.startDatePickerValue = null;
            this.startTimeInput = null;
        } else {
            this.startDateInput = this.toDateTextValue(startAt);
            this.startDatePickerValue = this.toDateInputValue(startAt);
            this.startTimeInput = this.toTimeInputValue(startAt);
        }

        this.$nextTick(() => {
            this.isSyncingStartAt = false;
        });
    }

    @Watch('startDateInput')
    public onChangeStartDate(newValue: string | null, oldValue: string | null): void {
        const formattedDate = this.formatDateInput(newValue, oldValue);
        if (formattedDate !== newValue) {
            this.startDateInput = formattedDate;
            this.setStartDateCursorToEnd(formattedDate);

            return;
        }

        this.startDatePickerValue = this.normalizeDateInputToISO(this.startDateInput);
        this.updateStartAt();
    }

    @Watch('startTimeInput')
    public onChangeStartTime(newValue: string | null, oldValue: string | null): void {
        const formattedTime = this.formatTimeInput(newValue, oldValue);
        if (formattedTime !== newValue) {
            this.startTimeInput = formattedTime;
            this.setStartTimeCursorToEnd();

            return;
        }

        this.updateStartAt();
    }

    public reset(): void {
        this.$emit('reset');
    }

    public upload(): void {
        this.$emit('upload');
    }

    public onStartDatePickerInput(): void {
        if (typeof this.startDatePickerValue === 'string') {
            this.startDateInput = this.datePickerValueToText(this.startDatePickerValue);
        }

        this.isStartDatePickerOpen = false;
    }

    private updateStartAt(): void {
        if (this.isSyncingStartAt === true) {
            return;
        }

        if (typeof this.startDateInput !== 'string' || this.startDateInput.length === 0) {
            this.setProgramStartAt(null);

            return;
        }

        const date = this.parseDateInput(this.startDateInput);
        if (typeof this.startTimeInput !== 'string' || this.startTimeInput.length === 0) {
            this.setProgramStartAt(null);

            return;
        }

        const time = this.parseTimeInput(this.startTimeInput);
        if (date === null || time === null) {
            if (date === null) {
                this.setProgramStartAt(null);
            }

            return;
        }

        this.setProgramStartAt(new Date(date.year, date.month - 1, date.day, time.hour, time.minute));
    }

    private setProgramStartAt(startAt: Date | null): void {
        this.isUpdatingStartAtFromInput = true;
        this.uploadState.programOption.startAt = startAt;
        this.$nextTick(() => {
            this.isUpdatingStartAtFromInput = false;
        });
    }

    private parseDateInput(value: string): { year: number; month: number; day: number } | null {
        const match = value.normalize('NFKC').match(/^(\d{4})[/-]?(\d{2})[/-]?(\d{2})$/);
        if (match === null) {
            return null;
        }

        const year = parseInt(match[1], 10);
        const month = parseInt(match[2], 10);
        const day = parseInt(match[3], 10);
        const date = new Date(year, month - 1, day);

        if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            return null;
        }

        return { year, month, day };
    }

    private formatDateInput(newValue: string | null, oldValue: string | null): string | null {
        if (typeof newValue !== 'string' || newValue.length === 0) {
            return newValue;
        }

        if (typeof oldValue === 'string' && newValue.length < oldValue.length) {
            return newValue;
        }

        const digits = newValue.normalize('NFKC').replace(/\D/g, '').slice(0, 8);
        if (digits.length < 4) {
            return digits;
        }
        if (digits.length === 4) {
            return `${digits}/`;
        }
        if (digits.length < 6) {
            return `${digits.slice(0, 4)}/${digits.slice(4)}`;
        }
        if (digits.length === 6) {
            return `${digits.slice(0, 4)}/${digits.slice(4)}/`;
        }

        return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6)}`;
    }

    private normalizeDateInputToISO(value: string | null): string | null {
        if (typeof value !== 'string') {
            return null;
        }

        const date = this.parseDateInput(value);
        if (date === null) {
            return null;
        }

        return `${date.year.toString(10).padStart(4, '0')}-${date.month.toString(10).padStart(2, '0')}-${date.day.toString(10).padStart(2, '0')}`;
    }

    private datePickerValueToText(value: string): string {
        return value.replace(/-/g, '/');
    }

    private setStartDateCursorToEnd(value: string | null): void {
        if (typeof value !== 'string') {
            return;
        }

        this.$nextTick(() => {
            const field = this.$refs.startDateInputField as Vue | undefined;
            const input = field?.$el.querySelector('input') as HTMLInputElement | null | undefined;
            if (input === null || typeof input === 'undefined') {
                return;
            }

            input.setSelectionRange(value.length, value.length);
        });
    }

    private parseTimeInput(value: string): { hour: number; minute: number } | null {
        const match = value.match(/^([01]?\d|2[0-3]):([0-5]\d)$/);
        if (match === null) {
            return null;
        }

        return {
            hour: parseInt(match[1], 10),
            minute: parseInt(match[2], 10),
        };
    }

    private formatTimeInput(newValue: string | null, oldValue: string | null): string | null {
        if (typeof newValue !== 'string' || newValue.length === 0) {
            return newValue;
        }

        if (typeof oldValue === 'string' && newValue.length < oldValue.length) {
            return newValue;
        }

        const normalized = newValue.normalize('NFKC');
        const digits = normalized.replace(/\D/g, '');
        if (digits.length === 0) {
            return normalized;
        }

        if (digits.length <= 1) {
            return digits;
        }

        if (digits.length === 2 && normalized.indexOf(':') === -1) {
            return `${digits}:`;
        }

        return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
    }

    private onStartTimeKeydown(event: KeyboardEvent): void {
        if (event.ctrlKey === true || event.metaKey === true || event.altKey === true) {
            return;
        }

        const key = event.key.normalize('NFKC');
        if (/^\d$/.test(key) === false) {
            return;
        }

        event.preventDefault();
        this.insertStartTimeDigit(key, event.target as HTMLInputElement | null);
    }

    private onStartTimePaste(event: ClipboardEvent): void {
        const text = event.clipboardData?.getData('text') ?? '';
        const digits = text.normalize('NFKC').replace(/\D/g, '');
        if (digits.length === 0) {
            return;
        }

        this.insertStartTimeDigit(digits, event.target as HTMLInputElement | null);
    }

    private insertStartTimeDigit(digitText: string, input: HTMLInputElement | null): void {
        const currentValue = this.startTimeInput ?? '';
        const currentDigits = currentValue.normalize('NFKC').replace(/\D/g, '');
        const selectionStart = input?.selectionStart ?? currentValue.length;
        const selectionEnd = input?.selectionEnd ?? selectionStart;
        const digitStart = currentValue.slice(0, selectionStart).replace(/\D/g, '').length;
        const digitEnd = currentValue.slice(0, selectionEnd).replace(/\D/g, '').length;
        const nextDigits = (currentDigits.slice(0, digitStart) + digitText + currentDigits.slice(digitEnd)).slice(0, 4);
        const nextDigitPosition = Math.min(digitStart + digitText.length, nextDigits.length);
        this.startTimeInput = this.formatStartTimeDigits(nextDigits);
        this.setStartTimeCursor(this.getStartTimeCursorPosition(nextDigitPosition));
    }

    private formatStartTimeDigits(digits: string): string {
        if (digits.length <= 1) {
            return digits;
        }

        if (digits.length === 2) {
            return `${digits}:`;
        }

        return `${digits.slice(0, 2)}:${digits.slice(2, 4)}`;
    }

    private getStartTimeCursorPosition(digitPosition: number): number {
        if (digitPosition <= 1) {
            return digitPosition;
        }

        return digitPosition + 1;
    }

    private setStartTimeCursorToEnd(): void {
        if (typeof this.startTimeInput !== 'string') {
            return;
        }

        this.setStartTimeCursor(this.startTimeInput.length);
    }

    private setStartTimeCursor(position: number): void {
        this.$nextTick(() => {
            const field = this.$refs.startTimeInputField as Vue | undefined;
            const input = field?.$el.querySelector('input') as HTMLInputElement | null | undefined;
            if (typeof this.startTimeInput !== 'string' || input === null || typeof input === 'undefined') {
                return;
            }

            const nextPosition = Math.min(position, this.startTimeInput.length);
            input.setSelectionRange(nextPosition, nextPosition);
        });
    }

    private toDateInputValue(date: Date): string {
        const year = date.getFullYear().toString(10);
        const month = (date.getMonth() + 1).toString(10).padStart(2, '0');
        const day = date.getDate().toString(10).padStart(2, '0');

        return `${year}-${month}-${day}`;
    }

    private toDateTextValue(date: Date): string {
        return this.toDateInputValue(date).replace(/-/g, '/');
    }

    private toTimeInputValue(date: Date): string {
        const hour = date.getHours().toString(10).padStart(2, '0');
        const minute = date.getMinutes().toString(10).padStart(2, '0');

        return `${hour}:${minute}`;
    }
}
</script>

<style lang="sass" scoped>
.view-name, .file-type, .directory
    max-width: 150px

.start-at-fields
    display: grid
    grid-template-columns: 1fr 160px
    column-gap: 12px
    align-items: flex-start
</style>
