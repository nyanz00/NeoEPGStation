import * as fs from 'fs/promises';
import * as path from 'path';

interface UploadAdmissionLease {
    releaseOnce(): void;
}

/** Limits concurrent upload receivers and issues idempotent release leases. */
export default class UploadAdmissionController {
    private readonly maxConcurrent: number;
    private active = 0;

    public constructor(maxConcurrent: number) {
        this.maxConcurrent = Number.isFinite(maxConcurrent) ? Math.max(0, Math.floor(maxConcurrent)) : 0;
    }

    public tryAcquire(): UploadAdmissionLease | null {
        if (this.active >= this.maxConcurrent) return null;
        this.active++;
        let released = false;
        return {
            releaseOnce: () => {
                if (released) return;
                released = true;
                this.active--;
            },
        };
    }
}

interface IncomingUploadFileOptions {
    error: (error: unknown) => void;
}

/** Owns one upload payload and its token directory, never their ancestors. */
export class IncomingUploadFile {
    private readonly ownedDir: string;
    private readonly ownedPayload: string;
    private readonly onError: (error: unknown) => void;
    private cleanupPromise: Promise<void> | null = null;
    private cleaned = false;

    public constructor(ownedDir: string, ownedPayload: string, options: IncomingUploadFileOptions) {
        this.ownedDir = path.resolve(ownedDir);
        this.ownedPayload = path.resolve(ownedPayload);
        if (path.dirname(this.ownedPayload) !== this.ownedDir) {
            throw new Error('UploadPayloadOutsideOwnedDirectory');
        }
        this.onError = options.error;
    }

    public cleanupOnce(): Promise<void> {
        if (this.cleaned) return Promise.resolve();
        if (this.cleanupPromise !== null) return this.cleanupPromise;

        this.cleanupPromise = this.cleanupOwnedFiles()
            .then(() => {
                this.cleaned = true;
            })
            .catch(error => {
                this.onError(error);
                throw error;
            })
            .finally(() => {
                if (!this.cleaned) this.cleanupPromise = null;
            });

        return this.cleanupPromise;
    }

    private async cleanupOwnedFiles(): Promise<void> {
        try {
            await fs.unlink(this.ownedPayload);
        } catch (error) {
            if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
        }

        try {
            await fs.rmdir(this.ownedDir);
        } catch (error) {
            const code = (error as NodeJS.ErrnoException).code;
            // The directory is ours, but files other than our payload are not.
            if (code !== 'ENOENT' && code !== 'ENOTEMPTY' && code !== 'EEXIST') throw error;
        }
    }
}
