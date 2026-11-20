type SchedulerKey = object | string | symbol;
type SchedulerCallback = () => void | Promise<void>;

interface ScheduledEntry {
    at: number;
    callback: SchedulerCallback;
}

/** Schedules callbacks against wall-clock time, periodically rechecking the clock. */
export default class WallClockScheduler {
    private readonly maxDelayMs: number;
    private readonly onError?: (error: unknown) => void;
    private readonly entries = new Map<SchedulerKey, ScheduledEntry>();
    private timer: ReturnType<typeof setTimeout> | undefined;
    private disposed = false;
    private ticking = false;
    private timerGeneration = 0;

    constructor(maxDelayMs: number = 3000, onError?: (error: unknown) => void) {
        if (!Number.isFinite(maxDelayMs) || maxDelayMs <= 0) {
            throw new RangeError('maxDelayMs must be a positive finite number');
        }

        this.maxDelayMs = maxDelayMs;
        this.onError = onError;
    }

    public schedule(key: SchedulerKey, at: number, callback: SchedulerCallback): () => void {
        if (this.disposed === true) {
            throw new Error('WallClockScheduler is disposed');
        }
        if (!Number.isFinite(at)) {
            throw new RangeError('at must be a finite number');
        }
        if (typeof callback !== 'function') {
            throw new TypeError('callback must be a function');
        }

        const entry: ScheduledEntry = { at, callback };
        this.entries.set(key, entry);
        this.refresh();

        return () => {
            if (this.entries.get(key) === entry) {
                this.entries.delete(key);
                this.refresh();
            }
        };
    }

    public cancel(key: SchedulerKey): void {
        if (this.entries.delete(key) === true) {
            this.refresh();
        }
    }

    public refresh(): void {
        if (this.disposed === true || this.ticking === true) {
            return;
        }

        this.armTimer();
    }

    private tick(): void {
        if (this.disposed === true || this.ticking === true) {
            return;
        }

        this.ticking = true;
        try {
            const now = Date.now();
            const due = Array.from(this.entries.entries()).filter(([, entry]) => entry.at <= now);

            for (const [key, entry] of due) {
                if (this.entries.get(key) !== entry) {
                    continue;
                }

                // Remove before invoking so callbacks may safely reschedule the same key.
                this.entries.delete(key);
                try {
                    const result = entry.callback();
                    if (result != null && typeof (result as Promise<void>).then === 'function') {
                        Promise.resolve(result).catch(error => this.reportError(error));
                    }
                } catch (error) {
                    this.reportError(error);
                }
            }
        } finally {
            this.ticking = false;
            this.armTimer();
        }
    }

    private armTimer(): void {
        if (this.disposed === true || this.ticking === true) {
            return;
        }

        this.clearTimer();
        if (this.entries.size === 0) {
            return;
        }

        let nextAt = Number.POSITIVE_INFINITY;
        for (const entry of this.entries.values()) {
            nextAt = Math.min(nextAt, entry.at);
        }
        const delay = Math.min(this.maxDelayMs, Math.max(0, nextAt - Date.now()));
        const generation = this.timerGeneration;
        const timer = setTimeout(() => {
            if (generation !== this.timerGeneration || this.disposed === true) {
                return;
            }
            this.timer = undefined;
            this.tick();
        }, delay);
        this.timer = timer;
    }

    public dispose(): void {
        if (this.disposed === true) {
            return;
        }
        this.disposed = true;
        this.clearTimer();
        this.entries.clear();
    }

    private clearTimer(): void {
        this.timerGeneration++;
        if (this.timer !== undefined) {
            clearTimeout(this.timer);
            this.timer = undefined;
        }
    }

    private reportError(error: unknown): void {
        try {
            this.onError?.(error);
        } catch {
            // Error reporting must not prevent other scheduled callbacks from running.
        }
    }
}
