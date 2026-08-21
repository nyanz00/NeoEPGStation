import * as child_process from 'child_process';
import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import IEPGUpdateExecutorManageModel from './model/epgUpdater/IEPGUpdateExecutorManageModel';
import IEventSetter from './model/event/IEventSetter';
import IConfiguration from './model/IConfiguration';
import IConnectionCheckModel from './model/IConnectionCheckModel';
import ILoggerModel from './model/ILoggerModel';
import IMirakurunClientModel from './model/IMirakurunClientModel';
import IIPCServer from './model/ipc/IIPCServer';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';
import IRecordingManageModel from './model/operator/recording/IRecordingManageModel';
import IReservationManageModel from './model/operator/reservation/IReservationManageModel';
import IStorageManageModel from './model/operator/storage/IStorageManageModel';
import { SERVICE_EXIT_CODE_ADDRESS_IN_USE, ServiceProcessMessage } from './model/service/ServiceProcess';
import ProcessUtil from './util/ProcessUtil';
install();

containerSetter.set(container);

/**
 * 初期処理
 */
const init = async () => {
    const logger = container.get<ILoggerModel>('ILoggerModel');
    logger.initialize();

    const log = logger.getLogger();
    process.on('uncaughtException', err => {
        log.system.fatal(`uncaughtException: ${err.message}`);
        log.system.fatal(err);
        process.exitCode = 1;
        setImmediate(() => process.exit(1));
    });

    process.on('unhandledRejection', err => {
        log.system.fatal('unhandledRejection');
        log.system.fatal(err);
        process.exitCode = 1;
        setImmediate(() => process.exit(1));
    });

    const config = container.get<IConfiguration>('IConfiguration').getConfig();

    // set uid & gid
    if (process.platform !== 'win32' && typeof process.getuid !== 'undefined' && process.getuid() === 0) {
        // gid
        if (typeof process.setgid !== 'undefined') {
            if (typeof config.gid === 'string' || typeof config.gid === 'number') {
                process.setgid(config.gid);
            } else {
                process.setgid('video');
            }
        }

        // uid
        if (typeof process.setuid !== 'undefined') {
            if (typeof config.uid === 'string' || typeof config.uid === 'number') {
                process.setuid(config.uid);
            }
        }
    }

    // uid, gid が設定されてから再度 log 再設定
    logger.initialize(path.join(__dirname, '..', 'config', 'operatorLogConfig.yml'));

    // 接続確認
    const connectionChecker = container.get<IConnectionCheckModel>('IConnectionCheckModel');
    // wait mirakurun
    await connectionChecker.checkMirakurun();

    // wait DB
    await connectionChecker.checkDB();
};

/**
 * Operator 機能起動処理
 */
const runOperator = async () => {
    const client = container.get<IMirakurunClientModel>('IMirakurunClientModel').getClient();

    const eventSetter = container.get<IEventSetter>('IEventSetter');
    eventSetter.set();

    const reservationManageModel = container.get<IReservationManageModel>('IReservationManageModel');
    const recordingManager = container.get<IRecordingManageModel>('IRecordingManageModel');

    const tuners = await client.getTuners();
    reservationManageModel.setTuners(tuners);
    recordingManager.setTuner(tuners);

    const storageManageModel = container.get<IStorageManageModel>('IStorageManageModel');
    storageManageModel.start();
};

/**
 * Service 起動処理
 */
const SERVICE_RESTART_LIMIT = 5;
let serviceRestartCount = 0;
const runService = async () => {
    const startedAt = Date.now();
    const child = child_process.spawn(
        process.argv[0],
        [path.join(__dirname, 'model', 'service', 'ServiceExecutor.js')],
        {
            stdio: ['ignore', 'ignore', 'pipe', 'ipc'],
        },
    );

    const log = container.get<ILoggerModel>('ILoggerModel').getLogger();
    let isRestartScheduled = false;
    let resolveReady: () => void = () => {};
    const ready = new Promise<void>(resolve => {
        resolveReady = resolve;
    });
    let lastHeartbeatAt = Date.now();
    let isHeartbeatTerminationStarted = false;
    const stopWithoutRestart = (reason: string): void => {
        log.system.fatal(reason);
        log.system.fatal('stop NeoEPGStation without restarting service');
        process.exitCode = 1;
        setImmediate(() => process.exit(1));
    };
    child.on('message', message => {
        if (typeof message !== 'object' || message === null || !('type' in message)) return;
        const serviceMessage = message as ServiceProcessMessage;
        if (serviceMessage.type === 'heartbeat') lastHeartbeatAt = Date.now();
        if (serviceMessage.type === 'ready') resolveReady();
    });
    const heartbeatMonitor = setInterval(() => {
        if (Date.now() - lastHeartbeatAt <= 20_000 || isHeartbeatTerminationStarted) return;
        isHeartbeatTerminationStarted = true;
        log.system.fatal('service heartbeat timed out; terminate stalled service process');
        void ProcessUtil.kill(child).catch(err => {
            log.system.fatal(`failed to terminate stalled service: ${err instanceof Error ? err.message : err}`);
        });
    }, 5_000);
    heartbeatMonitor.unref();
    const scheduleRestart = (reason: string): void => {
        if (isRestartScheduled) return;
        isRestartScheduled = true;
        const uptime = Date.now() - startedAt;
        serviceRestartCount = uptime >= 30_000 ? 0 : serviceRestartCount + 1;
        if (serviceRestartCount >= SERVICE_RESTART_LIMIT) {
            stopWithoutRestart(
                `service process failed ${serviceRestartCount.toString(10)} times without staying up for 30 seconds: ${reason}`,
            );
            return;
        }
        const delay = Math.min(30_000, 1_000 * 2 ** Math.min(serviceRestartCount, 5));
        log.system.fatal(`service process is down: ${reason}`);
        log.system.fatal(`restart service in ${delay.toString(10)} ms`);
        setTimeout(() => {
            void runService().then(resolveReady);
        }, delay);
    };
    child.once('exit', (code, signal) => {
        clearInterval(heartbeatMonitor);
        if (code === SERVICE_EXIT_CODE_ADDRESS_IN_USE) {
            stopWithoutRestart('service listen address is already in use');
            return;
        }
        scheduleRestart(`code=${code?.toString(10) ?? 'null'}, signal=${signal ?? 'null'}`);
    });
    child.once('error', err => {
        log.system.fatal(`service process spawn error: ${err.stack ?? err.message}`);
        scheduleRestart('spawn error');
    });

    if (child.stderr !== null) {
        child.stderr.setEncoding('utf8');
        child.stderr.on('data', (data: string) => {
            const message = data.trimEnd();
            if (message.length > 0) log.system.fatal(`service stderr:\n${message}`);
        });
    }

    // IPC 通信設定
    const ipcServer = container.get<IIPCServer>('IIPCServer');
    ipcServer.register(child);

    log.system.info(`start service pid: ${child.pid}`);

    await ready;
};

/**
 * クリーンアップ処理
 */
const cleanup = async () => {
    const reservationManageModel = container.get<IReservationManageModel>('IReservationManageModel');
    const recordingManager = container.get<IRecordingManageModel>('IRecordingManageModel');

    await recordingManager.cleanup();
    await reservationManageModel.cleanup();
};

/**
 * EPGUpdater 起動処理
 */
const runEPGUpdater = async () => {
    const epgUpdateExecutorManageModel = container.get<IEPGUpdateExecutorManageModel>('IEPGUpdateExecutorManageModel');
    epgUpdateExecutorManageModel.execute();
};

(async () => {
    try {
        await init();
    } catch (err: any) {
        console.error('initialize error');
        console.error(err);
        process.exit(1);
    }

    await runOperator();

    await runService();

    await cleanup();

    await runEPGUpdater();
})();
