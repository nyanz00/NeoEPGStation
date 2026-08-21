import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import VideoFile from '../../../db/entities/VideoFile';
import IRecordedDB, { FindAllOption } from '../../db/IRecordedDB';
import ITvUserDB from '../../db/ITvUserDB';
import IVideoFileDB, { UpdateFilePathOption } from '../../db/IVideoFileDB';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import { UploadedVideoFileOption } from '../../operator/recorded/IRecordedManageModel';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import IRecordedItemUtil from '../IRecordedItemUtil';
import IVideoUtil from '../video/IVideoUtil';
import IRecordedApiModel from './IRecordedApiModel';

interface VideoMovePlan {
    video: VideoFile;
    sourcePath: string;
    destinationPath: string;
    destinationFilePath: string;
}

@injectable()
export default class RecordedApiModel implements IRecordedApiModel {
    private configuration: IConfiguration;
    private ipc: IIPCClient;
    private recordedDB: IRecordedDB;
    private userDB: ITvUserDB;
    private videoFileDB: IVideoFileDB;
    private videoUtil: IVideoUtil;
    private encodeManage: IEncodeManageModel;
    private recordedItemUtil: IRecordedItemUtil;
    private log: ILogger;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('ITvUserDB') userDB: ITvUserDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @inject('IRecordedItemUtil') recordedItemUtil: IRecordedItemUtil,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.configuration = configuration;
        this.recordedDB = recordedDB;
        this.userDB = userDB;
        this.videoFileDB = videoFileDB;
        this.videoUtil = videoUtil;
        this.ipc = ipc;
        this.encodeManage = encodeManage;
        this.recordedItemUtil = recordedItemUtil;
        this.log = logger.getLogger();
    }

    /**
     * 録画情報の取得
     * @param option: GetRecordedOption
     * @return Promise<apid.Records>
     */
    public async gets(option: apid.GetRecordedOption): Promise<apid.Records> {
        (<FindAllOption>option).isRecording = false;
        this.setSearchVideoFileOption(option as FindAllOption);
        const [records, total] = await this.recordedDB.findAll(option, {
            isNeedVideoFiles: true,
            isNeedThumbnails: true,
            isNeedsDropLog: true,
            isNeedTags: false,
        });

        const encodeIndex = this.encodeManage.getRecordedIndex();

        return {
            records: records.map(r => {
                return this.recordedItemUtil.convertRecordedToRecordedItem(r, option.isHalfWidth, encodeIndex);
            }),
            total,
        };
    }

    /**
     * 指定した recorded id の録画情報を取得する
     * @param recordedId: apid.RecordedId
     * @param isHalfWidth: boolean 半角文字で返すか
     * @return Promise<apid.RecordedItem | null> null の場合録画情報が存在しない
     */
    public async get(recordedId: apid.RecordedId, isHalfWidth: boolean): Promise<apid.RecordedItem | null> {
        const item = await this.recordedDB.findId(recordedId);

        const encodeIndex = this.encodeManage.getRecordedIndex();

        return item === null
            ? null
            : this.recordedItemUtil.convertRecordedToRecordedItem(item, isHalfWidth, encodeIndex);
    }

    public async getListPosition(recordedId: apid.RecordedId, limit: number): Promise<apid.RecordedListPosition> {
        if (!Number.isInteger(recordedId) || recordedId <= 0) throw new Error('録画IDが不正です');
        if (!Number.isInteger(limit) || limit <= 0 || limit > 1000) throw new Error('表示件数が不正です');
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null || recorded.isRecording) throw new Error('録画済み番組が見つかりません');
        const precedingCount = await this.recordedDB.countRecordedBefore(recorded);
        return {
            page: Math.floor(precedingCount / limit) + 1,
            userId: recorded.userId ?? undefined,
        };
    }

    /**
     * recorded の検索オプションリストを取得する
     * @return Promise<apid.RecordedSearchOptionList>
     */
    public async getSearchOptionList(): Promise<apid.RecordedSearchOptions> {
        const channels = await this.recordedDB.findChannelList();
        const genres = await this.recordedDB.findGenreList();
        const encodedNames = await this.recordedDB.findEncodedNameList();
        const config = this.configuration.getConfig();
        const encodeItemIndex: { [name: string]: apid.RecordedEncodeListItem } = {};
        const encodeItems: apid.RecordedEncodeListItem[] = [];

        const pushEncodeItem = (item: apid.RecordedEncodeListItem): void => {
            if (
                typeof item.name !== 'string' ||
                item.name.length === 0 ||
                typeof encodeItemIndex[item.name] !== 'undefined'
            ) {
                return;
            }

            encodeItemIndex[item.name] = item;
            encodeItems.push(item);
        };

        for (const e of config.encode) {
            if (typeof e.name !== 'string' || e.name.length === 0) {
                continue;
            }

            pushEncodeItem({
                name: e.name,
                suffix: e.suffix,
            });
        }

        for (const name of encodedNames) {
            pushEncodeItem({
                name,
            });
        }

        return {
            channels: channels,
            genres: genres,
            encode: encodeItems,
        };
    }

    private setSearchVideoFileOption(option: FindAllOption): void {
        const encodeModes =
            typeof option.encodeModes !== 'undefined' && option.encodeModes.length > 0
                ? option.encodeModes
                : typeof option.encodeMode === 'string'
                  ? [option.encodeMode]
                  : [];

        if (encodeModes.length === 0) {
            return;
        }

        option.searchVideoFiles = encodeModes.map(mode => {
            if (mode === '__ts__') {
                return {
                    type: 'ts',
                };
            }

            return {
                type: 'encoded',
                name: mode,
            };
        });
    }

    /**
     *
     * @param recordedId: ReserveId
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId): Promise<void> {
        await this.encodeManage.cancelEncodeByRecordedId(recordedId);

        return this.ipc.recorded.delete(recordedId);
    }

    /**
     * recordedId を指定してエンコードを停止させる
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public stopEncode(recordedId: apid.RecordedId): Promise<void> {
        return this.encodeManage.cancelEncodeByRecordedId(recordedId);
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        return this.ipc.recorded.changeProtect(recordedId, isProtect);
    }

    /**
     * recorded のユーザーを変更する
     */
    public async changeUser(recordedId: apid.RecordedId, option: apid.UpdateRecordedUserOption): Promise<void> {
        const userId = Number(option.userId);
        if (Number.isInteger(userId) === false) {
            throw new Error('UserIsNull');
        }

        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }
        if ((await this.userDB.findId(userId)) === null) {
            throw new Error('UserIsNull');
        }

        await this.recordedDB.changeUser(recordedId, userId);
    }

    public async bulkChangeUser(option: apid.BulkUpdateRecordedUserOption): Promise<apid.BulkRecordedOperationResult> {
        const recordedIds = this.parseRecordedIds(option.recordedIds);
        const userId = Number(option.userId);
        if (Number.isInteger(userId) === false || (await this.userDB.findId(userId)) === null) {
            throw new Error('UserIsNull');
        }

        await this.requireRecordedItems(recordedIds);
        await this.recordedDB.changeUsers(recordedIds, userId);

        return {
            updatedCount: recordedIds.length,
            movedFileCount: 0,
        };
    }

    public async getSubDirectories(): Promise<apid.RecordedSubDirectories> {
        const directories = new Set<string>();
        for (const recordedDirectory of this.configuration.getConfig().recorded) {
            await this.collectSubDirectories(recordedDirectory.path, recordedDirectory.path, directories);
        }

        return {
            directories: Array.from(directories).sort((left, right) =>
                left.localeCompare(right, 'ja', { numeric: true }),
            ),
        };
    }

    public async moveToSubDirectory(
        option: apid.MoveRecordedSubDirectoryOption,
    ): Promise<apid.BulkRecordedOperationResult> {
        const recordedIds = this.parseRecordedIds(option.recordedIds);
        const subDirectory = this.normalizeSubDirectory(option.subDirectory);
        const records = await this.requireRecordedItems(recordedIds);
        const encodeIndex = this.encodeManage.getRecordedIndex();
        if (records.some(recorded => recorded.isRecording || typeof encodeIndex[recorded.id] !== 'undefined')) {
            throw new Error('RecordingOrEncodingCannotBeMoved');
        }

        const plans = records.flatMap(recorded =>
            (recorded.videoFiles ?? []).map(video => this.createVideoMovePlan(video, subDirectory)),
        );
        await this.validateVideoMovePlans(plans);

        const moved: VideoMovePlan[] = [];
        const destinationDirectories = new Set(plans.map(plan => path.dirname(plan.destinationPath)));
        try {
            for (const directory of destinationDirectories) {
                await fs.promises.mkdir(directory, { recursive: true });
            }
            for (const plan of plans) {
                if (this.isSamePath(plan.sourcePath, plan.destinationPath)) {
                    continue;
                }
                this.log.system.info(`move recorded file: ${plan.sourcePath} -> ${plan.destinationPath}`);
                await fs.promises.rename(plan.sourcePath, plan.destinationPath);
                moved.push(plan);
            }

            const updates: UpdateFilePathOption[] = moved.map(plan => ({
                videoFileId: plan.video.id,
                parentDirectoryName: plan.video.parentDirectoryName,
                filePath: plan.destinationFilePath,
            }));
            await this.videoFileDB.updateFilePaths(updates);
        } catch (err) {
            const rollbackErrors = await this.rollbackVideoMoves(moved);
            if (rollbackErrors.length > 0) {
                this.log.system.fatal(`recorded file move rollback failed: ${rollbackErrors.join(' / ')}`);
                throw new Error(`RecordedFileMoveRollbackError: ${rollbackErrors.join(' / ')}`);
            }
            throw err;
        }

        await this.removeEmptySourceDirectories(moved);
        return {
            updatedCount: recordedIds.length,
            movedFileCount: moved.length,
        };
    }

    private parseRecordedIds(value: unknown): apid.RecordedId[] {
        if (Array.isArray(value) === false) {
            throw new Error('RecordedIdsAreInvalid');
        }
        const ids = Array.from(new Set(value.map(id => Number(id))));
        if (ids.length === 0 || ids.some(id => Number.isInteger(id) === false || id <= 0)) {
            throw new Error('RecordedIdsAreInvalid');
        }

        return ids;
    }

    private async requireRecordedItems(recordedIds: apid.RecordedId[]) {
        const records = await this.recordedDB.findIds(recordedIds);
        if (records.length !== recordedIds.length) {
            throw new Error('RecordedIsNull');
        }

        return records;
    }

    private normalizeSubDirectory(value: unknown): string {
        if (typeof value !== 'string') {
            throw new Error('SubDirectoryIsInvalid');
        }
        const trimmed = value.trim();
        if (trimmed.length === 0) {
            return '';
        }
        if (path.isAbsolute(trimmed) || /^[a-zA-Z]:/.test(trimmed)) {
            throw new Error('SubDirectoryIsInvalid');
        }
        const segments = trimmed.split(/[\\/]+/);
        if (
            segments.some(
                segment =>
                    segment.length === 0 ||
                    segment === '.' ||
                    segment === '..' ||
                    Array.from(segment).some(character => character.charCodeAt(0) < 32) ||
                    /[<>:"|?*]/.test(segment) ||
                    /[ .]$/.test(segment),
            )
        ) {
            throw new Error('SubDirectoryIsInvalid');
        }

        return segments.join(path.sep);
    }

    private createVideoMovePlan(video: VideoFile, subDirectory: string): VideoMovePlan {
        const rootDirectory = this.videoUtil.getParentDirPath(video.parentDirectoryName);
        if (rootDirectory === null) {
            throw new Error(`RecordedDirectoryIsNull: ${video.parentDirectoryName}`);
        }
        const resolvedRoot = path.resolve(rootDirectory);
        const sourcePath = path.resolve(resolvedRoot, video.filePath);
        const destinationFilePath =
            subDirectory.length === 0
                ? path.basename(video.filePath)
                : path.join(subDirectory, path.basename(video.filePath));
        const destinationPath = path.resolve(resolvedRoot, destinationFilePath);
        if (
            this.isPathInDirectory(sourcePath, resolvedRoot) === false ||
            this.isPathInDirectory(destinationPath, resolvedRoot) === false
        ) {
            throw new Error('RecordedFilePathIsInvalid');
        }

        return {
            video,
            sourcePath,
            destinationPath,
            destinationFilePath,
        };
    }

    private async validateVideoMovePlans(plans: VideoMovePlan[]): Promise<void> {
        const destinationIndex = new Map<string, VideoMovePlan>();
        for (const plan of plans) {
            const sourceStat = await fs.promises.stat(plan.sourcePath).catch(() => null);
            if (sourceStat?.isFile() !== true) {
                throw new Error(`RecordedFileIsMissing: ${path.basename(plan.sourcePath)}`);
            }
            const destinationKey = this.pathComparisonKey(plan.destinationPath);
            const duplicate = destinationIndex.get(destinationKey);
            if (duplicate !== undefined && duplicate.video.id !== plan.video.id) {
                throw new Error(`DestinationFileAlreadyExists: ${path.basename(plan.destinationPath)}`);
            }
            destinationIndex.set(destinationKey, plan);

            if (this.isSamePath(plan.sourcePath, plan.destinationPath) === false) {
                const destinationStat = await fs.promises.stat(plan.destinationPath).catch(() => null);
                if (destinationStat !== null) {
                    throw new Error(`DestinationFileAlreadyExists: ${path.basename(plan.destinationPath)}`);
                }
            }
        }
    }

    private async rollbackVideoMoves(moved: VideoMovePlan[]): Promise<string[]> {
        const errors: string[] = [];
        for (const plan of [...moved].reverse()) {
            try {
                await fs.promises.mkdir(path.dirname(plan.sourcePath), { recursive: true });
                await fs.promises.rename(plan.destinationPath, plan.sourcePath);
            } catch (err) {
                errors.push(
                    `${path.basename(plan.destinationPath)}: ${err instanceof Error ? err.message : String(err)}`,
                );
            }
        }

        return errors;
    }

    private async removeEmptySourceDirectories(moved: VideoMovePlan[]): Promise<void> {
        const config = this.configuration.getConfig();
        const roots = config.recorded.map(item => path.resolve(item.path));
        if (typeof config.recordedTmp === 'string') {
            roots.push(path.resolve(config.recordedTmp));
        }
        const directories = Array.from(new Set(moved.map(plan => path.dirname(plan.sourcePath)))).sort(
            (left, right) => right.length - left.length,
        );
        for (const directory of directories) {
            if (roots.some(root => this.isSamePath(root, directory))) {
                continue;
            }
            await fs.promises.rmdir(directory).catch(() => {});
        }
    }

    private async collectSubDirectories(root: string, current: string, result: Set<string>): Promise<void> {
        const entries = await fs.promises.readdir(current, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (entry.isDirectory() === false) {
                continue;
            }
            const fullPath = path.join(current, entry.name);
            const relative = path.relative(root, fullPath);
            if (relative.length === 0 || this.isPathInDirectory(fullPath, root) === false) {
                continue;
            }
            result.add(relative.split(path.sep).join('/'));
            await this.collectSubDirectories(root, fullPath, result);
        }
    }

    private isPathInDirectory(candidate: string, root: string): boolean {
        const relative = path.relative(path.resolve(root), path.resolve(candidate));
        return (
            relative.length > 0 &&
            relative !== '..' &&
            path.isAbsolute(relative) === false &&
            relative.startsWith(`..${path.sep}`) === false
        );
    }

    private isSamePath(left: string, right: string): boolean {
        return this.pathComparisonKey(left) === this.pathComparisonKey(right);
    }

    private pathComparisonKey(value: string): string {
        const resolved = path.resolve(value);
        return process.platform === 'win32' ? resolved.toLocaleLowerCase() : resolved;
    }

    public getLatestCleanupPlanPath(): Promise<string | null> {
        return this.ipc.recorded.getLatestCleanupPlanPath();
    }

    public createCleanupPlan(): Promise<apid.RecordedCleanupPlanResult> {
        return this.ipc.recorded.createCleanupPlan();
    }

    public executeCleanupPlan(planPath: string): Promise<apid.RecordedCleanupExecuteResult> {
        return this.ipc.recorded.executeCleanupPlan(planPath);
    }

    /**
     * ファイルのクリーンアップ
     */
    public async fileCleanup(): Promise<void> {
        await this.ipc.recorded.videoFileCleanup();
        await this.ipc.recorded.dropLogFileCleanup();
    }

    /**
     * upload されたビデオファイルを追加する
     * @param option: UploadedVideoFileInfo
     * @return Promise<void>
     */
    public async addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void> {
        await this.ipc.recorded.addUploadedVideoFile(option);
    }

    /**
     * 録画番組情報を新規作成
     * @param option: apid.CreateNewRecordedOption
     * @return Promise<apid.RecordedId>
     */
    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        return await this.ipc.recorded.createNewRecorded(option);
    }
}
