import minimist from 'minimist';
import { createInterface } from 'readline';
import 'reflect-metadata';
import { install } from 'source-map-support';
import { Writable } from 'stream';
import ViewerProfile from './db/entities/ViewerProfile';
import IViewerProfileApiModel from './model/api/viewerProfile/IViewerProfileApiModel';
import IDBOperator from './model/db/IDBOperator';
import IViewerProfileDB from './model/db/IViewerProfileDB';
import IConnectionCheckModel from './model/IConnectionCheckModel';
import ILoggerModel from './model/ILoggerModel';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';

install();
containerSetter.set(container);

class MutedOutput extends Writable {
    public muted = false;

    public _write(chunk: Buffer | string, encoding: BufferEncoding, callback: (error?: Error | null) => void): void {
        if (!this.muted) process.stdout.write(chunk, encoding);
        callback();
    }
}

async function prompt(question: string, hidden = false): Promise<string> {
    if (process.stdin.isTTY !== true || process.stdout.isTTY !== true) {
        throw new Error('回復操作は対話可能なターミナルで実行してください');
    }
    const output = new MutedOutput();
    const input = createInterface({ input: process.stdin, output, terminal: true });
    return new Promise<string>(resolve => {
        output.muted = false;
        input.question(question, answer => {
            output.muted = false;
            process.stdout.write('\n');
            input.close();
            resolve(answer);
        });
        output.muted = hidden;
    });
}

async function findProfile(
    profileDB: IViewerProfileDB,
    userId: number | undefined,
    profileId: number | undefined,
): Promise<ViewerProfile> {
    const profile =
        userId !== undefined ? await profileDB.findByTvUserId(userId) : await profileDB.findId(profileId as number);
    if (profile === null) throw new Error('対象ユーザーの視聴者プロフィールが見つかりません');
    return profile;
}

async function run(): Promise<void> {
    const args = minimist(process.argv.slice(2), {
        alias: { u: 'user-id', p: 'profile-id' },
        boolean: ['wipe-credentials'],
        string: ['user-id', 'profile-id'],
    });
    const userId = args['user-id'] === undefined ? undefined : Number(args['user-id']);
    const profileId = args['profile-id'] === undefined ? undefined : Number(args['profile-id']);
    const hasUserId = Number.isInteger(userId) && (userId as number) > 0;
    const hasProfileId = Number.isInteger(profileId) && (profileId as number) > 0;
    if (hasUserId === hasProfileId) {
        throw new Error('--user-id または --profile-id のどちらか一方を指定してください');
    }

    container.get<ILoggerModel>('ILoggerModel').initialize();
    const connectionChecker = container.get<IConnectionCheckModel>('IConnectionCheckModel');
    const dbOperator = container.get<IDBOperator>('IDBOperator');
    try {
        await connectionChecker.checkDB();
        const profileDB = container.get<IViewerProfileDB>('IViewerProfileDB');
        const profile = await findProfile(
            profileDB,
            hasUserId ? (userId as number) : undefined,
            hasProfileId ? (profileId as number) : undefined,
        );
        const model = container.get<IViewerProfileApiModel>('IViewerProfileApiModel');
        if (args['wipe-credentials'] === true) {
            console.log(
                `警告: ユーザー「${profile.name}」のAnnict・Twitter・Bluesky・Misskey.io・ニコニコ等の外部連携資格情報を削除します。録画・ルール・ローカル視聴履歴は維持されます。`,
            );
            const confirmation = await prompt('続行するには対象ユーザー名を入力してください: ');
            if (confirmation !== profile.name) throw new Error('ユーザー名が一致しないため中止しました');
            await model.wipeExternalCredentials(profile.id);
            console.log(
                `ユーザー「${profile.name}」の外部連携資格情報、連携パスワード、回復コード、既存セッションを初期化しました。`,
            );
            return;
        }

        const recoveryCode = await prompt('回復コード: ', true);
        const password = await prompt('新しい連携パスワード: ', true);
        const confirmation = await prompt('新しい連携パスワード（確認）: ', true);
        if (password.normalize('NFC') !== confirmation.normalize('NFC')) {
            throw new Error('新しい連携パスワードが一致しません');
        }
        const result = await model.recoverPin(profile.id, recoveryCode, password);
        console.log(`ユーザー「${profile.name}」の連携パスワードを変更しました。既存セッションは無効になりました。`);
        console.log('新しい回復コード（以前のコードは無効です）:');
        console.log(result.recoveryCode);
        console.log('このコードは再表示できません。利用者本人が安全な場所へ保存してください。');
    } finally {
        await dbOperator.closeConnection();
    }
}

void run().catch((error: unknown) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exitCode = 1;
});
