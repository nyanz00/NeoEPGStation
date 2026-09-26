import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IEncodeEvent, { ErrorEncodeInfo, FinishEncodeInfo } from '../../event/IEncodeEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IIPCClient from '../../ipc/IIPCClient';
import ISocketIOManageModel from '../socketio/ISocketIOManageModel';
import IEncodeFinishModel from './IEncodeFinishModel';

@injectable()
export default class EncodeFinishModel implements IEncodeFinishModel {
    private log: ILogger;
    private socket: ISocketIOManageModel;
    private ipc: IIPCClient;
    private encodeEvent: IEncodeEvent;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('ISocketIOManageModel') socket: ISocketIOManageModel,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
    ) {
        this.log = logger.getLogger();
        this.socket = socket;
        this.ipc = ipc;
        this.encodeEvent = encodeEvent;
    }

    public set(): void {
        this.encodeEvent.setAddEncode(this.addEncode.bind(this));
        this.encodeEvent.setCancelEncode(this.cancelEncode.bind(this));
        this.encodeEvent.setFinishEncode(this.finishEncode.bind(this));
        this.encodeEvent.setErrorEncode(this.errorEncode.bind(this));
        this.encodeEvent.setUpdateEncode(this.updateEncode.bind(this));
        this.encodeEvent.setUpdateEncodeProgress(this.updateEncodeProgress.bind(this));
    }

    /**
     * エンコード追加処理
     * @param encodeId
     */
    private addEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコードキャンセル処理
     * @param encodeId
     */
    private cancelEncode(_encodeId: apid.EncodeId): void {
        this.socket.notifyClient();
    }

    /**
     * エンコード終了処理
     * @param info: FinishEncodeInfo
     */
    private async finishEncode(info: FinishEncodeInfo): Promise<void> {
        let newVideoFileId: apid.VideoFileId | null = null;
        try {
            if (info.fullOutputPath === null || info.filePath === null) {
                // update file size
                await this.ipc.recorded.updateVideoFileSize(info.videoFileId);
            } else {
                // add encode file
                const id = await this.ipc.recorded.addVideoFile({
                    recordedId: info.recordedId,
                    parentDirectoryName: info.parentDirName,
                    filePath: info.filePath,
                    type: 'encoded',
                    name: info.mode,
                });
                newVideoFileId = id;
            }
        } catch (err: any) {
            this.log.encode.error('finish encode error');
            this.log.encode.error(err);
            if (info.fullOutputPath !== null) {
                this.log.encode.error(`unregistered encode output was preserved: ${info.fullOutputPath}`);
            }
            const errorMessage = err instanceof Error ? err.message : String(err);
            this.encodeEvent.emitErrorEncode({
                recordedId: info.recordedId,
                videoFileId: info.videoFileId,
                mode: info.mode,
                encoderMessage:
                    info.fullOutputPath === null
                        ? errorMessage
                        : `${errorMessage} (未登録の出力ファイルは保持されています: ${info.fullOutputPath})`,
            });

            // 出力のDB登録に失敗した状態で元ファイル削除や成功通知へ進まない。
            // キュー自体は呼び出し元が完了扱いで片付け、保持したパスはログと失敗通知へ残す。
            return;
        }

        if (info.updateThumbnail === true && newVideoFileId !== null) {
            await this.ipc.thumbnail.replace(newVideoFileId).catch(err => {
                this.log.encode.error(`replace thumbnail error: ${newVideoFileId}`);
                this.log.encode.error(err);
            });
        }

        if (info.removeOriginal === true) {
            // delete source video file
            await this.ipc.recorded.deleteVideoFile(info.videoFileId, true);
        }

        this.socket.notifyClient();

        // Operator にイベントを転送
        await this.ipc.encodeEvent.emitFinishEncode({
            recordedId: info.recordedId,
            videoFileId: newVideoFileId,
            mode: info.mode,
        });
    }

    /**
     * エンコード失敗処理
     */
    private async errorEncode(info: ErrorEncodeInfo): Promise<void> {
        this.socket.notifyClient();
        await this.ipc.encodeEvent.emitErrorEncode({
            recordedId: info.recordedId,
            videoFileId: info.videoFileId,
            mode: info.mode,
            encoderMessage: info.encoderMessage,
        });
    }

    /**
     * エンコード進捗情報更新
     */
    private updateEncodeProgress(): void {
        this.socket.notifyUpdateEncodeProgress();
    }

    /**
     * キュー構造の復元など、録画一覧側のエンコード状態も変わる更新を通知する。
     */
    private updateEncode(): void {
        this.socket.notifyClient();
    }
}
