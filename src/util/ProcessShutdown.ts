/** Close process resources once, with a deadline shorter than the service stop timeout. */
export default class ProcessShutdown {
    private started = false;

    constructor(
        private readonly close: (reason: string) => Promise<void>,
        private readonly onError: (error: unknown) => void,
        private readonly timeoutMs = 25_000,
    ) {
        process.on('SIGTERM', () => this.request('SIGTERM'));
        process.on('SIGINT', () => this.request('SIGINT'));
    }

    public get isStarted(): boolean {
        return this.started;
    }

    public request(reason: string): void {
        if (this.started) return;
        this.started = true;
        let finished = false;
        const finish = (exitCode: number, error?: unknown): void => {
            if (finished) return;
            finished = true;
            clearTimeout(timeout);
            if (exitCode !== 0) this.onError(error);
            process.exit(exitCode);
        };
        const timeout = setTimeout(
            () => finish(1, new Error(`process shutdown timed out after ${this.timeoutMs.toString(10)} ms`)),
            this.timeoutMs,
        );
        void Promise.resolve()
            .then(() => this.close(reason))
            .then(
                () => finish(0),
                error => finish(1, error),
            );
    }
}
