import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import 'reflect-metadata';
import { install } from 'source-map-support';
import ILoggerModel from '../ILoggerModel';
import container from '../ModelContainer';
import * as containerSetter from '../ModelContainerSetter';
import IEncodeFinishModel from './encode/IEncodeFinishModel';
import IServiceServer from './IServiceServer';
install();

containerSetter.set(container);

const loggerModel = container.get<ILoggerModel>('ILoggerModel');
loggerModel.initialize(path.join(__dirname, '..', '..', '..', 'config', 'serviceLogConfig.yml'));

const log = loggerModel.getLogger();
process.on('uncaughtException', err => {
    log.system.fatal(`uncaughtException: ${err}`);
});

process.on('unhandledRejection', err => {
    log.system.fatal(`unhandledRejection: ${err}`);
});

const cleanupVodHlsTempDirs = (): void => {
    const tmpDir = os.tmpdir();
    const targetPrefixes = ['epgstation-vodhls-', 'epgstation-encoded-vodhls-'];
    let removedCount = 0;

    for (const entry of fs.readdirSync(tmpDir, { withFileTypes: true })) {
        if (entry.isDirectory() === false || targetPrefixes.some(prefix => entry.name.startsWith(prefix)) === false) {
            continue;
        }

        const targetPath = path.join(tmpDir, entry.name);
        try {
            fs.rmSync(targetPath, { force: true, recursive: true });
            removedCount++;
        } catch (err: any) {
            log.system.warn(`failed to remove VOD HLS temp dir: ${targetPath}`);
            log.system.warn(err);
        }
    }

    if (removedCount > 0) {
        log.system.info(`removed stale VOD HLS temp dirs: ${removedCount.toString(10)}`);
    }
};

cleanupVodHlsTempDirs();

const encodeFinishModel = container.get<IEncodeFinishModel>('IEncodeFinishModel');
encodeFinishModel.set();

const serviceServer = container.get<IServiceServer>('IServiceServer');
try {
    serviceServer.start();
} catch (err: any) {
    log.system.fatal(err);
    process.exit(1);
}
