import { ChildProcess } from 'child_process';
import * as events from 'events';
import * as fs from 'fs';
import * as iconv from 'iconv-lite';
import { inject, injectable } from 'inversify';
import * as net from 'net';
import * as path from 'path';
import { TextDecoder } from 'util';
import * as apid from '../../../../api';
import FileUtil from '../../../util/FileUtil';
import ProcessUtil from '../../../util/ProcessUtil';
import Util from '../../../util/Util';
import IVideoUtil, { VideoInfo } from '../../api/video/IVideoUtil';
import IChannelDB from '../../db/IChannelDB';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IEncodeEvent from '../../event/IEncodeEvent';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { AmatsukazeEncodeConfig } from '../../IConfigFile';
import IEncodeFileManageModel from './IEncodeFileManageModel';
import IEncodeProcessManageModel from './IEncodeProcessManageModel';
import { EncodeOption, EncodeProgressInfo, IEncoderModel } from './IEncoderModel';
import IRecordingUtilModel from '../../operator/recording/IRecordingUtilModel';

interface AmatsukazeOutputCandidate {
    path: string;
    size: number;
    mtimeMs: number;
    stableSince: number;
}

interface AmatsukazePushStatus {
    isConnected: boolean;
    isMatched: boolean;
    consoleId: number | null;
    log: string | null;
    percent: number | null;
    isReadyForOutputScan: boolean;
    isPending: boolean;
    pendingMessage: string | null;
    errorMessage: string | null;
    requiresOutputReconcile: boolean;
    updatedAt: number;
}

interface AmatsukazeUnfinishedTaskCancellation {
    requestedTaskIds: Set<number> | null;
    resolve: (count: number) => void;
    reject: (err: Error) => void;
    timeoutId: NodeJS.Timeout;
    onLog: (message: string) => void;
}

class AmatsukazePushConnection {
    private static readonly RPC_CHANGE_ITEM = 103;
    private static readonly RPC_ON_UI_DATA = 200;
    private static readonly RPC_ON_CONSOLE_UPDATE = 201;
    private static readonly RPC_ON_ENCODE_STATE = 202;
    private static readonly IDLE_CLOSE_DELAY_MS = 60 * 1000;
    private static readonly RECONNECT_MIN_DELAY_MS = 1000;
    private static readonly RECONNECT_MAX_DELAY_MS = 30 * 1000;
    private static readonly connections: Map<string, AmatsukazePushConnection> = new Map();
    // Keep a successful promise for the process lifetime so later restored jobs do not
    // cancel jobs that were freshly submitted after the recovery snapshot.
    private static readonly restartRecoveryPromises: Map<string, Promise<number>> = new Map();

    public static subscribe(
        host: string,
        port: number,
        inputFilePath: string,
        initialTaskId: number | null,
        allowRecoveryFallback: boolean,
        onUpdate: (status: AmatsukazePushStatus) => void,
        onTaskMatched: (taskId: number) => void,
        onLog: (message: string) => void,
    ): AmatsukazePushSubscription {
        const key = `${host}:${port}`;
        let connection = AmatsukazePushConnection.connections.get(key);
        if (typeof connection === 'undefined') {
            connection = new AmatsukazePushConnection(key, host, port);
            AmatsukazePushConnection.connections.set(key, connection);
        }

        return connection.subscribe(
            inputFilePath,
            initialTaskId,
            allowRecoveryFallback,
            onUpdate,
            onTaskMatched,
            onLog,
        );
    }

    public static readTag(xml: string, name: string): string | undefined {
        return AmatsukazePushConnection.readTags(xml, name)[0];
    }

    public static readTags(xml: string, name: string): string[] {
        const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
        const regexp = new RegExp(
            `<(?:\\w+:)?${escapedName}(?:\\s[^>]*)?>([\\s\\S]*?)</(?:\\w+:)?${escapedName}>`,
            'g',
        );
        const result: string[] = [];
        for (;;) {
            const match = regexp.exec(xml);
            if (match === null) {
                return result;
            }
            result.push(AmatsukazePushConnection.decodeXml(match[1].trim()));
        }
    }

    public static cancelUnfinishedTasks(host: string, port: number, onLog: (message: string) => void): Promise<number> {
        const key = `${host}:${port}`;
        const existingPromise = AmatsukazePushConnection.restartRecoveryPromises.get(key);
        if (typeof existingPromise !== 'undefined') return existingPromise;

        let connection = AmatsukazePushConnection.connections.get(key);
        if (typeof connection === 'undefined') {
            connection = new AmatsukazePushConnection(key, host, port);
            AmatsukazePushConnection.connections.set(key, connection);
        }
        const recoveryPromise = connection.cancelUnfinishedTasks(onLog).catch(err => {
            if (AmatsukazePushConnection.restartRecoveryPromises.get(key) === recoveryPromise) {
                AmatsukazePushConnection.restartRecoveryPromises.delete(key);
            }
            throw err;
        });
        AmatsukazePushConnection.restartRecoveryPromises.set(key, recoveryPromise);
        return recoveryPromise;
    }

    private static decodeXml(value: string): string {
        return value
            .replace(/&lt;/g, '<')
            .replace(/&gt;/g, '>')
            .replace(/&quot;/g, '"')
            .replace(/&apos;/g, "'")
            .replace(/&amp;/g, '&');
    }

    private socket: net.Socket | null = null;
    private recvBuffer: Buffer = Buffer.alloc(0);
    private subscriptions: Map<number, AmatsukazePushSubscription> = new Map();
    private nextSubscriptionId: number = 1;
    private idleCloseTimerId: NodeJS.Timeout | null = null;
    private reconnectTimerId: NodeJS.Timeout | null = null;
    private reconnectAttempts: number = 0;
    private unfinishedTaskCancellation: AmatsukazeUnfinishedTaskCancellation | null = null;
    private readonly decoder: TextDecoder = new TextDecoder('shift_jis');

    private constructor(
        private readonly key: string,
        private readonly host: string,
        private readonly port: number,
    ) {}

    private subscribe(
        inputFilePath: string,
        initialTaskId: number | null,
        allowRecoveryFallback: boolean,
        onUpdate: (status: AmatsukazePushStatus) => void,
        onTaskMatched: (taskId: number) => void,
        onLog: (message: string) => void,
    ): AmatsukazePushSubscription {
        if (this.idleCloseTimerId !== null) {
            clearTimeout(this.idleCloseTimerId);
            this.idleCloseTimerId = null;
        }

        const subscription = new AmatsukazePushSubscription(
            this.nextSubscriptionId++,
            this,
            inputFilePath,
            initialTaskId,
            allowRecoveryFallback,
            onUpdate,
            onTaskMatched,
            onLog,
        );
        this.subscriptions.set(subscription.id, subscription);
        this.start();

        return subscription;
    }

    public unsubscribe(subscriptionId: number): void {
        this.subscriptions.delete(subscriptionId);
        if (this.hasWork() || this.idleCloseTimerId !== null) {
            return;
        }

        this.idleCloseTimerId = setTimeout(() => {
            this.idleCloseTimerId = null;
            if (this.hasWork() === false) {
                this.stop();
            }
        }, AmatsukazePushConnection.IDLE_CLOSE_DELAY_MS);
    }

    public canClaimFallbackConsole(subscriptionId: number, consoleId: number): boolean {
        for (const subscription of this.subscriptions.values()) {
            if (subscription.id !== subscriptionId && subscription.getConsoleId() === consoleId) {
                return false;
            }
        }

        return true;
    }

    public canClaimTask(subscriptionId: number, taskId: number): boolean {
        for (const subscription of this.subscriptions.values()) {
            if (subscription.id !== subscriptionId && subscription.getTaskId() === taskId) {
                return false;
            }
        }

        return true;
    }

    public claimConsoleFromQueue(subscriptionId: number, consoleId: number): void {
        for (const subscription of this.subscriptions.values()) {
            if (subscription.id !== subscriptionId) {
                subscription.releaseFallbackConsoleClaim(consoleId);
            }
        }
    }

    public sendFrame(frame: Buffer): boolean {
        if (this.socket === null) {
            return false;
        }

        this.socket.write(frame);

        return true;
    }

    public createChangeItemFrame(itemId: number): Buffer {
        const requestId = `epgstation-${Date.now().toString(36)}`;
        const xml = [
            '<ChangeItemData xmlns="http://schemas.datacontract.org/2004/07/Amatsukaze.Server" xmlns:i="http://www.w3.org/2001/XMLSchema-instance">',
            '<ChangeType>Cancel</ChangeType>',
            `<ItemId>${itemId}</ItemId>`,
            '<Mode i:nil="true"/>',
            '<Position>0</Position>',
            '<Priority>0</Priority>',
            '<Profile i:nil="true"/>',
            `<RequestId>${requestId}</RequestId>`,
            '<workerId>0</workerId>',
            '</ChangeItemData>',
        ].join('');
        const xmlBytes = Buffer.from(xml, 'utf8');
        const chunked = Buffer.alloc(4 + xmlBytes.length);
        chunked.writeInt32LE(xmlBytes.length, 0);
        xmlBytes.copy(chunked, 4);

        const frame = Buffer.alloc(6 + chunked.length);
        frame.writeInt16LE(AmatsukazePushConnection.RPC_CHANGE_ITEM, 0);
        frame.writeInt32LE(chunked.length, 2);
        chunked.copy(frame, 6);

        return frame;
    }

    private cancelUnfinishedTasks(onLog: (message: string) => void): Promise<number> {
        if (this.unfinishedTaskCancellation !== null) {
            return Promise.reject(new Error('Amatsukaze unfinished task cancellation is already running'));
        }

        if (this.idleCloseTimerId !== null) {
            clearTimeout(this.idleCloseTimerId);
            this.idleCloseTimerId = null;
        }
        return new Promise<number>((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                if (this.unfinishedTaskCancellation?.timeoutId !== timeoutId) return;
                this.unfinishedTaskCancellation = null;
                reject(new Error('Amatsukaze unfinished task cancellation timed out'));
                this.scheduleIdleStop();
            }, 15_000);
            this.unfinishedTaskCancellation = {
                requestedTaskIds: null,
                resolve,
                reject,
                timeoutId,
                onLog,
            };
            this.start();
        });
    }

    private start(): void {
        if (this.socket !== null || this.reconnectTimerId !== null || this.hasWork() === false) {
            return;
        }

        const socket = net.createConnection({ host: this.host, port: this.port }, () => {
            if (this.socket !== socket) return;
            this.reconnectAttempts = 0;
            this.notifyConnected(true);
            this.notifyLog(`amatsukaze push connected: ${this.host}:${this.port}`);
        });
        this.socket = socket;

        socket.on('data', chunk => {
            this.onData(chunk);
        });
        socket.on('error', err => {
            this.notifyLog(`amatsukaze push error: ${err.message}`);
            if (this.socket === socket) socket.destroy();
        });
        socket.on('close', () => {
            if (this.socket !== socket) return;
            this.socket = null;
            this.recvBuffer = Buffer.alloc(0);
            this.notifyConnected(false);
            this.notifyLog('amatsukaze push closed');
            this.scheduleReconnect();
        });
    }

    private scheduleReconnect(): void {
        if (this.hasWork() === false || this.reconnectTimerId !== null) return;
        const delay = Math.min(
            AmatsukazePushConnection.RECONNECT_MAX_DELAY_MS,
            AmatsukazePushConnection.RECONNECT_MIN_DELAY_MS * 2 ** Math.min(this.reconnectAttempts, 5),
        );
        this.reconnectAttempts += 1;
        this.notifyLog(`amatsukaze push reconnect scheduled: ${delay.toString(10)}ms`);
        this.reconnectTimerId = setTimeout(() => {
            this.reconnectTimerId = null;
            this.start();
        }, delay);
    }

    private stop(): void {
        if (this.reconnectTimerId !== null) {
            clearTimeout(this.reconnectTimerId);
            this.reconnectTimerId = null;
        }
        if (this.socket !== null) {
            this.socket.removeAllListeners();
            this.socket.destroy();
            this.socket = null;
        }
        this.recvBuffer = Buffer.alloc(0);
        this.reconnectAttempts = 0;
        AmatsukazePushConnection.connections.delete(this.key);
    }

    private hasWork(): boolean {
        return this.subscriptions.size > 0 || this.unfinishedTaskCancellation !== null;
    }

    private scheduleIdleStop(): void {
        if (this.hasWork() || this.idleCloseTimerId !== null) return;
        this.idleCloseTimerId = setTimeout(() => {
            this.idleCloseTimerId = null;
            if (this.hasWork() === false) this.stop();
        }, 1_000);
    }

    private onData(chunk: Buffer): void {
        this.recvBuffer = Buffer.concat([this.recvBuffer, chunk]);
        for (;;) {
            if (this.recvBuffer.length < 6) {
                return;
            }

            const id = this.recvBuffer.readInt16LE(0);
            const size = this.recvBuffer.readInt32LE(2);
            if (this.recvBuffer.length < 6 + size) {
                return;
            }

            const payload = this.recvBuffer.subarray(6, 6 + size);
            this.recvBuffer = this.recvBuffer.subarray(6 + size);
            this.handlePacket(id, payload);
        }
    }

    private handlePacket(id: number, payload: Buffer): void {
        if (
            id !== AmatsukazePushConnection.RPC_ON_UI_DATA &&
            id !== AmatsukazePushConnection.RPC_ON_CONSOLE_UPDATE &&
            id !== AmatsukazePushConnection.RPC_ON_ENCODE_STATE
        ) {
            return;
        }

        const chunks = this.splitChunks(payload);
        const xml = chunks[0]?.toString('utf8') ?? '';
        if (id === AmatsukazePushConnection.RPC_ON_CONSOLE_UPDATE) {
            this.handleConsoleUpdate(xml);
            return;
        }

        if (id === AmatsukazePushConnection.RPC_ON_UI_DATA) {
            this.handleUIData(xml);
        }
    }

    private handleConsoleUpdate(xml: string): void {
        const index = Number(AmatsukazePushConnection.readTag(xml, 'index') ?? -999);
        const data = AmatsukazePushConnection.readTag(xml, 'data');
        if (data === undefined) {
            return;
        }

        const text = this.decoder.decode(Buffer.from(data, 'base64'));
        for (const subscription of this.subscriptions.values()) {
            subscription.handleConsoleUpdate(index, text);
        }
    }

    private handleUIData(xml: string): void {
        this.handleUnfinishedTaskCancellation(xml);
        for (const subscription of this.subscriptions.values()) {
            subscription.handleUIData(xml);
        }
    }

    private handleUnfinishedTaskCancellation(xml: string): void {
        const request = this.unfinishedTaskCancellation;
        if (request === null) return;
        const queueUpdate = AmatsukazePushConnection.readTag(xml, 'QueueUpdate');
        if (typeof queueUpdate === 'undefined') return;

        const activeTaskIds = new Set(
            AmatsukazePushConnection.readTags(queueUpdate, 'Item')
                .map(item => ({
                    id: Number(AmatsukazePushConnection.readTag(item, 'Id')),
                    state: (AmatsukazePushConnection.readTag(item, 'State') ?? '').trim().toLowerCase(),
                }))
                .filter(item => {
                    return (
                        Number.isNaN(item.id) === false &&
                        item.state.length > 0 &&
                        !['complete', 'failed', 'prefailed', 'canceled'].includes(item.state)
                    );
                })
                .map(item => item.id),
        );

        if (request.requestedTaskIds === null) {
            request.requestedTaskIds = activeTaskIds;
            if (activeTaskIds.size === 0) {
                request.onLog('amatsukaze restart recovery found no unfinished tasks');
                this.finishUnfinishedTaskCancellation(0);
                return;
            }
            request.onLog(
                `amatsukaze restart recovery canceling ${activeTaskIds.size.toString(10)} unfinished task(s)`,
            );
            for (const taskId of activeTaskIds) {
                this.sendFrame(this.createChangeItemFrame(taskId));
            }
            return;
        }

        const remaining = [...request.requestedTaskIds].filter(taskId => activeTaskIds.has(taskId));
        if (remaining.length === 0) this.finishUnfinishedTaskCancellation(request.requestedTaskIds.size);
    }

    private finishUnfinishedTaskCancellation(count: number): void {
        const request = this.unfinishedTaskCancellation;
        if (request === null) return;
        clearTimeout(request.timeoutId);
        this.unfinishedTaskCancellation = null;
        request.onLog(`amatsukaze restart recovery canceled ${count.toString(10)} unfinished task(s)`);
        request.resolve(count);
        this.scheduleIdleStop();
    }

    private notifyConnected(isConnected: boolean): void {
        for (const subscription of this.subscriptions.values()) {
            subscription.handleConnectionStatus(isConnected);
        }
    }

    private notifyLog(message: string): void {
        for (const subscription of this.subscriptions.values()) {
            subscription.log(message);
        }
    }

    private splitChunks(payload: Buffer): Buffer[] {
        const chunks: Buffer[] = [];
        let offset = 0;
        while (offset + 4 <= payload.length) {
            const size = payload.readInt32LE(offset);
            offset += 4;
            if (size < 0 || offset + size > payload.length) {
                return chunks;
            }
            chunks.push(payload.subarray(offset, offset + size));
            offset += size;
        }

        return chunks;
    }
}

class AmatsukazePushSubscription {
    private status: AmatsukazePushStatus = {
        isConnected: false,
        isMatched: false,
        consoleId: null,
        log: null,
        percent: null,
        isReadyForOutputScan: false,
        isPending: false,
        pendingMessage: null,
        errorMessage: null,
        requiresOutputReconcile: false,
        updatedAt: 0,
    };
    private taskId: number | null;
    private consoleTail: string = '';
    private consoleMatchSource: 'none' | 'fallback' | 'queue' = 'none';
    private hasConnectedOnce: boolean = false;

    constructor(
        public readonly id: number,
        private readonly connection: AmatsukazePushConnection,
        private readonly inputFilePath: string,
        initialTaskId: number | null,
        private readonly allowRecoveryFallback: boolean,
        private readonly onUpdate: (status: AmatsukazePushStatus) => void,
        private readonly onTaskMatched: (taskId: number) => void,
        private readonly onLog: (message: string) => void,
    ) {
        this.taskId = initialTaskId;
    }

    public stop(): void {
        this.flushConsoleTail();
        this.connection.unsubscribe(this.id);
    }

    public getStatus(): AmatsukazePushStatus {
        return {
            ...this.status,
        };
    }

    public getTaskId(): number | null {
        return this.taskId;
    }

    public getConsoleId(): number | null {
        return this.status.consoleId;
    }

    public releaseFallbackConsoleClaim(consoleId: number): void {
        if (this.consoleMatchSource !== 'fallback' || this.status.consoleId !== consoleId) {
            return;
        }

        this.consoleMatchSource = 'none';
        this.status = {
            ...this.status,
            isMatched: this.taskId !== null,
            consoleId: null,
            log: null,
            percent: null,
            isReadyForOutputScan: false,
            errorMessage: null,
            updatedAt: Date.now(),
        };
        this.onUpdate(this.getStatus());
    }

    public cancelTask(): Promise<boolean> {
        if (this.taskId === null) {
            return Promise.resolve(false);
        }

        const taskId = this.taskId;
        const isSent = this.connection.sendFrame(this.connection.createChangeItemFrame(taskId));

        return Promise.resolve(isSent);
    }

    public handleConnectionStatus(isConnected: boolean): void {
        if (isConnected === false) {
            this.flushConsoleTail();
        }
        const isReconnect =
            isConnected && this.hasConnectedOnce && this.status.isConnected === false && this.status.isMatched;
        if (isConnected) this.hasConnectedOnce = true;
        this.status = {
            ...this.status,
            isConnected,
            requiresOutputReconcile: this.status.requiresOutputReconcile || isReconnect,
            updatedAt: Date.now(),
        };
        this.onUpdate(this.getStatus());
    }

    public log(message: string): void {
        this.onLog(message);
    }

    public handleConsoleUpdate(index: number, text: string): void {
        if (
            index >= 0 &&
            this.status.consoleId === null &&
            this.isInputPathCp932Lossless() &&
            this.connection.canClaimFallbackConsole(this.id, index) &&
            this.isMatchingConsoleText(text)
        ) {
            this.consoleMatchSource = 'fallback';
            this.status = {
                ...this.status,
                isMatched: true,
                consoleId: index,
                isPending: false,
                pendingMessage: null,
                updatedAt: Date.now(),
            };
            this.onLog(`amatsukaze push matched console: ${index}`);
        }

        if (this.status.consoleId !== index) {
            return;
        }

        for (const line of this.applyConsoleText(text)) {
            this.processConsoleLine(line);
        }
    }

    public handleUIData(xml: string): void {
        const hasMatchedQueueItem = this.handleQueueUpdate(xml);

        const stateChangeEvent = this.readTag(xml, 'StateChangeEvent');
        if (stateChangeEvent === undefined || this.status.isMatched === false || hasMatchedQueueItem === false) {
            return;
        }

        if (stateChangeEvent === 'EncodeSucceeded') {
            this.status = {
                ...this.status,
                percent: 1,
                isReadyForOutputScan: true,
                updatedAt: Date.now(),
            };
            this.onUpdate(this.getStatus());
        } else if (stateChangeEvent === 'EncodeFailed' || stateChangeEvent === 'EncodeCanceled') {
            this.status = {
                ...this.status,
                errorMessage: stateChangeEvent,
                updatedAt: Date.now(),
            };
            this.onUpdate(this.getStatus());
        }
    }

    private handleQueueUpdate(xml: string): boolean {
        const queueUpdate = this.readTag(xml, 'QueueUpdate');
        if (typeof queueUpdate === 'undefined') {
            return false;
        }

        const queueItems = AmatsukazePushConnection.readTags(queueUpdate, 'Item').map(item => ({
            consoleId: Number(this.readTag(item, 'ConsoleId')),
            id: Number(this.readTag(item, 'Id')),
            srcPath: this.readTag(item, 'SrcPath'),
            state: this.readTag(item, 'State') ?? '',
            stateLabel: this.readTag(item, 'StateLabel') ?? '',
        }));
        const availableItems = queueItems.filter(
            item => Number.isNaN(item.id) === false && this.connection.canClaimTask(this.id, item.id),
        );
        const exactPathMatches = availableItems.filter(
            item => typeof item.srcPath === 'string' && this.isMatchingQueuePath(item.srcPath),
        );
        const basenameMatches =
            this.allowRecoveryFallback && exactPathMatches.length === 0
                ? availableItems.filter(
                      item => typeof item.srcPath === 'string' && this.isMatchingQueueBasename(item.srcPath),
                  )
                : [];
        const usedRecoveryFallback =
            this.taskId === null && exactPathMatches.length === 0 && basenameMatches.length === 1;
        const matchedItem =
            this.taskId === null
                ? (exactPathMatches.sort((a, b) => b.id - a.id)[0] ??
                  (basenameMatches.length === 1 ? basenameMatches[0] : undefined))
                : queueItems.find(item => item.id === this.taskId);
        if (typeof matchedItem === 'undefined') {
            return false;
        }

        if (Number.isNaN(matchedItem.id) === false && this.taskId !== matchedItem.id) {
            this.taskId = matchedItem.id;
            this.onTaskMatched(matchedItem.id);
            if (usedRecoveryFallback) {
                this.onLog(`amatsukaze recovered task by unique source name: ${matchedItem.id.toString(10)}`);
            }
        }

        const normalizedState = matchedItem.state.trim().toLowerCase();
        if (
            Number.isNaN(matchedItem.consoleId) === false &&
            matchedItem.consoleId >= 0 &&
            ['encoding', 'complete', 'failed', 'prefailed', 'canceled'].includes(normalizedState)
        ) {
            this.matchConsoleFromQueue(matchedItem.consoleId);
        }

        const isPending = this.isPendingState(matchedItem.state, matchedItem.stateLabel);
        if (isPending === true) {
            this.status = {
                ...this.status,
                isMatched: true,
                isPending: true,
                pendingMessage: matchedItem.stateLabel || matchedItem.state || 'pending',
                requiresOutputReconcile: false,
                updatedAt: Date.now(),
            };
        } else if (normalizedState === 'complete') {
            this.status = {
                ...this.status,
                isMatched: true,
                percent: 1,
                isReadyForOutputScan: true,
                isPending: false,
                pendingMessage: null,
                requiresOutputReconcile: false,
                updatedAt: Date.now(),
            };
        } else if (['failed', 'prefailed', 'canceled'].includes(normalizedState)) {
            this.status = {
                ...this.status,
                isMatched: true,
                isPending: false,
                pendingMessage: null,
                errorMessage: matchedItem.state,
                requiresOutputReconcile: false,
                updatedAt: Date.now(),
            };
        } else {
            this.status = {
                ...this.status,
                isMatched: true,
                isPending: false,
                pendingMessage: null,
                requiresOutputReconcile: false,
                updatedAt: Date.now(),
            };
        }

        this.onUpdate(this.getStatus());

        return true;
    }

    private matchConsoleFromQueue(consoleId: number): void {
        this.connection.claimConsoleFromQueue(this.id, consoleId);
        if (this.status.consoleId !== consoleId || this.consoleMatchSource !== 'queue') {
            this.onLog(`amatsukaze push matched console by queue: ${consoleId}`);
        }
        this.consoleMatchSource = 'queue';
        this.status = {
            ...this.status,
            isMatched: true,
            consoleId,
            isPending: false,
            pendingMessage: null,
            updatedAt: Date.now(),
        };
    }

    private isPendingState(state: string, stateLabel: string): boolean {
        const text = `${state} ${stateLabel}`.toLowerCase();

        return (
            state.trim().toLowerCase() === 'queue' ||
            state.trim().toLowerCase() === 'logopending' ||
            text.includes('pending') ||
            text.includes('ペンディング') ||
            (text.includes('ロゴ') &&
                (text.includes('未') ||
                    text.includes('無') ||
                    text.includes('なし') ||
                    text.includes('見つ') ||
                    text.includes('待')))
        );
    }

    private applyConsoleText(text: string): string[] {
        const lines: string[] = [];
        for (const ch of text) {
            if (ch === '\r' || ch === '\n') {
                if (this.consoleTail.length > 0) {
                    lines.push(this.consoleTail);
                }
                this.consoleTail = '';
            } else {
                this.consoleTail += ch;
            }
        }

        return lines;
    }

    private flushConsoleTail(): void {
        const tail = this.consoleTail;
        this.consoleTail = '';
        if (tail.length > 0) this.processConsoleLine(tail);
    }

    private processConsoleLine(rawLine: string): void {
        const line = rawLine.trim();
        if (line.length === 0) return;

        // A title such as "[100%]" is not an encode progress report.
        const percent = this.isMatchingConsoleText(line) ? null : this.parsePercent(line);
        this.status = {
            ...this.status,
            log: line,
            percent: percent ?? this.status.percent,
            isReadyForOutputScan: this.status.isReadyForOutputScan || (typeof percent === 'number' && percent >= 1),
            isPending: false,
            pendingMessage: null,
            updatedAt: Date.now(),
        };
        this.onUpdate(this.getStatus());
    }

    private isMatchingConsoleText(text: string): boolean {
        const normalizedText = path.normalize(text).toLowerCase();
        const normalizedInput = path.normalize(this.inputFilePath).toLowerCase();

        if (normalizedText.includes(normalizedInput) || text.includes(path.basename(this.inputFilePath))) {
            return true;
        }

        // Console updates use CP932 and replace unsupported characters, while queue updates arrive as UTF-8.
        const comparableTexts = this.getMatchingTextVariants(text);
        const comparableInputs = [
            ...this.getMatchingTextVariants(this.inputFilePath),
            ...this.getMatchingTextVariants(path.basename(this.inputFilePath)),
        ];

        return comparableTexts.some(comparableText =>
            comparableInputs.some(
                comparableInput => comparableInput.length > 0 && comparableText.includes(comparableInput),
            ),
        );
    }

    private isMatchingQueuePath(srcPath: string): boolean {
        const inputPaths = this.getUnicodePathVariants(this.inputFilePath);

        return this.getUnicodePathVariants(srcPath).some(value => inputPaths.includes(value));
    }

    private isMatchingQueueBasename(srcPath: string): boolean {
        const inputNames = this.getUnicodePathVariants(path.basename(this.inputFilePath));

        return this.getUnicodePathVariants(path.basename(srcPath)).some(value => inputNames.includes(value));
    }

    private getUnicodePathVariants(value: string): string[] {
        const normalized = path.normalize(value).toLowerCase();

        return [...new Set([normalized, normalized.normalize('NFC')])];
    }

    private getMatchingTextVariants(text: string): string[] {
        const normalized = path.normalize(text).toLowerCase();

        return [...new Set([normalized, normalized.normalize('NFC')].map(value => this.toCp932MatchingText(value)))];
    }

    private toCp932MatchingText(text: string): string {
        return iconv.decode(iconv.encode(text, 'cp932'), 'cp932').normalize('NFC');
    }

    private isInputPathCp932Lossless(): boolean {
        const normalizedInput = path.normalize(this.inputFilePath).normalize('NFC');

        return this.toCp932MatchingText(normalizedInput) === normalizedInput;
    }

    private parsePercent(line: string): number | null {
        const match = line.match(/(?:^|[\s[(])(\d+(?:\.\d+)?)\s*%/);
        if (match === null) {
            return null;
        }

        const percent = parseFloat(match[1]);
        if (Number.isNaN(percent) || percent < 0 || percent > 100) {
            return null;
        }

        return percent / 100;
    }

    private readTag(xml: string, name: string): string | undefined {
        return AmatsukazePushConnection.readTag(xml, name);
    }
}

@injectable()
class EncoderModel implements IEncoderModel {
    private log: ILogger;
    private configure: IConfiguration;
    private processManager: IEncodeProcessManageModel;
    private fileManager: IEncodeFileManageModel;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private channelDB: IChannelDB;
    private videoUtil: IVideoUtil;
    private encodeEvent: IEncodeEvent;
    private recodingUtil: IRecordingUtilModel;

    private listener: events.EventEmitter = new events.EventEmitter();

    private encodeOption: EncodeOption | null = null; // エンコード情報
    private childProcess: ChildProcess | null = null; // エンコードプロセス
    private timerId: NodeJS.Timeout | null = null; // タイムアウト検知用タイマーid
    private isCanceld: boolean = false; // キャンセルが呼び出されたか?
    private isFinished: boolean = false;
    private currentOutputFilePath: string | null = null;
    private progressInfo: EncodeProgressInfo | null = null;
    private amatsukazePushSubscription: AmatsukazePushSubscription | null = null;
    private encodingProgressBuffer: { stdout: string; stderr: string } = {
        stdout: '',
        stderr: '',
    };
    private lastEncoderMessage: string = '';
    private onAmatsukazeTaskMatched: ((taskId: number) => void) | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configure: IConfiguration,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IEncodeFileManageModel') fileManager: IEncodeFileManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IChannelDB') channelDB: IChannelDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
        @inject('IRecordingUtilModel') recodingUtil: IRecordingUtilModel,
    ) {
        this.log = logger.getLogger();
        this.configure = configure;
        this.processManager = processManager;
        this.fileManager = fileManager;
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.channelDB = channelDB;
        this.videoUtil = videoUtil;
        this.encodeEvent = encodeEvent;
        this.recodingUtil = recodingUtil;
    }

    /**
     * エンコードに必要な設定をセットする
     * @param encodeOption: EncodeOption
     */
    public setOption(encodeOption: EncodeOption): void {
        if (this.encodeOption !== null) {
            this.log.encode.error('encodeOption is not null');
            throw new Error('EncodeSetOptionError');
        }

        this.encodeOption = encodeOption;
    }

    /**
     * エンコード終了イベント登録
     * @param callback
     */
    public setOnFinish(
        callback: (
            isError: boolean,
            outputFilePath: string | null,
            isCanceled: boolean,
            encoderMessage?: string,
        ) => void,
    ): void {
        this.listener.once(
            EncoderModel.ENCODE_FINISH_EVENT,
            (isError: boolean, outputFilePath: string | null, isCanceled: boolean, encoderMessage?: string) => {
                callback(isError, outputFilePath, isCanceled, encoderMessage);
            },
        );
    }

    public setOnAmatsukazeTaskMatched(callback: (taskId: number) => void): void {
        this.onAmatsukazeTaskMatched = callback;
    }

    /**
     * エンコード開始
     */
    public async start(): Promise<void> {
        if (this.encodeOption === null) {
            this.log.encode.error('encodeOption is null');
            throw new Error('EncodeOptionIsNull');
        }

        // エンコード元ファイルの情報を取得
        const video = await this.videoFileDB.findId(this.encodeOption.sourceVideoFileId);
        if (video === null) {
            throw new Error('VideoFileIdIsNotFound');
        }

        // 番組情報を取得する
        const recorded = await this.recordedDB.findId(this.encodeOption.recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNotFound');
        }

        // 放送局情報を取得する
        const channel = await this.channelDB.findId(recorded.channelId);
        if (channel === null) {
            throw new Error('ChannelIsNotFound');
        }

        // ソースビデオファイルのファイルパスを生成する
        const inputFilePath = await this.videoUtil.getFullFilePathFromId(this.encodeOption.sourceVideoFileId);
        if (inputFilePath === null) {
            throw new Error('VideoPathIsNotFound');
        }

        // ソースビデオファイルの存在を確認
        try {
            await FileUtil.stat(inputFilePath);
        } catch (err: any) {
            this.log.encode.error(`video file is not found: ${inputFilePath}`);
            throw err;
        }

        const config = this.configure.getConfig();

        // エンコードコマンド設定を探す
        const encodeCmd = config.encode.find(enc => {
            return enc.name === this.encodeOption?.mode;
        });
        if (typeof encodeCmd === 'undefined') {
            throw new Error('EncodeCommandIsNotFound');
        }

        const amatsukazeConfig =
            encodeCmd.type === 'amatsukaze'
                ? this.getAmatsukazeConfig(config.amatsukaze, encodeCmd.amatsukaze)
                : undefined;

        // 出力先ディレクトリパスを取得する
        const outputDirPath =
            typeof encodeCmd.suffix === 'undefined'
                ? null
                : amatsukazeConfig?.outputDirMode === 'source'
                  ? path.dirname(inputFilePath)
                  : await this.getDirPath(this.encodeOption);

        // 出力先ディレクトリの存在確認 & 作成
        if (outputDirPath !== null) {
            try {
                await FileUtil.stat(outputDirPath);
            } catch (e: any) {
                // ディレクトリが存在しなければ作成する
                this.log.encode.info(`mkdirp: ${outputDirPath}`);
                await FileUtil.mkdir(outputDirPath);
            }
        }

        // 出力先をファイルパスを生成する
        let outputFilePath: string | null = null;
        if (outputDirPath !== null && typeof encodeCmd.suffix !== 'undefined') {
            if (typeof this.encodeOption.recoveryOutputFilePath === 'string') {
                outputFilePath = this.encodeOption.recoveryOutputFilePath;
                this.fileManager.reserveFilePath(outputFilePath);
            } else {
                outputFilePath = await this.fileManager.getFilePath(outputDirPath, inputFilePath, encodeCmd.suffix);
            }
        }
        this.currentOutputFilePath = outputFilePath;

        // DIR
        let dir: string = '';
        if (typeof encodeCmd.suffix === 'undefined' && typeof this.encodeOption.directory !== 'undefined') {
            dir = this.encodeOption.directory;
        } else if (outputFilePath !== null) {
            dir = outputFilePath;
        }

        // エンコード開始
        this.log.encode.info(
            `encode start. mode: ${this.encodeOption.mode} name: ${recorded.name} file: ${inputFilePath} -> ${outputFilePath}`,
        );
        this.log.encode.info(`encodeId: ${this.encodeOption.encodeId}`);
        this.log.encode.info(`encodeCmd.suffix: ${encodeCmd.suffix}`);
        this.log.encode.info(`queueItem.directory: ${this.encodeOption.directory}`);
        this.log.encode.info(`outputFilePath: ${outputFilePath}`);

        const amatsukazeOutputDir =
            outputFilePath !== null && typeof amatsukazeConfig !== 'undefined'
                ? this.getAmatsukazeOutputDir(amatsukazeConfig, inputFilePath, outputFilePath)
                : null;
        const amatsukazeServerInputFilePath =
            typeof amatsukazeConfig === 'undefined'
                ? inputFilePath
                : this.mapAmatsukazeServerPath(amatsukazeConfig, inputFilePath);
        const amatsukazeServerOutputDir =
            amatsukazeOutputDir === null || typeof amatsukazeConfig === 'undefined'
                ? null
                : this.mapAmatsukazeServerPath(amatsukazeConfig, amatsukazeOutputDir);
        const amatsukazeStartedAt = this.encodeOption.recoveryStartedAt ?? Date.now();
        if (typeof amatsukazeConfig !== 'undefined' && amatsukazeOutputDir !== null) {
            try {
                await FileUtil.stat(amatsukazeOutputDir);
            } catch (e: any) {
                this.log.encode.info(`mkdirp amatsukaze output: ${amatsukazeOutputDir}`);
                await FileUtil.mkdir(amatsukazeOutputDir);
            }
            if (this.encodeOption.restartInterruptedAmatsukaze === true && outputFilePath !== null) {
                this.progressInfo = {
                    percent: 0,
                    log: 'Amatsukazeの再起動前タスクをキャンセル中',
                };
                this.encodeEvent.emitUpdateEncodeProgress();
                void this.restartInterruptedAmatsukaze(
                    amatsukazeConfig,
                    inputFilePath,
                    outputFilePath,
                    amatsukazeOutputDir,
                    amatsukazeStartedAt,
                );
                return;
            }
            if (
                this.encodeOption.resumeExistingAmatsukaze !== true &&
                outputFilePath !== null &&
                typeof amatsukazeConfig.temporaryOutputDir !== 'undefined' &&
                amatsukazeConfig.temporaryOutputDir.length > 0 &&
                (amatsukazeConfig.outputNameMatch || 'exact') === 'exact'
            ) {
                const outputExtension = amatsukazeConfig.outputExtension || path.extname(outputFilePath);
                const candidatePath = this.getAmatsukazeExactOutputCandidatePath(
                    inputFilePath,
                    amatsukazeOutputDir,
                    outputExtension,
                );
                if ((await this.existsFile(candidatePath)) === true) {
                    throw new Error(`AmatsukazeTemporaryOutputAlreadyExists: ${candidatePath}`);
                }
            }
            this.startAmatsukazePushClient(amatsukazeConfig, amatsukazeServerInputFilePath);
        }

        if (
            this.encodeOption.resumeExistingAmatsukaze === true &&
            typeof amatsukazeConfig !== 'undefined' &&
            outputFilePath !== null &&
            amatsukazeOutputDir !== null
        ) {
            if ((await this.existsFile(outputFilePath)) === true) {
                void this.childEndProcessing(0, null, outputFilePath);
                return;
            }
            this.progressInfo = {
                percent: 0,
                log: 'Amatsukazeの既存タスクを確認中',
            };
            this.encodeEvent.emitUpdateEncodeProgress();
            void this.waitForAmatsukazeOutput(
                { ...amatsukazeConfig, pendingTimeoutSec: 0 },
                outputFilePath,
                inputFilePath,
                amatsukazeOutputDir,
                amatsukazeStartedAt,
            )
                .then(() => this.childEndProcessing(0, null, outputFilePath))
                .catch(async err => {
                    if (this.isCanceld === true || err?.message === 'AmatsukazeEncodeCanceled') {
                        await this.childEndProcessing(null, null, outputFilePath);
                        return;
                    }
                    this.lastEncoderMessage = err instanceof Error ? err.message : String(err);
                    await this.childEndProcessing(1, null, outputFilePath);
                });
            return;
        }

        // プロセスの生成
        this.childProcess = await this.processManager.create({
            input: typeof amatsukazeConfig === 'undefined' ? inputFilePath : amatsukazeServerInputFilePath,
            output:
                outputFilePath === null || typeof amatsukazeConfig === 'undefined'
                    ? outputFilePath
                    : this.mapAmatsukazeServerPath(amatsukazeConfig, outputFilePath),
            cmd: this.createEncodeCommand(encodeCmd.cmd, amatsukazeConfig),
            replace:
                amatsukazeOutputDir === null || typeof amatsukazeConfig === 'undefined'
                    ? undefined
                    : {
                          AMATSUKAZE_ADD_TASK: amatsukazeConfig.addTaskPath || '',
                          AMATSUKAZE_ROOT: amatsukazeConfig.root || '',
                          AMATSUKAZE_IP: amatsukazeConfig.ip || '127.0.0.1',
                          AMATSUKAZE_PORT: (amatsukazeConfig.port ?? 32768).toString(10),
                          AMATSUKAZE_OUTPUT_DIR: amatsukazeServerOutputDir,
                          AMATSUKAZE_PROFILE: amatsukazeConfig.profile || '',
                          AMATSUKAZE_PRIORITY: (amatsukazeConfig.priority ?? 3).toString(10),
                          AMATSUKAZE_PROC_MODE: amatsukazeConfig.procMode || 'auto',
                      },
            priority: EncoderModel.ENCODE_PRIPORITY,
            spawnOption: {
                env: {
                    ...process.env,
                    RECORDEDID: recorded.id.toString(10),
                    INPUT: inputFilePath,
                    OUTPUT: outputFilePath === null ? '' : outputFilePath,
                    DIR: dir,
                    SUBDIR: this.encodeOption.directory || '',
                    FFMPEG: config.ffmpeg,
                    FFPROBE: config.ffprobe,
                    NAME: recorded.name,
                    HALF_WIDTH_NAME: recorded.halfWidthName,
                    DESCRIPTION: recorded.description || '',
                    HALF_WIDTH_DESCRIPTION: recorded.halfWidthDescription || '',
                    EXTENDED: recorded.extended || '',
                    HALF_WIDTH_EXTENDED: recorded.halfWidthExtended || '',
                    VIDEOTYPE: recorded.videoType || '',
                    VIDEORESOLUTION: recorded.videoResolution || '',
                    VIDEOSTREAMCONTENT:
                        typeof recorded.videoStreamContent === 'number' ? recorded.videoStreamContent.toString(10) : '',
                    VIDEOCOMPONENTTYPE:
                        typeof recorded.videoComponentType === 'number' ? recorded.videoComponentType.toString(10) : '',
                    AUDIOSAMPLINGRATE:
                        typeof recorded.audioSamplingRate === 'number' ? recorded.audioSamplingRate.toString(10) : '',
                    AUDIOCOMPONENTTYPE:
                        typeof recorded.audioComponentType === 'number' ? recorded.audioComponentType.toString(10) : '',
                    CHANNELID: typeof recorded.channelId === 'number' ? recorded.channelId.toString(10) : '',
                    CHANNELNAME: typeof channel.name === 'string' ? channel.name : '',
                    HALF_WIDTH_CHANNELNAME: typeof channel.halfWidthName === 'string' ? channel.halfWidthName : '',
                    GENRE1: typeof recorded.genre1 === 'number' ? recorded.genre1.toString(10) : '',
                    SUBGENRE1: typeof recorded.subGenre1 === 'number' ? recorded.subGenre1.toString(10) : '',
                    GENRE2: typeof recorded.genre2 === 'number' ? recorded.genre2.toString(10) : '',
                    SUBGENRE2: typeof recorded.subGenre2 === 'number' ? recorded.subGenre2.toString(10) : '',
                    GENRE3: typeof recorded.genre3 === 'number' ? recorded.genre3.toString(10) : '',
                    SUBGENRE3: typeof recorded.subGenre3 === 'number' ? recorded.subGenre3.toString(10) : '',
                    START_AT: recorded.startAt.toString(10),
                    END_AT: recorded.endAt.toString(10),
                    DROPLOG_ID: recorded.dropLogFile?.id.toString(10) || '',
                    DROPLOG_PATH: recorded.dropLogFile?.filePath || '',
                    ERROR_CNT: recorded.dropLogFile?.errorCnt.toString(10) || '',
                    DROP_CNT: recorded.dropLogFile?.dropCnt.toString(10) || '',
                    SCRAMBLING_CNT: recorded.dropLogFile?.scramblingCnt.toString(10) || '',
                },
            },
        });

        // タイムアウト設定
        this.timerId = setTimeout(
            async () => {
                if (this.encodeOption === null) {
                    return;
                }

                this.log.encode.error(`encode process is time out: ${this.encodeOption.encodeId} ${outputFilePath}`);
                await this.cancel();
            },
            recorded.duration *
                (typeof encodeCmd.rate === 'undefined' ? EncoderModel.DEFAULT_TIMEOUT_RATE : encodeCmd.rate),
        );

        let encodeVideoInfo: VideoInfo | null = null;
        try {
            encodeVideoInfo = await this.videoUtil.getInfo(inputFilePath);
        } catch (err: any) {
            this.log.encode.error(`get encode vidoe file info: ${inputFilePath}`);
            this.log.encode.error(err);
        }

        /**
         * プロセスの設定
         */
        // debug 用
        if (this.childProcess.stderr !== null) {
            this.childProcess.stderr.on('data', data => {
                this.log.encode.debug(String(data));
                this.updateEncodingProgressInfo(data, encodeVideoInfo, 'stderr');
            });
            this.childProcess.stderr.once('end', () => {
                this.flushEncodingProgressSource('stderr', encodeVideoInfo);
            });
        }

        // 進捗情報更新用
        if (this.childProcess.stdout !== null) {
            {
                // エンコードプロセスの標準出力から進捗情報を取り出す
                this.childProcess.stdout.on('data', data => {
                    try {
                        this.updateEncodingProgressInfo(data, encodeVideoInfo, 'stdout');
                    } catch (err: any) {
                        // error
                    }
                });
                this.childProcess.stdout.once('end', () => {
                    this.flushEncodingProgressSource('stdout', encodeVideoInfo);
                });
            }
        }

        let hasHandledProcessExit = false;
        const handleProcessExit = async (code: number | null, signal: NodeJS.Signals | null): Promise<void> => {
            if (hasHandledProcessExit === true) {
                return;
            }
            hasHandledProcessExit = true;
            this.flushEncodingProgressInfo(encodeVideoInfo);

            if (
                code === 0 &&
                encodeCmd.type === 'amatsukaze' &&
                typeof amatsukazeConfig !== 'undefined' &&
                outputFilePath !== null &&
                amatsukazeOutputDir !== null
            ) {
                try {
                    await this.waitForAmatsukazeOutput(
                        amatsukazeConfig,
                        outputFilePath,
                        inputFilePath,
                        amatsukazeOutputDir,
                        amatsukazeStartedAt,
                    );
                } catch (err: any) {
                    if (this.isCanceld === true || err?.message === 'AmatsukazeEncodeCanceled') {
                        await this.childEndProcessing(null, signal, outputFilePath);

                        return;
                    }

                    this.log.encode.error(`amatsukaze output wait failed: ${this.encodeOption?.encodeId}`);
                    this.log.encode.error(err);
                    if (this.lastEncoderMessage.length === 0) {
                        this.lastEncoderMessage = err instanceof Error ? err.message : String(err);
                    }
                    await this.childEndProcessing(1, signal, outputFilePath);

                    return;
                }
            }
            await this.childEndProcessing(code, signal, outputFilePath);
        };

        // プロセス終了処理
        this.childProcess.on('exit', async (code, signal) => {
            await handleProcessExit(code, signal);
        });

        // プロセスの即時終了対応
        if (ProcessUtil.isExited(this.childProcess) === true) {
            // Amatsukaze の追加コマンドはすぐ終了するため、ここで出力待ちまで await すると
            // EncodeManageModel の queue 操作用ロックをエンコード完了まで占有してしまう。
            // 終了処理は継続させつつ start() 自体は返し、後続を待機 queue へ追加可能にする。
            void handleProcessExit(this.childProcess.exitCode, this.childProcess.signalCode).catch(err => {
                this.log.encode.error(`immediate encode process exit handling failed: ${this.encodeOption?.encodeId}`);
                this.log.encode.error(err);
            });
            this.childProcess.removeAllListeners();
        }
    }

    private getAmatsukazeConfig(
        common: AmatsukazeEncodeConfig | undefined,
        encode: AmatsukazeEncodeConfig | undefined,
    ): AmatsukazeEncodeConfig {
        const result = {
            ...(common || {}),
            ...(encode || {}),
        };

        if (typeof result.addTaskPath === 'undefined' || result.addTaskPath.length === 0) {
            throw new Error('AmatsukazeAddTaskPathIsNotFound');
        }
        if (typeof result.root === 'undefined' || result.root.length === 0) {
            throw new Error('AmatsukazeRootIsNotFound');
        }
        if (typeof result.profile === 'undefined' || result.profile.length === 0) {
            throw new Error('AmatsukazeProfileIsNotFound');
        }

        return result;
    }

    private startAmatsukazePushClient(amatsukaze: AmatsukazeEncodeConfig, inputFilePath: string): void {
        this.stopAmatsukazePushClient();
        const host = amatsukaze.ip || '127.0.0.1';
        const port = amatsukaze.port ?? 32768;
        this.amatsukazePushSubscription = AmatsukazePushConnection.subscribe(
            host,
            port,
            inputFilePath,
            this.encodeOption?.amatsukazeTaskId ?? null,
            this.encodeOption?.resumeExistingAmatsukaze === true,
            status => this.updateAmatsukazePushProgress(status),
            taskId => {
                if (this.encodeOption !== null) this.encodeOption.amatsukazeTaskId = taskId;
                this.onAmatsukazeTaskMatched?.(taskId);
            },
            message => this.log.encode.info(message),
        );
    }

    private async restartInterruptedAmatsukaze(
        amatsukaze: AmatsukazeEncodeConfig,
        inputFilePath: string,
        outputFilePath: string,
        amatsukazeOutputDir: string,
        startedAt: number,
    ): Promise<void> {
        const host = amatsukaze.ip || '127.0.0.1';
        const port = amatsukaze.port ?? 32768;
        while (this.isCanceld === false) {
            try {
                await AmatsukazePushConnection.cancelUnfinishedTasks(host, port, message =>
                    this.log.encode.info(message),
                );
                if (this.isCanceld) return;
                await this.deleteInterruptedAmatsukazeOutput(
                    amatsukaze,
                    inputFilePath,
                    outputFilePath,
                    amatsukazeOutputDir,
                    startedAt,
                );
                break;
            } catch (err: any) {
                this.lastEncoderMessage = err instanceof Error ? err.message : String(err);
                if (this.lastEncoderMessage.startsWith('UnsafeAmatsukazeOutputDeletion:')) {
                    this.log.encode.error(this.lastEncoderMessage);
                    await this.childEndProcessing(1, null, outputFilePath);
                    return;
                }
                this.progressInfo = {
                    percent: 0,
                    log: 'Amatsukazeの再起動復旧を再試行中',
                };
                this.encodeEvent.emitUpdateEncodeProgress();
                this.log.encode.warn(`amatsukaze restart recovery retry: ${this.lastEncoderMessage}`);
                await new Promise(resolve => setTimeout(resolve, 5_000));
            }
        }
        if (this.isCanceld || this.encodeOption === null) return;

        delete this.encodeOption.restartInterruptedAmatsukaze;
        delete this.encodeOption.resumeExistingAmatsukaze;
        delete this.encodeOption.amatsukazeTaskId;
        this.encodeOption.recoveryStartedAt = Date.now();
        this.log.encode.info(`re-submit interrupted Amatsukaze task: ${this.encodeOption.encodeId}`);

        try {
            await this.start();
        } catch (err: any) {
            this.lastEncoderMessage = err instanceof Error ? err.message : String(err);
            this.log.encode.error(`re-submit interrupted Amatsukaze task failed: ${this.encodeOption.encodeId}`);
            this.log.encode.error(err);
            await this.childEndProcessing(1, null, this.currentOutputFilePath);
        }
    }

    private async deleteInterruptedAmatsukazeOutput(
        amatsukaze: AmatsukazeEncodeConfig,
        inputFilePath: string,
        outputFilePath: string,
        outputDirPath: string,
        startedAt: number,
    ): Promise<void> {
        const outputExtension = (amatsukaze.outputExtension || path.extname(outputFilePath)).toLowerCase();
        const candidate = await this.findAmatsukazeOutputCandidate(
            inputFilePath,
            outputFilePath,
            outputDirPath,
            outputExtension,
            amatsukaze.outputNameMatch || 'exact',
            startedAt,
            false,
            false,
        );
        if (candidate === null) return;
        if (await this.isSameFile(candidate.path, inputFilePath)) {
            throw new Error(`UnsafeAmatsukazeOutputDeletion: source file ${candidate.path}`);
        }
        if (['.ts', '.m2ts', '.mts'].includes(path.extname(candidate.path).toLowerCase())) {
            throw new Error(`UnsafeAmatsukazeOutputDeletion: transport stream ${candidate.path}`);
        }

        this.log.encode.warn(`delete interrupted Amatsukaze output: ${candidate.path}`);
        await FileUtil.unlink(candidate.path);
    }

    private async isSameFile(firstPath: string, secondPath: string): Promise<boolean> {
        const normalize = (value: string): string => path.resolve(value).normalize('NFC').toLowerCase();
        if (normalize(firstPath) === normalize(secondPath)) return true;

        try {
            const [firstRealPath, secondRealPath] = await Promise.all([
                fs.promises.realpath(firstPath),
                fs.promises.realpath(secondPath),
            ]);
            return normalize(firstRealPath) === normalize(secondRealPath);
        } catch (err: any) {
            return false;
        }
    }

    private stopAmatsukazePushClient(): void {
        if (this.amatsukazePushSubscription === null) {
            return;
        }

        this.amatsukazePushSubscription.stop();
        this.amatsukazePushSubscription = null;
    }

    private updateAmatsukazePushProgress(status: AmatsukazePushStatus): void {
        if (status.log === null && status.percent === null) {
            return;
        }
        if (status.log !== null && status.log.trim().length > 0) {
            this.lastEncoderMessage = status.log.trim();
        }

        this.progressInfo = {
            percent:
                status.percent !== null && Number.isNaN(status.percent) === false
                    ? Math.max(0, Math.min(1, status.percent))
                    : (this.progressInfo?.percent ?? 0),
            log: status.log !== null ? `Amatsukaze: ${status.log}` : (this.progressInfo?.log ?? 'Amatsukaze'),
        };
        this.encodeEvent.emitUpdateEncodeProgress();
    }

    private getAmatsukazeOutputDir(
        amatsukaze: AmatsukazeEncodeConfig,
        inputFilePath: string,
        outputFilePath: string,
    ): string {
        const sourceDir = path.dirname(inputFilePath);
        const outputDir = path.dirname(outputFilePath);

        if (typeof amatsukaze.temporaryOutputDir !== 'undefined' && amatsukaze.temporaryOutputDir.length > 0) {
            return this.replaceAmatsukazeOutputDirVariables(amatsukaze.temporaryOutputDir, sourceDir, outputDir);
        }

        if (typeof amatsukaze.outputDir !== 'undefined' && amatsukaze.outputDir.length > 0) {
            return this.replaceAmatsukazeOutputDirVariables(amatsukaze.outputDir, sourceDir, outputDir);
        }

        return amatsukaze.outputDirMode === 'source' ? sourceDir : outputDir;
    }

    private replaceAmatsukazeOutputDirVariables(value: string, sourceDir: string, outputDir: string): string {
        return value.replace(/%SOURCE_DIR%/g, sourceDir).replace(/%OUTPUT_DIR%/g, outputDir);
    }

    private mapAmatsukazeServerPath(amatsukaze: AmatsukazeEncodeConfig, localPath: string): string {
        const mappings = amatsukaze.pathMappings ?? [];
        const resolvedLocalPath = path.resolve(localPath);
        let matched: { from: string; to: string; relative: string } | null = null;

        for (const mapping of mappings) {
            if (
                typeof mapping.from !== 'string' ||
                mapping.from.length === 0 ||
                typeof mapping.to !== 'string' ||
                mapping.to.length === 0
            ) {
                continue;
            }

            const resolvedFrom = path.resolve(mapping.from);
            const relative = path.relative(resolvedFrom, resolvedLocalPath);
            const isInside =
                relative.length === 0 ||
                (relative !== '..' &&
                    relative.startsWith(`..${path.sep}`) === false &&
                    path.isAbsolute(relative) === false);
            if (isInside === false || (matched !== null && resolvedFrom.length <= matched.from.length)) continue;

            matched = {
                from: resolvedFrom,
                to: mapping.to,
                relative,
            };
        }

        if (matched === null) return localPath;
        if (matched.relative.length === 0) return matched.to;

        const isWindowsTarget = /^[a-zA-Z]:[\\/]/.test(matched.to) || /^\\\\/.test(matched.to);
        const targetPath = isWindowsTarget ? path.win32 : path.posix;
        return targetPath.join(matched.to, ...matched.relative.split(path.sep));
    }

    private createEncodeCommand(cmd: string | undefined, amatsukaze: AmatsukazeEncodeConfig | undefined): string {
        if (typeof amatsukaze === 'undefined') {
            if (typeof cmd === 'undefined' || cmd.length === 0) {
                throw new Error('EncodeCommandIsNotFound');
            }

            return cmd;
        }

        if (typeof cmd !== 'undefined' && cmd.length > 0) {
            return cmd;
        }

        const args = [
            amatsukaze.addTaskPath || '',
            '-r',
            '%AMATSUKAZE_ROOT%',
            '-f',
            '%INPUT%',
            '-ip',
            '%AMATSUKAZE_IP%',
            '-p',
            '%AMATSUKAZE_PORT%',
            '-o',
            '%AMATSUKAZE_OUTPUT_DIR%',
            '-s',
            '%AMATSUKAZE_PROFILE%',
            '--priority',
            '%AMATSUKAZE_PRIORITY%',
            '--proc-mode',
            '%AMATSUKAZE_PROC_MODE%',
        ];

        if (amatsukaze.noMove !== false) {
            args.push('--no-move');
        }

        return args.join(' ');
    }

    private async waitForAmatsukazeOutput(
        amatsukaze: AmatsukazeEncodeConfig,
        outputFilePath: string,
        inputFilePath: string,
        outputDirPath: string,
        startedAt: number,
    ): Promise<void> {
        if (amatsukaze.waitForOutput === false) {
            return;
        }

        const waitIntervalMs = (amatsukaze.waitIntervalSec ?? 10) * 1000;
        const finishDelayMs = (amatsukaze.finishDelaySec ?? 30) * 1000;
        const stableMs = (amatsukaze.stableSec ?? 30) * 1000;
        const pendingTimeoutMs =
            typeof amatsukaze.pendingTimeoutSec === 'number' && amatsukaze.pendingTimeoutSec <= 0
                ? 0
                : (amatsukaze.pendingTimeoutSec ?? 300) * 1000;
        const outputExtension = (amatsukaze.outputExtension || path.extname(outputFilePath)).toLowerCase();
        let candidate: AmatsukazeOutputCandidate | null = null;
        let pendingSince: number | null = null;
        let isReadyForOutputScan = false;

        this.log.encode.info(`wait amatsukaze output: ${outputFilePath}`);
        if ((amatsukaze.outputNameMatch || 'exact') === 'exact') {
            this.log.encode.info(
                `amatsukaze exact output candidate: ${this.getAmatsukazeExactOutputCandidatePath(
                    inputFilePath,
                    outputDirPath,
                    outputExtension,
                )}`,
            );
        }

        while (this.isCanceld === false) {
            const pushStatus = this.amatsukazePushSubscription?.getStatus();
            const requiresOutputReconcile = pushStatus?.requiresOutputReconcile === true;
            if (typeof pushStatus !== 'undefined') {
                if (pushStatus.errorMessage !== null) {
                    throw new Error(`Amatsukaze encode failed: ${pushStatus.errorMessage}`);
                }
                isReadyForOutputScan = isReadyForOutputScan || pushStatus.isReadyForOutputScan;
                if (pushStatus.isPending === true) {
                    if (pendingSince === null) {
                        pendingSince = Date.now();
                        this.log.encode.warn(
                            `amatsukaze task pending: ${pushStatus.pendingMessage || path.basename(inputFilePath)}`,
                        );
                    }
                    this.progressInfo = {
                        percent: this.progressInfo?.percent ?? 0,
                        log: `Amatsukaze pending: ${pushStatus.pendingMessage || path.basename(inputFilePath)}`,
                    };
                    this.encodeEvent.emitUpdateEncodeProgress();

                    if (pendingTimeoutMs > 0 && Date.now() - pendingSince >= pendingTimeoutMs) {
                        this.log.encode.warn(
                            `cancel amatsukaze pending task: ${this.amatsukazePushSubscription?.getTaskId()}`,
                        );
                        this.isCanceld = true;
                        await this.cancelAmatsukazeTask().catch(err => {
                            this.log.encode.warn(`cancel amatsukaze pending task failed: ${err.message || err}`);
                        });
                        throw new Error('AmatsukazeEncodeCanceled');
                    }
                } else {
                    pendingSince = null;
                }
            }

            if (isReadyForOutputScan === true || requiresOutputReconcile) {
                if (requiresOutputReconcile === false && (await this.existsFile(outputFilePath)) === true) {
                    this.log.encode.info(`amatsukaze output found: ${outputFilePath}`);
                    await Util.sleep(finishDelayMs);

                    return;
                }

                const ignoreStartedAt =
                    this.encodeOption?.resumeExistingAmatsukaze === true ||
                    (typeof amatsukaze.temporaryOutputDir !== 'undefined' && amatsukaze.temporaryOutputDir.length > 0);
                const directOutput = requiresOutputReconcile
                    ? await this.getAmatsukazeOutputCandidate(outputFilePath, startedAt, ignoreStartedAt)
                    : null;
                const found =
                    directOutput ??
                    (await this.findAmatsukazeOutputCandidate(
                        inputFilePath,
                        outputFilePath,
                        outputDirPath,
                        outputExtension,
                        amatsukaze.outputNameMatch || 'exact',
                        startedAt,
                        ignoreStartedAt,
                    ));

                if (found !== null) {
                    if (
                        candidate !== null &&
                        candidate.path === found.path &&
                        candidate.size === found.size &&
                        candidate.mtimeMs === found.mtimeMs
                    ) {
                        if (Date.now() - candidate.stableSince >= stableMs) {
                            if (found.path !== outputFilePath) {
                                await this.moveAmatsukazeOutput(found.path, outputFilePath);
                            } else {
                                this.log.encode.info(`amatsukaze reconciled completed output: ${outputFilePath}`);
                            }
                            await Util.sleep(finishDelayMs);

                            return;
                        }
                    } else {
                        candidate = {
                            path: found.path,
                            size: found.size,
                            mtimeMs: found.mtimeMs,
                            stableSince: Date.now(),
                        };
                    }
                }
            }

            if (this.progressInfo === null) {
                this.progressInfo = {
                    percent: 0,
                    log: `waiting for Amatsukaze output: ${path.basename(outputFilePath)}`,
                };
                this.encodeEvent.emitUpdateEncodeProgress();
            }
            await Util.sleep(waitIntervalMs);
        }

        throw new Error('AmatsukazeEncodeCanceled');
    }

    private async existsFile(filePath: string): Promise<boolean> {
        try {
            const stats = await FileUtil.stat(filePath);

            return stats.isFile();
        } catch (err: any) {
            return false;
        }
    }

    private async findAmatsukazeOutputCandidate(
        inputFilePath: string,
        outputFilePath: string,
        outputDirPath: string,
        outputExtension: string,
        outputNameMatch: 'exact' | 'prefix',
        startedAt: number,
        ignoreStartedAt: boolean,
        excludeOutputFile: boolean = true,
    ): Promise<{ path: string; size: number; mtimeMs: number } | null> {
        const inputBaseName = path.basename(inputFilePath, path.extname(inputFilePath));

        if (outputNameMatch === 'exact') {
            const expectedPath = this.getAmatsukazeExactOutputCandidatePath(
                inputFilePath,
                outputDirPath,
                outputExtension,
            );
            if (excludeOutputFile && expectedPath === outputFilePath) {
                return null;
            }

            return this.getAmatsukazeOutputCandidate(expectedPath, startedAt, ignoreStartedAt);
        }

        const files = await FileUtil.readDir(outputDirPath);
        const candidates: { path: string; size: number; mtimeMs: number }[] = [];

        for (const file of files) {
            if (path.extname(file).toLowerCase() !== outputExtension) {
                continue;
            }

            const outputBaseName = path.basename(file, path.extname(file));
            if (
                outputBaseName
                    .normalize('NFC')
                    .toLowerCase()
                    .startsWith(inputBaseName.normalize('NFC').toLowerCase()) === false
            ) {
                continue;
            }

            const filePath = path.join(outputDirPath, file);
            if (excludeOutputFile && filePath === outputFilePath) {
                continue;
            }

            try {
                const stats = await FileUtil.stat(filePath);
                if (stats.isFile() === false || (ignoreStartedAt === false && stats.mtimeMs < startedAt - 5000)) {
                    continue;
                }
                candidates.push({
                    path: filePath,
                    size: stats.size,
                    mtimeMs: stats.mtimeMs,
                });
            } catch (err: any) {
                // skip transient files
            }
        }

        candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);

        return candidates.length === 0 ? null : candidates[0];
    }

    private getAmatsukazeExactOutputCandidatePath(
        inputFilePath: string,
        outputDirPath: string,
        outputExtension: string,
    ): string {
        const inputBaseName = path.basename(inputFilePath, path.extname(inputFilePath));

        return path.join(outputDirPath, `${inputBaseName}${outputExtension}`);
    }

    private async getAmatsukazeOutputCandidate(
        filePath: string,
        startedAt: number,
        ignoreStartedAt: boolean,
    ): Promise<{ path: string; size: number; mtimeMs: number } | null> {
        try {
            const stats = await FileUtil.stat(filePath);
            if (stats.isFile() === false || (ignoreStartedAt === false && stats.mtimeMs < startedAt - 5000)) {
                return null;
            }

            return {
                path: filePath,
                size: stats.size,
                mtimeMs: stats.mtimeMs,
            };
        } catch (err: any) {
            return null;
        }
    }

    private async moveAmatsukazeOutput(sourcePath: string, outputFilePath: string): Promise<void> {
        this.log.encode.info(`move amatsukaze output: ${sourcePath} -> ${outputFilePath}`);
        try {
            await FileUtil.rename(sourcePath, outputFilePath);
        } catch (err: any) {
            this.log.encode.info(`rename amatsukaze output failed; copy instead: ${err.message || err}`);
            await FileUtil.move(sourcePath, outputFilePath);
        }
    }

    /**
     * queueItem で指定された dir パスを取得する
     * @param queueItem: EncodeOption
     * @return string
     */
    private async getDirPath(queueItem: EncodeOption): Promise<string> {
        const parentDir = this.videoUtil.getParentDirPath(queueItem.parentDir);
        if (parentDir === null) {
            this.log.encode.error(`parent dir config is not found: ${queueItem.parentDir}`);
            throw new Error('parentDirIsNotFound');
        }

        if (typeof queueItem.directory !== 'undefined' && queueItem.directory.length > 0) {
            const recorded = await this.recordedDB.findId(queueItem.recordedId);
            if (recorded !== null) {
                queueItem.directory = await this.recodingUtil.formatFilePathString(queueItem.directory, recorded);
            }
        }

        return typeof queueItem.directory === 'undefined' ? parentDir : path.join(parentDir, queueItem.directory);
    }

    /**
     * エンコード進捗情報更新
     * @param data: エンコードプロセスの標準出力
     * @param encodeId: apid.EncodeId
     */
    private updateEncodingProgressInfo(data: any, videoInfo: VideoInfo | null, source: 'stdout' | 'stderr'): void {
        if (this.encodeOption === null) {
            return;
        }

        const text = this.encodingProgressBuffer[source] + String(data);
        const lines = text.split(/\r\n|\n|\r/);
        this.encodingProgressBuffer[source] = lines.pop() || '';

        for (const rawLine of lines) {
            this.processEncodingProgressLine(rawLine, videoInfo);
        }
    }

    private flushEncodingProgressInfo(videoInfo: VideoInfo | null): void {
        for (const source of ['stdout', 'stderr'] as const) {
            this.flushEncodingProgressSource(source, videoInfo);
        }
    }

    private flushEncodingProgressSource(source: 'stdout' | 'stderr', videoInfo: VideoInfo | null): void {
        const tail = this.encodingProgressBuffer[source];
        this.encodingProgressBuffer[source] = '';
        if (tail.length > 0) this.processEncodingProgressLine(tail, videoInfo);
    }

    private processEncodingProgressLine(rawLine: string, videoInfo: VideoInfo | null): void {
        const line = rawLine.trim();
        if (line.length === 0) return;
        this.lastEncoderMessage = line;

        const progress = this.parseEncodingProgressLine(line, videoInfo);
        if (progress === null) return;
        this.progressInfo = progress;
        this.encodeEvent.emitUpdateEncodeProgress();
    }

    private parseEncodingProgressLine(line: string, videoInfo: VideoInfo | null): EncodeProgressInfo | null {
        const jsonProgress = this.parseJsonEncodingProgressLine(line);
        if (jsonProgress !== null) {
            return jsonProgress;
        }

        const percentProgress = this.parsePercentEncodingProgressLine(line);
        if (percentProgress !== null) {
            return percentProgress;
        }

        return this.parseTimeEncodingProgressLine(line, videoInfo);
    }

    private parseJsonEncodingProgressLine(line: string): EncodeProgressInfo | null {
        try {
            const log = JSON.parse(line);
            this.log.encode.debug(log);
            if (log.type === 'progress' && typeof log.percent === 'number' && typeof log.log === 'string') {
                return {
                    percent: Math.max(0, Math.min(1, log.percent)),
                    log: log.log,
                };
            }
        } catch (err: any) {
            // skip non JSON encoder output
        }

        return null;
    }

    private parsePercentEncodingProgressLine(line: string): EncodeProgressInfo | null {
        const match = line.match(/(?:^|[\s[(])(\d+(?:\.\d+)?)\s*%/);
        if (match === null) {
            return null;
        }

        const percent = parseFloat(match[1]);
        if (Number.isNaN(percent) || percent < 0 || percent > 100) {
            return null;
        }

        return {
            percent: percent / 100,
            log: line,
        };
    }

    private parseTimeEncodingProgressLine(line: string, videoInfo: VideoInfo | null): EncodeProgressInfo | null {
        if (videoInfo === null || videoInfo.duration <= 0) {
            return null;
        }

        const match = line.match(/time=\s*(\d+:\d+:\d+(?:\.\d+)?)/);
        if (match === null) {
            return null;
        }

        const current = this.parseDurationText(match[1]);
        if (current === null) {
            return null;
        }

        return {
            percent: Math.max(0, Math.min(1, current / videoInfo.duration)),
            log: line,
        };
    }

    private parseDurationText(text: string): number | null {
        const times = text.split(':');
        if (times.length !== 3) {
            return null;
        }

        const hour = parseFloat(times[0]);
        const minute = parseFloat(times[1]);
        const second = parseFloat(times[2]);
        if (Number.isNaN(hour) || Number.isNaN(minute) || Number.isNaN(second)) {
            return null;
        }

        return hour * 3600 + minute * 60 + second;
    }

    /**
     * エンコードプロセス終了処理
     * @param code number | null
     * @param signal NodeJS.Signals | null
     * @param outputFilePath 出力先をファイルパス
     * @param queueItem EncodeQueueItem
     */
    private async childEndProcessing(
        code: number | null,
        signal: NodeJS.Signals | null,
        outputFilePath: string | null,
    ): Promise<void> {
        if (this.isFinished === true) {
            return;
        }
        this.isFinished = true;

        // exit code
        this.log.encode.info(`exit code: ${code}, signal: ${signal}`);

        // タイムアウトタイマークリア
        if (this.timerId !== null) {
            clearTimeout(this.timerId);
        }
        this.stopAmatsukazePushClient();

        // ファイルパスの登録を削除
        if (outputFilePath !== null) {
            this.fileManager.release(outputFilePath);
        }

        if (this.encodeOption === null) {
            this.log.encode.error('encodeOptionIsNull');

            return;
        }

        let isError = true;
        if (this.isCanceld === true) {
            // キャンセルされた
            this.log.encode.info(`canceld encode: ${this.encodeOption.encodeId}`);
        } else if (code !== 0) {
            // エンコードが正常終了しなかった
            this.log.encode.error(`encode failed: ${this.encodeOption.encodeId} ${outputFilePath}`);
        } else {
            // エンコード正常終了
            this.log.encode.info(`Successfully encod: ${this.encodeOption.encodeId} ${outputFilePath}`);

            isError = false;
        }

        if (isError === true) {
            // 出力ファイルを削除
            if (outputFilePath !== null && (await this.existsFile(outputFilePath)) === true) {
                this.log.encode.info(`delete encode output file: ${outputFilePath}`);
                await Util.sleep(1000);

                await FileUtil.unlink(outputFilePath).catch(err => {
                    if (err?.code === 'ENOENT') {
                        return;
                    }
                    this.log.encode.error(`delete encode output file failed: ${outputFilePath}`);
                    this.log.encode.error(err);
                });
            }
        }

        // エンコードプロセスの終了を通知
        this.listener.emit(
            EncoderModel.ENCODE_FINISH_EVENT,
            isError,
            outputFilePath,
            this.isCanceld,
            this.lastEncoderMessage,
        );
        this.listener.removeAllListeners();
    }

    /**
     * キャンセル処理
     */
    public async cancel(): Promise<void> {
        if (this.encodeOption === null) {
            return;
        }

        this.log.encode.info(`cancel encode: ${this.encodeOption.encodeId}`);
        this.isCanceld = true;
        await this.cancelAmatsukazeTask().catch(err => {
            this.log.encode.warn(`cancel amatsukaze task failed: ${err.message || err}`);
        });

        // プロセスが実行されていれば削除する
        if (this.childProcess === null || ProcessUtil.isExited(this.childProcess) === true) {
            await this.childEndProcessing(null, null, this.currentOutputFilePath);
        } else {
            this.log.encode.info(
                `kill encode process encodeId: ${this.encodeOption.encodeId}, pid: ${this.childProcess.pid}`,
            );

            await ProcessUtil.kill(this.childProcess).catch(err => {
                this.log.encode.error(`kill encode process failed: ${this.encodeOption?.encodeId}`);
                this.log.encode.error(err);
            });
        }
    }

    /**
     * セットされたエンコードオプションを返す
     * @returns EncodeOption | null
     */
    private async cancelAmatsukazeTask(): Promise<void> {
        if (this.amatsukazePushSubscription === null) {
            return;
        }

        const taskId = this.amatsukazePushSubscription.getTaskId();
        const isCanceled = await this.amatsukazePushSubscription.cancelTask();
        if (isCanceled === true) {
            this.log.encode.info(`cancel amatsukaze task by push: ${taskId}`);
        } else {
            this.log.encode.warn('cancel amatsukaze task by push skipped: task id is not resolved');
        }
    }

    public getEncodeOption(): EncodeOption | null {
        return this.encodeOption;
    }

    /**
     * エンコードの進捗情報を返す
     * @returns EncodeProgressInfo | null
     */
    public getProgressInfo(): EncodeProgressInfo | null {
        return this.progressInfo;
    }

    /**
     * encodeId を返す
     * @returns apid.EncodeId | null
     */
    public getEncodeId(): apid.EncodeId | null {
        return this.encodeOption === null ? null : this.encodeOption.encodeId;
    }

    public getOutputFilePath(): string | null {
        return this.currentOutputFilePath;
    }
}

namespace EncoderModel {
    export const ENCODE_FINISH_EVENT = 'encodeFinishEvent';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
}

export default EncoderModel;
