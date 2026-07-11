import { inject, injectable } from 'inversify';
import * as socketIo from 'socket.io-client';
import Util from '../../util/Util';
import IServerConfigModel from '../serverConfig/IServerConfigModel';
import ISocketIOModel from './ISocketIOModel';

@injectable()
class SocketIOModel implements ISocketIOModel {
    private serverConfiModel: IServerConfigModel;
    private io: socketIo.Socket | null = null;
    private updateStateCallbacks: Array<() => void> = [];
    private updateEncodeStateCallbacks: Array<() => void> = [];

    constructor(@inject('IServerConfigModel') serverConfiModel: IServerConfigModel) {
        this.serverConfiModel = serverConfiModel;
    }

    /**
     * SokcetIO 初期設定
     */
    public Iinitialize(): void {
        const config = this.serverConfiModel.getConfig();
        if (config === null || this.io !== null) {
            throw new Error('InitializationSocketIOError');
        }

        this.io = this.createSocket(config.socketIOPort);
    }

    /**
     * 設定済み socketIO をのインスタを返す
     */
    public getIO(): socketIo.Socket | null {
        return this.io;
    }

    /**
     * update status イベントへのコールバック追加
     * @param callback: () => void
     */
    public onUpdateState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        if (this.updateStateCallbacks.indexOf(callback) === -1) {
            this.updateStateCallbacks.push(callback);
        }
        this.io.on(SocketIOModel.UPDATE_STATUS_EVENT, callback);
    }

    /**
     * update status イベントへのコールバック削除
     * @param callback: () => void
     */
    public offUpdateState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        this.updateStateCallbacks = this.updateStateCallbacks.filter(c => c !== callback);
        this.io.off(SocketIOModel.UPDATE_STATUS_EVENT, callback);
    }

    /**
     * update encode status イベントへのコールバック追加
     * @param callback: () => void
     */
    public onUpdateEncodeState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        if (this.updateEncodeStateCallbacks.indexOf(callback) === -1) {
            this.updateEncodeStateCallbacks.push(callback);
        }
        this.io.on(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
    }

    /**
     * update encode status イベントへのコールバック削除
     * @param callback: () => void
     */
    public offUpdateEncodeState(callback: () => void): void {
        if (this.io === null) {
            throw new Error('IOIsNull');
        }

        this.updateEncodeStateCallbacks = this.updateEncodeStateCallbacks.filter(c => c !== callback);
        this.io.off(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
    }

    private createSocket(socketIOPort: number): socketIo.Socket {
        const socketIOUrl = this.getSocketIOUrl(socketIOPort);
        const socketIOOption = {
            path: `${Util.getSubDirectory()}/socket.io`,
            timeout: 3000,
        };
        const io = typeof socketIOUrl === 'undefined' ? socketIo.io(socketIOOption) : socketIo.io(socketIOUrl, socketIOOption);

        if (typeof socketIOUrl !== 'undefined') {
            io.once('connect_error', () => {
                if (this.io !== io) {
                    return;
                }

                io.close();
                this.io = socketIo.io(socketIOOption);
                this.bindCallbacks(this.io);
            });
        }

        return io;
    }

    private bindCallbacks(io: socketIo.Socket): void {
        for (const callback of this.updateStateCallbacks) {
            io.on(SocketIOModel.UPDATE_STATUS_EVENT, callback);
        }
        for (const callback of this.updateEncodeStateCallbacks) {
            io.on(SocketIOModel.UPDATE_ENCODE_STATUS_EVENT, callback);
        }
    }

    private getSocketIOUrl(socketIOPort: number): string | undefined {
        const defaultPort = location.protocol === 'https:' ? '443' : '80';
        const currentPort = location.port.length === 0 ? defaultPort : location.port;

        if (socketIOPort.toString(10) === currentPort) {
            return undefined;
        }

        const hostname = location.hostname.includes(':') === true ? `[${location.hostname}]` : location.hostname;

        return `${location.protocol}//${hostname}:${socketIOPort.toString(10)}`;
    }
}

namespace SocketIOModel {
    export const UPDATE_STATUS_EVENT = 'updateStatus';
    export const UPDATE_ENCODE_STATUS_EVENT = 'updateEncode';
}

export default SocketIOModel;
