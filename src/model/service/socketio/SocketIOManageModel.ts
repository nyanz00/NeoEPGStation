import * as http from 'http';
import { inject, injectable } from 'inversify';
import * as SocketIO from 'socket.io';
import urljoin from 'url-join';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import ISocketIOManageModel, { RecordedPlaybackHistoryUpdate } from './ISocketIOManageModel';

@injectable()
export default class SocketIOManageModel implements ISocketIOManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private ios: SocketIO.Server[] = [];
    private callTimer: NodeJS.Timeout | null = null;
    private encodeProgressCallTimer: NodeJS.Timeout | null = null;
    private isClientNotificationPending: boolean = false;
    private isEncodeNotificationPending: boolean = false;
    private historyRecordedIds = new Set<number>();

    constructor(@inject('ILoggerModel') logger: ILoggerModel, @inject('IConfiguration') configuration: IConfiguration) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
    }

    /**
     * socket.io 初期化
     * @param servers: http.Server[]
     */
    public initialize(servers: http.Server[]): void {
        for (const s of servers) {
            this.ios.push(
                new SocketIO.Server(s, {
                    path:
                        typeof this.config.subDirectory === 'undefined'
                            ? '/socket.io'
                            : urljoin(this.config.subDirectory, '/socket.io'),
                    cors: {
                        origin: '*',
                    },
                }),
            );
        }

        if (servers.length > 0) {
            this.log.system.info('SocketIO Server has started.');
            this.scheduleClientNotification();
            this.scheduleEncodeNotification();
        }
    }

    /**
     * client へ状態変更通知
     */
    public notifyClient(recordedId?: number): void {
        this.isClientNotificationPending = true;
        if (typeof recordedId === 'number' && Number.isSafeInteger(recordedId) && recordedId > 0) {
            this.historyRecordedIds.add(recordedId);
        }
        this.scheduleClientNotification();
    }

    public notifyRecordedPlaybackHistory(userId: number, settings = false): void {
        const update: RecordedPlaybackHistoryUpdate = { userId, settings };
        for (const io of this.ios) io.sockets.emit('updateRecordedPlaybackHistory', update);
    }

    /**
     * エンコードの進捗情報更新を通知
     */
    public notifyUpdateEncodeProgress(): void {
        this.isEncodeNotificationPending = true;
        this.scheduleEncodeNotification();
    }

    private scheduleClientNotification(): void {
        if (this.ios.length === 0 || this.isClientNotificationPending === false || this.callTimer !== null) {
            return;
        }

        this.callTimer = setTimeout(() => {
            this.callTimer = null;
            if (this.ios.length === 0 || this.isClientNotificationPending === false) {
                return;
            }
            this.isClientNotificationPending = false;
            const recordedIds = [...this.historyRecordedIds];
            this.historyRecordedIds.clear();
            for (const io of this.ios) {
                io.sockets.emit('updateStatus');
                if (recordedIds.length > 0) {
                    io.sockets.emit('updateRecordedPlaybackHistory', {
                        recordedIds,
                    } satisfies RecordedPlaybackHistoryUpdate);
                }
            }
        }, 200);
    }

    private scheduleEncodeNotification(): void {
        if (
            this.ios.length === 0 ||
            this.isEncodeNotificationPending === false ||
            this.encodeProgressCallTimer !== null
        ) {
            return;
        }

        this.encodeProgressCallTimer = setTimeout(() => {
            this.encodeProgressCallTimer = null;
            if (this.ios.length === 0 || this.isEncodeNotificationPending === false) {
                return;
            }
            this.isEncodeNotificationPending = false;
            for (const io of this.ios) {
                io.sockets.emit('updateEncode');
            }
        }, 200);
    }
}
