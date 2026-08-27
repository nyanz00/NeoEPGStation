import { spawn } from 'child_process';
import { createHash, randomUUID } from 'crypto';
import * as fileType from 'file-type';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import * as os from 'os';
import * as path from 'path';
import * as apid from '../../../../api';
import IRecordedDB from '../../db/IRecordedDB';
import IVideoFileDB from '../../db/IVideoFileDB';
import IConfiguration from '../../IConfiguration';
import IIPCClient from '../../ipc/IIPCClient';
import ILogger from '../../ILogger';
import ILoggerModel from '../../ILoggerModel';
import IEncodeManageModel from '../../service/encode/IEncodeManageModel';
import IApiUtil from '../IApiUtil';
import IPlayList from '../IPlayList';
import IVideoApiModel, { VideoFilePathInfo } from './IVideoApiModel';
import IVideoUtil, { VideoRecordingTimeInfo } from './IVideoUtil';

@injectable()
export default class VideoApiModel implements IVideoApiModel {
    private static readonly WEB_PLAYBACK_CACHE_MAX_IDLE = 12 * 60 * 60 * 1000;
    private static readonly WEB_PLAYBACK_REMUX_TIMEOUT = 30 * 60 * 1000;
    private static readonly SUBTITLE_TRANSFER_TIMEOUT = 12 * 60 * 60 * 1000;
    private static readonly SUBTITLE_TRANSFER_TASK_TTL = 24 * 60 * 60 * 1000;

    private configuration: IConfiguration;
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private apiUtil: IApiUtil;
    private videoUtil: IVideoUtil;
    private ipc: IIPCClient;
    private encodeManage: IEncodeManageModel;
    private log: ILogger;
    private webPlaybackPrepareTasks: Map<apid.VideoFileId, Promise<VideoFilePathInfo | null>> = new Map();
    private subtitleTransferTasks: Map<string, apid.SubtitleTransferTask> = new Map();
    private subtitleTransferLocks: Set<apid.VideoFileId> = new Set();
    private subtitleTransferPathLocks: Set<string> = new Set();
    private subtitleTransferRecovery: Promise<void> = Promise.resolve();
    private webPlaybackCacheDir: string;

    constructor(
        @inject('IConfiguration') configuration: IConfiguration,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IApiUtil') apiUtil: IApiUtil,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IIPCClient') ipc: IIPCClient,
        @inject('IEncodeManageModel') encodeManage: IEncodeManageModel,
        @inject('ILoggerModel') logger: ILoggerModel,
    ) {
        this.configuration = configuration;
        this.webPlaybackCacheDir = path.join(
            configuration.getConfig().temporaryDir ?? os.tmpdir(),
            `neoepgstation-web-playback-${process.pid.toString(10)}`,
        );
        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.apiUtil = apiUtil;
        this.videoUtil = videoUtil;
        this.ipc = ipc;
        this.encodeManage = encodeManage;
        this.log = logger.getLogger();
        if (this.configuration.getConfig().developerMode === true) {
            this.subtitleTransferRecovery = this.recoverAllSubtitleTransferFiles().catch(err => {
                this.log.system.error(`subtitle transfer startup recovery failed: ${String(err)}`);
            });
        }
    }

    /**
     * 指定した video fie id のファイルパスを返す
     * @param videoFileId: apid.VideoFileId
     * @return Promise<VideoFilePathInfo | null>
     */
    public async getFullFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null> {
        const fullPath = await this.videoUtil.getFullFilePathFromId(videoFileId);

        return fullPath === null
            ? null
            : {
                  path: fullPath,
                  mime: await this.createMime(fullPath),
              };
    }

    /**
     * WebKit が直接扱えない Matroska 録画を、再エンコードせず MP4 へリマックスした
     * PLAY 用キャッシュのパスとして返す。
     */
    public async getWebPlaybackFilePath(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null> {
        const existing = this.webPlaybackPrepareTasks.get(videoFileId);
        if (typeof existing !== 'undefined') {
            return existing;
        }

        const task = this.prepareWebPlaybackFile(videoFileId);
        this.webPlaybackPrepareTasks.set(videoFileId, task);
        try {
            return await task;
        } finally {
            if (this.webPlaybackPrepareTasks.get(videoFileId) === task) {
                this.webPlaybackPrepareTasks.delete(videoFileId);
            }
        }
    }

    private async prepareWebPlaybackFile(videoFileId: apid.VideoFileId): Promise<VideoFilePathInfo | null> {
        const source = await this.getFullFilePath(videoFileId);
        if (source === null) {
            return null;
        }
        if (source.mime !== 'video/x-matroska') {
            return source;
        }

        const sourceStat = await fs.promises.stat(source.path);
        const cacheKey = createHash('sha256')
            .update(`${source.path}\0${sourceStat.size.toString(10)}\0${sourceStat.mtimeMs.toString(10)}`)
            .digest('hex')
            .slice(0, 20);
        const targetPath = path.join(this.webPlaybackCacheDir, `video-${videoFileId.toString(10)}-${cacheKey}.mp4`);

        await fs.promises.mkdir(this.webPlaybackCacheDir, { recursive: true });
        await this.cleanupWebPlaybackCache(targetPath);
        if (await this.isUsableCacheFile(targetPath)) {
            const now = new Date();
            await fs.promises.utimes(targetPath, now, now).catch(() => {});
            return { path: targetPath, mime: 'video/mp4' };
        }

        const videoCodec = await this.getPrimaryVideoCodec(source.path);
        if (videoCodec !== 'hevc' && videoCodec !== 'h264' && videoCodec !== 'av1') {
            throw new Error(`WebPlaybackRemuxUnsupportedVideoCodec: ${videoCodec}`);
        }

        const temporaryPath = path.join(
            this.webPlaybackCacheDir,
            `.video-${videoFileId.toString(10)}-${cacheKey}-${Date.now().toString(10)}.tmp.mp4`,
        );
        const config = this.configuration.getConfig();
        const args = [
            '-v',
            'error',
            '-nostdin',
            '-y',
            '-i',
            source.path,
            '-map',
            '0:v:0',
            '-map',
            '0:a?',
            '-sn',
            '-dn',
            '-map_metadata',
            '-1',
            '-map_chapters',
            '-1',
            '-c:v',
            'copy',
            '-c:a',
            'copy',
        ];
        if (videoCodec === 'hevc') {
            args.push('-tag:v', 'hvc1');
        } else if (videoCodec === 'av1') {
            args.push('-tag:v', 'av01');
        }
        args.push('-movflags', '+faststart', '-write_tmcd', '0', temporaryPath);

        this.log.stream.info(
            `create WebKit PLAY remux cache: videoFileId=${videoFileId.toString(10)}, codec=${videoCodec}`,
        );
        try {
            await this.runProcess(config.ffmpeg, args, VideoApiModel.WEB_PLAYBACK_REMUX_TIMEOUT);
            if ((await this.isUsableCacheFile(temporaryPath)) === false) {
                throw new Error('WebPlaybackRemuxOutputIsEmpty');
            }
            await fs.promises.rename(temporaryPath, targetPath);
        } catch (err) {
            await fs.promises.unlink(temporaryPath).catch(() => {});
            throw err;
        }

        this.log.stream.info(
            `created WebKit PLAY remux cache: videoFileId=${videoFileId.toString(10)}, size=${(
                await fs.promises.stat(targetPath)
            ).size.toString(10)}`,
        );
        await this.cleanupWebPlaybackCache(targetPath);

        return { path: targetPath, mime: 'video/mp4' };
    }

    private async getPrimaryVideoCodec(filePath: string): Promise<string> {
        const config = this.configuration.getConfig();
        const result = await this.runProcess(
            config.ffprobe,
            [
                '-v',
                'error',
                '-select_streams',
                'v:0',
                '-show_entries',
                'stream=codec_name',
                '-of',
                'default=noprint_wrappers=1:nokey=1',
                filePath,
            ],
            60_000,
        );
        const codec = result.stdout.trim().toLowerCase();
        if (codec.length === 0) {
            throw new Error('WebPlaybackVideoCodecIsUndefined');
        }

        return codec;
    }

    private runProcess(
        command: string,
        args: string[],
        timeout: number,
        errorPrefix = 'WebPlayback',
    ): Promise<{ stdout: string; stderr: string }> {
        return new Promise((resolve, reject) => {
            const child = spawn(command, args, {
                stdio: ['ignore', 'pipe', 'pipe'],
                windowsHide: true,
            });
            let settled = false;
            let stdout = '';
            let stderr = '';
            const append = (current: string, data: Buffer): string => `${current}${data.toString()}`.slice(-32 * 1024);
            child.stdout.on('data', (data: Buffer) => {
                stdout = append(stdout, data);
            });
            child.stderr.on('data', (data: Buffer) => {
                stderr = append(stderr, data);
            });
            const timer = setTimeout(() => {
                if (settled) {
                    return;
                }
                settled = true;
                child.kill();
                reject(new Error(`${errorPrefix}ProcessTimeout: ${path.basename(command)}`));
            }, timeout);
            child.once('error', err => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                reject(err);
            });
            child.once('close', (code, signal) => {
                if (settled) {
                    return;
                }
                settled = true;
                clearTimeout(timer);
                if (code === 0) {
                    resolve({ stdout, stderr });
                } else {
                    reject(
                        new Error(
                            `${errorPrefix}ProcessFailed: ${path.basename(command)} code=${String(
                                code,
                            )} signal=${String(signal)} ${stderr.trim()}`,
                        ),
                    );
                }
            });
        });
    }

    private async isUsableCacheFile(filePath: string): Promise<boolean> {
        try {
            return (await fs.promises.stat(filePath)).size > 0;
        } catch {
            return false;
        }
    }

    private async cleanupWebPlaybackCache(keepPath: string): Promise<void> {
        const now = Date.now();
        const entries = await fs.promises.readdir(this.webPlaybackCacheDir, { withFileTypes: true });
        await Promise.all(
            entries.map(async entry => {
                if (entry.isFile() === false) {
                    return;
                }
                const filePath = path.join(this.webPlaybackCacheDir, entry.name);
                if (filePath === keepPath) {
                    return;
                }
                try {
                    const stat = await fs.promises.stat(filePath);
                    if (now - stat.mtimeMs > VideoApiModel.WEB_PLAYBACK_CACHE_MAX_IDLE) {
                        await fs.promises.unlink(filePath);
                    }
                } catch {
                    // 別リクエストが同時に片付けたキャッシュは無視する。
                }
            }),
        );
    }

    /**
     * 指定されたファイルパスからファイルの mime を返す
     * @param filePath: string ファイルパス
     * @return Promise<string>
     */
    private async createMime(filePath: string): Promise<string> {
        const mime = await fileType.fromFile(filePath);
        if (typeof mime !== 'undefined') {
            return mime.mime;
        }

        switch (path.extname(filePath)) {
            case '.m2ts':
            case '.ts':
                return 'video/mp2t';
            default:
                throw new Error('MimeTypeError');
        }
    }

    /**
     * 指定した videoFileId の m3u8 形式プレイリスト文字列を取得する
     * @param host: string host
     * @param isSecure: boolean https 通信か
     * @param videoFileId: apid.VideoFileId
     * @return Promise<IPlayList | null>
     */
    public async getM3u8(host: string, isSecure: boolean, videoFileId: apid.VideoFileId): Promise<IPlayList | null> {
        const video = await this.videoFileDB.findId(videoFileId);
        if (video === null || typeof video.recordedId === 'undefined') {
            return null;
        }

        const recorded = await this.recordedDB.findId(video?.recordedId);
        if (recorded === null) {
            return null;
        }

        return {
            name: encodeURIComponent(path.basename(video.filePath) + '.m3u8'),
            playList: this.apiUtil.createM3U8PlayListStr({
                host: host,
                isSecure: isSecure,
                name: recorded.name,
                duration: Math.floor(recorded.duration / 1000),
                baseUrl: `/api/videos/${videoFileId}`,
            }),
        };
    }

    /**
     * 指定した video file id のファイルを削除
     * @param videoFileId: apid.VideoFileId
     * @return Promise<void>
     */
    public async deleteVideoFile(videoFileId: apid.VideoFileId): Promise<void> {
        await this.ipc.recorded.deleteVideoFile(videoFileId);
    }

    /**
     * 指定した video file id のファイルの動画長を取得する
     * @param videoFileId: apid.VideoFileId
     * @return Promise<number> 秒
     */
    public async getDuration(videoFileId: apid.VideoFileId): Promise<number> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const videoInfo = await this.videoUtil.getInfo(filePath);

        return videoInfo.duration;
    }

    public async getMpegTsRecordingTime(videoFileId: apid.VideoFileId): Promise<VideoRecordingTimeInfo | null> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('VideoFileIsUndefined');
        }

        return this.videoUtil.getMpegTsRecordingTime(filePath);
    }

    public async getSubtitles(videoFileId: apid.VideoFileId): Promise<apid.VideoSubtitles> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('VideoFileIsUndefined');
        }

        return {
            items: await this.videoUtil.getSubtitles(filePath),
        };
    }

    public async getSubtitleText(
        videoFileId: apid.VideoFileId,
        subtitleIndex: number,
    ): Promise<apid.VideoSubtitleText> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('VideoFileIsUndefined');
        }

        return {
            subtitleText: await this.videoUtil.getSubtitleText(filePath, subtitleIndex),
        };
    }

    public async prepareSubtitle(
        videoFileId: apid.VideoFileId,
        subtitleIndex: number,
    ): Promise<apid.VideoPreparedSubtitle> {
        const filePath = await this.videoUtil.getFullFilePathFromId(videoFileId);
        if (filePath === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const prepared = await this.videoUtil.prepareSubtitle(filePath, subtitleIndex);

        return {
            subtitleFileKey: prepared.key,
            subtitleText: await fs.promises.readFile(prepared.filePath, 'utf8'),
        };
    }

    public async startSubtitleTransfer(
        targetVideoFileId: apid.VideoFileId,
        option: apid.SubtitleTransferOption,
    ): Promise<apid.SubtitleTransferTask> {
        this.assertDeveloperMode();
        this.cleanupSubtitleTransferTasks();
        if (
            Number.isSafeInteger(targetVideoFileId) === false ||
            Number.isSafeInteger(option.sourceVideoFileId) === false ||
            Number.isSafeInteger(option.subtitleIndex) === false ||
            option.subtitleIndex < 0
        ) {
            throw new Error('SubtitleTransferOptionIsInvalid');
        }
        if (targetVideoFileId === option.sourceVideoFileId) {
            throw new Error('SubtitleTransferSourceAndTargetAreSame');
        }
        const title = option.title.trim();
        if (title.length === 0 || title.length > 128) {
            throw new Error('SubtitleTransferTitleIsInvalid');
        }
        const lockedVideoFileIds = [option.sourceVideoFileId, targetVideoFileId];
        let lockedPaths: string[] = [];
        let hasLockedPaths = false;
        if (this.tryAcquireSubtitleTransferLocks(lockedVideoFileIds) === false) {
            throw new Error('SubtitleTransferVideoFileIsBusy');
        }

        try {
            await this.subtitleTransferRecovery;
            const sourceVideo = await this.videoFileDB.findId(option.sourceVideoFileId);
            const targetVideo = await this.videoFileDB.findId(targetVideoFileId);
            if (sourceVideo === null || targetVideo === null) {
                throw new Error('SubtitleTransferVideoFileIsUndefined');
            }
            const sourcePath = this.videoUtil.getFullFilePathFromVideoFile(sourceVideo);
            const targetPath = this.videoUtil.getFullFilePathFromVideoFile(targetVideo);
            if (sourcePath === null || targetPath === null) {
                throw new Error('SubtitleTransferVideoFilePathIsUndefined');
            }
            if (
                path.extname(sourcePath).toLowerCase() !== '.mkv' ||
                path.extname(targetPath).toLowerCase() !== '.mkv'
            ) {
                throw new Error('SubtitleTransferRequiresMatroska');
            }
            lockedPaths = [sourcePath, targetPath];
            if (this.tryAcquireSubtitleTransferPathLocks(lockedPaths) === false) {
                throw new Error('SubtitleTransferVideoFileIsBusy');
            }
            hasLockedPaths = true;
            const artifacts = this.getSubtitleTransferArtifactPaths(targetPath);
            await this.recoverSubtitleTransferFiles(targetPath, artifacts.temporaryPath, artifacts.backupPath);

            const [sourceRecorded, targetRecorded] = await Promise.all([
                this.recordedDB.findId(sourceVideo.recordedId),
                this.recordedDB.findId(targetVideo.recordedId),
            ]);
            if (sourceRecorded === null || targetRecorded === null) {
                throw new Error('SubtitleTransferRecordedIsUndefined');
            }
            if (sourceRecorded.isRecording || targetRecorded.isRecording) {
                throw new Error('SubtitleTransferRecordingIsRunning');
            }
            const encodeIndex = this.encodeManage.getRecordedIndex();
            if (
                encodeIndex[sourceVideo.recordedId] !== undefined ||
                encodeIndex[targetVideo.recordedId] !== undefined
            ) {
                throw new Error('SubtitleTransferEncodeIsRunning');
            }
            if (targetRecorded.isProtected) {
                throw new Error('SubtitleTransferTargetIsProtected');
            }

            const sourceSubtitles = await this.videoUtil.getSubtitles(sourcePath);
            if (sourceSubtitles.some(subtitle => subtitle.subtitleIndex === option.subtitleIndex) === false) {
                throw new Error('SubtitleTransferSubtitleIsUndefined');
            }
            await Promise.all([
                fs.promises.access(sourcePath, fs.constants.R_OK),
                fs.promises.access(targetPath, fs.constants.R_OK | fs.constants.W_OK),
            ]);

            const now = Date.now();
            const task: apid.SubtitleTransferTask = {
                id: randomUUID(),
                sourceVideoFileId: option.sourceVideoFileId,
                targetVideoFileId,
                subtitleIndex: option.subtitleIndex,
                title,
                status: 'running',
                createdAt: now,
                updatedAt: now,
            };
            this.subtitleTransferTasks.set(task.id, task);
            void this.runSubtitleTransfer(task, sourcePath, targetPath).finally(() => {
                this.releaseSubtitleTransferLocks(lockedVideoFileIds);
                if (hasLockedPaths) this.releaseSubtitleTransferPathLocks(lockedPaths);
            });
            return { ...task };
        } catch (err) {
            this.releaseSubtitleTransferLocks(lockedVideoFileIds);
            if (hasLockedPaths) this.releaseSubtitleTransferPathLocks(lockedPaths);
            throw err;
        }
    }

    public async getSubtitleTransferTask(
        targetVideoFileId: apid.VideoFileId,
        taskId: string,
    ): Promise<apid.SubtitleTransferTask> {
        this.assertDeveloperMode();
        this.cleanupSubtitleTransferTasks();
        const task = this.subtitleTransferTasks.get(taskId);
        if (task === undefined || task.targetVideoFileId !== targetVideoFileId) {
            throw new Error('SubtitleTransferTaskIsUndefined');
        }
        return { ...task };
    }

    public async startSubtitleRename(
        videoFileId: apid.VideoFileId,
        subtitleIndex: number,
        option: apid.SubtitleRenameOption,
    ): Promise<apid.SubtitleTransferTask> {
        this.assertDeveloperMode();
        this.cleanupSubtitleTransferTasks();
        if (
            Number.isSafeInteger(videoFileId) === false ||
            Number.isSafeInteger(subtitleIndex) === false ||
            subtitleIndex < 0
        ) {
            throw new Error('SubtitleRenameOptionIsInvalid');
        }
        const title = option.title.trim();
        if (title.length === 0 || title.length > 128) {
            throw new Error('SubtitleTransferTitleIsInvalid');
        }
        const lockedVideoFileIds = [videoFileId];
        let lockedPaths: string[] = [];
        let hasLockedPaths = false;
        if (this.tryAcquireSubtitleTransferLocks(lockedVideoFileIds) === false) {
            throw new Error('SubtitleTransferVideoFileIsBusy');
        }

        try {
            await this.subtitleTransferRecovery;
            const video = await this.videoFileDB.findId(videoFileId);
            if (video === null) throw new Error('SubtitleTransferVideoFileIsUndefined');
            const videoPath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (videoPath === null) throw new Error('SubtitleTransferVideoFilePathIsUndefined');
            if (path.extname(videoPath).toLowerCase() !== '.mkv') {
                throw new Error('SubtitleTransferRequiresMatroska');
            }
            lockedPaths = [videoPath];
            if (this.tryAcquireSubtitleTransferPathLocks(lockedPaths) === false) {
                throw new Error('SubtitleTransferVideoFileIsBusy');
            }
            hasLockedPaths = true;
            const artifacts = this.getSubtitleTransferArtifactPaths(videoPath);
            await this.recoverSubtitleTransferFiles(videoPath, artifacts.temporaryPath, artifacts.backupPath);

            const recorded = await this.recordedDB.findId(video.recordedId);
            if (recorded === null) throw new Error('SubtitleTransferRecordedIsUndefined');
            if (recorded.isRecording) throw new Error('SubtitleTransferRecordingIsRunning');
            if (this.encodeManage.getRecordedIndex()[video.recordedId] !== undefined) {
                throw new Error('SubtitleTransferEncodeIsRunning');
            }
            if (recorded.isProtected) throw new Error('SubtitleTransferTargetIsProtected');
            const subtitles = await this.videoUtil.getSubtitles(videoPath);
            if (subtitles.some(subtitle => subtitle.subtitleIndex === subtitleIndex) === false) {
                throw new Error('SubtitleTransferSubtitleIsUndefined');
            }
            await fs.promises.access(videoPath, fs.constants.R_OK | fs.constants.W_OK);

            const now = Date.now();
            const task: apid.SubtitleTransferTask = {
                id: randomUUID(),
                sourceVideoFileId: videoFileId,
                targetVideoFileId: videoFileId,
                subtitleIndex,
                title,
                status: 'running',
                createdAt: now,
                updatedAt: now,
            };
            this.subtitleTransferTasks.set(task.id, task);
            void this.runSubtitleRename(task, videoPath).finally(() => {
                this.releaseSubtitleTransferLocks(lockedVideoFileIds);
                if (hasLockedPaths) this.releaseSubtitleTransferPathLocks(lockedPaths);
            });
            return { ...task };
        } catch (err) {
            this.releaseSubtitleTransferLocks(lockedVideoFileIds);
            if (hasLockedPaths) this.releaseSubtitleTransferPathLocks(lockedPaths);
            throw err;
        }
    }

    public async startSubtitleReorder(
        videoFileId: apid.VideoFileId,
        option: apid.SubtitleReorderOption,
    ): Promise<apid.SubtitleTransferTask> {
        this.assertDeveloperMode();
        this.cleanupSubtitleTransferTasks();
        if (
            Number.isSafeInteger(videoFileId) === false ||
            Array.isArray(option.subtitleIndices) === false ||
            option.subtitleIndices.length === 0 ||
            option.subtitleIndices.some(index => Number.isSafeInteger(index) === false || index < 0) ||
            new Set(option.subtitleIndices).size !== option.subtitleIndices.length
        ) {
            throw new Error('SubtitleReorderOptionIsInvalid');
        }
        const lockedVideoFileIds = [videoFileId];
        let lockedPaths: string[] = [];
        let hasLockedPaths = false;
        if (this.tryAcquireSubtitleTransferLocks(lockedVideoFileIds) === false) {
            throw new Error('SubtitleTransferVideoFileIsBusy');
        }

        try {
            await this.subtitleTransferRecovery;
            const video = await this.videoFileDB.findId(videoFileId);
            if (video === null) throw new Error('SubtitleTransferVideoFileIsUndefined');
            const videoPath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (videoPath === null) throw new Error('SubtitleTransferVideoFilePathIsUndefined');
            if (path.extname(videoPath).toLowerCase() !== '.mkv') {
                throw new Error('SubtitleTransferRequiresMatroska');
            }
            lockedPaths = [videoPath];
            if (this.tryAcquireSubtitleTransferPathLocks(lockedPaths) === false) {
                throw new Error('SubtitleTransferVideoFileIsBusy');
            }
            hasLockedPaths = true;
            const artifacts = this.getSubtitleTransferArtifactPaths(videoPath);
            await this.recoverSubtitleTransferFiles(videoPath, artifacts.temporaryPath, artifacts.backupPath);

            const recorded = await this.recordedDB.findId(video.recordedId);
            if (recorded === null) throw new Error('SubtitleTransferRecordedIsUndefined');
            if (recorded.isRecording) throw new Error('SubtitleTransferRecordingIsRunning');
            if (this.encodeManage.getRecordedIndex()[video.recordedId] !== undefined) {
                throw new Error('SubtitleTransferEncodeIsRunning');
            }
            if (recorded.isProtected) throw new Error('SubtitleTransferTargetIsProtected');
            const subtitles = await this.videoUtil.getSubtitles(videoPath);
            const currentIndices = subtitles.map(subtitle => subtitle.subtitleIndex);
            if (
                option.subtitleIndices.length !== currentIndices.length ||
                option.subtitleIndices.some(index => currentIndices.includes(index) === false)
            ) {
                throw new Error('SubtitleReorderTracksChanged');
            }
            if (option.subtitleIndices.every((index, position) => index === currentIndices[position])) {
                throw new Error('SubtitleReorderOrderIsUnchanged');
            }
            await fs.promises.access(videoPath, fs.constants.R_OK | fs.constants.W_OK);

            const now = Date.now();
            const task: apid.SubtitleTransferTask = {
                id: randomUUID(),
                sourceVideoFileId: videoFileId,
                targetVideoFileId: videoFileId,
                subtitleIndex: option.subtitleIndices[0],
                title: '',
                status: 'running',
                createdAt: now,
                updatedAt: now,
            };
            this.subtitleTransferTasks.set(task.id, task);
            void this.runSubtitleReorder(task, videoPath, option.subtitleIndices, subtitles).finally(() => {
                this.releaseSubtitleTransferLocks(lockedVideoFileIds);
                if (hasLockedPaths) this.releaseSubtitleTransferPathLocks(lockedPaths);
            });
            return { ...task };
        } catch (err) {
            this.releaseSubtitleTransferLocks(lockedVideoFileIds);
            if (hasLockedPaths) this.releaseSubtitleTransferPathLocks(lockedPaths);
            throw err;
        }
    }

    private tryAcquireSubtitleTransferLocks(videoFileIds: apid.VideoFileId[]): boolean {
        const uniqueIds = [...new Set(videoFileIds)];
        if (uniqueIds.some(videoFileId => this.subtitleTransferLocks.has(videoFileId))) {
            return false;
        }
        for (const videoFileId of uniqueIds) {
            this.subtitleTransferLocks.add(videoFileId);
        }
        return true;
    }

    private releaseSubtitleTransferLocks(videoFileIds: apid.VideoFileId[]): void {
        for (const videoFileId of new Set(videoFileIds)) {
            this.subtitleTransferLocks.delete(videoFileId);
        }
    }

    private tryAcquireSubtitleTransferPathLocks(filePaths: string[]): boolean {
        const keys = [...new Set(filePaths.map(filePath => this.getSubtitleTransferPathLockKey(filePath)))];
        if (keys.some(key => this.subtitleTransferPathLocks.has(key))) return false;
        for (const key of keys) this.subtitleTransferPathLocks.add(key);
        return true;
    }

    private releaseSubtitleTransferPathLocks(filePaths: string[]): void {
        for (const filePath of filePaths) {
            this.subtitleTransferPathLocks.delete(this.getSubtitleTransferPathLockKey(filePath));
        }
    }

    private getSubtitleTransferPathLockKey(filePath: string): string {
        const resolved = path.resolve(filePath);
        return process.platform === 'win32' ? resolved.toLowerCase() : resolved;
    }

    private async runSubtitleTransfer(
        task: apid.SubtitleTransferTask,
        sourcePath: string,
        targetPath: string,
    ): Promise<void> {
        const { temporaryPath, backupPath } = this.getSubtitleTransferArtifactPaths(targetPath);
        let targetMovedToBackup = false;
        try {
            await this.recoverSubtitleTransferFiles(targetPath, temporaryPath, backupPath);
            const targetSubtitles = await this.videoUtil.getSubtitles(targetPath);
            const config = this.configuration.getConfig();
            const args = [
                '-hide_banner',
                '-loglevel',
                'error',
                '-nostdin',
                '-y',
                '-i',
                targetPath,
                '-i',
                sourcePath,
                '-map',
                '0',
                '-map',
                `1:s:${task.subtitleIndex.toString(10)}`,
                '-map_metadata',
                '0',
                '-map_chapters',
                '0',
                '-c',
                'copy',
                `-metadata:s:s:${targetSubtitles.length.toString(10)}`,
                `title=${task.title}`,
                temporaryPath,
            ];
            this.log.system.info(
                `subtitle transfer start: source=${task.sourceVideoFileId.toString(10)} target=${task.targetVideoFileId.toString(10)} subtitle=${task.subtitleIndex.toString(10)}`,
            );
            await this.runProcess(config.ffmpeg, args, VideoApiModel.SUBTITLE_TRANSFER_TIMEOUT, 'SubtitleTransfer');
            const outputStat = await fs.promises.stat(temporaryPath);
            if (outputStat.isFile() === false || outputStat.size <= 0) {
                throw new Error('SubtitleTransferOutputIsEmpty');
            }
            const outputSubtitles = await this.videoUtil.getSubtitles(temporaryPath);
            if (outputSubtitles.length !== targetSubtitles.length + 1) {
                throw new Error('SubtitleTransferOutputValidationFailed');
            }
            const addedSubtitle = outputSubtitles[outputSubtitles.length - 1];
            if (addedSubtitle?.title !== task.title) {
                throw new Error('SubtitleTransferTitleValidationFailed');
            }

            await fs.promises.rename(targetPath, backupPath);
            targetMovedToBackup = true;
            await fs.promises.rename(temporaryPath, targetPath);
            const finalStat = await fs.promises.stat(targetPath);
            await this.videoFileDB.updateSize(task.targetVideoFileId, finalStat.size);
            targetMovedToBackup = false;
            await fs.promises.rm(backupPath, { force: true }).catch(err => {
                this.log.system.warn(`subtitle transfer backup cleanup failed: ${String(err)}`);
            });
            task.status = 'completed';
            task.updatedAt = Date.now();
            delete task.error;
            this.log.system.info(
                `subtitle transfer completed: task=${task.id} target=${task.targetVideoFileId.toString(10)}`,
            );
        } catch (err) {
            if (targetMovedToBackup) {
                await fs.promises.rm(targetPath, { force: true }).catch(() => {});
                await fs.promises.rename(backupPath, targetPath).catch(rollbackError => {
                    this.log.system.fatal(`subtitle transfer rollback failed: ${String(rollbackError)}`);
                });
            }
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
            task.status = 'failed';
            task.error = err instanceof Error ? err.message : String(err);
            task.updatedAt = Date.now();
            this.log.system.error(`subtitle transfer failed: task=${task.id} ${task.error}`);
        }
    }

    private async runSubtitleRename(task: apid.SubtitleTransferTask, videoPath: string): Promise<void> {
        const { temporaryPath, backupPath } = this.getSubtitleTransferArtifactPaths(videoPath);
        let targetMovedToBackup = false;
        try {
            await this.recoverSubtitleTransferFiles(videoPath, temporaryPath, backupPath);
            const subtitles = await this.videoUtil.getSubtitles(videoPath);
            if (subtitles.some(subtitle => subtitle.subtitleIndex === task.subtitleIndex) === false) {
                throw new Error('SubtitleTransferSubtitleIsUndefined');
            }
            const config = this.configuration.getConfig();
            const args = [
                '-hide_banner',
                '-loglevel',
                'error',
                '-nostdin',
                '-y',
                '-i',
                videoPath,
                '-map',
                '0',
                '-map_metadata',
                '0',
                '-map_chapters',
                '0',
                '-c',
                'copy',
                `-metadata:s:s:${task.subtitleIndex.toString(10)}`,
                `title=${task.title}`,
                temporaryPath,
            ];
            this.log.system.info(
                `subtitle rename start: videoFileId=${task.targetVideoFileId.toString(10)} subtitle=${task.subtitleIndex.toString(10)}`,
            );
            await this.runProcess(config.ffmpeg, args, VideoApiModel.SUBTITLE_TRANSFER_TIMEOUT, 'SubtitleRename');
            const outputStat = await fs.promises.stat(temporaryPath);
            if (outputStat.isFile() === false || outputStat.size <= 0) throw new Error('SubtitleRenameOutputIsEmpty');
            const outputSubtitles = await this.videoUtil.getSubtitles(temporaryPath);
            if (outputSubtitles.length !== subtitles.length) throw new Error('SubtitleRenameOutputValidationFailed');
            if (outputSubtitles[task.subtitleIndex]?.title !== task.title) {
                throw new Error('SubtitleTransferTitleValidationFailed');
            }

            await fs.promises.rename(videoPath, backupPath);
            targetMovedToBackup = true;
            await fs.promises.rename(temporaryPath, videoPath);
            const finalStat = await fs.promises.stat(videoPath);
            await this.videoFileDB.updateSize(task.targetVideoFileId, finalStat.size);
            targetMovedToBackup = false;
            await fs.promises.rm(backupPath, { force: true }).catch(err => {
                this.log.system.warn(`subtitle rename backup cleanup failed: ${String(err)}`);
            });
            task.status = 'completed';
            task.updatedAt = Date.now();
            delete task.error;
            this.log.system.info(
                `subtitle rename completed: task=${task.id} videoFileId=${task.targetVideoFileId.toString(10)}`,
            );
        } catch (err) {
            if (targetMovedToBackup) {
                await fs.promises.rm(videoPath, { force: true }).catch(() => {});
                await fs.promises.rename(backupPath, videoPath).catch(rollbackError => {
                    this.log.system.fatal(`subtitle rename rollback failed: ${String(rollbackError)}`);
                });
            }
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
            task.status = 'failed';
            task.error = err instanceof Error ? err.message : String(err);
            task.updatedAt = Date.now();
            this.log.system.error(`subtitle rename failed: task=${task.id} ${task.error}`);
        }
    }

    private async runSubtitleReorder(
        task: apid.SubtitleTransferTask,
        videoPath: string,
        subtitleIndices: number[],
        sourceSubtitles: apid.VideoSubtitle[],
    ): Promise<void> {
        const { temporaryPath, backupPath } = this.getSubtitleTransferArtifactPaths(videoPath);
        let targetMovedToBackup = false;
        try {
            await this.recoverSubtitleTransferFiles(videoPath, temporaryPath, backupPath);
            const currentSubtitles = await this.videoUtil.getSubtitles(videoPath);
            if (
                currentSubtitles.length !== sourceSubtitles.length ||
                currentSubtitles.some(
                    (subtitle, index) => subtitle.subtitleIndex !== sourceSubtitles[index]?.subtitleIndex,
                )
            ) {
                throw new Error('SubtitleReorderTracksChanged');
            }
            const config = this.configuration.getConfig();
            const args = [
                '-hide_banner',
                '-loglevel',
                'error',
                '-nostdin',
                '-y',
                '-i',
                videoPath,
                '-map',
                '0',
                '-map',
                '-0:s',
                ...subtitleIndices.flatMap(index => ['-map', `0:s:${index.toString(10)}`]),
                '-map_metadata',
                '0',
                '-map_chapters',
                '0',
                '-c',
                'copy',
                temporaryPath,
            ];
            this.log.system.info(
                `subtitle reorder start: videoFileId=${task.targetVideoFileId.toString(10)} order=${subtitleIndices.join(',')}`,
            );
            await this.runProcess(config.ffmpeg, args, VideoApiModel.SUBTITLE_TRANSFER_TIMEOUT, 'SubtitleReorder');
            const outputStat = await fs.promises.stat(temporaryPath);
            if (outputStat.isFile() === false || outputStat.size <= 0) throw new Error('SubtitleReorderOutputIsEmpty');
            const outputSubtitles = await this.videoUtil.getSubtitles(temporaryPath);
            const sourceSubtitlesByIndex = new Map(sourceSubtitles.map(subtitle => [subtitle.subtitleIndex, subtitle]));
            const expectedSubtitles = subtitleIndices.map(index => sourceSubtitlesByIndex.get(index));
            if (
                outputSubtitles.length !== expectedSubtitles.length ||
                outputSubtitles.some((subtitle, index) => {
                    const expected = expectedSubtitles[index];
                    return (
                        expected === undefined ||
                        subtitle.codecName !== expected.codecName ||
                        subtitle.language !== expected.language ||
                        subtitle.title !== expected.title ||
                        subtitle.isDefault !== expected.isDefault ||
                        subtitle.isForced !== expected.isForced
                    );
                })
            ) {
                throw new Error('SubtitleReorderOutputValidationFailed');
            }

            await fs.promises.rename(videoPath, backupPath);
            targetMovedToBackup = true;
            await fs.promises.rename(temporaryPath, videoPath);
            const finalStat = await fs.promises.stat(videoPath);
            await this.videoFileDB.updateSize(task.targetVideoFileId, finalStat.size);
            targetMovedToBackup = false;
            await fs.promises.rm(backupPath, { force: true }).catch(err => {
                this.log.system.warn(`subtitle reorder backup cleanup failed: ${String(err)}`);
            });
            task.status = 'completed';
            task.updatedAt = Date.now();
            delete task.error;
            this.log.system.info(
                `subtitle reorder completed: task=${task.id} videoFileId=${task.targetVideoFileId.toString(10)}`,
            );
        } catch (err) {
            if (targetMovedToBackup) {
                await fs.promises.rm(videoPath, { force: true }).catch(() => {});
                await fs.promises.rename(backupPath, videoPath).catch(rollbackError => {
                    this.log.system.fatal(`subtitle reorder rollback failed: ${String(rollbackError)}`);
                });
            }
            await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
            task.status = 'failed';
            task.error = err instanceof Error ? err.message : String(err);
            task.updatedAt = Date.now();
            this.log.system.error(`subtitle reorder failed: task=${task.id} ${task.error}`);
        }
    }

    private async recoverSubtitleTransferFiles(
        targetPath: string,
        temporaryPath: string,
        backupPath: string,
    ): Promise<void> {
        const targetExists = await fs.promises
            .stat(targetPath)
            .then(stat => stat.isFile())
            .catch(() => false);
        const backupExists = await fs.promises
            .stat(backupPath)
            .then(stat => stat.isFile())
            .catch(() => false);
        if (targetExists === false && backupExists) {
            await fs.promises.rename(backupPath, targetPath);
        } else if (targetExists && backupExists) {
            await fs.promises.rm(backupPath, { force: true });
        }
        await fs.promises.rm(temporaryPath, { force: true }).catch(() => {});
    }

    private getSubtitleTransferArtifactPaths(targetPath: string): {
        temporaryPath: string;
        backupPath: string;
    } {
        const directory = path.dirname(targetPath);
        const baseName = path.basename(targetPath);
        return {
            temporaryPath: path.join(directory, `.${baseName}.neoepgstation-subtitle-transfer.tmp.mkv`),
            backupPath: path.join(directory, `.${baseName}.neoepgstation-subtitle-transfer.backup.mkv`),
        };
    }

    private async recoverAllSubtitleTransferFiles(): Promise<void> {
        const videos = await this.videoFileDB.findAll();
        for (const video of videos) {
            const targetPath = this.videoUtil.getFullFilePathFromVideoFile(video);
            if (targetPath === null || path.extname(targetPath).toLowerCase() !== '.mkv') continue;
            const { temporaryPath, backupPath } = this.getSubtitleTransferArtifactPaths(targetPath);
            const hasTemporary = await fs.promises
                .stat(temporaryPath)
                .then(stat => stat.isFile())
                .catch(() => false);
            const hasBackup = await fs.promises
                .stat(backupPath)
                .then(stat => stat.isFile())
                .catch(() => false);
            if (hasTemporary === false && hasBackup === false) continue;
            await this.recoverSubtitleTransferFiles(targetPath, temporaryPath, backupPath);
            const recoveredStat = await fs.promises.stat(targetPath).catch(() => null);
            if (recoveredStat?.isFile() === true) {
                await this.videoFileDB.updateSize(video.id, recoveredStat.size).catch(err => {
                    this.log.system.warn(`subtitle transfer recovered file size update failed: ${String(err)}`);
                });
            }
            this.log.system.info(`subtitle transfer startup recovery completed: videoFileId=${video.id.toString(10)}`);
        }
    }

    private cleanupSubtitleTransferTasks(): void {
        const threshold = Date.now() - VideoApiModel.SUBTITLE_TRANSFER_TASK_TTL;
        for (const [taskId, task] of this.subtitleTransferTasks) {
            if (task.status !== 'running' && task.updatedAt < threshold) this.subtitleTransferTasks.delete(taskId);
        }
    }

    private assertDeveloperMode(): void {
        if (this.configuration.getConfig().developerMode !== true) {
            throw new Error('DeveloperModeIsDisabled');
        }
    }

    public async sendToKodi(
        host: string,
        isSecure: boolean,
        kodiName: string,
        videoFileId: apid.VideoFileId,
    ): Promise<void> {
        host = this.apiUtil.getHost(host);

        // kodiName で指定された kodi host を config から探す
        const config = this.configuration.getConfig();
        if (typeof config.kodiHosts === 'undefined') {
            throw new Error('KodiHostsIsUndefined');
        }
        const kodi = config.kodiHosts.find(k => {
            return k.name === kodiName;
        });
        if (typeof kodi === 'undefined') {
            throw new Error('KodiHostIsUndefined');
        }

        const videoFile = await this.videoFileDB.findId(videoFileId);
        if (videoFile === null) {
            throw new Error('VideoFileIsUndefined');
        }

        const source = `${isSecure ? 'https' : 'http'}://${host}/api/videos/${videoFileId}`;

        return this.apiUtil.sendToKodi(source, kodi);
    }
}
