import * as path from 'path';
import 'reflect-metadata';
import ILoggerModel from '../ILoggerModel';
import IDBOperator from '../db/IDBOperator';
import container from '../ModelContainer';
import * as containerSetter from '../ModelContainerSetter';
import IEPGUpdater from './IEPGUpdater';
import ProcessShutdown from '../../util/ProcessShutdown';

containerSetter.set(container);

const loggerModel = container.get<ILoggerModel>('ILoggerModel');
loggerModel.initialize(path.join(__dirname, '..', '..', '..', 'config', 'epgUpdaterLogConfig.yml'));

const log = loggerModel.getLogger();
process.on('uncaughtException', err => {
    log.system.fatal(`uncaughtException: ${err}`);
});

process.on('unhandledRejection', err => {
    log.system.fatal(`unhandledRejection: ${err}`);
});

const updater = container.get<IEPGUpdater>('IEPGUpdater');
const shutdown = new ProcessShutdown(
    async reason => {
        log.system.info(`close EPG updater database connection: ${reason}`);
        await container.get<IDBOperator>('IDBOperator').closeConnection();
    },
    err => log.system.warn(`EPG updater database shutdown failed: ${err}`),
    5_000,
);
process.on('message', message => {
    if (
        typeof message !== 'object' ||
        message === null ||
        !('type' in message) ||
        message.type !== 'update-shutdown-request'
    ) {
        return;
    }
    shutdown.request('parent request');
});

(async () => {
    // 初回更新 or event stream 更新時にエラーが発生する
    await updater.start().catch(() => {
        process.exit(1);
    });
})();
