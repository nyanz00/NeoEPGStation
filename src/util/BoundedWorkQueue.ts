interface QueuedWork<T = unknown> {
    work: () => T | Promise<T>;
    resolve: (value: T | PromiseLike<T>) => void;
    reject: (reason?: unknown) => void;
}

/** Runs work one item at a time and rejects new work when the waiting queue is full. */
export default class BoundedWorkQueue {
    private readonly maxPending: number;
    private pending: QueuedWork[] = [];
    private isRunning: boolean = false;

    constructor(maxPending: number) {
        this.maxPending = Number.isSafeInteger(maxPending) && maxPending >= 0 ? maxPending : 0;
    }

    public enqueue<T>(work: () => T | Promise<T>): Promise<T> {
        if (this.isRunning === true && this.pending.length >= this.maxPending) {
            return Promise.reject(new Error('BoundedWorkQueueFullError'));
        }

        return new Promise<T>((resolve, reject) => {
            this.pending.push({ work, resolve, reject } as QueuedWork);
            this.runNext();
        });
    }

    private runNext(): void {
        if (this.isRunning === true) {
            return;
        }

        const queued = this.pending.shift();
        if (typeof queued === 'undefined') {
            return;
        }

        this.isRunning = true;
        Promise.resolve()
            .then(queued.work)
            .then(queued.resolve, queued.reject)
            .finally(() => {
                this.isRunning = false;
                this.runNext();
            });
    }
}
