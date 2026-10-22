import { recordedUseClient } from './RecordedUseClient';
import { recordedUseRegistry, RecordedUseResource } from './RecordedUseRegistry';

/** Shared adapter for readers that run in either the operator or service process. */
export async function acquireRecordedFileUse(resource: RecordedUseResource): Promise<{ release(): Promise<void> }> {
    if (typeof process.send === 'function') return recordedUseClient.acquire(resource);
    const peer = 'operator:reader';
    const lease = recordedUseRegistry.acquire(peer, resource);
    return { release: async () => recordedUseRegistry.release(peer, lease) };
}
