import type { AnnictRecordedEpisodeInfo, RecordedId } from '../../../../api';
import { withBasePath } from '../path';
import { activeUserStore } from '../storage/activeUser';
import { viewerProfileStore } from '../storage/viewerProfile';
import { settingsStore } from '../storage/settings';

/**
 * Uses fetch keepalive so PLAY via URL scheme and download navigation do not cancel the Annict write.
 */
export async function markRecordedAnnictEpisodeWatchedKeepalive(recordedId: RecordedId): Promise<AnnictRecordedEpisodeInfo> {
    const activeUser = activeUserStore.getSnapshot();
    const settings = settingsStore.getSnapshot();
    const response = await fetch(withBasePath(`/api/recorded/${recordedId}/annictEpisode`), {
        method: 'PUT',
        headers: {
            Accept: 'application/json',
            'Content-Type': 'application/json',
            'X-EPGStation-User-Id': typeof activeUser === 'number' ? String(activeUser) : 'master',
            ...viewerProfileStore.headers(),
        },
        body: JSON.stringify({
            markWorkWatchedOnFinalEpisode: settings.annictMarkWatchedOnFinalEpisode,
            disableRulesOnFinalEpisode: settings.annictMarkWatchedOnFinalEpisode && settings.annictDisableRulesOnFinalEpisode,
        }),
        keepalive: true,
    });
    const value = (await response.json().catch(() => ({}))) as AnnictRecordedEpisodeInfo & {
        message?: string;
    };
    if (!response.ok) throw new Error(value.message ?? `HTTP ${response.status}`);
    return value;
}
