import * as path from 'path';
import * as events from 'events';
import { createHash } from 'crypto';
import * as os from 'os';
import { inject, injectable } from 'inversify';
import { cloneDeep } from 'lodash';
import * as apid from '../../../../api';
import EncodeTask from '../../../db/entities/EncodeTask';
import IDBOperator from '../../db/IDBOperator';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IEncodeEvent from '../../event/IEncodeEvent';
import IConfiguration from '../../IConfiguration';
import IExecutionManagementModel, { ExecutionId } from '../../IExecutionManagementModel';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeManageModel, {
    EncodeInfoItem,
    EncodeQueueInfo,
    EncodeRecordedIdIndex,
    EncodeRecoveryInfoItem,
} from './IEncodeManageModel';
import { AddEncodeOption, EncodeOption, EncoderModelProvider, IEncoderModel } from './IEncoderModel';

interface ScheduledEncodeItem {
    option: EncodeOption;
    scheduledAt: number;
}

interface FinishingEncodeItem {
    option: EncodeOption;
    promise: Promise<void>;
}

interface RecoveryEncodeItem {
    task: EncodeTask;
    option: EncodeOption | null;
    reason: string;
}

@injectable()
class EncodeManageModel implements IEncodeManageModel {
    private log: ILogger;
    private configure: IConfiguration;
    private executeManagementModel: IExecutionManagementModel;
    private encoderModelProvider: EncoderModelProvider;
    private encodeEvent: IEncodeEvent;
    private concurrentEncodeNum: number;
    private waitQueue: IEncoderModel[] = [];
    private runningQueue: IEncoderModel[] = [];
    private scheduledQueue: ScheduledEncodeItem[] = [];
    private recoveryQueue = new Map<apid.EncodeId, RecoveryEncodeItem>();
    private finalizeRetryIds = new Set<apid.EncodeId>();
    private finishingEncodes = new Map<apid.EncodeId, FinishingEncodeItem>();
    private deletingRecordedIds = new Map<apid.RecordedId, number>();
    private deletingVideoFileIds = new Map<apid.VideoFileId, number>();
    private scheduledTimer: NodeJS.Timeout | null = null;
    private idCnt: number = 1;
    private readonly ownerFingerprint = createHash('sha256')
        .update(`${os.hostname()}\0${path.resolve(process.cwd())}`)
        .digest('hex');
    private readonly restorePromise: Promise<void>;

    private listener: events.EventEmitter = new events.EventEmitter();

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configure: IConfiguration,
        @inject('IExecutionManagementModel') executeManagementModel: IExecutionManagementModel,
        @inject('EncoderModelProvider') encoderModelProvider: EncoderModelProvider,
        @inject('IEncodeEvent') encodeEvent: IEncodeEvent,
        @inject('IDBOperator') private dbOperator: IDBOperator,
        @inject('IRecordedDB') private recordedDB: IRecordedDB,
        @inject('IVideoFileDB') private videoFileDB: IVideoFileDB,
    ) {
        this.log = logger.getLogger();
        this.configure = configure;
        this.executeManagementModel = executeManagementModel;
        this.concurrentEncodeNum = configure.getConfig().concurrentEncodeNum;
        this.encoderModelProvider = encoderModelProvider;
        this.encodeEvent = encodeEvent;

        this.listener.on(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT, () => {
            void this.checkQueue().catch((err: any) => {
                this.log.encode.error('check encode queue failed');
                this.log.encode.error(err);
                this.scheduleQueueCheckRetry();
            });
        });
        this.restorePromise = this.restorePersistedQueue();
    }

    public async waitUntilReady(): Promise<void> {
        await this.restorePromise;
    }

    /**
     * エンコード情報を queue に積む
     * @param addOption: apid.AddEncodeProgramOption
     * @return apid.EncodeId
     */
    public async push(addOption: AddEncodeOption): Promise<apid.EncodeId> {
        await this.restorePromise;
        if (this.concurrentEncodeNum <= 0) {
            throw new Error('CncurrentEncodeNumIsZero');
        }

        const option = this.createEncodeOption(addOption);
        const scheduledAt =
            typeof option.scheduledAt === 'number' &&
            Number.isFinite(option.scheduledAt) &&
            option.scheduledAt > Date.now()
                ? option.scheduledAt
                : null;
        let encoder: IEncoderModel | null = null;
        if (scheduledAt === null) {
            delete option.scheduledAt;
            // ロック中に provider の生成処理を待たないよう、encoder は先に準備する
            encoder = await this.encoderModelProvider();
            encoder.setOption(option);
        }

        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.ADD_ENCODE_PRIPORITY);

        try {
            if (
                this.deletingRecordedIds.has(option.recordedId) ||
                this.deletingVideoFileIds.has(option.sourceVideoFileId)
            ) {
                throw new Error('EncodeSourceIsDeleting');
            }
            const [recorded, videoFile] = await Promise.all([
                this.recordedDB.findId(option.recordedId),
                this.videoFileDB.findId(option.sourceVideoFileId),
            ]);
            if (recorded === null) throw new Error('RecordedIdIsNotFound');
            if (videoFile === null || videoFile.recordedId !== option.recordedId)
                throw new Error('VideoFileIsNotFound');

            if (scheduledAt === null) {
                if (encoder === null) throw new Error('EncoderIsNull');
                this.waitQueue.push(encoder);
                try {
                    await this.saveTask(option, 'waiting', this.waitQueue.length - 1, 0);
                } catch (err: any) {
                    this.waitQueue = this.waitQueue.filter(item => item !== encoder);
                    throw err;
                }
                this.log.encode.info(`add new encode: ${option.encodeId}`);
            } else {
                this.scheduledQueue.push({ option, scheduledAt });
                this.sortScheduledQueue();
                try {
                    await this.saveScheduledQueuePositions();
                } catch (err: any) {
                    this.scheduledQueue = this.scheduledQueue.filter(item => item.option.encodeId !== option.encodeId);
                    try {
                        await this.deleteTask(option.encodeId);
                        await this.saveScheduledQueuePositions();
                    } catch (rollbackError: any) {
                        this.log.encode.error(`rollback scheduled encode failed: ${option.encodeId}`);
                        this.log.encode.error(rollbackError);
                    }
                    throw err;
                }
                this.log.encode.info(`schedule encode: ${option.encodeId} at ${new Date(scheduledAt).toISOString()}`);
            }
        } finally {
            // 追加処理で例外が発生しても、以降の queue 操作を止めない
            this.executeManagementModel.unLockExecution(exeId);
        }

        // イベント発行
        this.encodeEvent.emitAddEncode(option.encodeId);

        // 追加用ロックを解放してから、別ターンで実行可能な queue を開始する
        if (scheduledAt === null) {
            process.nextTick(() => {
                this.emitNeedsCheckQueue();
            });
        } else {
            this.refreshScheduledTimer();
        }

        return option.encodeId;
    }

    /**
     * エンコードオプションを生成する
     * @param baseOption: apid.AddEncodeProgramOption
     * @returns EncodeOption
     */
    private createEncodeOption(baseOption: AddEncodeOption): EncodeOption {
        // encoder のオプションを生成
        const encodeOption: EncodeOption = cloneDeep(baseOption) as any;
        const encodeId = this.idCnt;
        encodeOption.encodeId = encodeId;

        // idCnt をインクリメント
        if (this.idCnt === Number.MAX_SAFE_INTEGER) {
            this.idCnt = 0;
        }
        this.idCnt++;

        return encodeOption;
    }

    /**
     * queue の状態をチェックする必要がある場合に呼ぶ
     */
    private emitNeedsCheckQueue(): void {
        this.listener.emit(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT);
    }

    private scheduleQueueCheckRetry(): void {
        const timer = setTimeout(() => this.emitNeedsCheckQueue(), EncodeManageModel.QUEUE_RETRY_DELAY);
        timer.unref();
    }

    private sortScheduledQueue(): void {
        this.scheduledQueue.sort((left, right) => {
            if (left.scheduledAt !== right.scheduledAt) return left.scheduledAt - right.scheduledAt;
            return left.option.encodeId - right.option.encodeId;
        });
    }

    private refreshScheduledTimer(minimumDelay = 0): void {
        if (this.scheduledTimer !== null) {
            clearTimeout(this.scheduledTimer);
            this.scheduledTimer = null;
        }
        const next = this.scheduledQueue[0];
        if (next === undefined) return;

        const delay = Math.min(
            Math.max(minimumDelay, next.scheduledAt - Date.now()),
            EncodeManageModel.MAX_TIMER_DELAY,
        );
        this.scheduledTimer = setTimeout(() => {
            this.scheduledTimer = null;
            void this.releaseScheduledEncodes().catch((err: any) => {
                this.log.encode.error('release scheduled encode queue failed');
                this.log.encode.error(err);
                this.refreshScheduledTimer(EncodeManageModel.RELEASE_RETRY_DELAY);
            });
        }, delay);
        this.scheduledTimer.unref();
    }

    private async releaseScheduledEncodes(): Promise<void> {
        await this.restorePromise;
        const exeId = await this.executeManagementModel.getExecution(
            EncodeManageModel.RELEASE_SCHEDULED_ENCODE_PRIORITY,
        );
        let released = false;
        let releaseFailed = false;
        try {
            const now = Date.now();
            const due = this.scheduledQueue.filter(item => item.scheduledAt <= now);
            if (due.length === 0) return;

            const releasedIds = new Set<apid.EncodeId>();
            for (const item of due) {
                const scheduledAt = item.scheduledAt;
                try {
                    const encoder = await this.encoderModelProvider();
                    delete item.option.scheduledAt;
                    encoder.setOption(item.option);
                    await this.saveTask(item.option, 'waiting', this.waitQueue.length, 0);
                    this.waitQueue.push(encoder);
                    releasedIds.add(item.option.encodeId);
                    released = true;
                    this.log.encode.info(`release scheduled encode: ${item.option.encodeId}`);
                } catch (err: any) {
                    item.option.scheduledAt = scheduledAt;
                    releaseFailed = true;
                    this.log.encode.error(`release scheduled encode failed: ${item.option.encodeId}`);
                    this.log.encode.error(err);
                }
            }
            this.scheduledQueue = this.scheduledQueue.filter(item => !releasedIds.has(item.option.encodeId));
            try {
                await this.saveWaitQueuePositions();
                await this.saveScheduledQueuePositions();
            } catch (err: any) {
                releaseFailed = true;
                this.log.encode.error('save released encode queue positions failed');
                this.log.encode.error(err);
            }
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
            this.refreshScheduledTimer(releaseFailed ? EncodeManageModel.RELEASE_RETRY_DELAY : 0);
        }

        if (released) {
            this.encodeEvent.emitUpdateEncodeProgress();
            process.nextTick(() => this.emitNeedsCheckQueue());
        }
    }

    /**
     * queue をチェックする
     * @return Promise<void>
     */
    private async checkQueue(): Promise<void> {
        await this.restorePromise;
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(
            EncodeManageModel.CREATE_ENCODING_PROCESS_PRIPORITY,
        );
        try {
            while (this.runningQueue.length < this.concurrentEncodeNum && this.waitQueue.length > 0) {
                const encoder = this.waitQueue[0];
                if (typeof encoder === 'undefined') break;

                const encodeOption = encoder.getEncodeOption();
                if (encodeOption === null) {
                    this.log.encode.warn('encodeOption is null');
                    this.waitQueue.shift();
                    await this.saveWaitQueuePositions();
                    continue;
                }

                try {
                    await this.persistQueueStart(encodeOption, this.waitQueue.slice(1));
                } catch (err: any) {
                    // DB が復旧するまでメモリ上では待機中のまま維持する。実行中へ移してから
                    // 保存に失敗すると、再起動後の状態と実プロセスが食い違うためである。
                    this.log.encode.error(`persist encode start failed: ${encodeOption.encodeId}`);
                    this.log.encode.error(err);
                    this.scheduleQueueCheckRetry();
                    break;
                }

                this.waitQueue.shift();
                this.runningQueue.push(encoder);
                encoder.setOnFinish((isError, outputFilePath, isCanceled, encoderMessage) => {
                    this.onFinish(isError, outputFilePath, encodeOption, isCanceled, encoderMessage);
                });
                encoder.setOnAmatsukazeTaskMatched(taskId => {
                    encodeOption.amatsukazeTaskId = taskId;
                    void this.saveAmatsukazeTaskId(encodeOption).catch(err => {
                        this.log.encode.warn(
                            `save Amatsukaze task id failed: ${encodeOption.encodeId} -> ${taskId.toString(10)}`,
                        );
                        this.log.encode.warn(err);
                    });
                });

                try {
                    await encoder.start();
                } catch (err: any) {
                    this.log.encode.error(`create encode process error: ${encoder.getEncodeId()}`);
                    this.log.encode.error(err);
                    this.encodeEvent.emitErrorEncode({
                        recordedId: encodeOption.recordedId,
                        videoFileId: encodeOption.sourceVideoFileId,
                        mode: encodeOption.mode,
                        encoderMessage: err instanceof Error ? err.message : String(err),
                    });
                    process.nextTick(() => {
                        void this.finalize(encodeOption.encodeId).catch(() => {
                            // finalize() logs and schedules its own persistence retry.
                        });
                    });
                    continue;
                }

                try {
                    await this.saveOutputFilePath(encodeOption.encodeId, encoder.getOutputFilePath());
                } catch (err: any) {
                    // エンコーダーは既に動いているので、キューから外したりプロセスを孤児化
                    // させたりせず、追跡を維持したままDB保存だけ再試行する。
                    this.log.encode.error(`save encode output path failed: ${encodeOption.encodeId}`);
                    this.log.encode.error(err);
                    this.retrySaveOutputFilePath(encodeOption.encodeId, encoder);
                }
            }
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }
    }

    private async persistQueueStart(option: EncodeOption, remainingWaitQueue: IEncoderModel[]): Promise<void> {
        const connection = await this.dbOperator.getConnection();
        await connection.transaction(async manager => {
            const repository = manager.getRepository(EncodeTask);
            const current = await repository.findOne({ where: { encodeId: option.encodeId } });
            const now = Date.now();
            await repository.save({
                encodeId: option.encodeId,
                optionJson: JSON.stringify(option),
                status: 'running',
                position: this.runningQueue.length,
                ownerFingerprint: this.ownerFingerprint,
                startedAt: option.recoveryStartedAt ?? now,
                outputFilePath: current?.outputFilePath ?? null,
                createdAt: current === null ? now : Number(current.createdAt),
                updatedAt: now,
            });

            for (let position = 0; position < remainingWaitQueue.length; position++) {
                const waitOption = remainingWaitQueue[position].getEncodeOption();
                if (waitOption === null) continue;
                const persisted = await repository.findOne({ where: { encodeId: waitOption.encodeId } });
                await repository.save({
                    encodeId: waitOption.encodeId,
                    optionJson: JSON.stringify(waitOption),
                    status: 'waiting',
                    position,
                    ownerFingerprint: this.ownerFingerprint,
                    startedAt: persisted === null ? 0 : Number(persisted.startedAt),
                    outputFilePath: persisted?.outputFilePath ?? null,
                    createdAt: persisted === null ? now : Number(persisted.createdAt),
                    updatedAt: now,
                });
            }
        });
    }

    private retrySaveOutputFilePath(encodeId: apid.EncodeId, encoder: IEncoderModel): void {
        const timer = setTimeout(() => {
            if (this.getRunnginQueueItem(encodeId) !== encoder) return;
            void this.saveOutputFilePath(encodeId, encoder.getOutputFilePath()).catch((err: any) => {
                this.log.encode.warn(`retry save encode output path failed: ${encodeId}`);
                this.log.encode.warn(err);
                this.retrySaveOutputFilePath(encodeId, encoder);
            });
        }, EncodeManageModel.OUTPUT_PATH_SAVE_RETRY_DELAY);
        timer.unref();
    }

    /**
     * エンコード終了処理
     * @param isError: 異常終了か
     * @param outputFilePath: エンコードファイルパス
     * @param encodeOption: エンコードオプション
     */
    private onFinish(
        isError: boolean,
        outputFilePath: string | null,
        encodeOption: EncodeOption,
        isCanceled: boolean,
        encoderMessage?: string,
    ): void {
        const promise = Promise.resolve().then(() =>
            this.processFinish(isError, outputFilePath, encodeOption, isCanceled, encoderMessage),
        );
        this.finishingEncodes.set(encodeOption.encodeId, { option: encodeOption, promise });
        void promise
            .catch(err => {
                this.log.encode.error(`encode finish processing failed: ${encodeOption.encodeId}`);
                this.log.encode.error(err);
            })
            .finally(() => {
                if (this.finishingEncodes.get(encodeOption.encodeId)?.promise === promise)
                    this.finishingEncodes.delete(encodeOption.encodeId);
            });
    }

    private async processFinish(
        isError: boolean,
        outputFilePath: string | null,
        encodeOption: EncodeOption,
        isCanceled: boolean,
        encoderMessage?: string,
    ): Promise<void> {
        try {
            if (isError) {
                // エラー通知
                if (isCanceled === false) {
                    this.encodeEvent.emitErrorEncode({
                        recordedId: encodeOption.recordedId,
                        videoFileId: encodeOption.sourceVideoFileId,
                        mode: encodeOption.mode,
                        encoderMessage,
                    });
                }
            } else {
                // 終了通知 DB に登録を依頼
                const fileName = outputFilePath === null ? null : path.basename(outputFilePath);
                if (
                    encodeOption.removeOriginal === true &&
                    this.hasSamVideoFileIdItem(encodeOption.sourceVideoFileId, encodeOption.encodeId) === true
                ) {
                    // queue に削除予定の videofile が存在するので、削除しないように false にする
                    encodeOption.removeOriginal = false;
                }

                await this.encodeEvent.emitFinishEncode({
                    recordedId: encodeOption.recordedId,
                    videoFileId: encodeOption.sourceVideoFileId,
                    parentDirName: encodeOption.parentDir,
                    filePath: this.getOutputFilePathForDB(outputFilePath, fileName, encodeOption),
                    fullOutputPath: outputFilePath,
                    mode: encodeOption.mode,
                    removeOriginal: encodeOption.removeOriginal,
                    updateThumbnail: encodeOption.updateThumbnail === true,
                });
            }
        } finally {
            // DB 登録や元ファイル削除まで終えてから queue から外す。
            await this.finalize(encodeOption.encodeId);
        }
    }

    private getOutputFilePathForDB(
        outputFilePath: string | null,
        fileName: string | null,
        encodeOption: EncodeOption,
    ): string | null {
        if (outputFilePath === null || fileName === null) {
            return null;
        }

        const parentDir = this.configure.getConfig().recorded.find(recordedDir => {
            return recordedDir.name === encodeOption.parentDir;
        });
        if (typeof parentDir !== 'undefined') {
            const relativePath = path.relative(parentDir.path, outputFilePath);
            if (
                relativePath.length > 0 &&
                relativePath.startsWith('..') === false &&
                path.isAbsolute(relativePath) === false
            ) {
                return relativePath;
            }
        }

        return typeof encodeOption.directory === 'undefined' ? fileName : path.join(encodeOption.directory, fileName);
    }

    /**
     * videoFileId で指定した video file id を持つ queue item が存在するか調べる
     * @param videoFileId: apid.VideoFileId
     * @param excludeEncodeId: apid.EncodeId 除外する encode id
     * @return boolean 存在するなら true を返す
     */
    private hasSamVideoFileIdItem(videoFileId: apid.VideoFileId, excludeEncodeId: apid.EncodeId): boolean {
        const runningItem = this.runningQueue.find(i => {
            const option = i.getEncodeOption();

            return option !== null && option.sourceVideoFileId === videoFileId && option.encodeId !== excludeEncodeId;
        });
        if (typeof runningItem !== 'undefined') {
            return true;
        }

        const waitItem = this.waitQueue.find(i => {
            const option = i.getEncodeOption();

            return option !== null && option.sourceVideoFileId === videoFileId && option.encodeId !== excludeEncodeId;
        });
        if (typeof waitItem !== 'undefined') {
            return true;
        }

        const scheduledItem = this.scheduledQueue.find(item => {
            return item.option.sourceVideoFileId === videoFileId && item.option.encodeId !== excludeEncodeId;
        });
        if (typeof scheduledItem !== 'undefined') {
            return true;
        }

        for (const item of this.recoveryQueue.values()) {
            if (
                item.option !== null &&
                item.option.sourceVideoFileId === videoFileId &&
                item.option.encodeId !== excludeEncodeId
            ) {
                return true;
            }
        }

        return false;
    }

    /**
     * 最終処理
     * @param encodeId: apid.EncodeId
     */
    private async finalize(encodeId: apid.EncodeId): Promise<void> {
        let exeId: ExecutionId | null = null;
        let finalized = false;
        try {
            // ロック取得自体が失敗した場合も、永続タスクの掃除を打ち切らず再試行する。
            exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CLEAR_QUEUE_PRIPORITY);
            const remainingQueue = this.runningQueue.filter(q => q.getEncodeId() !== encodeId);
            await this.persistQueueFinalize(encodeId, remainingQueue);
            // DB の削除と位置更新が成功してからメモリを更新する。失敗時は完了済み
            // タスクを追跡対象に残し、DB復旧後の再試行で確実に片付ける。
            this.runningQueue = remainingQueue;
            this.finalizeRetryIds.delete(encodeId);
            finalized = true;
        } catch (err: any) {
            this.log.encode.error(`finalize persisted encode task failed: ${encodeId}`);
            this.log.encode.error(err);
            this.scheduleFinalizeRetry(encodeId);
            throw err;
        } finally {
            if (exeId !== null) this.executeManagementModel.unLockExecution(exeId);
        }

        if (finalized) process.nextTick(() => this.emitNeedsCheckQueue());
    }

    private async persistQueueFinalize(encodeId: apid.EncodeId, remainingQueue: IEncoderModel[]): Promise<void> {
        const connection = await this.dbOperator.getConnection();
        await connection.transaction(async manager => {
            const repository = manager.getRepository(EncodeTask);
            await repository.delete({ encodeId });
            const updatedAt = Date.now();
            for (let position = 0; position < remainingQueue.length; position++) {
                const remainingId = remainingQueue[position].getEncodeId();
                if (remainingId !== null) await repository.update({ encodeId: remainingId }, { position, updatedAt });
            }
        });
    }

    private scheduleFinalizeRetry(encodeId: apid.EncodeId): void {
        if (this.finalizeRetryIds.has(encodeId)) return;
        this.finalizeRetryIds.add(encodeId);
        const timer = setTimeout(() => {
            this.finalizeRetryIds.delete(encodeId);
            void this.finalize(encodeId).catch(() => {
                // finalize() logs and schedules the next retry itself.
            });
        }, EncodeManageModel.FINALIZE_RETRY_DELAY);
        timer.unref();
    }

    /**
     * 指定された encode id を queue から削除する
     * @param encodeId: apid.EncodeId
     */
    public async cancel(encodeId: apid.EncodeId): Promise<void> {
        await this.restorePromise;
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CANCEL_ENCODE_PRIPORITY);
        try {
            this.log.encode.info(`cancel encode: ${encodeId}`);

            if (this.recoveryQueue.has(encodeId)) {
                await this.deleteTask(encodeId);
                this.recoveryQueue.delete(encodeId);
                this.encodeEvent.emitCancelEncode(encodeId);
                return;
            }

            // runningQueue にあるので プロセスを殺す
            const runningQueueItem = this.getRunnginQueueItem(encodeId);
            if (typeof runningQueueItem !== 'undefined') {
                await runningQueueItem.cancel();
            } else {
                const nextWaitQueue = this.waitQueue.filter(q => {
                    return q.getEncodeId() !== encodeId;
                });
                const nextScheduledQueue = this.scheduledQueue.filter(item => item.option.encodeId !== encodeId);
                await this.persistQueueCancellation(encodeId, nextWaitQueue, nextScheduledQueue);
                this.waitQueue = nextWaitQueue;
                this.scheduledQueue = nextScheduledQueue;
                this.refreshScheduledTimer();

                process.nextTick(() => {
                    this.emitNeedsCheckQueue();
                });
            }
            if (typeof runningQueueItem !== 'undefined') await this.deleteTask(encodeId);
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        // イベント発行
        this.encodeEvent.emitCancelEncode(encodeId);
    }

    private async persistQueueCancellation(
        encodeId: apid.EncodeId,
        waitQueue: IEncoderModel[],
        scheduledQueue: ScheduledEncodeItem[],
    ): Promise<void> {
        const connection = await this.dbOperator.getConnection();
        await connection.transaction(async manager => {
            const repository = manager.getRepository(EncodeTask);
            await repository.delete({ encodeId });
            const updatedAt = Date.now();
            for (let position = 0; position < waitQueue.length; position++) {
                const remainingId = waitQueue[position].getEncodeId();
                if (remainingId !== null) await repository.update({ encodeId: remainingId }, { position, updatedAt });
            }
            for (let position = 0; position < scheduledQueue.length; position++) {
                await repository.update(
                    { encodeId: scheduledQueue[position].option.encodeId },
                    { position, updatedAt },
                );
            }
        });
    }

    /**
     * 隔離された永続タスクを、利用可能な設定と入力元を再確認したうえで再試行する。
     */
    public async retry(encodeId: apid.EncodeId): Promise<void> {
        await this.restorePromise;
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.ADD_ENCODE_PRIPORITY);
        let shouldCheckQueue = false;
        try {
            const recoveryItem = this.recoveryQueue.get(encodeId);
            if (typeof recoveryItem === 'undefined') throw new Error('EncodeRecoveryTaskIsNotFound');
            if (this.canRetryRecoveryItem(recoveryItem) === false || recoveryItem.option === null)
                throw new Error('EncodeRecoveryTaskCannotRetry');
            if (
                this.runningQueue.some(item => item.getEncodeId() === encodeId) ||
                this.waitQueue.some(item => item.getEncodeId() === encodeId) ||
                this.scheduledQueue.some(item => item.option.encodeId === encodeId)
            )
                throw new Error('EncodeRecoveryTaskAlreadyActive');

            const option = cloneDeep(recoveryItem.option);
            const encodeConfig = this.configure.getConfig().encode.find(item => item.name === option.mode);
            if (typeof encodeConfig === 'undefined') throw new Error('EncodeModeIsNotFound');
            const [recorded, videoFile] = await Promise.all([
                this.recordedDB.findId(option.recordedId),
                this.videoFileDB.findId(option.sourceVideoFileId),
            ]);
            if (recorded === null) throw new Error('RecordedIdIsNotFound');
            if (videoFile === null || videoFile.recordedId !== option.recordedId)
                throw new Error('VideoFileIsNotFound');

            const scheduledAt =
                typeof option.scheduledAt === 'number' &&
                Number.isFinite(option.scheduledAt) &&
                option.scheduledAt > Date.now()
                    ? option.scheduledAt
                    : null;
            if (scheduledAt !== null) {
                const nextScheduledQueue = [...this.scheduledQueue, { option, scheduledAt }].sort((left, right) => {
                    if (left.scheduledAt !== right.scheduledAt) return left.scheduledAt - right.scheduledAt;
                    return left.option.encodeId - right.option.encodeId;
                });
                await this.persistScheduledQueue(nextScheduledQueue);
                this.scheduledQueue = nextScheduledQueue;
                this.refreshScheduledTimer();
            } else {
                delete option.scheduledAt;
                if (Number(recoveryItem.task.startedAt) > 0) {
                    option.recoveryStartedAt = Number(recoveryItem.task.startedAt);
                    if (recoveryItem.task.outputFilePath !== null)
                        option.recoveryOutputFilePath = recoveryItem.task.outputFilePath;
                    if (encodeConfig.type === 'amatsukaze') {
                        option.resumeExistingAmatsukaze = true;
                        delete option.restartInterruptedAmatsukaze;
                    }
                }
                const encoder = await this.encoderModelProvider();
                encoder.setOption(option);
                await this.saveTask(option, 'waiting', this.waitQueue.length, 0);
                this.waitQueue.push(encoder);
                shouldCheckQueue = true;
            }
            this.recoveryQueue.delete(encodeId);
            this.log.encode.info(`retry persisted encode task: ${encodeId}`);
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.encodeEvent.emitUpdateEncodeProgress();
        if (shouldCheckQueue) process.nextTick(() => this.emitNeedsCheckQueue());
    }

    private async persistScheduledQueue(queue: ScheduledEncodeItem[]): Promise<void> {
        const connection = await this.dbOperator.getConnection();
        await connection.transaction(async manager => {
            const repository = manager.getRepository(EncodeTask);
            const now = Date.now();
            for (let position = 0; position < queue.length; position++) {
                const option = queue[position].option;
                const current = await repository.findOne({ where: { encodeId: option.encodeId } });
                await repository.save({
                    encodeId: option.encodeId,
                    optionJson: JSON.stringify(option),
                    status: 'scheduled',
                    position,
                    ownerFingerprint: this.ownerFingerprint,
                    startedAt: current === null ? 0 : Number(current.startedAt),
                    outputFilePath: current?.outputFilePath ?? null,
                    createdAt: current === null ? now : Number(current.createdAt),
                    updatedAt: now,
                });
            }
        });
    }

    /**
     * 待機中エンコードの実行順を変更する
     * @param encodeIds 先頭から順に並べた待機中エンコードID
     */
    public async reorderWaitQueue(encodeIds: apid.EncodeId[], expectedEncodeIds: apid.EncodeId[]): Promise<void> {
        await this.restorePromise;
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.REORDER_ENCODE_PRIORITY);

        try {
            const queueById = new Map<apid.EncodeId, IEncoderModel>();
            const currentIds: apid.EncodeId[] = [];
            for (const item of this.waitQueue) {
                const encodeId = item.getEncodeId();
                if (encodeId !== null) {
                    queueById.set(encodeId, item);
                    currentIds.push(encodeId);
                }
            }

            const uniqueIds = new Set(encodeIds);
            if (
                currentIds.length !== expectedEncodeIds.length ||
                currentIds.some((encodeId, index) => encodeId !== expectedEncodeIds[index]) ||
                uniqueIds.size !== encodeIds.length ||
                encodeIds.length !== this.waitQueue.length ||
                encodeIds.some(encodeId => !queueById.has(encodeId))
            ) {
                throw new Error('EncodeQueueChangedError');
            }

            const reorderedQueue = encodeIds.map(encodeId => queueById.get(encodeId) as IEncoderModel);
            await this.persistWaitQueueOrder(reorderedQueue);
            this.waitQueue = reorderedQueue;
            this.log.encode.info(`reorder encode queue: ${encodeIds.join(',')}`);
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.encodeEvent.emitUpdateEncodeProgress();
    }

    private async persistWaitQueueOrder(queue: IEncoderModel[]): Promise<void> {
        const connection = await this.dbOperator.getConnection();
        await connection.transaction(async manager => {
            const repository = manager.getRepository(EncodeTask);
            const updatedAt = Date.now();
            for (let position = 0; position < queue.length; position++) {
                const encodeId = queue[position].getEncodeId();
                if (encodeId !== null) await repository.update({ encodeId }, { position, updatedAt });
            }
        });
    }

    /**
     * 指定した encodeId を runningQueue から取り出す
     * @param encodeId: apid.EncodeId
     * @return IEncoderModel | undefined
     */
    private getRunnginQueueItem(encodeId: apid.EncodeId): IEncoderModel | undefined {
        return this.runningQueue.find(q => {
            return q.getEncodeId() === encodeId;
        });
    }

    /**
     * queu に積まれている要素の recorded id の索引を返す
     */
    public getRecordedIndex(): EncodeRecordedIdIndex {
        const index: EncodeRecordedIdIndex = {};

        for (const item of this.runningQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        for (const item of this.waitQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        for (const item of this.scheduledQueue) {
            const itemOption = item.option;
            if (typeof index[itemOption.recordedId] === 'undefined') {
                index[itemOption.recordedId] = [];
            }
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        for (const item of this.recoveryQueue.values()) {
            const itemOption = item.option;
            if (itemOption === null) continue;
            if (typeof index[itemOption.recordedId] === 'undefined') index[itemOption.recordedId] = [];
            index[itemOption.recordedId].push({
                encodeId: itemOption.encodeId,
                name: itemOption.mode,
            });
        }

        return index;
    }

    /**
     * 指定した recordedId を持つエンコードをキャンセルする
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void> {
        await this.restorePromise;
        await this.cancelMatchingEncodes(option => option.recordedId === recordedId);
    }

    /**
     * 指定した videoFileId を入力元にしているエンコードをキャンセルする
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async cancelEncodeByVideoFileId(videoFileId: apid.VideoFileId): Promise<void> {
        await this.restorePromise;
        await this.cancelMatchingEncodes(option => option.sourceVideoFileId === videoFileId);
    }

    /**
     * recorded 全体の削除中は、新しいエンコードを受け付けず、既存の完了処理も待つ。
     */
    public async withRecordedDeletion(recordedId: apid.RecordedId, action: () => Promise<void>): Promise<void> {
        await this.restorePromise;
        const release = await this.acquireDeletionLease(recordedId);
        try {
            const predicate = (option: EncodeOption): boolean => option.recordedId === recordedId;
            await this.cancelMatchingEncodes(predicate);
            await this.awaitMatchingFinishes(predicate);
            await action();
        } finally {
            release();
        }
    }

    /**
     * 個別 video file の削除中は同じ録画への新規エンコードを止めるが、
     * キャンセルするのは、そのファイルを入力元にしているものだけに限定する。
     */
    public async withVideoFileDeletion(
        recordedId: apid.RecordedId,
        videoFileId: apid.VideoFileId,
        action: () => Promise<void>,
    ): Promise<void> {
        await this.restorePromise;
        const release = await this.acquireDeletionLease(recordedId, videoFileId);
        try {
            const predicate = (option: EncodeOption): boolean => option.sourceVideoFileId === videoFileId;
            await this.cancelMatchingEncodes(predicate);
            await this.awaitMatchingFinishes(predicate);
            await action();
        } finally {
            release();
        }
    }

    private async acquireDeletionLease(
        recordedId: apid.RecordedId,
        videoFileId?: apid.VideoFileId,
    ): Promise<() => void> {
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.DELETE_ENCODE_SOURCE_PRIORITY);
        try {
            this.incrementDeletionMarker(this.deletingRecordedIds, recordedId);
            if (typeof videoFileId !== 'undefined') {
                this.incrementDeletionMarker(this.deletingVideoFileIds, videoFileId);
            }
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        let isReleased = false;
        return () => {
            if (isReleased === true) return;
            isReleased = true;
            this.decrementDeletionMarker(this.deletingRecordedIds, recordedId);
            if (typeof videoFileId !== 'undefined') {
                this.decrementDeletionMarker(this.deletingVideoFileIds, videoFileId);
            }
        };
    }

    private incrementDeletionMarker<T extends number>(markers: Map<T, number>, id: T): void {
        markers.set(id, (markers.get(id) ?? 0) + 1);
    }

    private decrementDeletionMarker<T extends number>(markers: Map<T, number>, id: T): void {
        const count = markers.get(id);
        if (typeof count === 'undefined' || count <= 1) {
            markers.delete(id);
        } else {
            markers.set(id, count - 1);
        }
    }

    private async awaitMatchingFinishes(predicate: (option: EncodeOption) => boolean): Promise<void> {
        const pending = [...this.finishingEncodes.values()]
            .filter(item => predicate(item.option))
            .map(item => item.promise);
        if (pending.length === 0) return;

        const results = await Promise.allSettled(pending);
        const failures = results.filter((result): result is PromiseRejectedResult => result.status === 'rejected');
        if (failures.length > 0) {
            for (const failure of failures) {
                this.log.encode.error(failure.reason);
            }
            throw new Error('StopEncodeError');
        }
    }

    private async cancelMatchingEncodes(predicate: (option: EncodeOption) => boolean): Promise<void> {
        const encodeIds = new Set<apid.EncodeId>();
        for (const item of [...this.waitQueue, ...this.runningQueue]) {
            const option = item.getEncodeOption();
            if (option !== null && predicate(option)) encodeIds.add(option.encodeId);
        }
        for (const item of this.scheduledQueue) {
            if (predicate(item.option)) encodeIds.add(item.option.encodeId);
        }
        for (const item of this.recoveryQueue.values()) {
            if (item.option !== null && predicate(item.option)) encodeIds.add(item.option.encodeId);
        }

        let isError = false;
        for (const encodeId of encodeIds) {
            await this.cancel(encodeId).catch(err => {
                isError = true;
                this.log.encode.error(`cancel encode failed: ${encodeId}`);
                this.log.encode.error(err);
            });
        }

        if (isError !== false) {
            throw new Error('StopEncodeError');
        }
    }

    /**
     * queue に積まれているエンコード情報を返す
     * @return EncodeQueueInfo
     */
    public async getEncodeInfo(): Promise<EncodeQueueInfo> {
        await this.restorePromise;
        const queueInfo: EncodeQueueInfo = {
            runningQueue: [],
            waitQueue: [],
            scheduledQueue: [],
            recoveryQueue: [],
        };

        // running queue
        for (const i of this.runningQueue) {
            const option = i.getEncodeOption();
            if (option === null) {
                continue;
            }

            const result: EncodeInfoItem = {
                id: option.encodeId,
                mode: option.mode,
                recordedId: option.recordedId,
            };

            const progress = i.getProgressInfo();
            if (progress !== null) {
                result.percent = progress.percent;
                result.log = progress.log;
            }

            queueInfo.runningQueue.push(result);
        }

        // wait queue
        for (const i of this.waitQueue) {
            const option = i.getEncodeOption();
            if (option === null) {
                continue;
            }

            queueInfo.waitQueue.push({
                id: option.encodeId,
                mode: option.mode,
                recordedId: option.recordedId,
            });
        }

        // scheduled queue
        for (const item of this.scheduledQueue) {
            queueInfo.scheduledQueue.push({
                id: item.option.encodeId,
                mode: item.option.mode,
                recordedId: item.option.recordedId,
                scheduledAt: item.scheduledAt,
            });
        }

        for (const item of this.recoveryQueue.values()) {
            const recoveryInfo: EncodeRecoveryInfoItem = {
                id: item.task.encodeId,
                status: item.task.status === 'paused' ? 'paused' : 'needs_attention',
                mode: item.option?.mode ?? null,
                recordedId: item.option?.recordedId ?? null,
                reason: item.reason,
                canRetry: this.canRetryRecoveryItem(item),
            };
            queueInfo.recoveryQueue.push(recoveryInfo);
        }

        return queueInfo;
    }

    private canRetryRecoveryItem(item: RecoveryEncodeItem): boolean {
        const option = item.option;
        if (option === null) return false;
        if (
            typeof option.mode !== 'string' ||
            this.configure.getConfig().encode.some(mode => mode.name === option.mode) === false
        )
            return false;

        return (
            typeof option.scheduledAt === 'undefined' ||
            (typeof option.scheduledAt === 'number' && Number.isFinite(option.scheduledAt))
        );
    }

    private async restorePersistedQueue(): Promise<void> {
        for (;;) {
            try {
                // A previous attempt may have failed after partially building the in-memory view.
                // Restoration only runs during construction, so it is safe to rebuild it from DB.
                this.waitQueue = [];
                this.scheduledQueue = [];
                this.recoveryQueue.clear();
                const repository = (await this.dbOperator.getConnection()).getRepository(EncodeTask);
                const tasks = await repository.find();
                const restoreStatusOrder: Record<string, number> = {
                    running: 0,
                    waiting: 1,
                    scheduled: 2,
                };
                tasks.sort((left, right) => {
                    const statusOrder =
                        (restoreStatusOrder[left.status] ?? Number.MAX_SAFE_INTEGER) -
                        (restoreStatusOrder[right.status] ?? Number.MAX_SAFE_INTEGER);
                    if (statusOrder !== 0) return statusOrder;
                    if (left.position !== right.position) return left.position - right.position;

                    return left.encodeId - right.encodeId;
                });
                let maxEncodeId = 0;
                const overdueScheduledOptions: EncodeOption[] = [];

                for (const task of tasks) {
                    maxEncodeId = Math.max(maxEncodeId, task.encodeId);
                    if (
                        task.status !== 'waiting' &&
                        task.status !== 'running' &&
                        task.status !== 'scheduled' &&
                        task.status !== 'paused' &&
                        task.status !== 'needs_attention'
                    )
                        continue;

                    let option: EncodeOption | null = null;
                    try {
                        option = JSON.parse(task.optionJson) as EncodeOption;
                        option.encodeId = task.encodeId;
                    } catch (err: any) {
                        task.status = 'needs_attention';
                        task.updatedAt = Date.now();
                        await repository.save(task);
                        this.recoveryQueue.set(task.encodeId, {
                            task,
                            option: null,
                            reason: '保存されたタスク情報が壊れているため、自動復旧できません。',
                        });
                        this.log.encode.error(`persisted encode task is invalid: ${task.encodeId}`);
                        this.log.encode.error(err);
                        continue;
                    }
                    if (option === null || typeof option !== 'object') {
                        task.status = 'needs_attention';
                        task.updatedAt = Date.now();
                        await repository.save(task);
                        this.recoveryQueue.set(task.encodeId, {
                            task,
                            option: null,
                            reason: '保存されたタスク情報が壊れているため、自動復旧できません。',
                        });
                        continue;
                    }

                    const encodeConfig = this.configure.getConfig().encode.find(item => item.name === option.mode);
                    const hasInvalidScheduledAt =
                        typeof option.scheduledAt !== 'undefined' &&
                        (typeof option.scheduledAt !== 'number' || Number.isFinite(option.scheduledAt) === false);
                    if (task.ownerFingerprint !== this.ownerFingerprint) {
                        task.status = 'paused';
                        task.updatedAt = Date.now();
                        await repository.save(task);
                        this.recoveryQueue.set(task.encodeId, {
                            task,
                            option,
                            reason: '別のサーバーまたはインストール環境で作成されたタスクです。',
                        });
                        this.log.encode.warn(
                            `encode task ${task.encodeId} belongs to another server or install path; automatic restore skipped`,
                        );
                        continue;
                    }
                    if (typeof encodeConfig === 'undefined') {
                        task.status = 'needs_attention';
                        task.updatedAt = Date.now();
                        await repository.save(task);
                        this.recoveryQueue.set(task.encodeId, {
                            task,
                            option,
                            reason: `エンコードモード「${option.mode}」が現在の設定にありません。`,
                        });
                        this.log.encode.warn(
                            `encode mode is missing for persisted task: ${task.encodeId} ${option.mode}`,
                        );
                        continue;
                    }

                    const effectiveStatus =
                        task.status === 'waiting' || task.status === 'running' || task.status === 'scheduled'
                            ? task.status
                            : typeof option.scheduledAt !== 'undefined'
                              ? 'scheduled'
                              : Number(task.startedAt) > 0
                                ? 'running'
                                : 'waiting';

                    if (effectiveStatus === 'scheduled') {
                        if (hasInvalidScheduledAt || typeof option.scheduledAt !== 'number') {
                            task.status = 'needs_attention';
                            task.updatedAt = Date.now();
                            await repository.save(task);
                            this.recoveryQueue.set(task.encodeId, {
                                task,
                                option,
                                reason: 'エンコード予約の解放時刻が不正です。',
                            });
                            this.log.encode.warn(`scheduled encode time is invalid: ${task.encodeId}`);
                            continue;
                        }
                        if (option.scheduledAt > Date.now()) {
                            this.scheduledQueue.push({ option, scheduledAt: option.scheduledAt });
                            this.log.encode.info(`restore scheduled encode: ${task.encodeId}`);
                        } else {
                            overdueScheduledOptions.push(option);
                            this.log.encode.info(`release overdue scheduled encode on restore: ${task.encodeId}`);
                        }
                        continue;
                    }

                    const shouldResumeInterruptedAmatsukaze =
                        encodeConfig.type === 'amatsukaze' &&
                        (effectiveStatus === 'running' ||
                            option.resumeExistingAmatsukaze === true ||
                            option.restartInterruptedAmatsukaze === true);
                    if (shouldResumeInterruptedAmatsukaze) {
                        // Amatsukaze keeps its server-side queue alive when only NeoEPGStation restarts.
                        // Reconnect by the persisted task ID first, then fall back to the source path if
                        // the ID changed. Canceling the entire Amatsukaze queue can affect unrelated jobs.
                        option.resumeExistingAmatsukaze = true;
                        delete option.restartInterruptedAmatsukaze;
                        option.recoveryStartedAt = Number(task.startedAt) || Number(task.updatedAt);
                        if (task.outputFilePath !== null) option.recoveryOutputFilePath = task.outputFilePath;
                        this.log.encode.info(`resume Amatsukaze task monitoring: ${task.encodeId}`);
                    } else if (effectiveStatus === 'running') {
                        if (task.outputFilePath !== null) option.recoveryOutputFilePath = task.outputFilePath;
                        this.log.encode.warn(`restart interrupted internal encode from beginning: ${task.encodeId}`);
                    } else {
                        this.log.encode.info(`restore waiting encode: ${task.encodeId}`);
                    }

                    const encoder = await this.encoderModelProvider();
                    encoder.setOption(option);
                    this.waitQueue.push(encoder);
                }

                for (const option of overdueScheduledOptions) {
                    delete option.scheduledAt;
                    const encoder = await this.encoderModelProvider();
                    encoder.setOption(option);
                    this.waitQueue.push(encoder);
                }

                this.idCnt = Math.max(this.idCnt, maxEncodeId + 1);
                this.sortScheduledQueue();
                await this.saveWaitQueuePositions();
                await this.saveScheduledQueuePositions();
                this.refreshScheduledTimer();
                if (this.waitQueue.length > 0) {
                    process.nextTick(() => this.emitNeedsCheckQueue());
                }
                this.encodeEvent.emitUpdateEncode();
                return;
            } catch (err: any) {
                this.log.encode.error('restore persisted encode queue failed; retrying');
                this.log.encode.error(err);
                await new Promise<void>(resolve => {
                    const timer = setTimeout(resolve, EncodeManageModel.RESTORE_RETRY_DELAY);
                    timer.unref();
                });
            }
        }
    }

    private async saveTask(
        option: EncodeOption,
        status: 'scheduled' | 'waiting' | 'running',
        position: number,
        startedAt: number,
    ): Promise<void> {
        const repository = (await this.dbOperator.getConnection()).getRepository(EncodeTask);
        const current = await repository.findOne({ where: { encodeId: option.encodeId } });
        const now = Date.now();
        await repository.save({
            encodeId: option.encodeId,
            optionJson: JSON.stringify(option),
            status,
            position,
            ownerFingerprint: this.ownerFingerprint,
            startedAt:
                status === 'running'
                    ? (option.recoveryStartedAt ?? (startedAt > 0 ? startedAt : now))
                    : current === null
                      ? 0
                      : Number(current.startedAt),
            outputFilePath: current?.outputFilePath ?? null,
            createdAt: current === null ? now : Number(current.createdAt),
            updatedAt: now,
        });
    }

    private async deleteTask(encodeId: apid.EncodeId): Promise<void> {
        const repository = (await this.dbOperator.getConnection()).getRepository(EncodeTask);
        await repository.delete({ encodeId });
    }

    private async saveOutputFilePath(encodeId: apid.EncodeId, outputFilePath: string | null): Promise<void> {
        const repository = (await this.dbOperator.getConnection()).getRepository(EncodeTask);
        await repository.update({ encodeId }, { outputFilePath, updatedAt: Date.now() });
    }

    private async saveAmatsukazeTaskId(option: EncodeOption): Promise<void> {
        const repository = (await this.dbOperator.getConnection()).getRepository(EncodeTask);
        await repository.update(
            { encodeId: option.encodeId },
            { optionJson: JSON.stringify(option), updatedAt: Date.now() },
        );
    }

    private async saveWaitQueuePositions(): Promise<void> {
        for (let position = 0; position < this.waitQueue.length; position++) {
            const option = this.waitQueue[position].getEncodeOption();
            if (option !== null) await this.saveTask(option, 'waiting', position, 0);
        }
    }

    private async saveScheduledQueuePositions(): Promise<void> {
        for (let position = 0; position < this.scheduledQueue.length; position++) {
            const item = this.scheduledQueue[position];
            await this.saveTask(item.option, 'scheduled', position, 0);
        }
    }
}

namespace EncodeManageModel {
    export const UNLOCK_EVENT = 'unlockEvent';
    export const UNLOCK_TIMEOUT = 1000 * 60;
    export const CANCEL_ENCODE_PRIPORITY = 1;
    export const ADD_ENCODE_PRIPORITY = 2;
    export const CREATE_ENCODING_PROCESS_PRIPORITY = 2;
    export const RELEASE_SCHEDULED_ENCODE_PRIORITY = 2;
    export const REORDER_ENCODE_PRIORITY = 3;
    export const CLEAR_QUEUE_PRIPORITY = 3;
    export const DELETE_ENCODE_SOURCE_PRIORITY = 4;
    export const NEEDS_CHECK_QUEUE_EVENT = 'needsCheckQueue';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
    export const MAX_TIMER_DELAY = 2_147_483_647;
    export const RELEASE_RETRY_DELAY = 30_000;
    export const QUEUE_RETRY_DELAY = 5_000;
    export const OUTPUT_PATH_SAVE_RETRY_DELAY = 5_000;
    export const FINALIZE_RETRY_DELAY = 5_000;
    export const RESTORE_RETRY_DELAY = 5_000;
}

export default EncodeManageModel;
