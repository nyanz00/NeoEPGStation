import type { AddManualEncodeProgramOption, EncodeId, RecordedItem } from '../../../../api';

export interface BulkEncodeJob {
    recordedId: number;
    recordedName: string;
    option: AddManualEncodeProgramOption;
}

export interface BulkEncodeFailure {
    job: BulkEncodeJob;
    error: string;
}

export interface BulkEncodeResult {
    succeeded: BulkEncodeJob[];
    failed: BulkEncodeFailure[];
}

export function getCommonEncodeSourceNames(items: RecordedItem[]): string[] {
    if (items.length === 0) return [];
    const names = [...new Set(items[0].videoFiles?.map(file => file.name).filter(name => name.length > 0) ?? [])];
    return names.filter(name => items.every(item => item.videoFiles?.some(file => file.name === name)));
}

export function createBulkEncodeJobs(items: RecordedItem[], sourceName: string, settings: Omit<AddManualEncodeProgramOption, 'recordedId' | 'sourceVideoFileId'>): BulkEncodeJob[] {
    if (items.length === 0 || !getCommonEncodeSourceNames(items).includes(sourceName)) throw new Error('選択した録画すべてに共通する元ファイルがありません。');
    if (items.some(item => item.isRecording)) throw new Error('録画中の番組はエンコードに追加できません。');
    if (settings.mode.length === 0 || (!settings.isSaveSameDirectory && !settings.parentDir)) throw new Error('プリセットと保存先を選択してください。');

    return [...new Map(items.map(item => [item.id, item])).values()].map(item => {
        const source = item.videoFiles!.find(file => file.name === sourceName)!;
        const option: AddManualEncodeProgramOption = {
            recordedId: item.id,
            sourceVideoFileId: source.id,
            mode: settings.mode,
            removeOriginal: settings.removeOriginal,
            updateThumbnail: settings.updateThumbnail,
            isSaveSameDirectory: settings.isSaveSameDirectory,
        };
        // Omitting parentDir lets the API resolve each source file's own directory.
        if (!settings.isSaveSameDirectory) {
            option.parentDir = settings.parentDir;
            if (settings.directory?.trim()) option.directory = settings.directory.trim();
        }
        return { recordedId: item.id, recordedName: item.name, option };
    });
}

export async function submitBulkEncodeJobs(
    jobs: BulkEncodeJob[],
    enqueue: (option: AddManualEncodeProgramOption) => Promise<EncodeId>,
    onProgress: (completed: number) => void,
    shouldContinue: () => boolean,
): Promise<BulkEncodeResult> {
    const result: BulkEncodeResult = { succeeded: [], failed: [] };
    for (const job of jobs) {
        if (!shouldContinue()) break;
        try {
            await enqueue(job.option);
            result.succeeded.push(job);
        } catch (error) {
            result.failed.push({ job, error: error instanceof Error ? error.message : String(error) });
        }
        if (shouldContinue()) onProgress(result.succeeded.length + result.failed.length);
    }
    return result;
}
