import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import ILoggerModel from '../ILoggerModel';
import IConfiguration from '../IConfiguration';
import IAnnictApiModel from '../api/annict/IAnnictApiModel';
import container from '../ModelContainer';
import * as containerSetter from '../ModelContainerSetter';
import IEncodeFinishModel from './encode/IEncodeFinishModel';
import IServiceServer from './IServiceServer';
import { isAddressInUseError, SERVICE_EXIT_CODE_ADDRESS_IN_USE, ServiceProcessMessage } from './ServiceProcess';
install();

containerSetter.set(container);

const loggerModel = container.get<ILoggerModel>('ILoggerModel');
loggerModel.initialize(path.join(__dirname, '..', '..', '..', 'config', 'serviceLogConfig.yml'));

const log = loggerModel.getLogger();
let isFatalExitScheduled = false;
const scheduleFatalExit = (err: unknown): void => {
    if (isFatalExitScheduled) return;
    isFatalExitScheduled = true;
    const exitCode = isAddressInUseError(err) ? SERVICE_EXIT_CODE_ADDRESS_IN_USE : 1;
    setImmediate(() => process.exit(exitCode));
};
process.on('uncaughtException', err => {
    log.system.fatal(`uncaughtException: ${err}`);
    scheduleFatalExit(err);
});

process.on('unhandledRejection', err => {
    log.system.fatal(`unhandledRejection: ${err}`);
    scheduleFatalExit(err);
});

if (typeof process.send === 'function') {
    const heartbeat = setInterval(() => {
        process.send?.({ type: 'heartbeat' } satisfies ServiceProcessMessage);
    }, 5_000);
    heartbeat.unref();
}

const isProcessRunning = (pid: number): boolean => {
    try {
        process.kill(pid, 0);
        return true;
    } catch (err: any) {
        return err?.code !== 'ESRCH';
    }
};

const cleanupVodHlsTempDirs = (): void => {
    const tmpDir = container.get<IConfiguration>('IConfiguration').getConfig().temporaryDir ?? os.tmpdir();
    const webPlaybackPrefix = 'neoepgstation-web-playback-';
    const targetPrefixes = ['epgstation-vodhls-', 'epgstation-encoded-vodhls-', webPlaybackPrefix];
    const targetNames = new Set(['epgstation-vodhls-subtitles']);
    let removedCount = 0;

    fs.mkdirSync(tmpDir, { recursive: true });
    for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
        if (
            entry.isDirectory() === false ||
            (targetNames.has(entry.name) === false &&
                targetPrefixes.some(prefix => entry.name.startsWith(prefix)) === false)
        ) {
            continue;
        }
        if (entry.name.startsWith(webPlaybackPrefix)) {
            const ownerPid = Number(entry.name.slice(webPlaybackPrefix.length));
            if (Number.isSafeInteger(ownerPid) && ownerPid > 0 && isProcessRunning(ownerPid)) {
                continue;
            }
        }

        const targetPath = path.join(tmpDir, entry.name);
        try {
            fs.rmSync(targetPath, { force: true, recursive: true });
            removedCount++;
        } catch (err: any) {
            log.system.warn(`failed to remove playback temp dir: ${targetPath}`);
            log.system.warn(err);
        }
    }

    if (removedCount > 0) {
        log.system.info(`removed stale playback temp dirs: ${removedCount.toString(10)}`);
    }
};

cleanupVodHlsTempDirs();

const encodeFinishModel = container.get<IEncodeFinishModel>('IEncodeFinishModel');
encodeFinishModel.set();

const serviceServer = container.get<IServiceServer>('IServiceServer');
void serviceServer
    .start()
    .then(() => {
        process.send?.({ type: 'ready' } satisfies ServiceProcessMessage);
    })
    .catch((err: any) => {
        log.system.fatal(err);
        console.error(err?.stack ?? err);
        scheduleFatalExit(err);
    });

const annictApiModel = container.get<IAnnictApiModel>('IAnnictApiModel');
let isAnnictRetryRunning = false;
const retryPendingAnnictWrites = async (): Promise<void> => {
    if (isAnnictRetryRunning) return;
    isAnnictRetryRunning = true;
    try {
        await annictApiModel.retryPendingEpisodeSyncs();
    } catch (err) {
        log.system.warn(`Annict pending write retry failed: ${err}`);
    } finally {
        isAnnictRetryRunning = false;
    }
};
const annictRetryStartupTimer = setTimeout(() => void retryPendingAnnictWrites(), 30_000);
annictRetryStartupTimer.unref();
const annictRetryTimer = setInterval(() => void retryPendingAnnictWrites(), 60_000);
annictRetryTimer.unref();
process.once('exit', () => {
    clearTimeout(annictRetryStartupTimer);
    clearInterval(annictRetryTimer);
});
