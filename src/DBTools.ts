import * as fs from 'fs';
import * as path from 'path';
import minimist from 'minimist';
import 'reflect-metadata';
import { install } from 'source-map-support';
import AnnictRuleLink from './db/entities/AnnictRuleLink';
import AnnictEpisodeWatch from './db/entities/AnnictEpisodeWatch';
import AnnictRecordedEpisode from './db/entities/AnnictRecordedEpisode';
import DropLogFile from './db/entities/DropLogFile';
import Recorded from './db/entities/Recorded';
import RecordedHistory from './db/entities/RecordedHistory';
import RecordedPlayback from './db/entities/RecordedPlayback';
import RecordedTag from './db/entities/RecordedTag';
import Reserve from './db/entities/Reserve';
import Thumbnail from './db/entities/Thumbnail';
import TvUser from './db/entities/TvUser';
import VideoFile from './db/entities/VideoFile';
import ViewerCredential from './db/entities/ViewerCredential';
import ViewerProfile from './db/entities/ViewerProfile';
import ViewerProfileSession from './db/entities/ViewerProfileSession';
import IDBOperator from './model/db/IDBOperator';
import IAnnictRuleLinkDB from './model/db/IAnnictRuleLinkDB';
import IDropLogFileDB from './model/db/IDropLogFileDB';
import IRecordedDB from './model/db/IRecordedDB';
import IRecordedHistoryDB from './model/db/IRecordedHistoryDB';
import IRecordedTagDB from './model/db/IRecordedTagDB';
import IReserveDB from './model/db/IReserveDB';
import IRuleDB, { RuleWithCnt } from './model/db/IRuleDB';
import IThumbnailDB from './model/db/IThumbnailDB';
import ITvUserDB from './model/db/ITvUserDB';
import IVideoFileDB from './model/db/IVideoFileDB';
import IConnectionCheckModel from './model/IConnectionCheckModel';
import ILogger from './model/ILogger';
import ILoggerModel from './model/ILoggerModel';
import container from './model/ModelContainer';
import * as containerSetter from './model/ModelContainerSetter';
install();

containerSetter.set(container);

interface BackupData {
    tvUserItems?: TvUser[];
    annictRuleLinkItems?: AnnictRuleLink[];
    viewerProfileItems?: ViewerProfile[];
    annictCredentialItems?: ViewerCredential[];
    annictRecordedEpisodeItems?: AnnictRecordedEpisode[];
    annictEpisodeWatchItems?: AnnictEpisodeWatch[];
    recordedPlaybackItems?: RecordedPlayback[];
    annictSettings?: unknown;
    discordNotificationSettings?: unknown;
    ruleItems: RuleWithCnt[];
    reserveItems: Reserve[];
    recordedItems: Recorded[];
    thumbnailItems: Thumbnail[];
    videoFileItems: VideoFile[];
    dropLogFileItems: DropLogFile[];
    recordedHistoryItems: RecordedHistory[];
    recordedTagItems: RecordedTag[];
}

class DBTools {
    private readonly dataRoot = path.join(__dirname, '..', 'data');
    private filePath: string;
    private mode: 'backup' | 'restore';
    private backupType: 'full' | 'legacy';

    private log: ILogger;
    private annictRuleLinkDB: IAnnictRuleLinkDB;
    private connectionChecker: IConnectionCheckModel;
    private dbOperator: IDBOperator;
    private dropLogFileDB: IDropLogFileDB;
    private recordedDB: IRecordedDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private recordedTagDB: IRecordedTagDB;
    private reserveDB: IReserveDB;
    private ruleDB: IRuleDB;
    private thumbnailDB: IThumbnailDB;
    private tvUserDB: ITvUserDB;
    private videoFileDB: IVideoFileDB;

    constructor() {
        // 引数チェック
        const args = minimist(process.argv.slice(2), {
            alias: {
                m: 'mode',
                o: 'output',
                t: 'backup-type',
            },
            string: ['output', 'mode', 'backup-type'],
            boolean: ['compatible'],
        });

        if (
            typeof args.output === 'undefined' ||
            args.output === '' ||
            typeof args.mode === 'undefined' ||
            args.mode === ''
        ) {
            console.error('引数が足りません');
            process.exit(1);
        }

        if (args.mode !== 'backup' && args.mode !== 'restore') {
            console.error('mode の指定が間違っています');
            process.exit(1);
        }

        const backupType =
            args.compatible === true
                ? 'legacy'
                : typeof args['backup-type'] === 'undefined'
                  ? 'full'
                  : args['backup-type'];
        if (backupType !== 'full' && backupType !== 'legacy') {
            console.error('backup-type の指定が間違っています');
            process.exit(1);
        }

        this.filePath = args.output;
        this.mode = args.mode;
        this.backupType = backupType;

        const logger = container.get<ILoggerModel>('ILoggerModel');
        logger.initialize();
        this.log = logger.getLogger();
        this.annictRuleLinkDB = container.get<IAnnictRuleLinkDB>('IAnnictRuleLinkDB');
        this.connectionChecker = container.get<IConnectionCheckModel>('IConnectionCheckModel');
        this.dbOperator = container.get<IDBOperator>('IDBOperator');
        this.dropLogFileDB = container.get<IDropLogFileDB>('IDropLogFileDB');
        this.recordedDB = container.get<IRecordedDB>('IRecordedDB');
        this.recordedHistoryDB = container.get<IRecordedHistoryDB>('IRecordedHistoryDB');
        this.recordedTagDB = container.get<IRecordedTagDB>('IRecordedTagDB');
        this.reserveDB = container.get<IReserveDB>('IReserveDB');
        this.ruleDB = container.get<IRuleDB>('IRuleDB');
        this.thumbnailDB = container.get<IThumbnailDB>('IThumbnailDB');
        this.tvUserDB = container.get<ITvUserDB>('ITvUserDB');
        this.videoFileDB = container.get<IVideoFileDB>('IVideoFileDB');
    }

    /**
     * run
     */
    public async run(): Promise<void> {
        this.log.system.info('--- run ---');

        // DB との接続確認
        await this.connectionChecker.checkDB();

        if (this.mode === 'backup') {
            await this.backup();
        } else {
            await this.restore();
        }

        // DB 切断
        await this.dbOperator.closeConnection();
        this.log.system.info('--- finish ---');

        process.exit(0);
    }

    /**
     * backup
     */
    private async backup(): Promise<void> {
        this.log.system.info('--- start backup ---');

        this.log.system.info('rule');
        const [ruleItems] = await this.ruleDB.findAll({}, true);

        this.log.system.info('annict rule link');
        const annictRuleLinkItems = await this.annictRuleLinkDB.findAll();

        this.log.system.info('tv user');
        const tvUserItems = await this.tvUserDB.findAll();

        const connection = await this.dbOperator.getConnection();
        this.log.system.info('viewer profile');
        const viewerProfileItems = await connection.getRepository(ViewerProfile).find();
        this.log.system.info('annict credential');
        const annictCredentialItems = await connection.getRepository(ViewerCredential).find({
            where: { provider: 'annict' },
        });

        this.log.system.info('reserve');
        const [reserveItems] = await this.reserveDB.findAll({ isHalfWidth: false });

        this.log.system.info('drop log file');
        const dropLogFileItems = await this.dropLogFileDB.findAll();

        this.log.system.info('recorded');
        const [recordedItems] = await this.recordedDB.findAll(
            {
                isHalfWidth: false,
            },
            {
                isNeedVideoFiles: false,
                isNeedThumbnails: false,
                isNeedsDropLog: false,
                isNeedTags: false,
            },
        );
        /*
        recordedItems = recordedItems.map(r => {
            r.dropLogFileId = null;

            return r;
        });
        */

        this.log.system.info('thumbnail file');
        const thumbnailItems = await this.thumbnailDB.findAll();

        this.log.system.info('video file');
        const videoFileItems = await this.videoFileDB.findAll();

        this.log.system.info('recorded history');
        const recordedHistoryItems = await this.recordedHistoryDB.findAll();

        this.log.system.info('recorded tag');
        const [recordedTagItems] = await this.recordedTagDB.findAll({});

        this.log.system.info('annict recorded episode');
        const annictRecordedEpisodeItems = await connection.getRepository(AnnictRecordedEpisode).find();
        this.log.system.info('annict episode watch');
        const annictEpisodeWatchItems = await connection.getRepository(AnnictEpisodeWatch).find();
        this.log.system.info('recorded playback');
        const recordedPlaybackItems = await connection.getRepository(RecordedPlayback).find();

        const backup: BackupData = {
            tvUserItems: tvUserItems,
            annictRuleLinkItems: annictRuleLinkItems,
            viewerProfileItems,
            annictCredentialItems,
            annictRecordedEpisodeItems,
            annictEpisodeWatchItems,
            recordedPlaybackItems,
            annictSettings: this.readOptionalJson(path.join(this.dataRoot, 'annict', 'settings.json')),
            discordNotificationSettings: this.readOptionalJson(
                path.join(this.dataRoot, 'viewer-profiles', 'discord-notification.json'),
            ),
            ruleItems: ruleItems as RuleWithCnt[],
            reserveItems: reserveItems,
            recordedItems: recordedItems,
            thumbnailItems: thumbnailItems,
            videoFileItems: videoFileItems,
            dropLogFileItems: dropLogFileItems,
            recordedHistoryItems: recordedHistoryItems,
            recordedTagItems: recordedTagItems,
        };

        this.log.system.info('--- writing ---');

        fs.writeFileSync(
            this.filePath,
            JSON.stringify(this.backupType === 'legacy' ? this.createLegacyBackup(backup) : backup),
            {
                encoding: 'utf-8',
            },
        );
    }

    /**
     * restore
     */
    private async restore(): Promise<void> {
        this.log.system.info('--- start restore ---');

        // read backup
        this.log.system.info('--- read backup file ---');
        let backup: BackupData;
        try {
            const file: string | null = fs.readFileSync(this.filePath, 'utf-8');
            if (file === null) {
                throw new Error('file is null');
            }
            backup = JSON.parse(file);
        } catch (err: any) {
            if (err.code === 'ENOENT') {
                console.error(`${this.filePath} is not found`);
                process.exit(1);
            } else {
                console.error('file parse error');
                console.error(err);
                process.exit(1);
            }
        }

        // restore
        this.log.system.info('--- restore ---');
        this.log.system.info('tv user');
        if (Array.isArray(backup.tvUserItems) === true && backup.tvUserItems.length > 0) {
            await this.tvUserDB.restore(backup.tvUserItems);
            await this.tvUserDB.ensureDefaultUser();
        } else {
            await this.tvUserDB.ensureDefaultUser();
        }
        const connection = await this.dbOperator.getConnection();
        await connection.getRepository(AnnictEpisodeWatch).delete({});
        await connection.getRepository(AnnictRuleLink).delete({});
        await connection.getRepository(ViewerCredential).delete({});
        await connection.getRepository(ViewerProfileSession).delete({});
        await connection.getRepository(AnnictRecordedEpisode).delete({});
        await connection.getRepository(RecordedPlayback).delete({});
        await connection.getRepository(ViewerProfile).delete({});

        this.log.system.info('viewer profile');
        if (Array.isArray(backup.viewerProfileItems) && backup.viewerProfileItems.length > 0) {
            await connection.getRepository(ViewerProfile).save(backup.viewerProfileItems, { chunk: 100 });
        }
        this.log.system.info('annict credential');
        if (Array.isArray(backup.annictCredentialItems) && backup.annictCredentialItems.length > 0) {
            await connection.getRepository(ViewerCredential).save(backup.annictCredentialItems, { chunk: 100 });
        }
        this.normalizeUserId(backup.ruleItems);
        this.normalizeUserId(backup.reserveItems);
        this.normalizeUserId(backup.recordedItems);

        this.log.system.info('rule');
        await this.ruleDB.restore(backup.ruleItems);

        this.log.system.info('annict rule link');
        await this.annictRuleLinkDB.restore(
            Array.isArray(backup.annictRuleLinkItems) ? backup.annictRuleLinkItems : [],
            backup.ruleItems.map(rule => rule.id),
        );

        this.log.system.info('reserve');
        await this.reserveDB.restore(backup.reserveItems);

        this.log.system.info('drop log file');
        await this.dropLogFileDB.restore(backup.dropLogFileItems).catch(err => {
            console.error(err);
            process.exit(1);
        });

        this.log.system.info('recorded');
        await this.recordedDB.restore(backup.recordedItems);

        this.log.system.info('thumbnail file');
        await this.thumbnailDB.restore(backup.thumbnailItems);

        this.log.system.info('video file');
        await this.videoFileDB.restore(backup.videoFileItems);

        this.log.system.info('recorded history');
        await this.recordedHistoryDB.restore(backup.recordedHistoryItems);

        this.log.system.info('recorded tag');
        await this.recordedTagDB.restore(backup.recordedTagItems);

        this.log.system.info('annict recorded episode');
        if (Array.isArray(backup.annictRecordedEpisodeItems) && backup.annictRecordedEpisodeItems.length > 0) {
            await connection
                .getRepository(AnnictRecordedEpisode)
                .save(backup.annictRecordedEpisodeItems, { chunk: 100 });
        }
        this.log.system.info('annict episode watch');
        if (Array.isArray(backup.annictEpisodeWatchItems) && backup.annictEpisodeWatchItems.length > 0) {
            await connection.getRepository(AnnictEpisodeWatch).save(backup.annictEpisodeWatchItems, { chunk: 100 });
        }
        this.log.system.info('recorded playback');
        if (Array.isArray(backup.recordedPlaybackItems) && backup.recordedPlaybackItems.length > 0) {
            await connection.getRepository(RecordedPlayback).save(backup.recordedPlaybackItems, { chunk: 100 });
        }

        this.writeOptionalJson(path.join(this.dataRoot, 'annict', 'settings.json'), backup.annictSettings);
        fs.rmSync(path.join(this.dataRoot, 'annict', 'write-token.json'), { force: true });
        this.writeOptionalJson(
            path.join(this.dataRoot, 'viewer-profiles', 'discord-notification.json'),
            backup.discordNotificationSettings,
        );
    }

    private createLegacyBackup(backup: BackupData): BackupData {
        const legacyBackup = JSON.parse(JSON.stringify(backup)) as BackupData;
        delete legacyBackup.tvUserItems;
        delete legacyBackup.annictRuleLinkItems;
        delete legacyBackup.viewerProfileItems;
        delete legacyBackup.annictCredentialItems;
        delete legacyBackup.annictRecordedEpisodeItems;
        delete legacyBackup.annictEpisodeWatchItems;
        delete legacyBackup.recordedPlaybackItems;
        delete legacyBackup.annictSettings;
        delete legacyBackup.discordNotificationSettings;

        this.deleteProperties(legacyBackup.ruleItems, [
            'userId',
            'channelTypes',
            'encodeChannelId1',
            'encodeChannelId2',
            'encodeChannelId3',
            'encodeChannelIds1',
            'encodeChannelIds2',
            'encodeChannelIds3',
            'updateThumbnail',
        ]);
        this.deleteProperties(legacyBackup.reserveItems, ['userId', 'updateThumbnail']);
        this.deleteProperties(legacyBackup.recordedItems, ['userId']);

        return legacyBackup;
    }

    private normalizeUserId<T extends { userId?: number | null }>(items: T[]): void {
        for (const item of items) {
            if (typeof item.userId !== 'number') {
                item.userId = 1;
            }
        }
    }

    private deleteProperties(items: any[], names: string[]): void {
        for (const item of items) {
            for (const name of names) {
                delete item[name];
            }
        }
    }

    private readOptionalJson(filePath: string): unknown {
        try {
            return JSON.parse(fs.readFileSync(filePath, 'utf8'));
        } catch (err: any) {
            if (err?.code === 'ENOENT') return undefined;
            throw err;
        }
    }

    private writeOptionalJson(filePath: string, value: unknown): void {
        if (typeof value === 'undefined') return;
        fs.mkdirSync(path.dirname(filePath), { recursive: true });
        const temporaryPath = `${filePath}.restore-${process.pid.toString(10)}`;
        fs.writeFileSync(temporaryPath, JSON.stringify(value), { encoding: 'utf8', mode: 0o600 });
        fs.renameSync(temporaryPath, filePath);
    }
}

new DBTools().run();
