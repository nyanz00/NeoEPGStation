export interface RecordedUseResource {
    recordedId: number;
    videoFileId?: number;
    purpose: string;
    durableKey?: string;
}

interface RecordedUseLease {
    readonly id: string;
    peer: string;
    readonly recordedId: number;
    readonly videoFileId?: number;
    readonly purpose: string;
    readonly durableKey?: string;
    unknown: boolean;
}

interface DeletionReservation {
    readonly token: string;
    readonly recordedId: number;
    readonly videoFileId?: number;
}

/** In-memory ownership registry for recorded files shared across runtime processes. */
export default class RecordedUseRegistry {
    private readonly leases = new Map<string, RecordedUseLease>();
    private readonly deletions = new Map<string, DeletionReservation>();
    private nextId: number = 1;

    public acquire(peer: string, resource: RecordedUseResource): string {
        this.validatePeer(peer);
        this.validateResource(resource);

        if (this.hasDeletionConflict(resource.recordedId, resource.videoFileId)) {
            throw new Error('RecordedResourceDeleting');
        }

        if (typeof resource.durableKey === 'string') {
            const transferable = [...this.leases.values()].find(
                lease =>
                    lease.unknown === true &&
                    lease.recordedId === resource.recordedId &&
                    lease.videoFileId === resource.videoFileId &&
                    lease.durableKey === resource.durableKey,
            );
            if (typeof transferable !== 'undefined') {
                transferable.peer = peer;
                transferable.unknown = false;
                return transferable.id;
            }
        }

        const id = this.createId('lease');
        this.leases.set(id, {
            id,
            peer,
            recordedId: resource.recordedId,
            videoFileId: resource.videoFileId,
            purpose: resource.purpose,
            durableKey: resource.durableKey,
            unknown: false,
        });
        return id;
    }

    /** Releasing the same lease twice is harmless; another peer cannot release it. */
    public release(peer: string, leaseId: string): void {
        if (typeof peer !== 'string' || typeof leaseId !== 'string') return;
        const lease = this.leases.get(leaseId);
        if (lease?.peer === peer && lease.unknown === false) this.leases.delete(leaseId);
    }

    /** Mark leases as uncertain without dropping them after a peer disconnect. */
    public markPeerUnknown(peer: string): void {
        if (typeof peer !== 'string') return;
        for (const lease of this.leases.values()) {
            if (lease.peer === peer) lease.unknown = true;
        }
    }

    /** Call only after the peer's processes are confirmed stopped. */
    public clearPeer(peer: string, preserveDurable = false): void {
        if (typeof peer !== 'string') return;
        for (const [id, lease] of this.leases) {
            if (lease.peer === peer && (!preserveDurable || lease.durableKey === undefined)) this.leases.delete(id);
        }
    }

    /** Atomically reserve deletion if no overlapping lease or deletion exists. */
    public tryBeginDeletion(recordedId: number, videoFileId?: number): string | null {
        if (!this.isPositiveSafeInteger(recordedId)) throw new Error('InvalidRecordedId');
        if (typeof videoFileId !== 'undefined' && !this.isPositiveSafeInteger(videoFileId)) {
            throw new Error('InvalidVideoFileId');
        }
        if (this.isInUse(recordedId, videoFileId) || this.hasDeletionConflict(recordedId, videoFileId)) return null;

        const token = this.createId('delete');
        this.deletions.set(token, { token, recordedId, videoFileId });
        return token;
    }

    /** Releasing an unknown or already-ended deletion token is harmless. */
    public endDeletion(token: string): void {
        if (typeof token === 'string') this.deletions.delete(token);
    }

    public isInUse(recordedId: number, videoFileId?: number): boolean {
        if (!this.isPositiveSafeInteger(recordedId)) throw new Error('InvalidRecordedId');
        if (typeof videoFileId !== 'undefined' && !this.isPositiveSafeInteger(videoFileId)) {
            throw new Error('InvalidVideoFileId');
        }

        for (const lease of this.leases.values()) {
            if (lease.recordedId !== recordedId) continue;
            if (
                typeof videoFileId === 'undefined' ||
                typeof lease.videoFileId === 'undefined' ||
                lease.videoFileId === videoFileId
            ) {
                return true;
            }
        }
        return false;
    }

    private hasDeletionConflict(recordedId: number, videoFileId?: number): boolean {
        for (const deletion of this.deletions.values()) {
            if (deletion.recordedId !== recordedId) continue;
            if (
                typeof videoFileId === 'undefined' ||
                typeof deletion.videoFileId === 'undefined' ||
                deletion.videoFileId === videoFileId
            ) {
                return true;
            }
        }
        return false;
    }

    private validatePeer(peer: string): void {
        if (typeof peer !== 'string' || peer.length === 0) throw new Error('InvalidRecordedUsePeer');
    }

    private validateResource(resource: RecordedUseResource): void {
        if (typeof resource !== 'object' || resource === null) throw new Error('InvalidRecordedUseResource');
        if (!this.isPositiveSafeInteger(resource.recordedId)) throw new Error('InvalidRecordedId');
        if (typeof resource.videoFileId !== 'undefined' && !this.isPositiveSafeInteger(resource.videoFileId)) {
            throw new Error('InvalidVideoFileId');
        }
        if (typeof resource.purpose !== 'string' || resource.purpose.length === 0) {
            throw new Error('InvalidRecordedUsePurpose');
        }
        if (
            typeof resource.durableKey !== 'undefined' &&
            (typeof resource.durableKey !== 'string' || resource.durableKey.length === 0)
        ) {
            throw new Error('InvalidRecordedUseDurableKey');
        }
    }

    private isPositiveSafeInteger(value: unknown): value is number {
        return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
    }

    private createId(prefix: 'lease' | 'delete'): string {
        const id = `${prefix}-${this.nextId.toString(10)}`;
        this.nextId++;
        return id;
    }
}

export const recordedUseRegistry = new RecordedUseRegistry();
