import axios from 'axios';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';
import { inject, injectable } from 'inversify';
import * as fs from 'fs';
import * as path from 'path';
import * as apid from '../../../../api';
import Recorded from '../../../db/entities/Recorded';
import Reserve from '../../../db/entities/Reserve';
import IChannelDB from '../../db/IChannelDB';
import IRecordedDB from '../../db/IRecordedDB';
import { OperatorErrorEncodeInfo, OperatorFinishEncodeInfo } from '../../event/IOperatorEncodeEvent';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IDiscordNotificationModel from './IDiscordNotificationModel';

interface StoredDestination {
    id: string;
    name: string;
    username: string;
    webhookUrl: string;
}

interface StoredSettings {
    enabled: boolean;
    destinations: StoredDestination[];
    rules: apid.DiscordNotificationRule[];
}

interface EncryptedSettings {
    version: 1;
    encryptedValue: string;
    iv: string;
    authTag: string;
}

interface NotificationValues {
    recordedId: string;
    name: string;
    channelName: string;
    drop: number;
    error: number;
    scrambling: number;
    mode: string;
    encoderMessage: string;
}

@injectable()
export default class DiscordNotificationModel implements IDiscordNotificationModel {
    private static readonly FINISH_DELAY = 1_500;
    private static readonly FAILED_TTL = 60_000;
    private static readonly ID_PATTERN = /^[a-zA-Z0-9_-]{1,64}$/;
    private readonly root = path.join(__dirname, '..', '..', '..', '..', 'data', 'viewer-profiles');
    private readonly settingsPath = path.join(this.root, 'discord-notification.json');
    private readonly keyPath = path.join(this.root, 'credential.key');
    private readonly pendingFinish = new Map<number, NodeJS.Timeout>();
    private readonly failedRecordedIds = new Map<number, number>();
    private encryptionKey?: Buffer;
    private log: ILogger;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IChannelDB') private channelDB: IChannelDB,
        @inject('IRecordedDB') private recordedDB: IRecordedDB,
    ) {
        this.log = logger.getLogger();
    }

    public async getSettings(): Promise<apid.DiscordNotificationSettings> {
        return this.toPublicSettings(await this.readSettings());
    }

    public async updateSettings(
        settings: apid.UpdateDiscordNotificationSettings,
    ): Promise<apid.DiscordNotificationSettings> {
        const current = await this.readSettings();
        const currentById = new Map(current.destinations.map(destination => [destination.id, destination]));
        if (!Array.isArray(settings.destinations) || settings.destinations.length > 20) {
            throw new Error('Discord送信プリセットは20件以内で設定してください');
        }

        const destinations = settings.destinations.map(destination => {
            this.assertId(destination.id, '送信プリセットID');
            const name = this.assertText(destination.name, 80, '送信プリセット名');
            const username = this.assertText(destination.username, 80, 'Discord表示名');
            const previousUrl = currentById.get(destination.id)?.webhookUrl ?? '';
            const webhookUrl =
                destination.clearWebhook === true
                    ? ''
                    : typeof destination.webhookUrl === 'string' && destination.webhookUrl.trim().length > 0
                      ? this.validateWebhookUrl(destination.webhookUrl)
                      : previousUrl;
            return { id: destination.id, name, username, webhookUrl };
        });
        const destinationIds = new Set(destinations.map(destination => destination.id));
        if (destinationIds.size !== destinations.length) throw new Error('Discord送信プリセットIDが重複しています');

        if (!Array.isArray(settings.rules) || settings.rules.length > 50) {
            throw new Error('Discord通知ルールは50件以内で設定してください');
        }
        const rules = settings.rules.map(rule => this.validateRule(rule, destinationIds));
        if (new Set(rules.map(rule => rule.id)).size !== rules.length) {
            throw new Error('Discord通知ルールIDが重複しています');
        }

        const stored: StoredSettings = {
            enabled: settings.enabled === true,
            destinations,
            rules,
        };
        await this.writeSettings(stored);
        return this.toPublicSettings(stored);
    }

    public async testDestination(destinationId: string): Promise<void> {
        const settings = await this.readSettings();
        const destination = settings.destinations.find(item => item.id === destinationId);
        if (destination === undefined) throw new Error('Discord送信プリセットが見つかりません');
        await this.send(destination, 'NeoEPGStationからのテスト通知です。');
    }

    public notifyRecordingStart(recorded: Recorded): void {
        void this.notifyRecordedEvent('recording_start', recorded).catch(err => this.logError(err));
    }

    public notifyRecordingFinish(recorded: Recorded): void {
        this.cleanupFailedIds();
        if (this.failedRecordedIds.has(recorded.id)) return;
        const current = this.pendingFinish.get(recorded.id);
        if (current !== undefined) clearTimeout(current);
        this.pendingFinish.set(
            recorded.id,
            setTimeout(() => {
                this.pendingFinish.delete(recorded.id);
                if (this.failedRecordedIds.has(recorded.id)) return;
                void this.notifyRecordedEvent('recording_finish', recorded).catch(err => this.logError(err));
            }, DiscordNotificationModel.FINISH_DELAY),
        );
    }

    public notifyRecordingFailed(reserve: Reserve, recorded: Recorded | null): void {
        if (recorded !== null) {
            this.failedRecordedIds.set(recorded.id, Date.now() + DiscordNotificationModel.FAILED_TTL);
            const pending = this.pendingFinish.get(recorded.id);
            if (pending !== undefined) clearTimeout(pending);
            this.pendingFinish.delete(recorded.id);
        }
        void this.notifyRecordedEvent('recording_failed', recorded ?? reserve).catch(err => this.logError(err));
    }

    public notifyEncodingFinish(info: OperatorFinishEncodeInfo): void {
        void this.notifyEncodeEvent('encode_finish', info).catch(err => this.logError(err));
    }

    public notifyEncodingFailed(info: OperatorErrorEncodeInfo): void {
        void this.notifyEncodeEvent('encode_failed', info).catch(err => this.logError(err));
    }

    private async notifyRecordedEvent(
        event: apid.DiscordNotificationEvent,
        recorded: Recorded | Reserve,
    ): Promise<void> {
        const channel = await this.channelDB.findId(recorded.channelId);
        const dropLog = recorded instanceof Recorded ? recorded.dropLogFile : undefined;
        await this.notify(event, {
            recordedId: 'id' in recorded ? String(recorded.id) : '',
            name: recorded.name ?? '',
            channelName: channel?.name ?? '',
            drop: dropLog?.dropCnt ?? 0,
            error: dropLog?.errorCnt ?? 0,
            scrambling: dropLog?.scramblingCnt ?? 0,
            mode: '',
            encoderMessage: '',
        });
    }

    private async notifyEncodeEvent(
        event: apid.DiscordNotificationEvent,
        info: OperatorFinishEncodeInfo | OperatorErrorEncodeInfo,
    ): Promise<void> {
        const recorded = await this.recordedDB.findId(info.recordedId);
        if (recorded === null) throw new Error(`Discord通知対象の録画番組が見つかりません: ${info.recordedId}`);
        const channel = await this.channelDB.findId(recorded.channelId);
        await this.notify(event, {
            recordedId: String(recorded.id),
            name: recorded.name,
            channelName: channel?.name ?? '',
            drop: recorded.dropLogFile?.dropCnt ?? 0,
            error: recorded.dropLogFile?.errorCnt ?? 0,
            scrambling: recorded.dropLogFile?.scramblingCnt ?? 0,
            mode: info.mode,
            encoderMessage: 'encoderMessage' in info ? (info.encoderMessage ?? '') : '',
        });
    }

    private async notify(event: apid.DiscordNotificationEvent, values: NotificationValues): Promise<void> {
        const settings = await this.readSettings();
        if (!settings.enabled) return;
        const rule = settings.rules.find(
            item => item.enabled && item.event === event && this.matchesCondition(item.condition, values),
        );
        if (rule === undefined) return;
        const destination = settings.destinations.find(item => item.id === rule.destinationId);
        if (destination === undefined || destination.webhookUrl.length === 0) return;
        const message = this.formatMessage(rule.message, values);
        if (message.length === 0) return;
        await this.send(destination, message);
    }

    private async send(destination: StoredDestination, content: string): Promise<void> {
        if (destination.webhookUrl.length === 0) throw new Error('Discord Webhook URLが設定されていません');
        await axios.post(
            destination.webhookUrl,
            {
                username: destination.username,
                content: content.slice(0, 2_000),
                allowed_mentions: { parse: [] },
            },
            { timeout: 10_000, maxRedirects: 0 },
        );
    }

    private formatMessage(template: string, values: NotificationValues): string {
        const replacements: Record<string, string> = {
            recordedId: values.recordedId,
            name: values.name,
            channelName: values.channelName,
            drop: String(values.drop),
            error: String(values.error),
            scrambling: String(values.scrambling),
            mode: values.mode,
            encoderMessage: this.normalizeEncoderMessage(values.encoderMessage),
        };
        return template.replace(/\{([a-zA-Z]+)\}/g, (matched, key: string) => replacements[key] ?? matched).trim();
    }

    private normalizeEncoderMessage(message: string): string {
        const lines = message
            .replace(new RegExp(`${String.fromCharCode(27)}\\[[0-?]*[ -/]*[@-~]`, 'g'), '')
            .split(/\r?\n|\r/)
            .map(line => line.trim())
            .filter(line => line.length > 0);
        return (lines[lines.length - 1] ?? '').slice(0, 800);
    }

    private matchesCondition(
        condition: apid.DiscordNotificationCondition | undefined,
        values: NotificationValues,
    ): boolean {
        if (condition === undefined) return true;
        return (
            this.inRange(values.drop, condition.dropMin, condition.dropMax) &&
            this.inRange(values.error, condition.errorMin, condition.errorMax) &&
            this.inRange(values.scrambling, condition.scramblingMin, condition.scramblingMax)
        );
    }

    private inRange(value: number, min: number | undefined, max: number | undefined): boolean {
        return (min === undefined || value >= min) && (max === undefined || value <= max);
    }

    private validateRule(
        rule: apid.DiscordNotificationRule,
        destinationIds: Set<string>,
    ): apid.DiscordNotificationRule {
        this.assertId(rule.id, '通知ルールID');
        if (!this.isEvent(rule.event)) throw new Error('Discord通知イベントが不正です');
        if (!destinationIds.has(rule.destinationId))
            throw new Error(`送信プリセットが存在しません: ${rule.destinationId}`);
        const condition = rule.event === 'recording_finish' ? this.validateCondition(rule.condition) : undefined;
        return {
            id: rule.id,
            name: this.assertText(rule.name, 80, '通知ルール名'),
            enabled: rule.enabled === true,
            event: rule.event,
            destinationId: rule.destinationId,
            message: this.assertText(rule.message, 2_000, '通知メッセージ'),
            ...(condition === undefined ? {} : { condition }),
        };
    }

    private validateCondition(
        condition: apid.DiscordNotificationCondition | undefined,
    ): apid.DiscordNotificationCondition | undefined {
        if (condition === undefined) return undefined;
        const result: apid.DiscordNotificationCondition = {};
        for (const key of ['dropMin', 'dropMax', 'errorMin', 'errorMax', 'scramblingMin', 'scramblingMax'] as const) {
            const value = condition[key];
            if (value === undefined) continue;
            if (!Number.isSafeInteger(value) || value < 0)
                throw new Error('Discord通知条件には0以上の整数を指定してください');
            result[key] = value;
        }
        for (const key of ['drop', 'error', 'scrambling'] as const) {
            const min = result[`${key}Min`];
            const max = result[`${key}Max`];
            if (min !== undefined && max !== undefined && min > max) {
                throw new Error(`${key}の最小値が最大値を超えています`);
            }
        }
        return Object.keys(result).length === 0 ? undefined : result;
    }

    private isEvent(value: unknown): value is apid.DiscordNotificationEvent {
        return (
            value === 'recording_start' ||
            value === 'recording_finish' ||
            value === 'recording_failed' ||
            value === 'encode_finish' ||
            value === 'encode_failed'
        );
    }

    private assertId(value: string, label: string): void {
        if (!DiscordNotificationModel.ID_PATTERN.test(value)) throw new Error(`${label}が不正です`);
    }

    private assertText(value: string, maxLength: number, label: string): string {
        const text = typeof value === 'string' ? value.trim() : '';
        if (text.length === 0 || text.length > maxLength) throw new Error(`${label}が不正です`);
        return text;
    }

    private validateWebhookUrl(value: string): string {
        let url: URL;
        try {
            url = new URL(value.trim());
        } catch (_err: any) {
            throw new Error('Discord Webhook URLの形式が不正です');
        }
        if (
            url.protocol !== 'https:' ||
            (url.hostname !== 'discord.com' && url.hostname !== 'discordapp.com') ||
            !/^\/api\/webhooks\/\d+\/[^/]+\/?$/.test(url.pathname)
        ) {
            throw new Error('Discord公式のWebhook URLを指定してください');
        }
        url.search = '';
        url.hash = '';
        return url.toString();
    }

    private toPublicSettings(settings: StoredSettings): apid.DiscordNotificationSettings {
        return {
            enabled: settings.enabled,
            destinations: settings.destinations.map(destination => ({
                id: destination.id,
                name: destination.name,
                username: destination.username,
                configured: destination.webhookUrl.length > 0,
            })),
            rules: settings.rules,
        };
    }

    private async readSettings(): Promise<StoredSettings> {
        let envelope: EncryptedSettings;
        try {
            envelope = JSON.parse(await fs.promises.readFile(this.settingsPath, 'utf8')) as EncryptedSettings;
        } catch (err: any) {
            if (err?.code === 'ENOENT') return this.defaultSettings();
            throw new Error('Discord通知設定を読み込めませんでした');
        }
        if (
            envelope.version !== 1 ||
            typeof envelope.encryptedValue !== 'string' ||
            typeof envelope.iv !== 'string' ||
            typeof envelope.authTag !== 'string'
        ) {
            throw new Error('Discord通知設定の形式が不正です');
        }
        try {
            const decipher = createDecipheriv(
                'aes-256-gcm',
                await this.getEncryptionKey(),
                Buffer.from(envelope.iv, 'base64'),
            );
            decipher.setAuthTag(Buffer.from(envelope.authTag, 'base64'));
            const json = Buffer.concat([
                decipher.update(Buffer.from(envelope.encryptedValue, 'base64')),
                decipher.final(),
            ]).toString('utf8');
            return JSON.parse(json) as StoredSettings;
        } catch (_err: any) {
            throw new Error('Discord通知設定を復号できませんでした');
        }
    }

    private async writeSettings(settings: StoredSettings): Promise<void> {
        await fs.promises.mkdir(this.root, { recursive: true });
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', await this.getEncryptionKey(), iv);
        const encrypted = Buffer.concat([cipher.update(JSON.stringify(settings), 'utf8'), cipher.final()]);
        const envelope: EncryptedSettings = {
            version: 1,
            encryptedValue: encrypted.toString('base64'),
            iv: iv.toString('base64'),
            authTag: cipher.getAuthTag().toString('base64'),
        };
        const temporaryPath = `${this.settingsPath}.${process.pid}.tmp`;
        await fs.promises.writeFile(temporaryPath, JSON.stringify(envelope), { encoding: 'utf8', mode: 0o600 });
        await fs.promises.rename(temporaryPath, this.settingsPath);
    }

    private async getEncryptionKey(): Promise<Buffer> {
        if (this.encryptionKey !== undefined) return this.encryptionKey;
        await fs.promises.mkdir(this.root, { recursive: true });
        try {
            this.encryptionKey = Buffer.from((await fs.promises.readFile(this.keyPath, 'utf8')).trim(), 'base64');
        } catch (err: any) {
            if (err?.code !== 'ENOENT') throw err;
            const generated = randomBytes(32);
            try {
                await fs.promises.writeFile(this.keyPath, generated.toString('base64'), {
                    encoding: 'utf8',
                    mode: 0o600,
                    flag: 'wx',
                });
                this.encryptionKey = generated;
            } catch (writeError: any) {
                if (writeError?.code !== 'EEXIST') throw writeError;
                this.encryptionKey = Buffer.from((await fs.promises.readFile(this.keyPath, 'utf8')).trim(), 'base64');
            }
        }
        if (this.encryptionKey.length !== 32) throw new Error('資格情報の暗号化キーが不正です');
        return this.encryptionKey;
    }

    private defaultSettings(): StoredSettings {
        return {
            enabled: true,
            destinations: [
                { id: 'recording-normal', name: '録画開始・正常終了', username: 'RECMASTER', webhookUrl: '' },
                { id: 'recording-warning', name: 'エラー・スクランブリング', username: 'RECMASTER', webhookUrl: '' },
                { id: 'recording-drop', name: 'ドロップ発生', username: 'RECMASTER', webhookUrl: '' },
                { id: 'recording-failed', name: '録画失敗', username: 'RECMASTER', webhookUrl: '' },
                { id: 'encode-finish', name: 'エンコード成功', username: 'ENCMASTER', webhookUrl: '' },
                { id: 'encode-failed', name: 'エンコード失敗', username: 'ENCMASTER', webhookUrl: '' },
            ],
            rules: [
                {
                    id: 'recording-start',
                    name: '録画開始',
                    enabled: true,
                    event: 'recording_start',
                    destinationId: 'recording-normal',
                    message: '録画開始-[{recordedId}] {name} [{channelName}]',
                },
                {
                    id: 'recording-drop',
                    name: 'ドロップ発生',
                    enabled: true,
                    event: 'recording_finish',
                    destinationId: 'recording-drop',
                    message:
                        '**ドロップ発生**-[{recordedId}] {name} [{channelName}] [**drop: {drop}** error: {error} scrambling: {scrambling}]',
                    condition: { dropMin: 1 },
                },
                {
                    id: 'recording-error',
                    name: 'エラー発生',
                    enabled: true,
                    event: 'recording_finish',
                    destinationId: 'recording-warning',
                    message:
                        '**エラー発生**-[{recordedId}] {name} [{channelName}] [drop: {drop} **error: {error}** scrambling: {scrambling}]',
                    condition: { errorMin: 1 },
                },
                {
                    id: 'recording-scrambling',
                    name: 'スクランブリング発生',
                    enabled: true,
                    event: 'recording_finish',
                    destinationId: 'recording-warning',
                    message:
                        '**スクランブリング発生**-[{recordedId}] {name} [{channelName}] [drop: {drop} error: {error} **scrambling: {scrambling}**]',
                    condition: { scramblingMin: 1 },
                },
                {
                    id: 'recording-finish',
                    name: '録画正常終了',
                    enabled: true,
                    event: 'recording_finish',
                    destinationId: 'recording-normal',
                    message:
                        '録画完了-[{recordedId}] {name} [{channelName}] [drop: {drop} error: {error} scrambling: {scrambling}]',
                    condition: { dropMax: 0, errorMax: 0, scramblingMax: 0 },
                },
                {
                    id: 'recording-failed',
                    name: '録画失敗',
                    enabled: true,
                    event: 'recording_failed',
                    destinationId: 'recording-failed',
                    message:
                        '録画失敗-[{recordedId}] {name} [{channelName}] [drop: {drop} error: {error} scrambling: {scrambling}]',
                },
                {
                    id: 'encode-finish',
                    name: 'エンコード成功',
                    enabled: true,
                    event: 'encode_finish',
                    destinationId: 'encode-finish',
                    message: 'エンコード完了-{name} [{mode}]',
                },
                {
                    id: 'encode-failed',
                    name: 'エンコード失敗',
                    enabled: true,
                    event: 'encode_failed',
                    destinationId: 'encode-failed',
                    message: 'エンコード失敗-{name} [{mode}]\n{encoderMessage}',
                },
            ],
        };
    }

    private cleanupFailedIds(): void {
        const now = Date.now();
        for (const [recordedId, expiresAt] of this.failedRecordedIds) {
            if (expiresAt <= now) this.failedRecordedIds.delete(recordedId);
        }
    }

    private logError(error: unknown): void {
        this.log.system.warn(`Discord notification failed: ${error instanceof Error ? error.message : String(error)}`);
    }
}
