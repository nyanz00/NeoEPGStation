import * as apid from '../../../../../../api';

export type RecordedDateSearchMode = 'range' | 'specific';

export interface SelectorItem<T = number> {
    text: string;
    value: T;
}

export default interface IRecordedSearchState {
    keyword: string | undefined;
    hasOriginalFile: boolean;
    ruleId: apid.RuleId | null | undefined;
    channelId: apid.ChannelId | undefined;
    genre: apid.ProgramGenreLv1 | undefined;
    encodeModes: string[];
    encodeModeMatch: apid.RecordedEncodeModeMatch;
    hasDrop: boolean;
    hasError: boolean;
    hasScrambling: boolean;
    recordedDateSearchMode: RecordedDateSearchMode;
    recordedStartDate: string | undefined;
    recordedEndDate: string | undefined;
    recordedYear: number | undefined;
    recordedMonth: number | undefined;
    recordedDay: number | undefined;
    ruleKeyword: string | null;
    ruleItems: apid.RuleKeywordItem[];
    channelItems: SelectorItem[];
    genreItems: SelectorItem[];
    encodeItems: SelectorItem<string>[];
    fetchData(): Promise<void>;
    initValues(): void;
    updateRuleItems(): Promise<void>;
}
