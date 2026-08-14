import { injectable } from 'inversify';

@injectable()
export default class PromiseQueue {
    private queue: Promise<any> = Promise.resolve(true);

    /**
     * add job
     * @param job: Promise
     * @return Promise<T>
     */
    public add<T>(job: () => Promise<T>): Promise<T> {
        const result = this.queue.then(job);

        // A failed job must not leave the shared queue rejected. Callers still
        // receive the original rejection, while later jobs can continue.
        this.queue = result.then(
            () => undefined,
            () => undefined,
        );

        return result;
    }
}
