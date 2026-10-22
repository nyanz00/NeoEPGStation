import { randomUUID } from 'crypto';
import type { RecordedUseResource } from './RecordedUseRegistry';

type RecordedUseOperation = 'acquire' | 'release';

interface RecordedUseRequest {
    type: 'recorded-use';
    id: string;
    op: RecordedUseOperation;
    resource?: RecordedUseResource;
    leaseRequestId?: string;
}

interface RecordedUseReply {
    type: 'recorded-use-result';
    id: string;
    result?: unknown;
    error?: string;
}

type RecordedUseTransport = (request: RecordedUseRequest) => Promise<unknown>;

interface LocalLease {
    readonly requestId: string;
    readonly resource: RecordedUseResource;
    readonly stop?: () => Promise<void>;
    releasePromise: Promise<void> | null;
}

interface PendingReply {
    readonly resolve: (reply: RecordedUseReply) => void;
    readonly reject: (error: Error) => void;
    readonly timer: NodeJS.Timeout;
}

const IPC_TIMEOUT_MS = 5_000;

/** Service-process client for parent-owned recorded-resource leases. */
export class RecordedUseClient {
    private readonly transport: RecordedUseTransport;
    private readonly uses = new Map<string, LocalLease>();
    private readonly pendingReplies = new Map<string, PendingReply>();
    private ipcListenersBound = false;

    public constructor(transport?: RecordedUseTransport) {
        this.transport = transport ?? (request => this.sendIpcRequest(request));
    }

    public async acquire(
        resource: RecordedUseResource,
        stop?: () => Promise<void>,
    ): Promise<{ release(): Promise<void> }> {
        const requestId = randomUUID();
        const lease: LocalLease = { requestId, resource: { ...resource }, stop, releasePromise: null };
        try {
            await this.transport({ type: 'recorded-use', id: requestId, op: 'acquire', resource: lease.resource });
        } catch (error) {
            // If the request reached the parent but its reply was lost or timed out,
            // releasing by the original request id cleans up any acquired lease.
            await this.releaseRequest(requestId).catch(() => {});
            throw error;
        }

        this.uses.set(requestId, lease);
        return { release: () => this.releaseLease(lease) };
    }

    public async stopUses(recordedId: number, videoFileId?: number): Promise<void> {
        const targets = [...this.uses.values()].filter(lease => this.overlaps(lease.resource, recordedId, videoFileId));
        if (targets.length === 0) return;

        const results = await Promise.allSettled(
            targets.map(async lease => {
                if (lease.stop === undefined) throw new Error('RecordedResourceBusy');
                await lease.stop();
                await this.releaseLease(lease);
            }),
        );
        const failed = results.find(result => result.status === 'rejected');
        if (failed?.status === 'rejected') throw failed.reason;
    }

    private overlaps(resource: RecordedUseResource, recordedId: number, videoFileId?: number): boolean {
        if (resource.recordedId !== recordedId) return false;
        return (
            typeof videoFileId === 'undefined' ||
            typeof resource.videoFileId === 'undefined' ||
            resource.videoFileId === videoFileId
        );
    }

    private releaseLease(lease: LocalLease): Promise<void> {
        if (lease.releasePromise !== null) return lease.releasePromise;
        if (!this.uses.has(lease.requestId)) return Promise.resolve();

        const releasePromise = this.releaseRequest(lease.requestId)
            .then(() => {
                this.uses.delete(lease.requestId);
            })
            .finally(() => {
                if (lease.releasePromise === releasePromise) lease.releasePromise = null;
            });
        lease.releasePromise = releasePromise;
        return releasePromise;
    }

    private releaseRequest(leaseRequestId: string): Promise<void> {
        return this.transport({
            type: 'recorded-use',
            id: randomUUID(),
            op: 'release',
            leaseRequestId,
        }).then(() => {});
    }

    private sendIpcRequest(request: RecordedUseRequest): Promise<unknown> {
        if (typeof process.send !== 'function') return Promise.reject(new Error('RecordedUseIPCUnavailable'));
        this.bindIpcListeners();

        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.settlePending(request.id, new Error('RecordedUseIPCTimeout'));
            }, IPC_TIMEOUT_MS);
            this.pendingReplies.set(request.id, {
                resolve: reply => {
                    if (typeof reply.error !== 'undefined') reject(new Error(reply.error));
                    else resolve(reply.result);
                },
                reject,
                timer,
            });

            try {
                process.send!(request, error => {
                    if (error !== null && typeof error !== 'undefined') this.settlePending(request.id, error);
                });
            } catch (error) {
                this.settlePending(request.id, error instanceof Error ? error : new Error(String(error)));
            }
        });
    }

    private bindIpcListeners(): void {
        if (this.ipcListenersBound) return;
        this.ipcListenersBound = true;
        process.on('message', this.onIpcMessage);
        process.on('disconnect', this.onIpcDisconnect);
    }

    private readonly onIpcMessage = (message: unknown): void => {
        if (typeof message !== 'object' || message === null) return;
        const reply = message as Partial<RecordedUseReply>;
        if (reply.type !== 'recorded-use-result' || typeof reply.id !== 'string') return;
        const pending = this.pendingReplies.get(reply.id);
        if (pending === undefined) return;
        clearTimeout(pending.timer);
        this.pendingReplies.delete(reply.id);
        pending.resolve(reply as RecordedUseReply);
    };

    private readonly onIpcDisconnect = (): void => {
        for (const [id] of this.pendingReplies) this.settlePending(id, new Error('RecordedUseIPCDisconnected'));
    };

    private settlePending(id: string, error: Error): void {
        const pending = this.pendingReplies.get(id);
        if (pending === undefined) return;
        clearTimeout(pending.timer);
        this.pendingReplies.delete(id);
        pending.reject(error);
    }
}

export const recordedUseClient = new RecordedUseClient();
