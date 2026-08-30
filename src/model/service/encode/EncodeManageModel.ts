import * as path from 'path';
import * as events from 'events';
import { createHash } from 'crypto';
import * as os from 'os';
import { inject, injectable } from 'inversify';
import { cloneDeep } from 'lodash';
import * as apid from '../../../../api';
import EncodeTask from '../../../db/entities/EncodeTask';
import IDBOperator from '../../db/IDBOperator';
import IEncodeEvent from '../../event/IEncodeEvent';
import IConfiguration from '../../IConfiguration';
import IExecutionManagementModel from '../../IExecutionManagementModel';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeManageModel, { EncodeInfoItem, EncodeQueueInfo, EncodeRecordedIdIndex } from './IEncodeManageModel';
import { AddEncodeOption, EncodeOption, EncoderModelProvider, IEncoderModel } from './IEncoderModel';

interface ScheduledEncodeItem {
    option: EncodeOption;
    scheduledAt: number;
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
    ) {
        this.log = logger.getLogger();
        this.configure = configure;
        this.executeManagementModel = executeManagementModel;
        this.concurrentEncodeNum = configure.getConfig().concurrentEncodeNum;
        this.encoderModelProvider = encoderModelProvider;
        this.encodeEvent = encodeEvent;

        this.listener.on(EncodeManageModel.NEEDS_CHECK_QUEUE_EVENT, this.checkQueue.bind(this));
        this.restorePromise = this.restorePersistedQueue();
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
                await this.saveScheduledQueuePositions();
            } catch (err: any) {
                releaseFailed = true;
                this.log.encode.error('save scheduled encode queue positions failed');
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
            if (this.runningQueue.length >= this.concurrentEncodeNum || this.waitQueue.length === 0) return;

            const encoder = this.waitQueue.shift();
            if (typeof encoder === 'undefined') return;

            const encodeOption = encoder.getEncodeOption();
            if (encodeOption === null) {
                this.log.encode.warn('encodeOption is null');
                return;
            }

            this.runningQueue.push(encoder);
            await this.saveTask(encodeOption, 'running', this.runningQueue.length - 1, Date.now());
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
                await this.saveOutputFilePath(encodeOption.encodeId, encoder.getOutputFilePath());
            } catch (err: any) {
                this.log.encode.error(`create encode process error: ${encoder.getEncodeId()}`);
                this.log.encode.error(err);
                this.encodeEvent.emitErrorEncode({
                    recordedId: encodeOption.recordedId,
                    videoFileId: encodeOption.sourceVideoFileId,
                    mode: encodeOption.mode,
                    encoderMessage: err instanceof Error ? err.message : String(err),
                });
                process.nextTick(() => void this.finalize(encodeOption.encodeId));
            }
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }
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

            this.encodeEvent.emitFinishEncode({
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

        // 終了処理
        this.finalize(encodeOption.encodeId);
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

        return false;
    }

    /**
     * 最終処理
     * @param encodeId: apid.EncodeId
     */
    private async finalize(encodeId: apid.EncodeId): Promise<void> {
        // 実行権取得
        const exeId = await this.executeManagementModel.getExecution(EncodeManageModel.CLEAR_QUEUE_PRIPORITY);
        try {
            // runningQueue から encodeId の要素を削除する
            this.runningQueue = this.runningQueue.filter(q => {
                return q.getEncodeId() !== encodeId;
            });
            await this.deleteTask(encodeId);
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        process.nextTick(() => {
            this.emitNeedsCheckQueue();
        });
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

            // runningQueue にあるので プロセスを殺す
            const runningQueueItem = this.getRunnginQueueItem(encodeId);
            if (typeof runningQueueItem !== 'undefined') {
                await runningQueueItem.cancel();
            } else {
                // waitQueue から削除
                this.waitQueue = this.waitQueue.filter(q => {
                    return q.getEncodeId() !== encodeId;
                });
                this.scheduledQueue = this.scheduledQueue.filter(item => item.option.encodeId !== encodeId);
                this.refreshScheduledTimer();

                process.nextTick(() => {
                    this.emitNeedsCheckQueue();
                });
            }
            await this.deleteTask(encodeId);
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        // イベント発行
        this.encodeEvent.emitCancelEncode(encodeId);
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

            this.waitQueue = encodeIds.map(encodeId => queueById.get(encodeId) as IEncoderModel);
            await this.saveWaitQueuePositions();
            this.log.encode.info(`reorder encode queue: ${encodeIds.join(',')}`);
        } finally {
            this.executeManagementModel.unLockExecution(exeId);
        }

        this.encodeEvent.emitUpdateEncodeProgress();
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

        return index;
    }

    /**
     * 指定した recordedId を持つエンコードをキャンセルする
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async cancelEncodeByRecordedId(recordedId: apid.RecordedId): Promise<void> {
        await this.restorePromise;
        const encodeIds: apid.EncodeId[] = [];

        // recordedId に該当する encodedId を取り出す
        // wait queue
        for (const item of this.waitQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (itemOption.recordedId === recordedId) {
                encodeIds.push(itemOption.encodeId);
            }
        }

        // running queue
        for (const item of this.runningQueue) {
            const itemOption = item.getEncodeOption();
            if (itemOption === null) {
                continue;
            }

            if (itemOption.recordedId === recordedId) {
                encodeIds.push(itemOption.encodeId);
            }
        }

        // scheduled queue
        for (const item of this.scheduledQueue) {
            if (item.option.recordedId === recordedId) {
                encodeIds.push(item.option.encodeId);
            }
        }

        // 取り出した encodedId を元にキャンセル指示を出す
        let isError = false;
        for (const encodeId of encodeIds) {
            await this.cancel(encodeId).catch(err => {
                isError = true;
                this.log.encode.error(`cancel encode failed: ${encodeId}`);
                this.log.encode.error(err);
            });
        }

        // キャンセルに失敗した場合はエラーを履く
        if (isError !== false) {
            throw new Error('StopEncodeError');
        }
    }

    /**
     * queue に積まれているエンコード情報を返す
     * @return EncodeQueueInfo
     */
    public getEncodeInfo(): EncodeQueueInfo {
        const queueInfo: EncodeQueueInfo = {
            runningQueue: [],
            waitQueue: [],
            scheduledQueue: [],
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

        return queueInfo;
    }

    private async restorePersistedQueue(): Promise<void> {
        try {
            const repository = (await this.dbOperator.getConnection()).getRepository(EncodeTask);
            const tasks = await repository.find({ order: { position: 'ASC', encodeId: 'ASC' } });
            let maxEncodeId = 0;
            const overdueScheduledOptions: EncodeOption[] = [];

            for (const task of tasks) {
                maxEncodeId = Math.max(maxEncodeId, task.encodeId);
                if (task.ownerFingerprint !== this.ownerFingerprint) {
                    if (task.status !== 'paused') {
                        task.status = 'paused';
                        task.updatedAt = Date.now();
                        await repository.save(task);
                    }
                    this.log.encode.warn(
                        `encode task ${task.encodeId} belongs to another server or install path; automatic restore skipped`,
                    );
                    continue;
                }
                if (task.status !== 'waiting' && task.status !== 'running' && task.status !== 'scheduled') continue;

                let option: EncodeOption;
                try {
                    option = JSON.parse(task.optionJson) as EncodeOption;
                } catch (err: any) {
                    task.status = 'needs_attention';
                    task.updatedAt = Date.now();
                    await repository.save(task);
                    this.log.encode.error(`persisted encode task is invalid: ${task.encodeId}`);
                    this.log.encode.error(err);
                    continue;
                }

                const encodeConfig = this.configure.getConfig().encode.find(item => item.name === option.mode);
                if (typeof encodeConfig === 'undefined') {
                    task.status = 'needs_attention';
                    task.updatedAt = Date.now();
                    await repository.save(task);
                    this.log.encode.warn(`encode mode is missing for persisted task: ${task.encodeId} ${option.mode}`);
                    continue;
                }

                if (task.status === 'scheduled') {
                    if (typeof option.scheduledAt !== 'number' || Number.isFinite(option.scheduledAt) === false) {
                        task.status = 'needs_attention';
                        task.updatedAt = Date.now();
                        await repository.save(task);
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

                const shouldRestartInterruptedAmatsukaze =
                    encodeConfig.type === 'amatsukaze' &&
                    (task.status === 'running' ||
                        option.resumeExistingAmatsukaze === true ||
                        option.restartInterruptedAmatsukaze === true);
                if (shouldRestartInterruptedAmatsukaze) {
                    // Amatsukaze task/console IDs can no longer be trusted after this process restarts.
                    // The first restored task cancels the server-side unfinished snapshot, then every
                    // persisted NeoEPGStation task is submitted again through the normal add flow.
                    delete option.resumeExistingAmatsukaze;
                    delete option.amatsukazeTaskId;
                    option.restartInterruptedAmatsukaze = true;
                    option.recoveryStartedAt = Number(task.startedAt) || Number(task.updatedAt);
                    if (task.outputFilePath !== null) option.recoveryOutputFilePath = task.outputFilePath;
                    this.log.encode.warn(`restart interrupted Amatsukaze task from beginning: ${task.encodeId}`);
                } else if (task.status === 'running') {
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
        } catch (err: any) {
            this.log.encode.error('restore persisted encode queue failed');
            this.log.encode.error(err);
            throw err;
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
    export const NEEDS_CHECK_QUEUE_EVENT = 'needsCheckQueue';
    export const ENCODE_PRIPORITY = 10;
    export const DEFAULT_TIMEOUT_RATE = 4.0;
    export const MAX_TIMER_DELAY = 2_147_483_647;
    export const RELEASE_RETRY_DELAY = 30_000;
}

export default EncodeManageModel;
