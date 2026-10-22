import { fileURLToPath } from 'node:url';
import * as fs from 'fs';
import * as http from 'http';
import { inject, injectable } from 'inversify';
import { Client as mirakurun } from 'mirakurun';
import * as path from 'path';
import { URL } from 'url';
import IConfigFile from './IConfigFile.js';
import IConfiguration from './IConfiguration.js';
import IMirakurunClientModel from './IMirakurunClientModel.js';

type RequestOptions = NonNullable<Parameters<mirakurun['request']>[2]>;

/**
 * mirakurun client のインスタンスを生成する
 */
@injectable()
export default class MirakurunClientModel implements IMirakurunClientModel {
    private client: mirakurun;
    private config: IConfigFile;
    private requestTimeoutConfigured = false;

    constructor(@inject('IConfiguration') conf: IConfiguration) {
        this.client = new mirakurun();
        this.config = conf.getConfig();

        this.setClient();
    }

    /**
     * mirakurun client の設定
     */
    private setClient(): void {
        const pkg = JSON.parse(
            fs
                .readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'package.json'))
                .toString(),
        );
        const mirakurunPath = this.config.mirakurunPath;

        /**
         * Copyright (c) 2016 Yuki KAN and Chinachu Project Contributors
         * Released under the MIT license
         * http://opensource.org/licenses/mit-license.php
         */
        if (/\\\\.\\pipe/.test(mirakurunPath)) {
            this.client.socketPath = mirakurunPath;
        } else if (/(?:\/|\+)unix:/.test(mirakurunPath) === true) {
            const standardFormat = /^http\+unix:\/\/([^\/]+)(\/?.*)$/;
            const legacyFormat = /^http:\/\/unix:([^:]+):?(.*)$/;

            if (standardFormat.test(mirakurunPath) === true) {
                this.client.socketPath = mirakurunPath.replace(standardFormat, '$1').replace(/%2F/g, '/');
                this.client.basePath = path.posix.join(
                    mirakurunPath.replace(standardFormat, '$2'),
                    this.client.basePath,
                );
            } else {
                this.client.socketPath = mirakurunPath.replace(legacyFormat, '$1');
                this.client.basePath = path.posix.join(mirakurunPath.replace(legacyFormat, '$2'), this.client.basePath);
            }
        } else {
            const urlObject = new URL(mirakurunPath);
            this.client.host = urlObject.hostname;
            this.client.port = Number(urlObject.port);
            this.client.basePath = path.posix.join(urlObject.pathname, this.client.basePath);
        }

        this.client.userAgent = `NeoEPGStation/${pkg.version}`;
    }

    /**
     * mirakurun client を返す
     * @return mirakurun client
     */
    public getClient(): mirakurun {
        if (this.requestTimeoutConfigured === false) {
            this.setRequestTimeout(this.config.tunerRequestTimeout ?? 30000);
            this.requestTimeoutConfigured = true;
        }
        return this.client;
    }

    private setRequestTimeout(timeoutMs: number): void {
        const originalRequest = this.client.request.bind(this.client);
        this.client.request = ((method, requestPath, option: RequestOptions = {}) =>
            this.withRequestTimeout(timeoutMs, option.signal, signal =>
                originalRequest(method, requestPath, { ...option, signal }),
            )) as mirakurun['request'];

        const originalCall = this.client.call.bind(this.client);
        this.client.call = ((operationId, param, option: RequestOptions = {}) =>
            this.withRequestTimeout(timeoutMs, option.signal, signal =>
                originalCall(operationId, param, { ...option, signal }),
            )) as mirakurun['call'];
    }

    private async withRequestTimeout<T>(
        timeoutMs: number,
        sourceSignal: AbortSignal | undefined,
        request: (signal: AbortSignal) => Promise<T>,
    ): Promise<T> {
        if (sourceSignal?.aborted === true) {
            throw sourceSignal.reason ?? new Error('MirakurunRequestAborted');
        }

        const controller = new AbortController();
        const abortFromSource = (): void => controller.abort(sourceSignal?.reason);
        const removeSourceAbortListener = (): void => sourceSignal?.removeEventListener('abort', abortFromSource);
        let retainSourceAbortListener = false;
        sourceSignal?.addEventListener('abort', abortFromSource, { once: true });
        const timeout = setTimeout(() => controller.abort(new Error('MirakurunRequestTimeout')), timeoutMs);

        try {
            const result = await request(controller.signal);
            if (
                result instanceof http.IncomingMessage &&
                result.destroyed === false &&
                result.readableEnded === false
            ) {
                // call() resolves as soon as stream headers arrive. Keep caller cancellation
                // connected for the stream lifetime, while ending the response-wait timeout here.
                result.once('close', removeSourceAbortListener);
                retainSourceAbortListener = true;
            } else {
                removeSourceAbortListener();
            }
            return result;
        } finally {
            clearTimeout(timeout);
            if (retainSourceAbortListener === false) {
                removeSourceAbortListener();
            }
        }
    }
}
