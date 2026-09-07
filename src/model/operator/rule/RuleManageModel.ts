import { inject, injectable } from 'inversify';
import * as apid from '../../../../api';
import IRuleDB from '../../db/IRuleDB';
import IRuleEvent from '../../event/IRuleEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IReserveOptionChecker from '../IReserveOptionChecker';
import IRuleManageModel from './IRuleManageModel';
import IConfiguration from '../../IConfiguration';
import removeMissingEncodePresets from './removeMissingEncodePresets';

@injectable()
export default class RuleManageModel implements IRuleManageModel {
    private pending: Promise<void> = Promise.resolve();
    private releaseLock: (() => void) | undefined;

    private log: ILogger;
    private optionChecker: IReserveOptionChecker;
    private ruleDB: IRuleDB;
    private ruleEvent: IRuleEvent;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IReserveOptionChecker') optionChecker: IReserveOptionChecker,
        @inject('IRuleDB') ruleDB: IRuleDB,
        @inject('IRuleEvent') ruleEvent: IRuleEvent,
        @inject('IConfiguration') private configure: IConfiguration,
    ) {
        this.log = logger.getLogger();
        this.optionChecker = optionChecker;
        this.ruleDB = ruleDB;
        this.ruleEvent = ruleEvent;
    }

    public async removeMissingEncodePresets(): Promise<void> {
        for (const id of await this.ruleDB.getIds()) {
            await this.lockExecution();
            try {
                const rule = await this.ruleDB.findId(id);
                if (rule !== null && removeMissingEncodePresets(rule, this.configure.getConfig())) {
                    await this.ruleDB.updateOnce(rule);
                    this.log.system.info(`removed missing encode presets from rule: ${id}`);
                    this.ruleEvent.emitUpdated(id);
                }
            } catch (err: any) {
                this.log.system.error(`failed to remove missing encode presets from rule: ${id}`);
                this.log.system.error(err);
            } finally {
                this.unlockExecution();
            }
        }
    }

    /**
     * ルールの追加
     * @param rule: apid.AddRuleOption
     * @return Promise<apid.Rule>
     */
    public async add(rule: apid.AddRuleOption): Promise<apid.RuleId> {
        await this.lockExecution();
        try {
            this.log.system.info('add rule');

            // check option
            if (this.optionChecker.checkRuleOption(rule) === false) {
                this.log.system.error('failed to add rule');
                throw new Error('AddRuleError');
            }

            let ruleId!: apid.RuleId;
            try {
                ruleId = await this.ruleDB.insertOnce(rule);
            } catch (err: any) {
                this.log.system.error('insert rule error');
                this.log.system.error(err);
            }

            this.log.system.info(`rule added successfully: ${ruleId}`);

            // 通知
            this.ruleEvent.emitAdded(ruleId);

            return ruleId;
        } finally {
            this.unlockExecution();
        }
    }

    /**
     * ルールの更新
     * @param rule: apid.Rule
     */
    public async update(rule: apid.Rule): Promise<void> {
        await this.lockExecution();
        try {
            // rule が存在するか確認
            const oldRule = await this.ruleDB.findId(rule.id).catch(err => {
                this.log.system.error(err);
                throw err;
            });

            if (oldRule === null) {
                throw new Error('RuleIsNotFound');
            }

            this.log.system.info(`update rule: ${rule.id}`);

            removeMissingEncodePresets(rule, this.configure.getConfig());

            // check option
            if (this.optionChecker.checkRuleOption(rule) === false) {
                this.log.system.error('failed to update rule');
                throw new Error('UpdateRuleError');
            }

            // rule 更新
            try {
                await this.ruleDB.updateOnce(rule);
            } catch (err: any) {
                this.log.system.error(`update rule error: ${rule.id}`);
                throw err;
            }
            this.log.system.info(`rule updated successfully: ${rule.id}`);

            // 通知
            this.ruleEvent.emitUpdated(rule.id);
        } finally {
            this.unlockExecution();
        }
    }

    /**
     * ルール有効化
     * @param ruleId: rule id
     */
    public async enable(ruleId: apid.RuleId): Promise<void> {
        await this.lockExecution();
        try {
            this.log.system.info(`enable rule: ${ruleId}`);

            try {
                await this.ruleDB.enableOnce(ruleId);
            } catch (err: any) {
                this.log.system.error(`enable rule error: ${ruleId}`);
                throw err;
            }

            this.log.system.info(`rule enabled successfully: ${ruleId}`);

            // 通知
            this.ruleEvent.emitEnabled(ruleId);
        } finally {
            this.unlockExecution();
        }
    }

    /**
     * ルール無効化
     * @param ruleId: rule id
     */
    public async disable(ruleId: apid.RuleId): Promise<void> {
        await this.lockExecution();
        try {
            this.log.system.info(`disable rule: ${ruleId}`);

            try {
                await this.ruleDB.disableOnce(ruleId);
            } catch (err: any) {
                this.log.system.error(`disable rule error: ${ruleId}`);
                throw err;
            }

            this.log.system.info(`rule disabled successfully: ${ruleId}`);

            // 通知
            this.ruleEvent.emitDisabled(ruleId);
        } finally {
            this.unlockExecution();
        }
    }

    /**
     * ルール削除
     * @param ruleId: rule id
     */
    public async delete(ruleId: apid.RuleId): Promise<void> {
        await this.lockExecution();
        try {
            this.log.system.info(`delete rule: ${ruleId}`);

            try {
                await this.ruleDB.deleteOnce(ruleId);
            } catch (err: any) {
                this.log.system.error(`delete rule error: ${ruleId}`);
                throw err;
            }

            this.log.system.info(`rule deleted successfully: ${ruleId}`);

            // 通知
            this.ruleEvent.emitDeleted(ruleId);
        } finally {
            this.unlockExecution();
        }
    }

    /**
     * ルール複数削除
     * @param ruleIds: rule ids
     * @return Promise<apid.RuleId[]> 削除出来なかった ruleId を返す
     */
    public async deletes(ruleIds: apid.RuleId[]): Promise<apid.RuleId[]> {
        const failedIds: apid.RuleId[] = [];

        this.log.system.info('deletes rule');
        for (const ruleId of ruleIds) {
            try {
                await this.delete(ruleId);
            } catch (err: any) {
                failedIds.push(ruleId);
            }
        }

        return failedIds;
    }

    /**
     * 実行権をロックする
     */
    private async lockExecution(): Promise<void> {
        const previous = this.pending;
        let release!: () => void;
        this.pending = new Promise(resolve => {
            release = resolve;
        });
        await previous;
        this.releaseLock = release;
    }

    /**
     * 実行権の開放
     */
    private unlockExecution(): void {
        this.releaseLock?.();
        this.releaseLock = undefined;
    }
}
