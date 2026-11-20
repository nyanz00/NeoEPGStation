import type { Readable } from 'node:stream';

/** Connection settings shared by every tuner request. */
export type ConnectionTarget =
    | { readonly kind: 'http'; readonly host: string; readonly port: number; readonly basePath: string }
    | { readonly kind: 'unix'; readonly socketPath: string; readonly basePath: string }
    | { readonly kind: 'named-pipe'; readonly socketPath: string; readonly basePath: string };

export interface TunerRequestOptions {
    readonly signal?: AbortSignal;
}

export interface TunerStreamHandle {
    readonly stream: Readable;
    readonly close: () => void;
}
