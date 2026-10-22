import { inject, injectable } from 'inversify';
import { Client as mirakurun } from 'mirakurun';
import Util from '../util/Util.js';
import IDBOperator from './db/IDBOperator.js';
import IConnectionCheckModel from './IConnectionCheckModel.js';
import ILogger from './ILogger.js';
import ILoggerModel from './ILoggerModel.js';
import IMirakurunClientModel from './IMirakurunClientModel.js';

@injectable()
export default class ConnectionCheckModel implements IConnectionCheckModel {
    private log: ILogger;
    private mirakurunClient: mirakurun;
    private dbOperator: IDBOperator;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IMirakurunClientModel') mirakurunClientModel: IMirakurunClientModel,
        @inject('IDBOperator') dbOperator: IDBOperator,
    ) {
        this.log = logger.getLogger();
        this.mirakurunClient = mirakurunClientModel.getClient();
        this.dbOperator = dbOperator;
    }

    /**
     * mirakurun との接続を待つ
     * @return Promise<void>
     */
    public async checkMirakurun(): Promise<void> {
        while (true) {
            try {
                this.log.system.info('check mirakurun');
                await this.mirakurunClient.getStatus();
                break;
            } catch (err: any) {
                await Util.sleep(1000);
            }
        }
    }

    /**
     * DB との接続を待つ
     */
    public async checkDB(): Promise<void> {
        while (true) {
            try {
                this.log.system.info('check db');
                await this.dbOperator.checkConnection();
                break;
            } catch (err: any) {
                await Util.sleep(1000);
            }
        }
    }
}
