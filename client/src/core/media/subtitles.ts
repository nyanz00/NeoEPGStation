import type { VideoSubtitle } from '../../../../api';

// NicoJK tracks are normally marked in the Matroska stream title by ffprobe
// (for example, "NicoJK-1080T").  Keep the other explicit danmaku markers
// here as well so files produced by tools that use a localized/generic title
// are separated from ordinary ASS/SRT subtitles.
const DANMAKU_METADATA_PATTERN = /nico[\s_-]*jk|jikkyo|danmaku|comments?|実況|弾幕|流れる/i;

function subtitleMetadata(subtitle: VideoSubtitle): string[] {
    return [subtitle.displayName, subtitle.title, subtitle.language, subtitle.codecName].filter((value): value is string => typeof value === 'string' && value.length > 0);
}

export function isDanmakuSubtitle(subtitle: VideoSubtitle): boolean {
    return subtitleMetadata(subtitle).some(value => DANMAKU_METADATA_PATTERN.test(value));
}

export function subtitleMatchesKeyword(subtitle: VideoSubtitle, keyword: string): boolean {
    const normalized = keyword.trim().toLowerCase();
    return normalized.length > 0 && subtitleMetadata(subtitle).some(value => value.toLowerCase().includes(normalized));
}

export function preferredSubtitleIndex(subtitles: VideoSubtitle[], keywords: string[]): number | null {
    for (const keyword of keywords) {
        const subtitle = subtitles.find(item => subtitleMatchesKeyword(item, keyword));
        if (subtitle !== undefined) return subtitle.subtitleIndex;
    }
    return null;
}
