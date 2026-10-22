import { ChildProcess, spawn } from 'child_process';
import { getDiskUsage } from '../../../util/DiskUsage.js';
import { inject, injectable } from 'inversify';
import Recorded from '../../../db/entities/Recorded.js';
import ProcessUtil from '../../../util/ProcessUtil.js';
import { killManaged } from '../../../util/ManagedProcess.js';
import Util from '../../../util/Util.js';
import IRecordedDB from '../../db/IRecordedDB.js';
import IConfigFile, { RecordedDirInfo } from '../../IConfigFile.js';
import IConfiguration from '../../IConfiguration.js';
import ILogger from '../../ILogger.js';
import ILoggerModel from '../../ILoggerModel.js';
import IRecordedManageModel from '../recorded/IRecordedManageModel.js';
import IStorageManageModel from './IStorageManageModel.js';

@injectable()
export default class StorageManageModel implements IStorageManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private recordedManage: IRecordedManageModel;
    private recordedDB: IRecordedDB;

    private isRunning: boolean = false;
    private timerId: NodeJS.Timeout | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IRecordedManageModel') recordedManage: IRecordedManageModel,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.recordedManage = recordedManage;
        this.recordedDB = recordedDB;
    }

    /**
     * 空き容量チェック開始
     */
    public start(): void {
        const checkList: RecordedDirInfo[] = [];
        for (const r of this.config.recorded) {
            if (typeof r.limitThreshold !== 'undefined') {
                checkList.push(r);
            }
        }

        // 空き容量チェックが必要なければ何もしない
        if (checkList.length === 0) {
            return;
        }

        this.timerId = setInterval(async () => {
            await this.check(checkList).catch(err => {
                this.isRunning = false;
                this.log.system.error('disk check error');
                this.log.system.error(err);
            });
        }, this.config.storageLimitCheckIntervalTime * 1000);
    }

    /**
     * 空き容量をチェックし、空きがなければ録画を削除する
     * @param list: RecordedDirInfo[]
     */
    private async check(list: RecordedDirInfo[]): Promise<void> {
        if (this.isRunning === true) {
            return;
        }
        this.isRunning = true;

        for (const l of list) {
            if (typeof l.limitThreshold === 'undefined') {
                continue;
            }

            let free: number;
            try {
                free = await this.getFreeSize(l.path);
            } catch (err: any) {
                this.log.system.error(`get disk info error: ${l.path}`);
                this.log.system.error(err);

                continue;
            }
            free = free / 1024 / 1024; // MB に換算

            // 空き容量が閾値を超えたか
            if (free > l.limitThreshold) {
                continue;
            }

            if (typeof l.limitCmd !== 'undefined') {
                // run cmd
                this.log.system.info(`run storage limit cmd: ${l.limitCmd}`);
                try {
                    const cmds = ProcessUtil.parseCmdStr(l.limitCmd);
                    // 互換性のためここでは全ての環境変数を渡すため env は未指定
                    const child = spawn(cmds.bin, cmds.args, {
                        stdio: 'ignore',
                        detached: process.platform !== 'win32',
                        windowsHide: true,
                    });
                    await this.waitForLimitCommand(child, l.limitCmd);
                } catch (err: any) {
                    this.log.system.error(`limit cmd error: ${l.limitCmd}`);
                    this.log.system.error(err);
                }
            }

            if (l.action === 'remove') {
                while (free <= l.limitThreshold) {
                    this.log.system.info(`name: ${l.name}, free: ${free}, threshold: ${l.limitThreshold}`);

                    // 削除
                    let recorded: Recorded | null = null;
                    try {
                        recorded = await this.recordedDB.findOld();
                    } catch (err: any) {
                        this.log.system.error('failed to find old recorded');
                        this.log.system.error(err);
                        break;
                    }

                    // 削除すべき録画が見つからなかった
                    if (recorded === null) {
                        this.log.system.error('find old recorded error');
                        break;
                    }

                    // 録画を削除
                    try {
                        this.log.system.info(`storage limit remove recorded: ${recorded.id}`);
                        await this.recordedManage.delete(recorded.id);
                    } catch (err: any) {
                        this.log.system.error(err);
                        break;
                    }

                    // 空き容量取得
                    try {
                        free = await this.getFreeSize(l.path);
                    } catch (err: any) {
                        this.log.system.error(`get disk info error: ${l.path}`);
                        this.log.system.error(err);
                        break;
                    }

                    await Util.sleep(100);
                }
            }
        }

        this.isRunning = false;
    }

    private waitForLimitCommand(child: ChildProcess, command: string): Promise<void> {
        const timeout = this.config.storageCommandTimeout ?? 300_000;
        return new Promise<void>((resolve, reject) => {
            let settled = false;
            let timedOut = false;
            let killPending = false;
            let retryTimer: NodeJS.Timeout | null = null;

            const cleanup = (): void => {
                clearTimeout(timer);
                if (retryTimer !== null) clearTimeout(retryTimer);
                child.removeListener('exit', onExit);
                child.removeListener('error', onError);
            };
            const finish = (error?: Error): void => {
                if (settled) return;
                settled = true;
                cleanup();
                if (error !== undefined) reject(error);
                else resolve();
            };
            const finishTimeout = (): void => finish(new Error('StorageCommandTimeout'));
            const onExit = (): void => {
                if (timedOut) {
                    if (child.pid === undefined) finishTimeout();
                    return;
                }
                if (child.exitCode === 0) this.log.system.info(`storage limit cmd finished: ${command}`);
                else this.log.system.error(`storage limit cmd failed: ${command}. exit: ${child.exitCode}`);
                finish();
            };
            const onError = (error: Error): void => {
                this.log.system.error(`storage limit cmd failed: ${command}`);
                this.log.system.error(error);
                if (timedOut) {
                    if (child.pid === undefined) finishTimeout();
                    return;
                }
                finish();
            };

            const confirmStop = (): void => {
                if (settled || killPending) return;
                if (child.pid === undefined) {
                    finishTimeout();
                    return;
                }
                killPending = true;
                void killManaged(child).then(
                    () => {
                        killPending = false;
                        finishTimeout();
                    },
                    error => {
                        killPending = false;
                        this.log.system.error(`StorageCommandTimeout: failed to confirm process stop for ${command}`);
                        this.log.system.error(error);
                        if (child.pid === undefined && (child.exitCode !== null || child.signalCode !== null)) {
                            finishTimeout();
                            return;
                        }
                        retryTimer = setTimeout(() => {
                            retryTimer = null;
                            confirmStop();
                        }, 5_000);
                        retryTimer.unref();
                    },
                );
            };
            const timer = setTimeout(() => {
                if (settled) return;
                timedOut = true;
                this.log.system.error(`StorageCommandTimeout: ${command} exceeded ${timeout}ms; stopping process`);
                confirmStop();
            }, timeout);

            child.once('exit', onExit);
            child.once('error', onError);
            if (child.exitCode !== null || child.signalCode !== null) onExit();
        });
    }

    /**
     * 空き容量を取得する
     * @param dirPath: ディレクトリパス
     * @return Promise<number>
     */
    private async getFreeSize(dirPath: string): Promise<number> {
        return (await getDiskUsage(dirPath)).available;
    }

    /**
     * 空き容量チェックを停止
     */
    public stop(): void {
        if (this.timerId !== null) {
            clearInterval(this.timerId);
        }
    }
}
