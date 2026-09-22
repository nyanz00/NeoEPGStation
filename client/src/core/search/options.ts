import type { ChannelId, ChannelType, Genre, RuleSearchOption } from '../../../../api';

const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;

export interface KeywordFields {
    caseSensitive: boolean;
    regexp: boolean;
    name: boolean;
    description: boolean;
    extended: boolean;
}

export interface SearchFormState {
    keyword: string;
    keywordFields: KeywordFields;
    ignoreKeyword: string;
    ignoreFields: KeywordFields;
    channelIds: ChannelId[];
    channelTypes: ChannelType[];
    genres: number[];
    subGenres: string[];
    startHour: number | '';
    rangeHour: number | '';
    week: number;
    durationMin: string;
    durationMax: string;
    startDate: string;
    startTime: string;
    endDate: string;
    endTime: string;
    isFree: boolean;
}

export const allKeywordFields: KeywordFields = { caseSensitive: false, regexp: false, name: true, description: true, extended: false };
export const animeKeywordFields: KeywordFields = { caseSensitive: false, regexp: false, name: true, description: false, extended: false };

export const openSearchPeriodStartAt = 0;
export const openSearchPeriodEndAt = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

export function createDefaultSearchForm(): SearchFormState {
    return {
        keyword: '',
        keywordFields: { ...allKeywordFields },
        ignoreKeyword: '',
        ignoreFields: { ...allKeywordFields },
        channelIds: [],
        channelTypes: [],
        genres: [],
        subGenres: [],
        startHour: '',
        rangeHour: '',
        week: 0x7f,
        durationMin: '',
        durationMax: '',
        startDate: '',
        startTime: '00:00',
        endDate: '',
        endTime: '23:59',
        isFree: false,
    };
}

export function subGenreKey(genre: number, subGenre: number): string {
    return `${genre}:${subGenre}`;
}

function hasKeywordTarget(fields: KeywordFields): boolean {
    return fields.name || fields.description || fields.extended;
}

export function normalizeSearchForm(form: SearchFormState): SearchFormState {
    const keywordFields = form.keyword.trim().length > 0 && !hasKeywordTarget(form.keywordFields) ? { ...form.keywordFields, name: true, description: true } : form.keywordFields;
    const ignoreFields = form.ignoreKeyword.trim().length > 0 && !hasKeywordTarget(form.ignoreFields) ? { ...form.ignoreFields, name: true, description: true } : form.ignoreFields;
    return keywordFields === form.keywordFields && ignoreFields === form.ignoreFields ? form : { ...form, keywordFields, ignoreFields };
}

function dateTimeParts(value: number): { date: string; time: string } {
    const date = new Date(value + JST_OFFSET_MS);
    const year = date.getUTCFullYear().toString(10).padStart(4, '0');
    const month = (date.getUTCMonth() + 1).toString(10).padStart(2, '0');
    const day = date.getUTCDate().toString(10).padStart(2, '0');
    const hour = date.getUTCHours().toString(10).padStart(2, '0');
    const minute = date.getUTCMinutes().toString(10).padStart(2, '0');
    return { date: `${year}-${month}-${day}`, time: `${hour}:${minute}` };
}

export function jstDateTimeToEpoch(dateValue: string, timeValue: string): number | undefined {
    const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue);
    const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue);
    if (dateMatch === null || timeMatch === null) return undefined;
    const year = Number(dateMatch[1]);
    const month = Number(dateMatch[2]);
    const day = Number(dateMatch[3]);
    const hour = Number(timeMatch[1]);
    const minute = Number(timeMatch[2]);
    if (year < 1 || month < 1 || month > 12 || hour > 23 || minute > 59) return undefined;

    const shifted = new Date(0);
    shifted.setUTCFullYear(year, month - 1, day);
    shifted.setUTCHours(hour, minute, 0, 0);
    if (
        shifted.getUTCFullYear() !== year ||
        shifted.getUTCMonth() !== month - 1 ||
        shifted.getUTCDate() !== day ||
        shifted.getUTCHours() !== hour ||
        shifted.getUTCMinutes() !== minute
    ) {
        return undefined;
    }
    return shifted.getTime() - JST_OFFSET_MS;
}

export function searchPeriodError(form: SearchFormState): string | null {
    const startAt = form.startDate.length === 0 ? undefined : jstDateTimeToEpoch(form.startDate, form.startTime);
    const endAt = form.endDate.length === 0 ? undefined : jstDateTimeToEpoch(form.endDate, form.endTime);
    if (form.startDate.length > 0 && startAt === undefined) return '開始日時を正しく入力してください';
    if (form.endDate.length > 0 && endAt === undefined) return '終了日時を正しく入力してください';
    if (startAt !== undefined && endAt !== undefined && startAt > endAt) return '開始日時は終了日時以前にしてください';
    return null;
}

export function toSearchOption(source: SearchFormState): RuleSearchOption {
    const form = normalizeSearchForm(source);
    const option: RuleSearchOption = {};
    if (form.keyword.trim().length > 0) {
        option.keyword = form.keyword.trim();
        option.keyCS = form.keywordFields.caseSensitive;
        option.keyRegExp = form.keywordFields.regexp;
        option.name = form.keywordFields.name;
        option.description = form.keywordFields.description;
        option.extended = form.keywordFields.extended;
    }
    if (form.ignoreKeyword.trim().length > 0) {
        option.ignoreKeyword = form.ignoreKeyword.trim();
        option.ignoreKeyCS = form.ignoreFields.caseSensitive;
        option.ignoreKeyRegExp = form.ignoreFields.regexp;
        option.ignoreName = form.ignoreFields.name;
        option.ignoreDescription = form.ignoreFields.description;
        option.ignoreExtended = form.ignoreFields.extended;
    }
    if (form.channelIds.length > 0) option.channelIds = [...form.channelIds];
    else if (form.channelTypes.length > 0) option.channelTypes = [...form.channelTypes];
    if (form.genres.length > 0) {
        option.genres = form.genres.flatMap(genre => {
            const subGenres = form.subGenres
                .filter(value => value.startsWith(`${genre}:`))
                .map(value => Number(value.slice(value.indexOf(':') + 1)))
                .filter(value => Number.isInteger(value));
            return subGenres.length === 0 ? [{ genre } satisfies Genre] : subGenres.map(subGenre => ({ genre, subGenre }) satisfies Genre);
        });
    }
    option.times = [{ week: form.week === 0 ? 0x7f : form.week }];
    if (form.startHour !== '' && form.rangeHour !== '') {
        option.times[0].start = form.startHour;
        option.times[0].range = form.rangeHour;
    }
    if (form.durationMin.length > 0) option.durationMin = Number(form.durationMin) * 60;
    if (form.durationMax.length > 0) option.durationMax = Number(form.durationMax) * 60;
    const startAt = form.startDate.length === 0 ? undefined : jstDateTimeToEpoch(form.startDate, form.startTime);
    const endAt = form.endDate.length === 0 ? undefined : jstDateTimeToEpoch(form.endDate, form.endTime);
    if (startAt !== undefined || endAt !== undefined) {
        option.searchPeriods = [{ startAt: startAt ?? openSearchPeriodStartAt, endAt: endAt ?? openSearchPeriodEndAt }];
    }
    if (form.isFree) option.isFree = true;
    return option;
}

export function fromSearchOption(option: RuleSearchOption): SearchFormState {
    const legacyTypes = (['GR', 'BS', 'CS', 'SKY'] as const).filter(type => option[type] === true);
    const time = option.times?.[0];
    const genres = [...new Set(option.genres?.map(item => item.genre) ?? [])];
    const wholeGenres = new Set((option.genres ?? []).filter(item => item.subGenre === undefined).map(item => item.genre));
    const startPeriod = option.searchPeriods?.[0]?.startAt;
    const endPeriod = option.searchPeriods?.[0]?.endAt;
    const start = startPeriod === undefined || startPeriod === openSearchPeriodStartAt ? undefined : dateTimeParts(startPeriod);
    const end = endPeriod === undefined || endPeriod === openSearchPeriodEndAt ? undefined : dateTimeParts(endPeriod);
    return {
        ...createDefaultSearchForm(),
        keyword: option.keyword ?? '',
        keywordFields: {
            caseSensitive: option.keyCS === true,
            regexp: option.keyRegExp === true,
            name: option.name !== false,
            description: option.description !== false,
            extended: option.extended === true,
        },
        ignoreKeyword: option.ignoreKeyword ?? '',
        ignoreFields: {
            caseSensitive: option.ignoreKeyCS === true,
            regexp: option.ignoreKeyRegExp === true,
            name: option.ignoreName !== false,
            description: option.ignoreDescription !== false,
            extended: option.ignoreExtended === true,
        },
        channelIds: [...(option.channelIds ?? [])],
        channelTypes: [...(option.channelTypes ?? legacyTypes)],
        genres,
        subGenres: [
            ...new Set(
                (option.genres ?? []).filter(item => item.subGenre !== undefined && !wholeGenres.has(item.genre)).map(item => subGenreKey(item.genre, item.subGenre as number)),
            ),
        ],
        startHour: time?.start ?? '',
        rangeHour: time?.range ?? '',
        week: time?.week ?? 0x7f,
        durationMin: option.durationMin === undefined ? '' : (option.durationMin / 60).toString(10),
        durationMax: option.durationMax === undefined ? '' : (option.durationMax / 60).toString(10),
        startDate: start?.date ?? '',
        startTime: start?.time ?? '00:00',
        endDate: end?.date ?? '',
        endTime: end?.time ?? '23:59',
        isFree: option.isFree === true,
    };
}
