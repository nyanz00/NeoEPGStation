import * as child_process from 'child_process';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import ProcessUtil from '../../util/ProcessUtil';
import IEPGUpdateEvent from '../event/IEPGUpdateEvent';
import ILogger from '../ILogger';
import ILoggerModel from '../ILoggerModel';
import IEPGUpdateExecutorManageModel from './IEPGUpdateExecutorManageModel';

@injectable()
export default class EPGUpdateExecutorManageModel implements IEPGUpdateExecutorManageModel {
    private log: ILogger;
    private epgUpdateEvent: IEPGUpdateEvent;
    private isRestarting: boolean = false;
    private isShuttingDown: boolean = false;
    private executor: child_process.ChildProcess | null = null;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEPGUpdateEvent') epgUpdateEvent: IEPGUpdateEvent,
    ) {
        this.log = logger.getLogger();
        this.epgUpdateEvent = epgUpdateEvent;
    }

    /**
     * EPGUpdateExecutor を実行する
     */
    public async execute(): Promise<void> {
        if (this.isShuttingDown === true) return;
        const executor = child_process.spawn(process.argv[0], [path.join(__dirname, 'EPGUpdateExecutor.js')], {
            stdio: ['ignore', 'pipe', 'pipe', 'ipc'],
        });
        this.executor = executor;

        this.log.system.info(`start epg updater pid: ${executor.pid}`);

        // epg 更新完了
        executor.on('message', msg => {
            if ((<any>msg).msg === 'updated') {
                // epg 更新完了イベントを発行
                this.epgUpdateEvent.emitUpdated();
            }
        });
        /**
         * エラー処理
         */
        executor.once('exit', () => {
            if (this.executor === executor) this.executor = null;
            if (this.isShuttingDown === true) return;
            this.log.system.fatal('epg updater is abort');

            this.restart(executor);
        });
        executor.once('disconnect', () => {
            if (this.isShuttingDown === true) return;
            this.log.system.fatal('epg updater is disconnected');

            executor.kill('SIGINT');
            this.restart(executor);
        });
        executor.once('close', () => {
            if (this.isShuttingDown === true) return;
            this.log.system.fatal('epg update is closed');

            this.restart(executor);
        });
        executor.once('error', err => {
            if (this.isShuttingDown === true) return;
            this.log.system.fatal('epg updater is error');
            this.log.system.error(err);

            this.restart(executor);
        });

        // buffer が埋まらないようにする
        if (executor.stdout !== null) {
            executor.stdout.on('data', () => {});
        }
        if (executor.stderr !== null) {
            executor.stderr.on('data', () => {});
        }

        // TODO ping pong
    }

    /**
     * executor 再スタート
     * @param executor child_process.ChildProcess
     */
    private restart(executor: child_process.ChildProcess): void {
        if (this.isRestarting === true || this.isShuttingDown === true) {
            return;
        }

        this.isRestarting = true;
        executor.removeAllListeners();
        if (executor.stdout !== null) {
            executor.stdout.removeAllListeners();
        }
        if (executor.stderr !== null) {
            executor.stderr.removeAllListeners();
        }

        // restart
        this.isRestarting = false;
        void this.execute();
    }

    public async shutdownForUpdate(): Promise<void> {
        this.isShuttingDown = true;
        const executor = this.executor;
        if (executor === null || executor.exitCode !== null || executor.signalCode !== null) return;

        this.log.system.info('request EPG updater database shutdown for Web UI update');
        const exited = new Promise<boolean>(resolve => {
            const timeout = setTimeout(() => finish(false), 5_000);
            const finish = (value: boolean): void => {
                clearTimeout(timeout);
                executor.removeListener('exit', onExit);
                resolve(value);
            };
            const onExit = (): void => finish(true);
            executor.once('exit', onExit);
        });

        try {
            executor.send?.({ type: 'update-shutdown-request' }, err => {
                if (err !== null) this.log.system.warn(`EPG updater database shutdown IPC failed: ${err.message}`);
            });
        } catch (err) {
            this.log.system.warn(`failed to request EPG updater shutdown: ${err}`);
        }

        if ((await exited) === false) {
            this.log.system.warn('EPG updater database shutdown timed out; force terminating process');
            await ProcessUtil.kill(executor, 0);
        }
        if (this.executor === executor) this.executor = null;
    }
}
