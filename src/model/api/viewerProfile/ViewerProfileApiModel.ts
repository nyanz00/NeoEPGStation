import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt, timingSafeEqual } from 'crypto';
import { inject, injectable } from 'inversify';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as apid from '../../../../api';
import ITvUserDB from '../../db/ITvUserDB';
import IViewerProfileDB from '../../db/IViewerProfileDB';
import IViewerProfileApiModel from './IViewerProfileApiModel';

const scryptAsync = promisify(scrypt);

interface UnlockAttemptState {
    failures: number;
    blockedUntil: number;
}

interface RecoveryCodeValue {
    code: string;
    salt: string;
    hash: string;
}

@injectable()
export default class ViewerProfileApiModel implements IViewerProfileApiModel {
    private static readonly MAX_UNLOCK_FAILURES = 10;
    private static readonly UNLOCK_BLOCK_DURATION = 5 * 60_000;
    private static readonly ALLOWED_LOCK_PASSWORD =
        /^[\x21-\x7E\u3001-\u303F\u3040-\u30FF\u31F0-\u31FF\uFF01-\uFF60\uFF61-\uFF9F\p{Script=Han}]+$/u;
    private readonly root = path.join(__dirname, '..', '..', '..', '..', 'data', 'viewer-profiles');
    private readonly unlockAttempts = new Map<number, UnlockAttemptState>();
    private readonly unlockQueues = new Map<number, Promise<void>>();
    private encryptionKey?: Buffer;
    private encryptionKeyPromise?: Promise<Buffer>;

    constructor(
        @inject('IViewerProfileDB') private profileDB: IViewerProfileDB,
        @inject('ITvUserDB') private userDB: ITvUserDB,
    ) {}

    public async gets(): Promise<apid.ViewerProfiles> {
        const profiles = await this.profileDB.findAll();
        return {
            profiles: await Promise.all(
                profiles.map(async profile => ({
                    id: profile.id,
                    name: profile.name,
                    tvUserId: profile.tvUserId ?? undefined,
                    annictConfigured: await this.hasCredential(profile.id, 'annict'),
                    lockRequired: this.isPinRequired(profile),
                    recoveryCodeConfigured: this.hasRecoveryCode(profile),
                    pinRequired: this.isPinRequired(profile),
                    createdAt: Number(profile.createdAt),
                })),
            ),
        };
    }

    public async add(option: apid.CreateViewerProfileOption): Promise<apid.ViewerProfileId> {
        const password = this.passwordFromOption(option);
        const tvUserId = Number(option.tvUserId);
        const user = Number.isInteger(tvUserId) ? await this.userDB.findId(tvUserId) : null;
        if (user === null) throw new Error('関連付けるユーザーが見つかりません');
        if ((await this.profileDB.findByTvUserId(tvUserId)) !== null)
            throw new Error('このユーザーには既に外部連携が設定されています');
        const pinValue = await this.createPinValue(password);
        try {
            return await this.profileDB.insert(user.name, tvUserId, pinValue.salt, pinValue.hash);
        } catch (error) {
            // The database constraint closes the race between the pre-check above and this insert.
            if ((await this.profileDB.findByTvUserId(tvUserId)) !== null) {
                throw new Error('このユーザーには既に外部連携が設定されています');
            }
            throw error;
        }
    }

    public async unlock(profileId: apid.ViewerProfileId, password: string): Promise<apid.ViewerProfileSession> {
        const previous = this.unlockQueues.get(profileId) ?? Promise.resolve();
        let release!: () => void;
        const current = new Promise<void>(resolve => {
            release = resolve;
        });
        this.unlockQueues.set(profileId, current);
        await previous;

        try {
            return await this.unlockExclusive(profileId, password);
        } finally {
            release();
            if (this.unlockQueues.get(profileId) === current) this.unlockQueues.delete(profileId);
        }
    }

    private async unlockExclusive(
        profileId: apid.ViewerProfileId,
        password: string,
    ): Promise<apid.ViewerProfileSession> {
        const profile = await this.profileDB.findId(profileId);
        if (profile === null) throw new Error('視聴者プロフィールが見つかりません');
        if (this.isPinRequired(profile)) {
            this.assertUnlockAllowed(profileId);
            let normalized: string;
            try {
                normalized = this.normalizeLockPassword(password);
            } catch (error) {
                this.throwUnlockFailure(profileId, error instanceof Error ? error.message : String(error));
            }
            const actual = (await scryptAsync(normalized!, Buffer.from(profile.pinSalt, 'base64'), 32)) as Buffer;
            const expected = Buffer.from(profile.pinHash, 'base64');
            if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
                this.throwUnlockFailure(profileId, '連携パスワードが違います');
            }
        }
        this.unlockAttempts.delete(profileId);
        const recoveryCode =
            this.isPinRequired(profile) && !this.hasRecoveryCode(profile)
                ? (await this.rotateRecoveryCode(profileId)).recoveryCode
                : undefined;
        return {
            ...(await this.createSession(profileId)),
            ...(recoveryCode === undefined ? {} : { recoveryCode }),
        };
    }

    public async updatePin(profileId: apid.ViewerProfileId, password?: string): Promise<apid.ViewerProfileSession> {
        const profile = await this.profileDB.findId(profileId);
        if (profile === null) throw new Error('視聴者プロフィールが見つかりません');
        const shouldLock = password !== undefined && password.length > 0;
        const value = await this.createPinValue(shouldLock ? password : '');
        let recoveryCode: RecoveryCodeValue | undefined;
        if (shouldLock && !this.hasRecoveryCode(profile)) {
            recoveryCode = await this.createRecoveryCodeValue();
        }
        await this.profileDB.updateSecurity(
            profileId,
            value.salt,
            value.hash,
            shouldLock ? (recoveryCode?.salt ?? profile.recoveryCodeSalt) : '',
            shouldLock ? (recoveryCode?.hash ?? profile.recoveryCodeHash) : '',
        );
        await this.profileDB.deleteSessions(profileId);
        this.unlockAttempts.delete(profileId);
        return {
            ...(await this.createSession(profileId)),
            ...(recoveryCode === undefined ? {} : { recoveryCode: recoveryCode.code }),
        };
    }

    public async rotateRecoveryCode(profileId: apid.ViewerProfileId): Promise<apid.ViewerProfileRecoveryCode> {
        const profile = await this.profileDB.findId(profileId);
        if (profile === null) throw new Error('視聴者プロフィールが見つかりません');
        if (!this.isPinRequired(profile)) throw new Error('回復コードを発行するには外部連携ロックを設定してください');
        const value = await this.createRecoveryCodeValue();
        await this.profileDB.updateRecoveryCode(profileId, value.salt, value.hash);
        return { recoveryCode: value.code };
    }

    public async recoverPin(
        profileId: apid.ViewerProfileId,
        recoveryCode: string,
        password: string,
    ): Promise<apid.ViewerProfileRecoveryCode> {
        const profile = await this.profileDB.findId(profileId);
        if (profile === null) throw new Error('視聴者プロフィールが見つかりません');
        if (!this.isPinRequired(profile) || !this.hasRecoveryCode(profile)) {
            throw new Error('このユーザーには回復コードが発行されていません');
        }
        if (password.length === 0) throw new Error('新しい連携パスワードを入力してください');
        const normalizedRecoveryCode = this.normalizeRecoveryCode(recoveryCode);
        const actual = (await scryptAsync(
            normalizedRecoveryCode,
            Buffer.from(profile.recoveryCodeSalt, 'base64'),
            32,
        )) as Buffer;
        const expected = Buffer.from(profile.recoveryCodeHash, 'base64');
        if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) {
            throw new Error('回復コードが違います');
        }
        const pinValue = await this.createPinValue(password);
        const nextRecovery = await this.createRecoveryCodeValue();
        await this.profileDB.updateSecurity(
            profileId,
            pinValue.salt,
            pinValue.hash,
            nextRecovery.salt,
            nextRecovery.hash,
        );
        await this.profileDB.deleteSessions(profileId);
        this.unlockAttempts.delete(profileId);
        return { recoveryCode: nextRecovery.code };
    }

    public async wipeExternalCredentials(profileId: apid.ViewerProfileId): Promise<void> {
        if ((await this.profileDB.findId(profileId)) === null) {
            throw new Error('視聴者プロフィールが見つかりません');
        }
        await this.profileDB.deleteCredentials(profileId);
        await this.profileDB.updateSecurity(profileId, '', '', '', '');
        await this.profileDB.deleteSessions(profileId);
        this.unlockAttempts.delete(profileId);
    }

    private async createSession(profileId: apid.ViewerProfileId): Promise<apid.ViewerProfileSession> {
        const sessionToken = randomBytes(32).toString('base64url');
        await this.profileDB.insertSession(profileId, this.hashSessionToken(sessionToken));
        return { sessionToken };
    }

    public async authenticate(profileId: apid.ViewerProfileId, sessionToken: string): Promise<boolean> {
        const profile = await this.profileDB.findId(profileId);
        if (profile === null) return false;
        if (!this.isPinRequired(profile)) return true;
        if (sessionToken.length < 32) return false;
        return (await this.profileDB.findSession(profileId, this.hashSessionToken(sessionToken))) !== null;
    }

    public async hasCredential(profileId: apid.ViewerProfileId, provider: string): Promise<boolean> {
        return (await this.profileDB.findCredential(profileId, provider)) !== null;
    }

    public async getCredential(profileId: apid.ViewerProfileId, provider: string): Promise<string | null> {
        const credential = await this.profileDB.findCredential(profileId, provider);
        if (credential === null) return null;
        const decipher = createDecipheriv(
            'aes-256-gcm',
            await this.getEncryptionKey(),
            Buffer.from(credential.iv, 'base64'),
        );
        decipher.setAuthTag(Buffer.from(credential.authTag, 'base64'));
        return Buffer.concat([
            decipher.update(Buffer.from(credential.encryptedValue, 'base64')),
            decipher.final(),
        ]).toString('utf8');
    }

    public async setCredential(profileId: apid.ViewerProfileId, provider: string, value: string): Promise<void> {
        if ((await this.profileDB.findId(profileId)) === null) throw new Error('視聴者プロフィールが見つかりません');
        const iv = randomBytes(12);
        const cipher = createCipheriv('aes-256-gcm', await this.getEncryptionKey(), iv);
        const encrypted = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
        await this.profileDB.upsertCredential(
            profileId,
            provider,
            encrypted.toString('base64'),
            iv.toString('base64'),
            cipher.getAuthTag().toString('base64'),
        );
    }

    public async deleteCredential(profileId: apid.ViewerProfileId, provider: string): Promise<void> {
        await this.profileDB.deleteCredential(profileId, provider);
    }

    private passwordFromOption(option: apid.CreateViewerProfileOption): string {
        if (typeof option.password === 'string') return option.password;
        if (typeof option.pin === 'string') return option.pin;
        return '';
    }

    private normalizeLockPassword(password: string): string {
        const normalized = password.normalize('NFC');
        if (normalized.length === 0) throw new Error('連携パスワードを入力してください');
        if (/\p{White_Space}/u.test(normalized)) throw new Error('連携パスワードに空白は使用できません');
        if (/\p{Extended_Pictographic}/u.test(normalized)) throw new Error('連携パスワードに絵文字は使用できません');
        if (!ViewerProfileApiModel.ALLOWED_LOCK_PASSWORD.test(normalized)) {
            throw new Error('連携パスワードには英数字・一般的な記号・日本語だけを使用できます');
        }
        return normalized;
    }

    private async createPinValue(password: string): Promise<{ salt: string; hash: string }> {
        if (password.length === 0) return { salt: '', hash: '' };
        const normalized = this.normalizeLockPassword(password);
        const salt = randomBytes(16);
        const hash = (await scryptAsync(normalized, salt, 32)) as Buffer;
        return { salt: salt.toString('base64'), hash: hash.toString('base64') };
    }

    private async createRecoveryCodeValue(): Promise<RecoveryCodeValue> {
        const normalized = randomBytes(16).toString('hex');
        const salt = randomBytes(16);
        const hash = (await scryptAsync(normalized, salt, 32)) as Buffer;
        return {
            code: normalized.match(/.{4}/g)?.join('-') ?? normalized,
            salt: salt.toString('base64'),
            hash: hash.toString('base64'),
        };
    }

    private normalizeRecoveryCode(recoveryCode: string): string {
        const normalized = recoveryCode.normalize('NFKC').toLowerCase().replace(/[\s-]/g, '');
        if (!/^[0-9a-f]{32}$/.test(normalized)) throw new Error('回復コードの形式が不正です');
        return normalized;
    }

    private assertUnlockAllowed(profileId: number): void {
        const state = this.unlockAttempts.get(profileId);
        if (state === undefined || state.blockedUntil === 0) return;
        if (state.blockedUntil <= Date.now()) {
            this.unlockAttempts.delete(profileId);
            return;
        }
        const remainingSeconds = Math.max(1, Math.ceil((state.blockedUntil - Date.now()) / 1000));
        throw new Error(`解除試行回数が上限に達しています。${remainingSeconds}秒後にもう一度お試しください`);
    }

    private throwUnlockFailure(profileId: number, message: string): never {
        const current = this.unlockAttempts.get(profileId);
        const failures = (current?.failures ?? 0) + 1;
        if (failures >= ViewerProfileApiModel.MAX_UNLOCK_FAILURES) {
            this.unlockAttempts.set(profileId, {
                failures,
                blockedUntil: Date.now() + ViewerProfileApiModel.UNLOCK_BLOCK_DURATION,
            });
            throw new Error('連携パスワードの解除に10回失敗したため、5分間ロックしました');
        }
        this.unlockAttempts.set(profileId, { failures, blockedUntil: 0 });
        const remaining = ViewerProfileApiModel.MAX_UNLOCK_FAILURES - failures;
        throw new Error(`${message}（あと${remaining}回失敗すると5分間ロックされます）`);
    }

    private isPinRequired(profile: { pinSalt: string; pinHash: string }): boolean {
        return profile.pinSalt.length > 0 || profile.pinHash.length > 0;
    }

    private hasRecoveryCode(profile: { recoveryCodeSalt: string; recoveryCodeHash: string }): boolean {
        return profile.recoveryCodeSalt.length > 0 && profile.recoveryCodeHash.length > 0;
    }

    private hashSessionToken(sessionToken: string): string {
        return createHash('sha256').update(sessionToken).digest('hex');
    }

    private async getEncryptionKey(): Promise<Buffer> {
        if (this.encryptionKey !== undefined) return this.encryptionKey;
        if (this.encryptionKeyPromise !== undefined) return this.encryptionKeyPromise;
        this.encryptionKeyPromise = this.loadEncryptionKey();
        try {
            return await this.encryptionKeyPromise;
        } finally {
            this.encryptionKeyPromise = undefined;
        }
    }

    private async loadEncryptionKey(): Promise<Buffer> {
        const file = path.join(this.root, 'credential.key');
        await fs.promises.mkdir(this.root, { recursive: true });
        try {
            this.encryptionKey = Buffer.from((await fs.promises.readFile(file, 'utf8')).trim(), 'base64');
        } catch (err: any) {
            if (err?.code !== 'ENOENT') throw err;
            const generated = randomBytes(32);
            try {
                await fs.promises.writeFile(file, generated.toString('base64'), {
                    encoding: 'utf8',
                    mode: 0o600,
                    flag: 'wx',
                });
                this.encryptionKey = generated;
            } catch (writeError: any) {
                if (writeError?.code !== 'EEXIST') throw writeError;
                this.encryptionKey = Buffer.from((await fs.promises.readFile(file, 'utf8')).trim(), 'base64');
            }
        }
        if (this.encryptionKey.length !== 32) throw new Error('視聴者プロフィールの暗号化キーが不正です');
        return this.encryptionKey;
    }
}
