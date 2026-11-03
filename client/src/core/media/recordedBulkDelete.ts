import type { RecordedItem } from '../../../../api';

export type RecordedBulkDeleteOption = 'all' | 'original' | 'encoded' | 'names';

export interface RecordedBulkDeleteTarget {
    item: RecordedItem;
    deleteRecording: boolean;
    videoFileIds: number[];
}

export function getRecordedDeleteFileNames(items: RecordedItem[]): { name: string; count: number }[] {
    const counts = new Map<string, number>();
    for (const item of items) {
        for (const file of item.videoFiles ?? []) counts.set(file.name, (counts.get(file.name) ?? 0) + 1);
    }
    return [...counts].map(([name, count]) => ({ name, count }));
}

export function createRecordedBulkDeleteTargets(items: RecordedItem[], option: RecordedBulkDeleteOption, names: string[]): RecordedBulkDeleteTarget[] {
    const selectedNames = new Set(names);
    if (option === 'names' && selectedNames.size === 0) return [];
    return items
        .map(item => ({
            item,
            deleteRecording: option === 'all',
            videoFileIds: (item.videoFiles ?? [])
                .filter(file => option === 'all' || (option === 'names' ? selectedNames.has(file.name) : file.type === (option === 'original' ? 'ts' : 'encoded')))
                .map(file => file.id),
        }))
        .filter(target => target.deleteRecording || target.videoFileIds.length > 0);
}

export async function deleteRecordedBulkTargets(
    targets: RecordedBulkDeleteTarget[],
    deleteRecording: (id: number) => Promise<void>,
    deleteVideo: (id: number) => Promise<void>,
): Promise<{ succeeded: number[]; failed: { item: RecordedItem; error: string }[] }> {
    const results = await Promise.allSettled(
        targets.map(async target => {
            if (target.deleteRecording) return deleteRecording(target.item.id);
            const errors: string[] = [];
            for (const id of target.videoFileIds) {
                try {
                    await deleteVideo(id);
                } catch (error) {
                    errors.push(error instanceof Error ? error.message : String(error));
                }
            }
            if (errors.length > 0) throw new Error(errors.join(' / '));
        }),
    );
    return {
        succeeded: targets.filter((_target, index) => results[index].status === 'fulfilled').map(target => target.item.id),
        failed: targets.flatMap((target, index) => {
            const result = results[index];
            return result.status === 'rejected' ? [{ item: target.item, error: result.reason instanceof Error ? result.reason.message : String(result.reason) }] : [];
        }),
    };
}
