import { IncomingMessage } from 'node:http';
import { Readable } from 'node:stream';
import * as api from './TunerApi.js';
import { parseConnectionTarget } from './transport/ConnectionTargetParser.js';
import TunerHttpTransport from './transport/TunerHttpTransport.js';

export interface StreamRequest {
    id: number;
    decode?: boolean;
    priority?: number;
    signal?: AbortSignal;
}

/** Shared HTTP boundary for metadata, diagnostics, change feeds and media streams. */
export default class TunerServerAccessModel {
    private readonly transport: TunerHttpTransport;
    constructor(
        target: string,
        userAgent: string,
        private readonly timeoutMs = 30000,
    ) {
        this.transport = new TunerHttpTransport(parseConnectionTarget(target), userAgent);
    }
    public getStatus(): Promise<api.Status> {
        return this.json('/api/status');
    }
    public getTuners(): Promise<api.TunerDevice[]> {
        return this.json('/api/tuners');
    }
    public getServices(): Promise<api.Service[]> {
        return this.json('/api/services');
    }
    public getPrograms(): Promise<api.Program[]> {
        return this.json('/api/programs');
    }
    public getProgram(id: number): Promise<api.Program> {
        return this.json(`/api/programs/${this.id(id)}`);
    }
    public getProgramsByService(id: number): Promise<api.Program[]> {
        return this.json(`/api/services/${this.id(id)}/programs`);
    }
    public getServerConfig(): Promise<unknown> {
        return this.json('/api/config/server');
    }
    public async isMirakc(): Promise<boolean> {
        const response = await this.request(signal => this.transport.probeJson('/api/config/server', { signal }));
        return response.status === 404;
    }
    public getLogoImage(id: number): Promise<Buffer> {
        return this.request(signal => this.transport.getBuffer(`/api/services/${this.id(id)}/logo`, { signal }));
    }
    public getEventsStream(): Promise<IncomingMessage> {
        return this.request(signal =>
            this.transport.getStream('/api/events/stream', { signal }),
        ) as Promise<IncomingMessage>;
    }
    public getMirakcEvents(signal?: AbortSignal): Promise<Readable> {
        return this.request(abort => this.transport.getRootStream('/events', { signal: abort }), signal);
    }
    public getProgramStream(options: StreamRequest): Promise<IncomingMessage> {
        return this.openStream(`/api/programs/${this.id(options.id)}/stream`, options);
    }
    public getServiceStream(options: StreamRequest): Promise<IncomingMessage> {
        return this.openStream(`/api/services/${this.id(options.id)}/stream`, options);
    }
    private async openStream(path: string, options: StreamRequest): Promise<IncomingMessage> {
        return this.request(async signal => {
            const handle = await this.transport.openStream(
                `${path}?decode=${options.decode === false ? 0 : 1}`,
                options.priority ?? 0,
                { signal },
            );
            const incoming = handle.stream as IncomingMessage;
            incoming.once('close', () => handle.close());
            return incoming;
        }, options.signal);
    }
    private json<T>(path: string): Promise<T> {
        return this.request(signal => this.transport.getJson(path, { signal })) as Promise<T>;
    }
    private id(value: number): string {
        if (!Number.isSafeInteger(value) || value < 0) throw new Error('InvalidTunerResourceId');
        return String(value);
    }
    private async request<T>(operation: (signal: AbortSignal) => Promise<T>, source?: AbortSignal): Promise<T> {
        const controller = new AbortController();
        const abort = (): void => controller.abort(source?.reason);
        if (source?.aborted) abort();
        else source?.addEventListener('abort', abort, { once: true });
        const timeout = setTimeout(() => controller.abort(new Error('TunerRequestTimeout')), this.timeoutMs);
        let stream: Readable | null = null;
        try {
            const result = await operation(controller.signal);
            if (result instanceof Readable) {
                stream = result;
                const destroy = (): void => {
                    stream?.destroy();
                };
                controller.signal.addEventListener('abort', destroy, { once: true });
                result.once('close', () => {
                    source?.removeEventListener('abort', abort);
                    controller.signal.removeEventListener('abort', destroy);
                });
                if (controller.signal.aborted) destroy();
            }
            return result;
        } finally {
            clearTimeout(timeout);
            if (stream === null) source?.removeEventListener('abort', abort);
        }
    }
}
