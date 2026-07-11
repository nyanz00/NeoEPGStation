import { inject, injectable } from 'inversify';
import { mkdirp } from 'mkdirp';
import * as path from 'path';
import * as apid from '../../../../api';
import DropLogFile from '../../../db/entities/DropLogFile';
import Recorded from '../../../db/entities/Recorded';
import Thumbnail from '../../../db/entities/Thumbnail';
import VideoFile from '../../../db/entities/VideoFile';
import FileUtil from '../../../util/FileUtil';
import StrUtil from '../../../util/StrUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IDropLogFileDB from '../../db/IDropLogFileDB';
import IRecordedDB from '../../db/IRecordedDB';
import IRecordedHistoryDB from '../../db/IRecordedHistoryDB';
import IThumbnailDB from '../../db/IThumbnailDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IRecordedEvent from '../../event/IRecordedEvent';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IRecordingManageModel from '../recording/IRecordingManageModel';
import IRecordedManageModel, { AddVideoFileOption, UploadedVideoFileOption } from './IRecordedManageModel';
import IRecordingUtilModel from '../recording/IRecordingUtilModel';

@injectable()
export default class RecordedManageModel implements IRecordedManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private recordedDB: IRecordedDB;
    private videoFileDB: IVideoFileDB;
    private thumbnailDB: IThumbnailDB;
    private dropLogFileDB: IDropLogFileDB;
    private recordedHistoryDB: IRecordedHistoryDB;
    private recordingManageModel: IRecordingManageModel;
    private recordedEvent: IRecordedEvent;
    private videoUtil: IVideoUtil;
    private recordingUtilModel: IRecordingUtilModel;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IDropLogFileDB') dropLogFileDB: IDropLogFileDB,
        @inject('IRecordedHistoryDB') recordedHistoryDB: IRecordedHistoryDB,
        @inject('IRecordingManageModel')
        recordingManageModel: IRecordingManageModel,
        @inject('IRecordedEvent') recordedEvent: IRecordedEvent,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IRecordingUtilModel') recordingUtilModel: IRecordingUtilModel,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.recordedDB = recordedDB;
        this.videoFileDB = videoFileDB;
        this.thumbnailDB = thumbnailDB;
        this.dropLogFileDB = dropLogFileDB;
        this.recordedHistoryDB = recordedHistoryDB;
        this.recordingManageModel = recordingManageModel;
        this.recordedEvent = recordedEvent;
        this.videoUtil = videoUtil;
        this.recordingUtilModel = recordingUtilModel;
    }

    /**
     * 指定した録画情報と各種ファイルを削除する
     * @param recordedId: RecordedId
     * @param isIgnoreProtection: boolean
     * @return Promise<void>
     */
    public async delete(recordedId: apid.RecordedId, isIgnoreProtection: boolean = false): Promise<void> {
        this.log.system.info(`delete recorded: ${recordedId}`);
        const recorded = await this.recordedDB.findId(recordedId);
        if (recorded === null) {
            this.log.system.warn(`${recordedId} is null`);
            throw new Error('RecordedIdIsNotFound');
        }

        // プロテクトチェック
        if (recorded.isProtected === true) {
            this.log.system.warn(`${recordedId} is protected`);
            throw new Error('RecordedIsProtected');
        }

        // 録画中なら停止
        if (
            isIgnoreProtection === false &&
            recorded.isRecording === true &&
            recorded.reserveId !== null &&
            this.recordingManageModel.hasReserve(recorded.reserveId) === true
        ) {
            this.log.system.info(
                `cancel recording by recorded manager reserveId: ${recorded.reserveId} recordedId: ${recorded.id}`,
            );
            await this.recordingManageModel.cancel(recorded.reserveId, true);
        }

        const hasThumbnails = typeof recorded.thumbnails !== 'undefined' && recorded.thumbnails.length > 0;
        const hasVideoFiles = typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length > 0;

        // サムネイル実ファイル削除
        if (hasThumbnails === true && typeof recorded.thumbnails !== 'undefined') {
            for (const t of recorded.thumbnails) {
                const filePath = this.getThumbnailPath(t);
                this.log.system.info(`delete: ${filePath}`);
                await FileUtil.unlink(filePath).catch(err => {
                    this.log.system.error(`failed to delete ${filePath}`);
                    this.log.system.error(err);
                });
            }
        }

        // 録画ファイル実ファイル削除
        if (hasVideoFiles === true && typeof recorded.videoFiles !== 'undefined') {
            for (const v of recorded.videoFiles) {
                let filePath: string | null;
                try {
                    filePath = await this.videoUtil.getFullFilePathFromId(v.id);
                    if (filePath === null) {
                        throw new Error('GetVideoFilePathError');
                    }
                } catch (err: any) {
                    this.log.system.error(`get video file path error: ${v.id}`);
                    this.log.system.error(err);
                    this.log.system.error(v);
                    continue;
                }

                this.log.system.info(`delete: ${filePath}`);
                await FileUtil.unlink(filePath).catch(err => {
                    this.log.system.error(`failed to delete ${filePath}`);
                    this.log.system.error(err);
                });
            }
        }

        // ドロップログファイル削除処理
        if (typeof recorded.dropLogFile !== 'undefined' && recorded.dropLogFile !== null) {
            const filePath = this.getDropLogFilePath(recorded.dropLogFile);
            this.log.system.info(`delete: ${filePath}`);
            await FileUtil.unlink(filePath).catch(err => {
                this.log.system.error(`failed to delete ${filePath}`);
                this.log.system.error(err);
            });
        }

        // DB からサムネイル情報削除
        if (hasThumbnails === true) {
            this.thumbnailDB.deleteRecordedId(recordedId).catch(err => {
                this.log.system.error(`falied to delete thumbnail data: ${recordedId}`);
                this.log.system.error(err);
            });
        }

        // DB から録画ファイル情報削除
        if (hasVideoFiles === true) {
            await this.videoFileDB.deleteRecordedId(recordedId).catch(err => {
                this.log.system.error(`falied to delete video data: ${recordedId}`);
                this.log.system.error(err);
            });
        }

        // DB から録画情報削除
        await this.recordedDB.deleteOnce(recordedId).catch(err => {
            this.log.system.error(`falied to delete recorded data: ${recordedId}`);
            this.log.system.error(err);
        });

        // DB からドロップログファイル情報削除
        if (typeof recorded.dropLogFile !== 'undefined' && recorded.dropLogFile !== null) {
            await this.dropLogFileDB.deleteOnce(recorded.dropLogFile.id).catch(err => {
                this.log.system.error(`failed to delete drop log data: ${recorded.dropLogFile?.id}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info(`successful delete recorded: ${recordedId}`);

        // イベント発行
        this.recordedEvent.emitDeleteRecorded(recorded);
    }

    /**
     * サムネイルファイルパス取得
     * @param thumbnail: Thumbnail
     * @return string
     */
    private getThumbnailPath(thumbnail: Thumbnail): string {
        return path.join(this.config.thumbnail, thumbnail.filePath);
    }

    /**
     * ドロップログファイルパス取得
     * @param dropLogFile: DropLogFile
     * @return string
     */
    private getDropLogFilePath(dropLogFile: DropLogFile): string {
        return path.join(this.config.dropLog, dropLogFile.filePath);
    }

    /**
     * 指定されて video file id のファイルサイズを更新する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>;
     */
    public async updateVideoFileSize(videoFileId: apid.VideoFileId): Promise<void> {
        this.log.system.info(`update video file size: ${videoFileId}`);

        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        const fileSize = await FileUtil.getFileSize(filePath);

        await this.videoFileDB.updateSize(videoFileId, fileSize);

        this.recordedEvent.emitUpdateVideoFileSize(videoFileId);
    }

    /**
     * option で指定されたビデオファイルを追加する
     * @param option: AddVideoFileOption
     * @return Promise<apid.VideoFileId>
     */
    public async addVideoFile(option: AddVideoFileOption): Promise<apid.VideoFileId> {
        this.log.system.info(`add video file: ${option.recordedId} ${option.filePath}`);

        const parentDirPath = this.videoUtil.getParentDirPath(option.parentDirectoryName);
        if (parentDirPath === null) {
            this.log.system.error(`parent directory is null: ${option.parentDirectoryName}`);
            throw new Error('ParentDirectoryIsNull');
        }

        const fileSize = await FileUtil.getFileSize(path.join(parentDirPath, option.filePath));

        const videoFile = new VideoFile();
        videoFile.parentDirectoryName = option.parentDirectoryName;
        videoFile.filePath = option.filePath;
        videoFile.type = option.type;
        videoFile.name = option.name;
        videoFile.size = fileSize;
        videoFile.recordedId = option.recordedId;

        const newVideoFileId = await this.videoFileDB.insertOnce(videoFile).catch(err => {
            this.log.system.error(`failed to add video: ${option.parentDirectoryName}/${option.filePath}`);
            this.log.system.error(err);
            throw err;
        });

        this.recordedEvent.emitAddVideoFile(newVideoFileId);

        return newVideoFileId;
    }

    /**
     * option で指定されたビデオファイルを追加する
     * @param option: UploadedVideoFileInfo
     * @return Promise<void>
     */
    public async addUploadedVideoFile(option: UploadedVideoFileOption): Promise<void> {
        this.log.system.info(`add uploaded file: ${option.recordedId}`);

        // 指定された番組情報を取得
        const recorded = await this.recordedDB.findId(option.recordedId);
        if (recorded === null) {
            await FileUtil.unlink(option.filePath).catch(() => {});
            throw new Error('RecordedIdIsNull');
        }

        // 親ディレクトリ
        const parentDirPath = this.videoUtil.getParentDirPath(option.parentDirectoryName);
        if (parentDirPath === null) {
            this.log.system.error(`parent directory is null: ${option.parentDirectoryName}`);
            await FileUtil.unlink(option.filePath).catch(() => {});
            throw new Error('ParentDirectoryIsNull');
        }

        // サブディレクトリ
        let dirPath = parentDirPath;
        if (typeof option.subDirectory !== 'undefined') {
            dirPath = path.join(
                dirPath,
                await this.recordingUtilModel.formatFilePathString(option.subDirectory, recorded),
            );

            // check dir
            try {
                await FileUtil.stat(dirPath);
            } catch (err: any) {
                // mkdirp directory
                this.log.system.info(`mkdirp: ${dirPath}`);
                await mkdirp(dirPath);
            }
        }

        // コピー先のファイルパスを生成する
        const filePath = await this.getUploadedVideoFilePath(dirPath, option.fileName);

        // アップロードされたファイルを保存先へ移動する
        try {
            this.log.system.info(`move file ${option.filePath} -> ${filePath}`);
            await FileUtil.rename(option.filePath, filePath);
        } catch (err: any) {
            // move を試す
            try {
                await FileUtil.move(option.filePath, filePath);
            } catch (e: any) {
                this.log.system.error('move file error');
                this.log.system.error(e);
                await FileUtil.unlink(option.filePath).catch(() => {});

                throw new Error('FileMoveError');
            }
        }

        // DB に反映
        try {
            const fileName = path.basename(filePath);
            const videoFileId = await this.addVideoFile({
                recordedId: option.recordedId,
                parentDirectoryName: option.parentDirectoryName,
                filePath:
                    typeof option.subDirectory === 'undefined'
                        ? fileName
                        : path.join(
                              await this.recordingUtilModel.formatFilePathString(option.subDirectory, recorded),
                              fileName,
                          ),
                type: option.fileType,
                name: option.viewName,
            });

            // 通知
            const needsCreateThumbnail = typeof recorded.thumbnails === 'undefined' || recorded.thumbnails.length === 0;
            this.recordedEvent.emitAddUploadedVideoFile(videoFileId, needsCreateThumbnail);
        } catch (err: any) {
            await FileUtil.unlink(filePath).catch(() => {});
            throw err;
        }
    }

    /**
     * アップロードファイルの file path を取得する
     * @param dir: directory
     * @param fileName: file name
     * @param conflict: 同名ファイルがあった場合カウントされる
     * @return string
     */
    private async getUploadedVideoFilePath(dir: string, fileName: string, conflict: number = 0): Promise<string> {
        const extname = path.extname(fileName);
        const name = fileName.slice(0, fileName.length - extname.length);
        const count = conflict > 0 ? `(${conflict})` : '';

        const filePath = path.join(dir, `${name}${count}${extname}`);

        try {
            // 同盟のファイルが存在するか確認
            await FileUtil.stat(filePath);

            return this.getUploadedVideoFilePath(dir, fileName, conflict + 1);
        } catch (err: any) {
            return filePath;
        }
    }

    /**
     * 録画番組情報を新規作成
     * @param option: apid.CreateNewRecordedOption
     * @return Promise<apid.RecordedId>
     */
    public async createNewRecorded(option: apid.CreateNewRecordedOption): Promise<apid.RecordedId> {
        this.log.system.info('create new recorded');

        const recorded = new Recorded();
        recorded.isRecording = false;
        recorded.isProtected = false;
        recorded.userId = typeof option.userId === 'undefined' ? 1 : option.userId;
        if (typeof option.ruleId !== 'undefined') {
            recorded.ruleId = option.ruleId;
        }
        recorded.channelId = option.channelId;
        recorded.startAt = option.startAt;
        recorded.endAt = option.endAt;
        if (option.startAt - option.endAt >= 0) {
            throw new Error('TimeRangeError');
        }
        recorded.duration = option.endAt - option.startAt;
        recorded.name = StrUtil.toDBStr(option.name);
        recorded.halfWidthName = StrUtil.toHalf(option.name);
        if (typeof option.description !== 'undefined') {
            recorded.description = StrUtil.toDBStr(option.description);
            recorded.halfWidthDescription = StrUtil.toHalf(recorded.description);
        }
        if (typeof option.extended !== 'undefined') {
            recorded.extended = StrUtil.toDBStr(option.extended);
            recorded.halfWidthExtended = StrUtil.toHalf(recorded.extended);
        }
        if (typeof option.genre1 !== 'undefined') {
            recorded.genre1 = option.genre1;
        }
        if (typeof option.subGenre1 !== 'undefined') {
            recorded.subGenre1 = option.subGenre1;
        }
        if (typeof option.genre2 !== 'undefined') {
            recorded.genre2 = option.genre2;
        }
        if (typeof option.subGenre2 !== 'undefined') {
            recorded.subGenre2 = option.subGenre2;
        }
        if (typeof option.genre3 !== 'undefined') {
            recorded.genre3 = option.genre3;
        }
        if (typeof option.subGenre3 !== 'undefined') {
            recorded.subGenre3 = option.subGenre3;
        }

        const recordedId = await this.recordedDB.insertOnce(recorded).catch(err => {
            this.log.system.error(err);
            throw err;
        });

        this.log.system.info(`created new recorded: ${recordedId}`);

        this.recordedEvent.emitCreateNewRecorded(recordedId);

        return recordedId;
    }

    /**
     * 指定された video file id のファイルを削除する
     * @param videoFileid: apid.VideoFileId
     * @param isIgnoreProtection: boolean
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileid: apid.VideoFileId, isIgnoreProtection: boolean = false): Promise<void> {
        this.log.system.info(`delete video file: ${videoFileid}`);

        const video = await this.videoFileDB.findId(videoFileid);
        if (video === null) {
            this.log.system.info(`video file is not found: ${videoFileid}`);
            throw new Error('VideoFileIsNotFound');
        }

        // プロテクトがかかっているか確認
        let recorded = await this.recordedDB.findId(video.recordedId);
        if (isIgnoreProtection === false && recorded !== null && recorded.isProtected === true) {
            this.log.system.warn(`${videoFileid} is protected`);
            throw new Error('RecordedIsProtected');
        }

        // 録画中の場合は録画情報ごと削除
        if (recorded?.isRecording === true) {
            return await this.delete(video.recordedId, false);
        }

        // 実ファイル削除
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileid);
        if (filePath !== null) {
            this.log.system.info(`delete: ${filePath}`);
            await FileUtil.unlink(filePath).catch(err => {
                this.log.system.error(`failed to delete ${filePath}`);
                this.log.system.error(err);
            });
        }

        // DB から削除
        await this.videoFileDB.deleteOnce(videoFileid);

        // video に紐付けられていた recorded が空かチェック
        recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded !== null && typeof recorded.videoFiles !== 'undefined' && recorded.videoFiles.length === 0) {
            // 空だったので recorded も削除
            this.log.system.info(`empty video files: ${video.recordedId}`);
            await this.delete(video.recordedId, false);
        } else {
            this.recordedEvent.emitDeleteVideoFile(videoFileid);
        }
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public async changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        this.log.system.info((isProtect === true ? 'set protect' : 'remove protect') + `: ${recordedId}`);

        await this.recordedDB.changeProtect(recordedId, isProtect);
        this.recordedEvent.emitChangeProtect(recordedId, isProtect);
    }

    /**
     * RecordedHistory の保存期間外のデータを削除する
     * @return Promise<void>
     */
    public async historyCleanup(): Promise<void> {
        const date = new Date().getTime() - this.config.recordedHistoryRetentionPeriodDays * 24 * 60 * 60 * 1000;
        await this.recordedHistoryDB.delete(date).catch(err => {
            this.log.system.error('failed to historyCleanup');
            this.log.system.error(err);
        });
    }

    public async createCleanupPlan(): Promise<apid.RecordedCleanupPlanResult> {
        this.log.system.info('start create recorded cleanup plan');

        const videoFiles = await this.videoFileDB.findAll();
        const fileIndex: { [filePath: string]: boolean } = {};
        const dirIndex: { [dirPath: string]: boolean } = {};
        const missingVideoFiles: { id: number; path: string }[] = [];

        for (const video of videoFiles) {
            const videoFilePath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (videoFilePath === null) {
                continue;
            }

            if ((await this.checkFileExistence(videoFilePath)) === true) {
                fileIndex[videoFilePath] = true;
                const parentDir = path.dirname(videoFilePath).replace(new RegExp(`\\${path.sep}$`), '');
                dirIndex[parentDir] = true;
            } else {
                missingVideoFiles.push({
                    id: video.id,
                    path: videoFilePath,
                });
            }
        }

        const recordedList: FileUtil.FileList = {
            files: [],
            directories: [],
        };
        for (const r of this.config.recorded) {
            const list = await FileUtil.getFileList(r.path);
            Array.prototype.push.apply(recordedList.files, list.files);
            Array.prototype.push.apply(recordedList.directories, list.directories);
            dirIndex[r.path] = true;
        }
        recordedList.directories.sort((dir1, dir2) => {
            return dir2.length - dir1.length;
        });

        const epgstationLikeFiles: string[] = [];
        const otherRecordedFiles: string[] = [];
        for (const file of recordedList.files) {
            if (typeof fileIndex[file] !== 'undefined') {
                continue;
            }

            if (this.isEpgstationLikeRecordedFile(file) === true) {
                epgstationLikeFiles.push(file);
            } else {
                otherRecordedFiles.push(file);
            }
        }

        const unregisteredDirectories = recordedList.directories.filter(dir => {
            return typeof dirIndex[dir] === 'undefined';
        });

        const dropLogs = await this.dropLogFileDB.findAll();
        const dropLogFileIndex: { [filePath: string]: boolean } = {};
        const missingDropLogs: { id: number; path: string }[] = [];
        for (const dropLog of dropLogs) {
            const filePath = this.getDropLogFilePath(dropLog);

            if ((await this.checkFileExistence(filePath)) === true) {
                dropLogFileIndex[filePath] = true;
            } else {
                missingDropLogs.push({
                    id: dropLog.id,
                    path: filePath,
                });
            }
        }

        const dropLogList = await FileUtil.getFileList(this.config.dropLog);
        const unregisteredDropLogFiles = dropLogList.files.filter(file => {
            return typeof dropLogFileIndex[file] === 'undefined';
        });

        const thumbnails = await this.thumbnailDB.findAll();
        const thumbnailFileIndex: { [filePath: string]: boolean } = {};
        const missingThumbnails: { id: number; path: string }[] = [];
        for (const thumbnail of thumbnails) {
            const filePath = this.getThumbnailPath(thumbnail);

            if ((await this.checkFileExistence(filePath)) === true) {
                thumbnailFileIndex[filePath] = true;
            } else {
                missingThumbnails.push({
                    id: thumbnail.id,
                    path: filePath,
                });
            }
        }

        const thumbnailList = await FileUtil.getFileList(this.config.thumbnail);
        const unregisteredThumbnailFiles = thumbnailList.files.filter(file => {
            return typeof thumbnailFileIndex[file] === 'undefined';
        });

        const planPath = await this.writeCleanupPlan({
            missingVideoFiles,
            epgstationLikeFiles,
            otherRecordedFiles,
            unregisteredDirectories,
            missingDropLogs,
            unregisteredDropLogFiles,
            missingThumbnails,
            unregisteredThumbnailFiles,
        });

        this.log.system.info(`created recorded cleanup plan: ${planPath}`);

        return {
            planPath,
            recordedFileCount: epgstationLikeFiles.length + otherRecordedFiles.length,
            epgstationLikeRecordedFileCount: epgstationLikeFiles.length,
            otherRecordedFileCount: otherRecordedFiles.length,
            recordedDirectoryCount: unregisteredDirectories.length,
            missingVideoFileCount: missingVideoFiles.length,
            dropLogFileCount: unregisteredDropLogFiles.length,
            missingDropLogFileCount: missingDropLogs.length,
            thumbnailFileCount: unregisteredThumbnailFiles.length,
            missingThumbnailFileCount: missingThumbnails.length,
        };
    }

    public async executeCleanupPlan(planPath: string): Promise<apid.RecordedCleanupExecuteResult> {
        const resolvedPlanPath = path.resolve(planPath);
        if (this.isPathInDir(resolvedPlanPath, this.getCleanupPlanDir()) === false) {
            throw new Error('InvalidCleanupPlanPath');
        }

        this.log.system.info(`execute recorded cleanup plan: ${resolvedPlanPath}`);

        const result: apid.RecordedCleanupExecuteResult = {
            deletedRecordedFileCount: 0,
            deletedRecordedDirectoryCount: 0,
            deletedDropLogFileCount: 0,
            deletedThumbnailFileCount: 0,
            removedMissingVideoFileCount: 0,
            removedMissingDropLogFileCount: 0,
            removedMissingThumbnailFileCount: 0,
            skippedCount: 0,
        };
        const lines = (await FileUtil.readFile(resolvedPlanPath)).split(/\r?\n/);

        for (const line of lines) {
            const trimmedLine = line.trim();
            if (trimmedLine.length === 0 || trimmedLine.startsWith('#') === true) {
                continue;
            }

            const [command, value, comment] = trimmedLine.split('\t');
            try {
                if (command === 'DELETE_RECORDED_FILE') {
                    if (this.isPathInRecordedDirs(value) === false) {
                        throw new Error('InvalidRecordedFilePath');
                    }
                    await FileUtil.unlink(value);
                    result.deletedRecordedFileCount++;
                } else if (command === 'DELETE_RECORDED_DIR') {
                    if (
                        this.isPathInRecordedDirs(value) === false ||
                        (await FileUtil.isEmptyDirectory(value)) === false
                    ) {
                        result.skippedCount++;
                        continue;
                    }
                    await FileUtil.rmdir(value);
                    result.deletedRecordedDirectoryCount++;
                } else if (command === 'DELETE_DROP_LOG_FILE') {
                    if (this.isPathInDir(value, this.config.dropLog) === false) {
                        throw new Error('InvalidDropLogFilePath');
                    }
                    await FileUtil.unlink(value);
                    result.deletedDropLogFileCount++;
                } else if (command === 'DELETE_THUMBNAIL_FILE') {
                    if (this.isPathInDir(value, this.config.thumbnail) === false) {
                        throw new Error('InvalidThumbnailFilePath');
                    }
                    await FileUtil.unlink(value);
                    result.deletedThumbnailFileCount++;
                } else if (command === 'REMOVE_VIDEO_DB') {
                    const videoFileId = parseInt(value, 10);
                    const videoFile = await this.videoFileDB.findId(videoFileId);
                    if (videoFile === null) {
                        result.skippedCount++;
                        continue;
                    }

                    const videoFilePath = this.videoUtil.getFullFilePathFromVideoFile(videoFile);
                    if (videoFilePath !== null && (await this.checkFileExistence(videoFilePath)) === false) {
                        await this.deleteVideoFile(videoFile.id).catch(() => {});
                        result.removedMissingVideoFileCount++;
                    } else {
                        result.skippedCount++;
                    }
                } else if (command === 'REMOVE_DROP_LOG_DB') {
                    const dropLogFileId = parseInt(value, 10);
                    const dropLogFile = await this.dropLogFileDB.findId(dropLogFileId);
                    if (dropLogFile === null) {
                        result.skippedCount++;
                        continue;
                    }

                    const dropLogFilePath = this.getDropLogFilePath(dropLogFile);
                    if ((await this.checkFileExistence(dropLogFilePath)) === false) {
                        await this.recordedDB.removeDropLogFileId(dropLogFile.id);
                        await this.dropLogFileDB.deleteOnce(dropLogFile.id);
                        result.removedMissingDropLogFileCount++;
                    } else {
                        result.skippedCount++;
                    }
                } else if (command === 'REMOVE_THUMBNAIL_DB') {
                    const thumbnailId = parseInt(value, 10);
                    const thumbnail = await this.thumbnailDB.findId(thumbnailId);
                    if (thumbnail === null) {
                        result.skippedCount++;
                        continue;
                    }

                    const thumbnailPath = this.getThumbnailPath(thumbnail);
                    if ((await this.checkFileExistence(thumbnailPath)) === false) {
                        await this.thumbnailDB.deleteOnce(thumbnail.id);
                        result.removedMissingThumbnailFileCount++;
                    } else {
                        result.skippedCount++;
                    }
                } else {
                    result.skippedCount++;
                }
            } catch (err: any) {
                result.skippedCount++;
                this.log.system.error(`failed to execute cleanup line: ${command}\t${value}\t${comment}`);
                this.log.system.error(err);
            }
        }

        this.log.system.info(`execute recorded cleanup plan completed: ${resolvedPlanPath}`);

        return result;
    }

    private async writeCleanupPlan(option: {
        missingVideoFiles: { id: number; path: string }[];
        epgstationLikeFiles: string[];
        otherRecordedFiles: string[];
        unregisteredDirectories: string[];
        missingDropLogs: { id: number; path: string }[];
        unregisteredDropLogFiles: string[];
        missingThumbnails: { id: number; path: string }[];
        unregisteredThumbnailFiles: string[];
    }): Promise<string> {
        const cleanupDir = this.getCleanupPlanDir();
        await FileUtil.mkdir(cleanupDir);

        const date = new Date();
        const timestamp =
            date.getFullYear().toString(10) +
            (date.getMonth() + 1).toString(10).padStart(2, '0') +
            date.getDate().toString(10).padStart(2, '0') +
            '-' +
            date.getHours().toString(10).padStart(2, '0') +
            date.getMinutes().toString(10).padStart(2, '0') +
            date.getSeconds().toString(10).padStart(2, '0');
        const planPath = path.join(cleanupDir, `recorded-cleanup-${timestamp}.txt`);
        const lines: string[] = [];

        lines.push('# EPGStation cleanup plan');
        lines.push('# Delete lines you do not want to execute, then run cleanup execution from EPGStation.');
        lines.push('# Format: COMMAND<TAB>VALUE<TAB># comment');
        lines.push('');
        this.pushCleanupSection(lines, 'DB video file entries whose actual files are missing');
        for (const item of option.missingVideoFiles) {
            lines.push(`REMOVE_VIDEO_DB\t${item.id}\t# ${item.path}`);
        }
        lines.push('');
        this.pushCleanupSection(lines, 'Unregistered recorded files that look like EPGStation outputs');
        for (const file of option.epgstationLikeFiles) {
            lines.push(`DELETE_RECORDED_FILE\t${file}\t# epgstation-like`);
        }
        lines.push('');
        this.pushCleanupSection(lines, 'Unregistered recorded files that do not look like EPGStation outputs');
        for (const file of option.otherRecordedFiles) {
            lines.push(`DELETE_RECORDED_FILE\t${file}\t# other`);
        }
        lines.push('');
        this.pushCleanupSection(lines, 'Unregistered recorded directories, removed only if empty at execution time');
        for (const dir of option.unregisteredDirectories) {
            lines.push(`DELETE_RECORDED_DIR\t${dir}\t# empty-directory-only`);
        }
        lines.push('');
        this.pushCleanupSection(lines, 'DB drop log entries whose actual files are missing');
        for (const item of option.missingDropLogs) {
            lines.push(`REMOVE_DROP_LOG_DB\t${item.id}\t# ${item.path}`);
        }
        lines.push('');
        this.pushCleanupSection(lines, 'Unregistered drop log files');
        for (const file of option.unregisteredDropLogFiles) {
            lines.push(`DELETE_DROP_LOG_FILE\t${file}\t# drop-log`);
        }
        lines.push('');
        this.pushCleanupSection(lines, 'DB thumbnail entries whose actual files are missing');
        for (const item of option.missingThumbnails) {
            lines.push(`REMOVE_THUMBNAIL_DB\t${item.id}\t# ${item.path}`);
        }
        lines.push('');
        this.pushCleanupSection(lines, 'Unregistered thumbnail files');
        for (const file of option.unregisteredThumbnailFiles) {
            lines.push(`DELETE_THUMBNAIL_FILE\t${file}\t# thumbnail`);
        }
        lines.push('');

        await FileUtil.writeFile(planPath, lines.join('\r\n'));

        return planPath;
    }

    private pushCleanupSection(lines: string[], title: string): void {
        lines.push(`## ${title}`);
    }

    private getCleanupPlanDir(): string {
        return path.join(process.cwd(), 'data', 'cleanup');
    }

    private isPathInRecordedDirs(filePath: string): boolean {
        for (const recordedDir of this.config.recorded) {
            if (this.isPathInDir(filePath, recordedDir.path) === true) {
                return true;
            }
        }

        return false;
    }

    private isPathInDir(filePath: string, dirPath: string): boolean {
        const relative = path.relative(path.resolve(dirPath), path.resolve(filePath));

        return relative.length === 0 || (relative.startsWith('..') === false && path.isAbsolute(relative) === false);
    }

    private isEpgstationLikeRecordedFile(filePath: string): boolean {
        const baseName = path.basename(filePath);
        for (const suffix of this.getEncodeSuffixes()) {
            if (baseName.endsWith(suffix) === true) {
                return true;
            }
        }

        return this.createRecordedFormatRegex().test(baseName);
    }

    private getEncodeSuffixes(): string[] {
        const suffixes: string[] = [];
        for (const encode of this.config.encode) {
            if (typeof encode.suffix === 'string' && encode.suffix.length > 0) {
                suffixes.push(encode.suffix);
            }
        }

        return suffixes;
    }

    private createRecordedFormatRegex(): RegExp {
        const tokenPattern = /%[A-Z0-9_]+%/g;
        const escaped = this.config.recordedFormat.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(tokenPattern, '.+');
        const extension = this.config.recordedFileExtension.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

        return new RegExp(`^${escaped}${extension}$`);
    }

    /**
     * DB に登録されていない recorded 下のファイル削除 &  DB に登録されているが存在しない番組情報の削除
     * @return Promise<void>
     */
    public async videoFileCleanup(): Promise<void> {
        this.log.system.info('start video files cleanup');

        const videoFiles = await this.videoFileDB.findAll();

        // ファイル, ディレクトリ索引生成と DB 上に存在するが実ファイルが存在しないデータを削除する
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        const dirIndex: { [dirPath: string]: boolean } = {}; // ディレクトリ索引
        for (const video of videoFiles) {
            const videoFilePath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (videoFilePath === null) {
                continue;
            }

            if ((await this.checkFileExistence(videoFilePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[videoFilePath] = true;
                const parentDir = path.dirname(videoFilePath).replace(new RegExp(`\\${path.sep}$`), '');
                dirIndex[parentDir] = true;
            } else {
                // ファイルが存在しないなら削除
                await this.deleteVideoFile(video.id).catch(() => {});
            }
        }

        // 実ファイルリストを取得する
        const list: FileUtil.FileList = {
            files: [],
            directories: [],
        };
        for (const r of this.config.recorded) {
            const l = await FileUtil.getFileList(r.path);
            Array.prototype.push.apply(list.files, l.files);
            Array.prototype.push.apply(list.directories, l.directories);
            dirIndex[r.path] = true; // 親ディレクトリを索引に追加
        }
        // ディレクトリ削除時にネストが深いディレクトリから削除するためにソート
        list.directories.sort((dir1, dir2) => {
            return dir2.length - dir1.length;
        });

        // ファイル索引上に存在しないファイルを削除する
        for (const file of list.files) {
            if (typeof fileIndex[file] !== 'undefined') {
                continue;
            }

            this.log.system.info(`delete file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to delete file: ${file}`);
                this.log.system.error(err);
            });
        }

        // ディレクトリ索引上に存在しないディレクトリを削除する
        for (const dir of list.directories) {
            if (typeof dirIndex[dir] !== 'undefined') {
                continue;
            }

            this.log.system.info(`delete directory: ${dir}`);
            try {
                // ディレクトリが空かチェック
                if ((await FileUtil.isEmptyDirectory(dir)) === true) {
                    await FileUtil.rmdir(dir);
                } else {
                    this.log.system.warn(`directory is not empty: ${dir}`);
                }
            } catch (err: any) {
                this.log.system.error(`failed to delete directory: ${dir}`);
                this.log.system.error(err);
            }
        }

        this.log.system.info('start video files cleanup completed');
    }

    /**
     * DB に登録されていないログファイル削除 &  DB に登録されているが存在しないログ情報の削除
     */
    public async dropLogFileCleanup(): Promise<void> {
        this.log.system.info('start drop log files cleanup');
        const dropLogs = await this.dropLogFileDB.findAll();

        // ファイル, ディレクトリ索引生成と DB 上に存在するが実ファイルが存在しないデータを削除する
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        for (const dropLog of dropLogs) {
            const filePath = this.getDropLogFilePath(dropLog);

            if ((await this.checkFileExistence(filePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[filePath] = true;
            } else {
                this.log.system.warn(`drop file is not exist: ${filePath}`);
                // ファイルが存在しないなら削除
                try {
                    await this.recordedDB.removeDropLogFileId(dropLog.id);
                    await this.dropLogFileDB.deleteOnce(dropLog.id);
                } catch (err: any) {
                    this.log.system.error(err);
                }
            }
        }

        // ファイル索引上に存在しないファイルを削除する
        const list = await FileUtil.getFileList(this.config.dropLog);
        for (const file of list.files) {
            if (typeof fileIndex[file] !== 'undefined') {
                continue;
            }

            this.log.system.info(`delete drop log file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to drop log file: ${file}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info('start drop log files cleanup completed');
    }

    /**
     * 指定したファイルパスにファイルが存在するか
     * @param filePath: string ファイルパス
     * @return Promise<boolean> ファイルが存在するなら true を返す
     */
    private async checkFileExistence(filePath: string): Promise<boolean> {
        try {
            await FileUtil.stat(filePath);

            return true;
        } catch (err: any) {
            return false;
        }
    }

    /**
     * 指定された ruleId を録画情報から削除する
     * @param ruleId: apid.Rule
     */
    public async removeRuleId(ruleId: apid.RuleId): Promise<void> {
        await this.recordedDB.removeRuleId(ruleId);
    }
}
