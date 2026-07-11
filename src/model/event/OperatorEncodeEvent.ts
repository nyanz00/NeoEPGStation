import * as events from 'events';
import { inject, injectable } from 'inversify';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IOperatorEncodeEvent, { OperatorErrorEncodeInfo, OperatorFinishEncodeInfo } from './IOperatorEncodeEvent';

@injectable()
class OperatorEncodeEvent implements IOperatorEncodeEvent {
    private log: ILogger;
    private emitter: events.EventEmitter = new events.EventEmitter();

    constructor(@inject('ILoggerModel') logger: ILoggerModel) {
        this.log = logger.getLogger();
    }

    /**
     * エンコード完了イベント発行
     * @param info: OperatorFinishEncodeInfo
     */
    public emitFinishEncode(info: OperatorFinishEncodeInfo): void {
        this.emitter.emit(OperatorEncodeEvent.FINISH_ENCODE_EVENT, info);
    }

    public emitErrorEncode(info: OperatorErrorEncodeInfo): void {
        this.emitter.emit(OperatorEncodeEvent.ERROR_ENCODE_EVENT, info);
    }

    /**
     * エンコード完了イベント登録
     * @param callback: (info: OperatorFinishEncodeInfo) => void
     */
    public setFinishEncode(callback: (info: OperatorFinishEncodeInfo) => void): void {
        this.emitter.on(OperatorEncodeEvent.FINISH_ENCODE_EVENT, async (info: OperatorFinishEncodeInfo) => {
            try {
                await callback(info);
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }

    public setErrorEncode(callback: (info: OperatorErrorEncodeInfo) => void): void {
        this.emitter.on(OperatorEncodeEvent.ERROR_ENCODE_EVENT, async (info: OperatorErrorEncodeInfo) => {
            try {
                await callback(info);
            } catch (err: any) {
                this.log.system.error(err);
            }
        });
    }
}

namespace OperatorEncodeEvent {
    export const FINISH_ENCODE_EVENT = 'finishEncodeEvent';
    export const ERROR_ENCODE_EVENT = 'errorEncodeEvent';
}

export default OperatorEncodeEvent;
