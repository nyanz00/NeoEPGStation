import type { VideoSubtitle } from '../../../../api';

export function preferredSubtitleIndex(subtitles: VideoSubtitle[], keywords: string[]): number | null {
    for (const keyword of keywords) {
        const normalized = keyword.trim().toLowerCase();
        if (normalized.length === 0) continue;
        const subtitle = subtitles.find(item =>
            [item.displayName, item.title, item.language, item.codecName].some(value => typeof value === 'string' && value.toLowerCase().includes(normalized)),
        );
        if (subtitle !== undefined) return subtitle.subtitleIndex;
    }
    return null;
}
