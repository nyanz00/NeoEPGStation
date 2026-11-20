export async function cancelEncodeBatch(ids: number[], cancel: (id: number) => Promise<void>, onProgress: (completed: number) => void) {
    const succeeded: number[] = [];
    const failed: { id: number; result: PromiseRejectedResult }[] = [];
    for (const id of ids) {
        try {
            await cancel(id);
            succeeded.push(id);
        } catch (reason) {
            failed.push({ id, result: { status: 'rejected', reason } });
        }
        onProgress(succeeded.length + failed.length);
    }
    return { succeeded, failed };
}
