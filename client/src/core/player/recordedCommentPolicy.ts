import type { VideoFileType } from '../../../../api';
import type { AppSettings } from '../storage/settings';

export function getRecordedCommentPolicy(
    videoType: VideoFileType | undefined,
    streaming: boolean,
    settings: Pick<AppSettings, 'watchPlaySubtitleDanmaku' | 'watchStreamingSubtitleDanmaku'>,
): { usesJikkyo: boolean; usesClientSubtitles: boolean; subtitleDanmaku: boolean } {
    const subtitleDanmaku = streaming ? settings.watchStreamingSubtitleDanmaku : settings.watchPlaySubtitleDanmaku;
    const usesClientSubtitles = videoType === 'encoded' && (!streaming || subtitleDanmaku);
    return {
        usesJikkyo: videoType === 'ts',
        usesClientSubtitles,
        subtitleDanmaku: usesClientSubtitles && subtitleDanmaku,
    };
}
