export interface GuideSizeValue {
    channelHeight: number;
    channelWidth: number;
    channelFontsize: number;
    timescaleHeight: number;
    timescaleWidth: number;
    timescaleFontsize: number;
    programFontSize: number;
}

export interface GuideSizeSettings {
    tablet: GuideSizeValue;
    mobile: GuideSizeValue;
}

export type GuideGenreSettings = Record<number, boolean>;

export interface GuideProgramDialogSettings {
    encode: string;
    isDeleteOriginalAfterEncode: boolean;
    updateThumbnail: boolean;
}

export interface GuideColorSettings {
    light: string[];
    dark: string[];
}

export const guideColorLabels = [
    'ニュース・報道',
    'スポーツ',
    '情報・ワイドショー',
    'ドラマ',
    '音楽',
    'バラエティ',
    '映画',
    'アニメ・特撮',
    'ドキュメンタリー・教養',
    '劇場・公演',
    '趣味・教育',
    '福祉',
    '予備1',
    '予備2',
    '拡張',
    'その他',
    'ジャンル情報なし',
] as const;

export const defaultGuideColorSettings: GuideColorSettings = {
    light: [
        '#abe6f6',
        '#f3f8c3',
        '#afd3f6',
        '#f8c6cb',
        '#d9efa8',
        '#ebccf0',
        '#fbe0b9',
        '#fcd1df',
        '#aeb9f9',
        '#eaffd1',
        '#b7e3b8',
        '#c3f0ec',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#ffffff',
        '#ffffff',
    ],
    dark: [
        '#40b6bd',
        '#97a039',
        '#59b1c7',
        '#d88686',
        '#7fa534',
        '#cf56a1',
        '#d85b2a',
        '#eb8242',
        '#515585',
        '#83a993',
        '#2c7873',
        '#46b3e6',
        '#445165',
        '#445165',
        '#445165',
        '#445165',
        '#445165',
    ],
};

export const minimumGuideChannelHeight = {
    tablet: 54,
    mobile: 50,
} as const;

export const defaultGuideSizeSettings: GuideSizeSettings = {
    tablet: {
        channelHeight: 54,
        channelWidth: 140,
        channelFontsize: 14,
        timescaleHeight: 180,
        timescaleWidth: 30,
        timescaleFontsize: 16,
        programFontSize: 10,
    },
    mobile: {
        channelHeight: 50,
        channelWidth: 100,
        channelFontsize: 12,
        timescaleHeight: 120,
        timescaleWidth: 20,
        timescaleFontsize: 12,
        programFontSize: 7.5,
    },
};

export const defaultGuideGenreSettings: GuideGenreSettings = Object.fromEntries(Array.from({ length: 16 }, (_, index) => [index, true]));

export const defaultGuideProgramDialogSettings: GuideProgramDialogSettings = {
    encode: 'TS',
    isDeleteOriginalAfterEncode: false,
    updateThumbnail: false,
};

export function cloneGuideColorSettings(value: GuideColorSettings): GuideColorSettings {
    return { light: [...value.light], dark: [...value.dark] };
}

function cloneSizeSettings(value: GuideSizeSettings): GuideSizeSettings {
    return { tablet: { ...value.tablet }, mobile: { ...value.mobile } };
}

export function loadGuideSizeSettings(): GuideSizeSettings {
    try {
        const saved = localStorage.getItem('GuideSizeSetting');
        if (saved === null) return cloneSizeSettings(defaultGuideSizeSettings);
        const parsed = JSON.parse(saved) as Partial<GuideSizeSettings>;
        return {
            tablet: { ...defaultGuideSizeSettings.tablet, ...parsed.tablet },
            mobile: { ...defaultGuideSizeSettings.mobile, ...parsed.mobile },
        };
    } catch {
        return cloneSizeSettings(defaultGuideSizeSettings);
    }
}

export function saveGuideSizeSettings(value: GuideSizeSettings): void {
    localStorage.setItem('GuideSizeSetting', JSON.stringify(value));
}

export function getEffectiveGuideSizeValue(value: GuideSizeSettings, target: keyof GuideSizeSettings): GuideSizeValue {
    return {
        ...value[target],
        channelHeight: Math.max(value[target].channelHeight, minimumGuideChannelHeight[target]),
    };
}

export function loadGuideGenreSettings(): GuideGenreSettings {
    try {
        const saved = localStorage.getItem('GuideGenreSetting');
        return saved === null ? { ...defaultGuideGenreSettings } : { ...defaultGuideGenreSettings, ...(JSON.parse(saved) as GuideGenreSettings) };
    } catch {
        return { ...defaultGuideGenreSettings };
    }
}

export function saveGuideGenreSettings(value: GuideGenreSettings): void {
    localStorage.setItem('GuideGenreSetting', JSON.stringify(value));
}

export function loadGuideColorSettings(): GuideColorSettings {
    try {
        const saved = localStorage.getItem('GuideColorSetting');
        if (saved === null) return cloneGuideColorSettings(defaultGuideColorSettings);
        const parsed = JSON.parse(saved) as Partial<GuideColorSettings>;
        const loadPalette = (value: unknown, defaults: string[]): string[] => {
            const colors = Array.isArray(value) ? value : [];
            return defaults.map((fallback, index) => {
                const color = colors[index];
                return typeof color === 'string' && /^#[0-9a-f]{6}$/i.test(color) ? color.toLowerCase() : fallback;
            });
        };
        return {
            light: loadPalette(parsed.light, defaultGuideColorSettings.light),
            dark: loadPalette(parsed.dark, defaultGuideColorSettings.dark),
        };
    } catch {
        return cloneGuideColorSettings(defaultGuideColorSettings);
    }
}

export function saveGuideColorSettings(value: GuideColorSettings): void {
    localStorage.setItem('GuideColorSetting', JSON.stringify(value));
}

export function loadGuideProgramDialogSettings(): GuideProgramDialogSettings {
    try {
        const saved = localStorage.getItem('GuideProgramDetailSetting');
        if (saved === null) return { ...defaultGuideProgramDialogSettings };
        const parsed = JSON.parse(saved) as Partial<GuideProgramDialogSettings>;
        return {
            encode: typeof parsed.encode === 'string' && parsed.encode.length > 0 ? parsed.encode : 'TS',
            isDeleteOriginalAfterEncode: parsed.isDeleteOriginalAfterEncode === true,
            updateThumbnail: parsed.updateThumbnail === true,
        };
    } catch {
        return { ...defaultGuideProgramDialogSettings };
    }
}

export function saveGuideProgramDialogSettings(value: GuideProgramDialogSettings): void {
    localStorage.setItem('GuideProgramDetailSetting', JSON.stringify(value));
}
