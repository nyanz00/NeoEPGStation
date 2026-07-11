<template>
    <div>
        <v-menu v-model="isOpen" bottom left :close-on-content-click="false">
            <template v-slot:activator="{ on }">
                <v-btn dark icon v-on="on">
                    <v-icon>mdi-magnify</v-icon>
                </v-btn>
            </template>
            <v-card width="520">
                <div class="recorded-search pa-4">
                    <v-text-field v-model="searchState.keyword" label="キーワード" clearable v-on:keydown.enter="onSearch()" ref="keyword"></v-text-field>
                    <v-autocomplete
                        v-model="searchState.ruleId"
                        :disabled="isNoRule === true"
                        :loading="loading"
                        :items="searchState.ruleItems"
                        :search-input.sync="search"
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
                    <v-select v-model="searchState.channelId" :items="searchState.channelItems" label="放送局" clearable :menu-props="{ auto: true }"></v-select>
                    <v-select v-model="searchState.genre" :items="searchState.genreItems" label="ジャンル" clearable :menu-props="{ auto: true }"></v-select>
                    <div class="recorded-search-row">
                        <v-select
                            v-model="searchState.encodeModes"
                            :items="searchState.encodeItems"
                            label="ファイルタイプ"
                            clearable
                            multiple
                            small-chips
                            deletable-chips
                            :menu-props="{ auto: true }"
                        ></v-select>
                        <v-btn-toggle v-model="searchState.encodeModeMatch" mandatory dense class="ml-2 mt-3">
                            <v-btn small value="include">含む</v-btn>
                            <v-btn small value="only">のみ</v-btn>
                        </v-btn-toggle>
                    </div>
                    <div class="check-boxes">
                        <div class="check-box-row">
                            <v-checkbox v-model="searchState.hasOriginalFile" label="元ファイルを含む" class="mt-2"></v-checkbox>
                            <v-checkbox v-model="isNoRule" label="手動録画のみ" class="mt-2"></v-checkbox>
                        </div>
                        <div class="check-box-row">
                            <v-checkbox v-model="searchState.hasDrop" label="drop" class="mt-2"></v-checkbox>
                            <v-checkbox v-model="searchState.hasError" label="error" class="mt-2"></v-checkbox>
                            <v-checkbox v-model="searchState.hasScrambling" label="scrambling" class="mt-2"></v-checkbox>
                        </div>
                    </div>
                    <v-divider class="my-3"></v-divider>
                    <div class="recorded-date-search">
                        <v-btn-toggle v-model="searchState.recordedDateSearchMode" mandatory dense>
                            <v-btn small value="range">期間</v-btn>
                            <v-btn small value="specific">日付指定</v-btn>
                        </v-btn-toggle>
                        <div v-if="searchState.recordedDateSearchMode === 'range'" class="recorded-date-range mt-2">
                            <v-menu v-model="isStartDatePickerOpen" :close-on-content-click="false" offset-y min-width="290px">
                                <template v-slot:activator>
                                    <v-text-field
                                        ref="recordedStartDateInputField"
                                        v-model="recordedStartDateInput"
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
                                    v-model="searchState.recordedStartDate"
                                    :dark="$vuetify.theme.dark"
                                    :first-day-of-week="1"
                                    locale="ja-jp"
                                    v-on:input="onRecordedStartDatePickerInput"
                                ></v-date-picker>
                            </v-menu>
                            <span class="date-separator">〜</span>
                            <v-menu v-model="isEndDatePickerOpen" :close-on-content-click="false" offset-y min-width="290px">
                                <template v-slot:activator>
                                    <v-text-field
                                        ref="recordedEndDateInputField"
                                        v-model="recordedEndDateInput"
                                        label="終了日"
                                        placeholder="2026/06/26"
                                        hint="yyyy/MM/dd"
                                        persistent-hint
                                        clearable
                                        append-icon="mdi-calendar"
                                        v-on:click:append="isEndDatePickerOpen = true"
                                    ></v-text-field>
                                </template>
                                <v-date-picker
                                    v-model="searchState.recordedEndDate"
                                    :dark="$vuetify.theme.dark"
                                    :first-day-of-week="1"
                                    locale="ja-jp"
                                    v-on:input="onRecordedEndDatePickerInput"
                                ></v-date-picker>
                            </v-menu>
                        </div>
                        <div v-else class="recorded-date-specific mt-2">
                            <v-text-field v-model.number="searchState.recordedYear" label="年" type="number" clearable suffix="年"></v-text-field>
                            <v-text-field v-model.number="searchState.recordedMonth" label="月" type="number" clearable suffix="月"></v-text-field>
                            <v-text-field v-model.number="searchState.recordedDay" label="日" type="number" clearable suffix="日"></v-text-field>
                        </div>
                    </div>
                </div>
                <v-divider></v-divider>
                <v-card-actions>
                    <v-spacer></v-spacer>
                    <v-btn v-on:click="onCancel" text color="error">閉じる</v-btn>
                    <v-btn v-on:click="onSearch" text color="primary">検索</v-btn>
                </v-card-actions>
            </v-card>
        </v-menu>
        <div v-if="isOpen === true" class="menu-background" v-on:click="onClickMenuBackground"></div>
    </div>
</template>

<script lang="ts">
import container from '@/model/ModelContainer';
import IRecordedSearchState from '@/model/state/recorded/search/IRecordedSearchState';
import ISnackbarState from '@/model/state/snackbar/ISnackbarState';
import Util from '@/util/Util';
import VuetifyUtil from '@/util/VuetifyUtil';
import { Component, Vue, Watch } from 'vue-property-decorator';
import * as apid from '../../../../api';

interface RecordedDateRange {
    startAt?: number;
    endAt?: number;
}

@Component({})
export default class RecordedSearchMenu extends Vue {
    public loading: boolean = false;
    public search: string | null = null;
    public isNoRule: boolean = false;
    public isStartDatePickerOpen: boolean = false;
    public isEndDatePickerOpen: boolean = false;
    public recordedStartDateInput: string | null = null;
    public recordedEndDateInput: string | null = null;

    @Watch('search', { immediate: true })
    public async onChangeSearch(newKeyword: string): Promise<void> {
        if (newKeyword === null || newKeyword === this.searchState.ruleKeyword) {
            return;
        }

        this.searchState.ruleKeyword = newKeyword;
        await this.searchState.updateRuleItems();
    }

    @Watch('recordedStartDateInput')
    public onChangeRecordedStartDateInput(newValue: string | null, oldValue: string | null): void {
        this.syncRecordedStartDateInput(newValue, oldValue);
    }

    @Watch('recordedEndDateInput')
    public onChangeRecordedEndDateInput(newValue: string | null, oldValue: string | null): void {
        this.syncRecordedEndDateInput(newValue, oldValue);
    }

    public isOpen: boolean = false;
    public searchState: IRecordedSearchState = container.get<IRecordedSearchState>('IRecordedSearchState');

    private snackbarState: ISnackbarState = container.get<ISnackbarState>('ISnackbarState');

    public onCancel(): void {
        this.isOpen = false;
    }

    public onSearch(): void {
        this.isOpen = false;

        this.$nextTick(async () => {
            await Util.sleep(300);

            const searchQuery: any = {};
            if (typeof this.searchState.keyword !== 'undefined') {
                searchQuery.keyword = this.searchState.keyword;
            }
            if (this.isNoRule === true) {
                this.searchState.ruleId = 0;
                searchQuery.ruleId = 0;
            } else if (typeof this.searchState.ruleId !== 'undefined' && this.searchState.ruleId !== null) {
                searchQuery.ruleId = this.searchState.ruleId;
            }
            if (typeof this.searchState.channelId !== 'undefined' && this.searchState.channelId !== null) {
                searchQuery.channelId = this.searchState.channelId;
            }
            if (typeof this.searchState.genre !== 'undefined' && this.searchState.genre !== null) {
                searchQuery.genre = this.searchState.genre;
            }
            if (this.searchState.hasOriginalFile === true) {
                searchQuery.hasOriginalFile = true;
            }
            if (this.searchState.encodeModes.length > 0) {
                searchQuery.encodeModes = this.searchState.encodeModes;
                searchQuery.encodeModeMatch = this.searchState.encodeModeMatch;
            }
            if (this.searchState.hasDrop === true) {
                searchQuery.hasDrop = true;
            }
            if (this.searchState.hasError === true) {
                searchQuery.hasError = true;
            }
            if (this.searchState.hasScrambling === true) {
                searchQuery.hasScrambling = true;
            }

            let recordedDateRange: RecordedDateRange | null = null;
            try {
                recordedDateRange = this.createRecordedDateRange();
            } catch (err) {
                this.snackbarState.open({
                    color: 'error',
                    text: '録画日の指定が不正です',
                });

                return;
            }

            if (recordedDateRange !== null) {
                searchQuery.recordedDateMode = this.searchState.recordedDateSearchMode;
                if (typeof recordedDateRange.startAt === 'number') {
                    searchQuery.recordedStartAt = recordedDateRange.startAt;
                }
                if (typeof recordedDateRange.endAt === 'number') {
                    searchQuery.recordedEndAt = recordedDateRange.endAt;
                }
                if (this.searchState.recordedDateSearchMode === 'specific') {
                    searchQuery.recordedYear = this.searchState.recordedYear;
                    if (typeof this.searchState.recordedMonth === 'number' && isNaN(this.searchState.recordedMonth) === false) {
                        searchQuery.recordedMonth = this.searchState.recordedMonth;
                    }
                    if (typeof this.searchState.recordedDay === 'number' && isNaN(this.searchState.recordedDay) === false) {
                        searchQuery.recordedDay = this.searchState.recordedDay;
                    }
                }
            }

            await Util.move(this.$router, {
                path: '/recorded',
                query: searchQuery,
            });
        });
    }

    public onClickMenuBackground(e: Event): boolean {
        e.stopPropagation();

        return false;
    }

    /**
     * ページ移動時
     */
    @Watch('$route', { immediate: true, deep: true })
    public onUrlChange(): void {
        this.isOpen = false;

        this.setRuleId();
        this.searchState.fetchData().catch(err => {
            console.error(err);
            this.snackbarState.open({
                color: 'error',
                text: '録画検索オプションの取得に失敗',
            });
        });
    }

    private setRuleId(): void {
        const ruleId = typeof this.$route.query.ruleId === 'undefined' ? null : parseInt(this.$route.query.ruleId as string, 10);
        this.searchState.ruleId = ruleId === null || isNaN(ruleId) === false ? ruleId : null;
        if (this.searchState.ruleId === 0) {
            this.isNoRule = true;
        }
    }

    @Watch('isOpen', { immediate: true })
    public onChangeState(newState: boolean, oldState: boolean): void {
        if (newState === true && oldState === false) {
            this.searchState.initValues();
            this.isNoRule = false;
            this.recordedStartDateInput = null;
            this.recordedEndDateInput = null;

            // query から値をセット
            this.setRuleId();
            if (typeof this.$route.query.keyword === 'string') {
                this.searchState.keyword = this.$route.query.keyword;
            }
            if (typeof this.$route.query.channelId !== 'undefined') {
                this.searchState.channelId = parseInt(this.$route.query.channelId as string, 10);
            }
            if (typeof this.$route.query.genre !== 'undefined') {
                this.searchState.genre = parseInt(this.$route.query.genre as string, 10);
            }
            if (typeof this.$route.query.hasOriginalFile !== 'undefined') {
                this.searchState.hasOriginalFile = (this.$route.query.hasOriginalFile as any) === true || this.$route.query.hasOriginalFile === 'true';
            }
            this.searchState.encodeModes = this.getStringArrayQuery('encodeModes');
            if (this.searchState.encodeModes.length === 0 && typeof this.$route.query.encodeMode === 'string') {
                this.searchState.encodeModes = [this.$route.query.encodeMode];
            }
            if (this.$route.query.encodeModeMatch === 'include' || this.$route.query.encodeModeMatch === 'only') {
                this.searchState.encodeModeMatch = this.$route.query.encodeModeMatch;
            }
            this.searchState.hasDrop = this.getBoolQuery('hasDrop');
            this.searchState.hasError = this.getBoolQuery('hasError');
            this.searchState.hasScrambling = this.getBoolQuery('hasScrambling');
            this.setRecordedDateFromQuery();

            // キーワードにフォーカスを当てる
            this.$nextTick(() => {
                if (typeof this.$refs.keyword !== 'undefined') {
                    VuetifyUtil.focusTextFiled(this.$refs.keyword as Vue);
                }
            });
        }
    }

    private createRecordedDateRange(): RecordedDateRange | null {
        if (this.searchState.recordedDateSearchMode === 'specific') {
            return this.createSpecificRecordedDateRange();
        }

        const result: RecordedDateRange = {};
        if (typeof this.recordedStartDateInput === 'string' && this.recordedStartDateInput.length > 0) {
            result.startAt = this.getLocalDateStart(this.recordedStartDateInput).getTime();
        }
        if (typeof this.recordedEndDateInput === 'string' && this.recordedEndDateInput.length > 0) {
            result.endAt = this.getNextLocalDateStart(this.recordedEndDateInput).getTime();
        }
        if (typeof result.startAt === 'number' && typeof result.endAt === 'number' && result.startAt >= result.endAt) {
            throw new Error('InvalidRecordedDateRange');
        }

        return typeof result.startAt === 'undefined' && typeof result.endAt === 'undefined' ? null : result;
    }

    private createSpecificRecordedDateRange(): RecordedDateRange | null {
        const year = this.searchState.recordedYear;
        const month = this.searchState.recordedMonth;
        const day = this.searchState.recordedDay;

        if (typeof year !== 'number' || isNaN(year) === true) {
            if (typeof month === 'number' || typeof day === 'number') {
                throw new Error('InvalidRecordedDate');
            }

            return null;
        }

        if (typeof month !== 'number' || isNaN(month) === true) {
            if (typeof day === 'number' && isNaN(day) === false) {
                throw new Error('InvalidRecordedDate');
            }

            return {
                startAt: new Date(year, 0, 1).getTime(),
                endAt: new Date(year + 1, 0, 1).getTime(),
            };
        }

        if (month < 1 || month > 12) {
            throw new Error('InvalidRecordedDate');
        }

        if (typeof day !== 'number' || isNaN(day) === true) {
            return {
                startAt: new Date(year, month - 1, 1).getTime(),
                endAt: new Date(year, month, 1).getTime(),
            };
        }

        const start = new Date(year, month - 1, day);
        if (day < 1 || start.getFullYear() !== year || start.getMonth() !== month - 1 || start.getDate() !== day) {
            throw new Error('InvalidRecordedDate');
        }

        return {
            startAt: start.getTime(),
            endAt: new Date(year, month - 1, day + 1).getTime(),
        };
    }

    private getLocalDateStart(dateStr: string): Date {
        const normalizedDate = this.parseDateInput(dateStr);
        if (normalizedDate === null) {
            throw new Error('InvalidRecordedDate');
        }

        const { year, month, day } = normalizedDate;
        const date = new Date(year, month - 1, day);
        if (isNaN(date.getTime()) === true || date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
            throw new Error('InvalidRecordedDate');
        }

        return date;
    }

    private getNextLocalDateStart(dateStr: string): Date {
        const start = this.getLocalDateStart(dateStr);

        return new Date(start.getFullYear(), start.getMonth(), start.getDate() + 1);
    }

    private setRecordedDateFromQuery(): void {
        this.searchState.recordedDateSearchMode = this.$route.query.recordedDateMode === 'specific' ? 'specific' : 'range';
        if (this.searchState.recordedDateSearchMode === 'specific') {
            this.searchState.recordedYear = this.getNumberQuery('recordedYear');
            this.searchState.recordedMonth = this.getNumberQuery('recordedMonth');
            this.searchState.recordedDay = this.getNumberQuery('recordedDay');

            return;
        }

        const startAt = this.getNumberQuery('recordedStartAt');
        const endAt = this.getNumberQuery('recordedEndAt');
        if (typeof startAt === 'number') {
            this.searchState.recordedStartDate = this.toDateInputValue(new Date(startAt));
            this.recordedStartDateInput = this.toDateTextValue(new Date(startAt));
        }
        if (typeof endAt === 'number') {
            this.searchState.recordedEndDate = this.toDateInputValue(new Date(endAt - 1));
            this.recordedEndDateInput = this.toDateTextValue(new Date(endAt - 1));
        }
    }

    private onRecordedStartDatePickerInput(): void {
        this.recordedStartDateInput = this.datePickerValueToText(this.searchState.recordedStartDate);
        this.isStartDatePickerOpen = false;
    }

    private onRecordedEndDatePickerInput(): void {
        this.recordedEndDateInput = this.datePickerValueToText(this.searchState.recordedEndDate);
        this.isEndDatePickerOpen = false;
    }

    private syncRecordedStartDateInput(newValue: string | null, oldValue: string | null): void {
        const formattedDate = this.formatDateInput(newValue, oldValue);
        if (formattedDate !== newValue) {
            this.recordedStartDateInput = formattedDate;
            this.setTextFieldCursorToEnd('recordedStartDateInputField', formattedDate);

            return;
        }

        this.searchState.recordedStartDate = this.normalizeDateInputToISO(this.recordedStartDateInput) ?? undefined;
    }

    private syncRecordedEndDateInput(newValue: string | null, oldValue: string | null): void {
        const formattedDate = this.formatDateInput(newValue, oldValue);
        if (formattedDate !== newValue) {
            this.recordedEndDateInput = formattedDate;
            this.setTextFieldCursorToEnd('recordedEndDateInputField', formattedDate);

            return;
        }

        this.searchState.recordedEndDate = this.normalizeDateInputToISO(this.recordedEndDateInput) ?? undefined;
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

    private datePickerValueToText(value: string | null | undefined): string | null {
        if (typeof value !== 'string' || value.length === 0) {
            return null;
        }

        const date = this.getLocalDateStart(value);

        return this.toDateTextValue(date);
    }

    private formatDateInput(newValue: string | null, oldValue: string | null): string | null {
        if (typeof newValue !== 'string' || newValue.length === 0) {
            return newValue;
        }

        if (typeof oldValue === 'string' && newValue.length < oldValue.length) {
            return newValue;
        }

        const digits = newValue.normalize('NFKC').replace(/\D/g, '').slice(0, 8);
        return this.formatDateDigits(digits);
    }

    private formatDateDigits(digits: string): string {
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
        const date = this.parseDateInput(value);
        if (date === null) {
            return null;
        }

        return `${date.year.toString(10).padStart(4, '0')}-${date.month.toString(10).padStart(2, '0')}-${date.day.toString(10).padStart(2, '0')}`;
    }

    private parseDateInput(value: string | null): { year: number; month: number; day: number } | null {
        if (typeof value !== 'string') {
            return null;
        }

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

    private setTextFieldCursorToEnd(refName: string, value: string | null): void {
        if (typeof value !== 'string') {
            return;
        }

        this.$nextTick(() => {
            const field = this.$refs[refName] as Vue | undefined;
            const input = field?.$el.querySelector('input') as HTMLInputElement | null | undefined;
            if (input === null || typeof input === 'undefined') {
                return;
            }

            input.setSelectionRange(value.length, value.length);
        });
    }

    private getNumberQuery(name: string): number | undefined {
        if (typeof this.$route.query[name] === 'undefined') {
            return undefined;
        }

        const value = parseInt(this.$route.query[name] as string, 10);

        return isNaN(value) === true ? undefined : value;
    }

    private getBoolQuery(name: string): boolean {
        return (this.$route.query[name] as any) === true || this.$route.query[name] === 'true';
    }

    private getStringArrayQuery(name: string): string[] {
        const value = this.$route.query[name];
        if (Array.isArray(value)) {
            return value.filter((item): item is string => typeof item === 'string' && item.length > 0);
        }
        if (typeof value === 'string' && value.length > 0) {
            return [value];
        }

        return [];
    }
}
</script>

<style lang="sass">
.recorded-search
    .v-input__control
        .v-input__slot
            margin: 0 !important
        .v-messages
            display: none

    .check-boxes
        .check-box-row
            display: flex
            flex-wrap: wrap

            .v-input--checkbox
                padding-right: 18px

        .check-box-row + .check-box-row
            margin-top: -8px

    .recorded-search-row
        display: flex
        align-items: flex-start

        .v-select
            flex: 1

    .recorded-date-range
        display: grid
        grid-template-columns: 1fr auto 1fr
        align-items: center
        column-gap: 8px

    .recorded-date-specific
        display: grid
        grid-template-columns: repeat(3, 1fr)
        column-gap: 8px

    .date-separator
        padding-top: 16px
</style>
