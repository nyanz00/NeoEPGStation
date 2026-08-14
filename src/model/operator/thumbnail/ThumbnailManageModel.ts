import { spawn, type ChildProcess } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as path from 'path';
import * as apid from '../../../../api';
import Thumbnail from '../../../db/entities/Thumbnail';
import FileUtil from '../../../util/FileUtil';
import ProcessUtil from '../../../util/ProcessUtil';
import IVideoUtil from '../../api/video/IVideoUtil';
import IRecordedDB from '../../db/IRecordedDB';
import IThumbnailDB from '../../db/IThumbnailDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IThumbnailEvent from '../../event/IThumbnailEvent';
import IConfigFile from '../../IConfigFile';
import IConfiguration from '../../IConfiguration';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IThumbnailManageModel from './IThumbnailManageModel';

@injectable()
export default class ThumbnailManageModel implements IThumbnailManageModel {
    private log: ILogger;
    private config: IConfigFile;
    private queue: Promise<void> = Promise.resolve();
    private recordingTimers: Map<apid.VideoFileId, NodeJS.Timeout> = new Map();
    private recordingAttempts: Map<apid.VideoFileId, number> = new Map();
    private recordingProcesses: Map<apid.VideoFileId, ChildProcess> = new Map();
    private recordedDB: IRecordedDB;
    private videoFileDB: IVideoFileDB;
    private thumbnailDB: IThumbnailDB;
    private thumbnailEvent: IThumbnailEvent;
    private videoUtil: IVideoUtil;

    constructor(
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IThumbnailDB') thumbnailDB: IThumbnailDB,
        @inject('IThumbnailEvent') thumbnailEvent: IThumbnailEvent,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
    ) {
        this.log = logger.getLogger();
        this.config = configuration.getConfig();
        this.recordedDB = recordedDB;
        this.videoFileDB = videoFileDB;
        this.thumbnailDB = thumbnailDB;
        this.thumbnailEvent = thumbnailEvent;
        this.videoUtil = videoUtil;
    }

    /**
     * サムネイル作成 Queue に追加する
     * @param videoFileId: apid.VideoFileId
     */
    public add(videoFileId: apid.VideoFileId): void {
        this.log.system.info(`add thumbnail queue: ${videoFileId}`);

        this.enqueue(() => this.createIfNeeded(videoFileId)).catch(err => {
            this.log.system.error(`create thumbnail error: ${videoFileId}`);
            this.log.system.error(err);
        });
    }

    /** 録画開始後、追記中のTSから早期サムネイルを一度だけ生成する。 */
    public addDuringRecording(videoFileId: apid.VideoFileId): void {
        this.stopDuringRecording(videoFileId);
        this.recordingAttempts.set(videoFileId, 0);
        this.scheduleRecordingThumbnail(videoFileId, ThumbnailManageModel.INITIAL_RECORDING_DELAY);
    }

    /** 録画終了・削除時に未実行の早期生成を止める。生成済み画像はそのまま使用する。 */
    public stopDuringRecording(videoFileId: apid.VideoFileId): void {
        const timer = this.recordingTimers.get(videoFileId);
        if (timer !== undefined) clearTimeout(timer);
        const child = this.recordingProcesses.get(videoFileId);
        if (child !== undefined) child.kill();
        this.recordingTimers.delete(videoFileId);
        this.recordingAttempts.delete(videoFileId);
        this.recordingProcesses.delete(videoFileId);
    }

    public replace(videoFileId: apid.VideoFileId): void {
        this.log.system.info(`replace thumbnail queue: ${videoFileId}`);

        this.enqueue(() => this.replaceRecordedThumbnail(videoFileId)).catch(err => {
            this.log.system.error(`replace thumbnail error: ${videoFileId}`);
            this.log.system.error(err);
        });
    }

    private enqueue<T>(job: () => Promise<T>): Promise<T> {
        const result = this.queue.then(job);
        this.queue = result.then(
            () => undefined,
            () => undefined,
        );
        return result;
    }

    private scheduleRecordingThumbnail(videoFileId: apid.VideoFileId, delay: number): void {
        const timer = setTimeout(() => {
            this.recordingTimers.delete(videoFileId);
            if (this.recordingAttempts.has(videoFileId) === false) return;
            const attempt = (this.recordingAttempts.get(videoFileId) ?? 0) + 1;
            this.recordingAttempts.set(videoFileId, attempt);
            this.log.system.info(`create recording thumbnail: ${videoFileId}, attempt: ${attempt}`);
            this.enqueue(() => this.createIfNeeded(videoFileId, true))
                .then(() => {
                    this.recordingAttempts.delete(videoFileId);
                })
                .catch(err => {
                    this.log.system.warn(`create recording thumbnail failed: ${videoFileId}, attempt: ${attempt}`);
                    this.log.system.debug(err);
                    if (this.recordingAttempts.has(videoFileId) === false) return;
                    if (attempt < ThumbnailManageModel.MAX_RECORDING_ATTEMPTS) {
                        this.scheduleRecordingThumbnail(videoFileId, ThumbnailManageModel.RETRY_RECORDING_DELAY);
                    } else {
                        this.recordingAttempts.delete(videoFileId);
                    }
                });
        }, delay);
        this.recordingTimers.set(videoFileId, timer);
    }

    private async createIfNeeded(videoFileId: apid.VideoFileId, isDuringRecording: boolean = false): Promise<void> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) throw new Error('VideoFileIsNotFound');
        const recorded = await this.recordedDB.findId(videoFile.recordedId);
        if (recorded === null) throw new Error('RecordedIsNotFound');
        if (typeof recorded.thumbnails !== 'undefined' && recorded.thumbnails.length > 0) return;
        await this.create(videoFileId, isDuringRecording);
    }

    /**
     * サムネイル生成をして生成したファイルを Thumbnail に登録する
     * @param videoFileId: apid.VideoFileId
     */
    private async create(videoFileId: apid.VideoFileId, isDuringRecording: boolean = false): Promise<void> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        const videoFilePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (videoFile === null || videoFilePath === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        // check thumbnail dir
        try {
            await FileUtil.access(this.config.thumbnail, fs.constants.R_OK | fs.constants.W_OK);
        } catch (err: any) {
            if (typeof err.code !== 'undefined' && err.code === 'ENOENT') {
                // ディレクトリが存在しないので作成する
                this.log.system.warn(`mkdirp: ${this.config.thumbnail}`);
                await FileUtil.mkdir(this.config.thumbnail);
            } else {
                // アクセス権に Read or Write が無い
                this.log.system.fatal(`thumbnail dir permission error: ${this.config.thumbnail}`);
                this.log.system.fatal(err);
                throw err;
            }
        }

        const fileName = await this.getSaveFileName(videoFile.recordedId);
        const output = path.join(this.config.thumbnail, fileName);
        const temporaryOutput = `${output}.tmp-${process.pid}-${Date.now()}.jpg`;
        const cmdStr = this.config.thumbnailCmd.replace(/%FFMPEG%/g, this.config.ffmpeg);
        const cmds = ProcessUtil.parseCmdStr(cmdStr);

        // コマンドの引数準備
        for (let i = 0; i < cmds.args.length; i++) {
            cmds.args[i] = cmds.args[i]
                .replace(/%INPUT%/, videoFilePath)
                .replace(/%OUTPUT%/, temporaryOutput)
                .replace(/%THUMBNAIL_POSITION%/, `${this.config.thumbnailPosition.toString(10)}`)
                .replace(/%THUMBNAIL_SIZE%/, this.config.thumbnailSize);
        }

        // run ffmpeg
        const child = spawn(cmds.bin, cmds.args);
        if (isDuringRecording) this.recordingProcesses.set(videoFileId, child);

        // debug 用
        if (child.stderr !== null) {
            child.stderr.on('data', data => {
                this.log.system.debug(String(data));
            });
        }
        if (child.stdout !== null) {
            child.stdout.on('data', () => {});
        }

        // プロセス終了処理
        const endProcessing = async (code: number | null): Promise<boolean> => {
            if (this.recordingProcesses.get(videoFileId) === child) this.recordingProcesses.delete(videoFileId);
            if (code !== 0) {
                this.log.system.error(`create thumbnail cmd error: ${code}`);
                await FileUtil.unlink(temporaryOutput).catch(() => {});
                return false;
            }
            try {
                const stat = await FileUtil.stat(temporaryOutput);
                if (stat.size === 0) throw new Error('ThumbnailFileIsEmpty');
                await FileUtil.rename(temporaryOutput, output);
            } catch (err: any) {
                this.log.system.error(`create thumbnail file error: ${videoFileId}`);
                this.log.system.error(err);
                await FileUtil.unlink(temporaryOutput).catch(() => {});
                return false;
            }
            this.log.system.info(`create thumbnail: ${videoFileId}, ${output}`);

            const currentVideoFile = await this.videoFileDB.findId(videoFileId);
            const currentRecorded =
                currentVideoFile === null ? null : await this.recordedDB.findId(currentVideoFile.recordedId);
            if (currentVideoFile === null || currentRecorded === null) {
                await FileUtil.unlink(output).catch(() => {});
                return false;
            }

            // add DB
            const thumbnail = new Thumbnail();
            thumbnail.filePath = fileName;
            thumbnail.recordedId = videoFile.recordedId;
            try {
                await this.thumbnailDB.insertOnce(thumbnail);
            } catch (err: any) {
                this.log.system.error(`thumbnail add DB error: ${videoFileId}`);
                this.log.system.error(err);

                // delete thumbnail file
                await FileUtil.unlink(output).catch(err => {
                    this.log.system.error(`thumbnail delete error: ${videoFileId}, ${output}`);
                    this.log.system.error(err);
                });
                return false;
            }

            // event emit
            this.thumbnailEvent.emitAdded(videoFileId, videoFile.recordedId);

            return true;
        };

        return new Promise<void>(async (resolve: () => void, reject: (err: Error) => void) => {
            child.on('exit', async code => {
                if ((await endProcessing(code)) === true) {
                    resolve();
                } else {
                    reject(new Error('CreateThumbnailExitError'));
                }
            });

            child.on('error', err => {
                if (this.recordingProcesses.get(videoFileId) === child) this.recordingProcesses.delete(videoFileId);
                this.log.system.error(`create thumbnail failed: ${videoFileId}`);
                FileUtil.unlink(temporaryOutput).catch(() => {});
                reject(err);
            });

            // プロセスの即時終了対応
            if (ProcessUtil.isExited(child) === true) {
                child.removeAllListeners();
                if ((await endProcessing(child.exitCode)) === true) {
                    resolve();
                } else {
                    reject(new Error('CreateThumbnailExitError'));
                }
            }
        });
    }

    /**
     * 重複しないサムネイルファイル名を返す
     * @param recordedId: recorded id
     * @param conflict: 重複数
     * @return string
     */
    private async replaceRecordedThumbnail(videoFileId: apid.VideoFileId): Promise<void> {
        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) {
            this.log.system.error(`video file is not found: ${videoFileId}`);
            throw new Error('VideoFileIsNotFound');
        }

        const recorded = await this.recordedDB.findId(videoFile.recordedId);
        const oldThumbnails =
            recorded !== null && typeof recorded.thumbnails !== 'undefined' ? recorded.thumbnails.slice() : [];

        await this.create(videoFileId);

        for (const thumbnail of oldThumbnails) {
            await this.delete(thumbnail.id).catch(err => {
                this.log.system.error(`delete old thumbnail error: ${thumbnail.id}`);
                this.log.system.error(err);
            });
        }
    }

    private async getSaveFileName(recordedId: apid.RecordedId, conflict: number = 0): Promise<string> {
        const conflictStr = conflict === 0 ? '' : `(${conflict})`;
        const fileName = `${recordedId}${conflictStr}.jpg`;
        const filePath = path.join(this.config.thumbnail, fileName);

        try {
            await FileUtil.stat(filePath);

            return this.getSaveFileName(recordedId, conflict + 1);
        } catch (err: any) {
            return fileName;
        }
    }

    /**
     * 指定したサムネイルを削除する
     * @param thumbnailId: apid.ThumbnailId
     * @return Promise<void>
     */
    public async delete(thumbnailId: apid.ThumbnailId): Promise<void> {
        const thumbnail = await this.thumbnailDB.findId(thumbnailId);
        if (thumbnail === null) {
            throw new Error('ThumbnailIsNotFound');
        }

        this.log.system.info(`delete thumbnail ${thumbnailId}`);

        // DB から削除
        await this.thumbnailDB.deleteOnce(thumbnailId).catch(err => {
            this.log.system.error(`delete thumbnail error: ${thumbnailId}`);
            this.log.system.error(err);
            throw err;
        });

        // サムネイルファイルを削除
        const filePath = path.join(this.config.thumbnail, thumbnail.filePath);
        await FileUtil.unlink(filePath).catch(err => {
            this.log.system.error(`delete thumbnail error: ${thumbnailId}`);
            this.log.system.error(err);
            throw err;
        });

        this.thumbnailEvent.emitDeleted();
    }

    /**
     * サムネイル再生性
     * @return Promise<void>
     */
    public async regenerate(): Promise<void> {
        this.log.system.info('start regenerate thumbnail');

        const [recordeds] = await this.recordedDB.findAll(
            {
                isHalfWidth: false,
            },
            {
                isNeedVideoFiles: true,
                isNeedThumbnails: true,
                isNeedsDropLog: false,
                isNeedTags: false,
            },
        );

        const videoFileIds: apid.VideoFileId[] = []; // サムネイル再生成リスト
        for (const recorded of recordeds) {
            if (typeof recorded.videoFiles === 'undefined' || recorded.videoFiles.length === 0) {
                continue;
            }

            if (typeof recorded.thumbnails === 'undefined' || recorded.thumbnails.length === 0) {
                // サムネイルが存在しないので生成リストに追加
                videoFileIds.push(recorded.videoFiles[0].id);
                continue;
            }

            // ファイルが存在しないサムネイルデータを列挙する
            const nonExistingThumbnailIds: apid.ThumbnailId[] = [];
            let existingThumbnailCnt = 0;

            // サムネイルファイルが存在するか確認
            for (const thumbnail of recorded.thumbnails) {
                const thumbnailPath = path.join(this.config.thumbnail, thumbnail.filePath);
                try {
                    await FileUtil.stat(thumbnailPath);
                    // ファイルが存在するので無視
                    existingThumbnailCnt++;
                    continue;
                } catch (err: any) {
                    // ファイルが存在しない
                    nonExistingThumbnailIds.push(thumbnail.id);
                }
            }

            // 存在しないサムネイルデータを削除する
            for (const thumbnailId of nonExistingThumbnailIds) {
                await this.thumbnailDB.deleteOnce(thumbnailId).catch(err => {
                    this.log.system.error(`failed to delete non-existing thumbnail data: ${thumbnailId}`);
                    this.log.system.error(err);
                });
            }

            // サムネイル情報が存在しなくなったので生成リストに追加
            if (existingThumbnailCnt === 0) {
                videoFileIds.push(recorded.videoFiles[0].id);
            }
        }

        // 再生成リストにある videoFileId からサムネイルを再生成させる
        for (const videoFileId of videoFileIds) {
            this.add(videoFileId);
        }
    }

    /**
     * DB に登録されていないログファイル削除 &  DB に登録されているが存在しないログ情報の削除
     */
    public async fileCleanup(): Promise<void> {
        this.log.system.info('start thumbnail files cleanup');
        const thumbnails = await this.thumbnailDB.findAll();

        // ファイル, ディレクトリ索引生成と DB 上に存在するが実ファイルが存在しないデータを削除する
        const fileIndex: { [filePath: string]: boolean } = {}; // ファイル索引
        for (const thumbnail of thumbnails) {
            const filePath = path.join(this.config.thumbnail, thumbnail.filePath);

            if ((await this.checkFileExistence(filePath)) === true) {
                // ファイルが存在するなら索引に追加
                fileIndex[filePath] = true;
            } else {
                this.log.system.warn(`thumbnail file is not exist: ${filePath}`);
                // ファイルが存在しないなら削除
                await this.thumbnailDB.deleteOnce(thumbnail.id).catch(err => {
                    this.log.system.error(err);
                });
            }
        }

        // ファイル索引上に存在しないファイルを削除する
        const list = await FileUtil.getFileList(this.config.thumbnail);
        for (const file of list.files) {
            if (typeof fileIndex[file] !== 'undefined') {
                continue;
            }

            this.log.system.info(`delete thumbnail file: ${file}`);
            await FileUtil.unlink(file).catch(err => {
                this.log.system.error(`failed to thumbnail file: ${file}`);
                this.log.system.error(err);
            });
        }

        this.log.system.info('start thumbnail files cleanup completed');
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

    private static readonly INITIAL_RECORDING_DELAY = 15 * 1000;
    private static readonly RETRY_RECORDING_DELAY = 15 * 1000;
    private static readonly MAX_RECORDING_ATTEMPTS = 3;
}
