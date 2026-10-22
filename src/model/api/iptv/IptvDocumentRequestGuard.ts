import { Response } from 'express';

export const DEFAULT_IPTV_DOCUMENT_TIMEOUT = 30_000;
export const IPTV_DOCUMENT_TIMEOUT_MESSAGE = 'IptvDocumentRequestDeadlineExceeded';

export interface IptvRequestContext {
    /** Throws after the client disconnects or the request deadline expires. */
    ensureActive(): void;
}

export interface IptvDocumentRequestOptions<T> {
    readonly timeoutMs?: number;
    readonly execute: (context: IptvRequestContext) => Promise<T> | T;
    readonly success: (result: T) => void;
    readonly failure: (error: unknown) => void;
}

/** Run document generation until it completes, the client disconnects, or its deadline expires. */
export const completeIptvDocumentRequest = <T>(
    res: Response,
    options: IptvDocumentRequestOptions<T>,
): Promise<void> => {
    const timeoutMs = options.timeoutMs ?? DEFAULT_IPTV_DOCUMENT_TIMEOUT;
    const deadline = globalThis.performance.now() + timeoutMs;
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    let resolveCompletion!: () => void;
    let rejectCompletion!: (error: unknown) => void;
    const completion = new Promise<void>((resolve, reject) => {
        resolveCompletion = resolve;
        rejectCompletion = reject;
    });

    const cleanup = (): void => {
        if (timer !== undefined) {
            clearTimeout(timer);
            timer = undefined;
        }
        res.removeListener('close', onResponseClose);
    };
    const settle = (callback?: () => void): boolean => {
        if (settled) return false;
        settled = true;
        cleanup();
        try {
            callback?.();
            resolveCompletion();
        } catch (error: unknown) {
            rejectCompletion(error);
        }
        return true;
    };
    const fail = (error: unknown): void => {
        settle(() => options.failure(error));
    };
    const onResponseClose = (): void => {
        settle();
    };
    const ensureActive = (): void => {
        if (settled) throw new Error('IptvDocumentRequestTerminated');
        if (globalThis.performance.now() >= deadline) {
            const error = new Error(IPTV_DOCUMENT_TIMEOUT_MESSAGE);
            fail(error);
            throw error;
        }
    };

    res.once('close', onResponseClose);
    if (res.destroyed === true || res.writableEnded === true) {
        settle();
        return completion;
    }

    const remaining = deadline - globalThis.performance.now();
    if (remaining <= 0) {
        fail(new Error(IPTV_DOCUMENT_TIMEOUT_MESSAGE));
        return completion;
    }
    timer = setTimeout(() => fail(new Error(IPTV_DOCUMENT_TIMEOUT_MESSAGE)), Math.ceil(remaining));

    let operation: Promise<T>;
    try {
        operation = Promise.resolve(options.execute({ ensureActive }));
    } catch (error: unknown) {
        fail(error);
        return completion;
    }

    void operation.then(
        result => {
            if (globalThis.performance.now() >= deadline) fail(new Error(IPTV_DOCUMENT_TIMEOUT_MESSAGE));
            else settle(() => options.success(result));
        },
        error => {
            if (globalThis.performance.now() >= deadline) fail(new Error(IPTV_DOCUMENT_TIMEOUT_MESSAGE));
            else fail(error);
        },
    );

    return completion;
};
