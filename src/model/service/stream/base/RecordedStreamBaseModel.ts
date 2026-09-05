import { ChildProcess, spawn } from 'child_process';
import * as fs from 'fs';
import { inject, injectable } from 'inversify';
import internal, { Readable } from 'stream';
import ID3MetadataTransform from 'arib-subtitle-timedmetadater';
import * as apid from '../../../../../api';
import * as fst from '../../../../lib/TailStream';
import ProcessUtil from '../../../../util/ProcessUtil';
import IVideoUtil from '../../../api/video/IVideoUtil';
import IVideoAnalysisModel from '../../../video/IVideoAnalysisModel';
import IRecordedDB from '../../../db/IRecordedDB';
import IVideoFileDB from '../../../db/IVideoFileDB';
import IConfiguration from '../../../IConfiguration';
import ILoggerModel from '../../../ILoggerModel';
import IEncodeProcessManageModel, { CreateProcessOption } from '../../encode/IEncodeProcessManageModel';
import ISocketIOManageModel from '../../socketio/ISocketIOManageModel';
import IHLSFileDeleterModel from '../util/IHLSFileDeleterModel';
import IRecordedStreamBaseModel, { RecordedStreamOption, VideoFileInfo } from './IRecordedStreamBaseModel';
import { RecordedStreamInfo } from './IStreamBaseModel';
import StreamBaseModel from './StreamBaseModel';

@injectable()
export default abstract class RecordedStreamBaseModel
    extends StreamBaseModel<RecordedStreamOption>
    implements IRecordedStreamBaseModel
{
    private videoFileDB: IVideoFileDB;
    private recordedDB: IRecordedDB;
    private videoUtil: IVideoUtil;
    private videoAnalysis: IVideoAnalysisModel;

    private fileStream: Readable | null = null;
    private id3MetadataTransoform: ID3MetadataTransform | null = null;
    private preProcessProcess: ChildProcess | null = null;
    private streamProcess: ChildProcess | null = null;
    private videoFilePath: string | null = null;
    private videoFileInfo: VideoFileInfo | null = null;
    private videoFileType: apid.VideoFileType = 'encoded';
    private isRecording: boolean = false;

    constructor(
        @inject('IConfiguration') configure: IConfiguration,
        @inject('ILoggerModel') logger: ILoggerModel,
        @inject('IEncodeProcessManageModel') processManager: IEncodeProcessManageModel,
        @inject('IHLSFileDeleterModel') fileDeleter: IHLSFileDeleterModel,
        @inject('ISocketIOManageModel') socketIO: ISocketIOManageModel,
        @inject('IVideoFileDB') videoFileDB: IVideoFileDB,
        @inject('IRecordedDB') recordedDB: IRecordedDB,
        @inject('IVideoUtil') videoUtil: IVideoUtil,
        @inject('IVideoAnalysisModel') videoAnalysis: IVideoAnalysisModel,
    ) {
        super(configure, logger, processManager, fileDeleter, socketIO);

        this.videoFileDB = videoFileDB;
        this.recordedDB = recordedDB;
        this.videoUtil = videoUtil;
        this.videoAnalysis = videoAnalysis;
    }

    /**
     * ストリーム開始
     * @param streamId: apid.StreamId
     * @return Promise<void>
     */
    /**
     * ストリーム開始
     * @return Promise<void>
     */
    public async start(streamId: apid.StreamId): Promise<void> {
        // HLS stream ディレクトリ使用準備
        if (this.getStreamType() === 'RecordedHLS') {
            await this.prepStreamDir(streamId);
        }

        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        await this.setVideFileInfo();
        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }

        // 開始時刻が動画の長さを超えている
        if (this.processOption.playPosition > this.videoFileInfo.duration) {
            throw new Error('OutOfRange');
        }

        // file read stream の生成
        try {
            this.setFileStream();
        } catch (err: any) {
            this.log.stream.error('create file stream error');
            this.log.stream.error(err);
            await this.stop();
            throw new Error('FileStreamSetError');
        }

        // エンコードプロセス生成
        const poption = await this.createProcessOption(streamId);
        this.log.stream.debug(`create encode process: ${poption.cmd}`);
        try {
            this.streamProcess = await this.processManager.create(poption);
        } catch (err: any) {
            this.log.stream.error('create encode process failed');
            await this.stop();
        }
        if (this.streamProcess === null) {
            throw new Error('CreateStreamProcessError');
        }

        const stderrLines: string[] = [];

        // ffmpeg / HWEncC debug 用ログ出力
        if (this.streamProcess.stderr !== null) {
            this.streamProcess.stderr.on('data', data => {
                const text = String(data);
                this.log.stream.debug(text);
                for (const line of text.split(/\r|\n/)) {
                    const trimmed = line.trim();
                    if (trimmed.length === 0) {
                        continue;
                    }
                    stderrLines.push(trimmed);
                    if (stderrLines.length > 30) {
                        stderrLines.shift();
                    }
                }
            });
        }

        // process 終了時にイベントを発行する
        if (this.getStreamType() !== 'RecordedHLS') {
            this.streamProcess.on('exit', (code, signal) => {
                this.log.stream.info(`recorded stream process exited: code=${code}, signal=${signal}`);
                if (code !== null && code !== 0) {
                    this.log.stream.warn(`recorded stream process failed: code=${code}, signal=${signal}`);
                    for (const line of stderrLines) {
                        this.log.stream.warn(line);
                    }
                }
                this.emitExitStream();
            });
            this.streamProcess.on('error', err => {
                this.log.stream.error('recorded stream process error');
                this.log.stream.error(err);
                this.emitExitStream();
            });
        } else {
            // stream 有効チェク開始
            this.startCheckStreamEnable(streamId);
        }
        // stream 停止タイマーセット
        this.setStopTimer();

        // パイプ処理
        if (this.streamProcess.stdin !== null && this.fileStream !== null) {
            const inputStream = this.createInputStream();

            // ts が入力かつ、HLS 配信の場合は arib-subtitle-timedmetadater を通す
            if (this.videoFileType === 'ts' && this.getStreamType() === 'RecordedHLS') {
                this.log.stream.info('use arib-subtitle-timedmetadater');
                this.id3MetadataTransoform = new ID3MetadataTransform();
                inputStream.pipe(this.id3MetadataTransoform);
                this.id3MetadataTransoform.pipe(this.streamProcess.stdin);
            } else {
                inputStream.pipe(this.streamProcess.stdin);
            }
        }

        // プロセスが即時終了していた場合
        if (ProcessUtil.isExited(this.streamProcess) === true) {
            this.streamProcess.removeAllListeners();
            this.emitExitStream();
        }
    }

    /**
     * video file 情報を格納する
     * @return Promise<void>
     */
    private async setVideFileInfo(): Promise<void> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        const video = await this.videoFileDB.findId(this.processOption.videoFileId);
        if (video === null) {
            throw new Error('VideoIsNull');
        }

        // recorded 情報セット
        const recorded = await this.recordedDB.findId(video.recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }
        this.isRecording = recorded.isRecording;

        // videoFilePath セット
        this.videoFilePath = await this.videoUtil.getFullFilePathFromId(video.id);
        if (this.videoFilePath === null) {
            throw new Error('GetVideoFilePathError');
        }

        // videoFileInfo セット
        const analysis = await this.videoAnalysis.get(video.id);
        if (analysis.duration === null || analysis.bitRate === null) throw new Error('VideoAnalysisIsIncomplete');
        this.videoFileInfo = { duration: analysis.duration, size: analysis.size, bitRate: analysis.bitRate };

        this.videoFileType = video.type as apid.VideoFileType;
    }

    /**
     * stream プロセス生成に必要な情報を生成する
     * @return Promise<CreateProcessOption>
     */
    private async createProcessOption(streamId: apid.StreamId): Promise<CreateProcessOption> {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('SetVideoFileInfoError');
        }

        let cmd = this.processOption.cmd
            .replace(/%FFMPEG%/g, this.config.ffmpeg)
            .replace(/%SS%/g, this.videoFileType === 'ts' ? '' : this.processOption.playPosition.toString(10));

        if (this.getStreamType() === 'RecordedHLS') {
            cmd = cmd
                .replace(/%streamFileDir%/g, this.config.streamFilePath)
                .replace(/%streamNum%/g, streamId.toString(10));
        }

        const option: CreateProcessOption = {
            input:
                typeof this.processOption.preprocessor === 'undefined' && this.isRecording === false
                    ? this.videoFilePath
                    : null,
            output:
                this.getStreamType() === 'RecordedHLS'
                    ? `${this.config.streamFilePath}\/stream${streamId.toString(10)}.m3u8`
                    : null,
            cmd: cmd,
            priority: RecordedStreamBaseModel.ENCODE_PROCESS_PRIORITY,
            preserveStdout: this.getStreamType() !== 'RecordedHLS',
        };

        return option;
    }

    /**
     * fileStream をセットする
     */
    private setFileStream(): void {
        if (this.processOption === null || this.videoFilePath === null || this.videoFileInfo === null) {
            throw new Error('VideoFileError');
        }

        // エンコードファイルなら何もしない
        if (this.videoFileType === 'encoded') {
            return;
        }

        this.log.stream.info(`create file stream: ${this.videoFilePath}`);
        const start = Math.floor((this.videoFileInfo.bitRate / 8) * this.processOption.playPosition);
        if (this.isRecording === true) {
            this.fileStream = fst.createReadStream(this.videoFilePath, {
                start: start,
            });
        } else {
            this.fileStream = fs.createReadStream(this.videoFilePath, {
                start: start,
            });
        }
    }

    private createInputStream(): Readable {
        if (this.fileStream === null || this.processOption === null) {
            throw new Error('FileStreamIsNull');
        }

        if (typeof this.processOption.preprocessor === 'undefined') {
            return this.fileStream;
        }

        const cmds = this.processOption.preprocessor;
        this.log.stream.debug(`create recorded stream preprocessor: ${cmds.bin} ${cmds.args.join(' ')}`);
        this.preProcessProcess = spawn(cmds.bin, cmds.args);

        this.preProcessProcess.on('exit', (code, signal) => {
            this.log.stream.debug(`recorded stream preprocessor exited: code=${code}, signal=${signal}`);
        });
        this.preProcessProcess.on('error', err => {
            this.log.stream.error('recorded stream preprocessor error');
            this.log.stream.error(err);
            this.emitExitStream();
        });

        if (this.preProcessProcess.stderr !== null) {
            this.preProcessProcess.stderr.on('data', data => {
                this.log.stream.debug(String(data));
            });
        }

        if (this.preProcessProcess.stdin === null || this.preProcessProcess.stdout === null) {
            throw new Error('RecordedStreamPreprocessorPipeIsNull');
        }

        this.fileStream.pipe(this.preProcessProcess.stdin);

        return this.preProcessProcess.stdout;
    }

    /**
     * ストリームを停止
     * @return Promise<void>
     */
    public async stop(): Promise<void> {
        await super.stop();

        if (this.fileStream !== null) {
            this.fileStream.unpipe();
            this.fileStream.destroy();
        }

        if (this.id3MetadataTransoform !== null) {
            this.id3MetadataTransoform.unpipe();
            this.id3MetadataTransoform.destroy();
        }

        if (this.preProcessProcess !== null) {
            await ProcessUtil.kill(this.preProcessProcess, 0);
        }

        if (this.streamProcess !== null) {
            await ProcessUtil.kill(this.streamProcess, 0);
        }

        if (this.getStreamType() === 'RecordedHLS') {
            await this.fileDeleter.deleteAllFiles();
        }
    }

    /**
     * 生成したストリームを返す
     * @return internal.Readable
     */
    public getStream(): internal.Readable {
        if (this.streamProcess !== null && this.streamProcess.stdout !== null) {
            return this.streamProcess.stdout;
        } else {
            throw new Error('StreamIsNull');
        }
    }

    /**
     * ストリーム情報を返す
     * @return RecordedStreamInfo
     */
    public getInfo(): RecordedStreamInfo {
        if (this.processOption === null) {
            throw new Error('ProcessOptionIsNull');
        }

        if (this.configMode === null) {
            throw new Error('ConfigModeIsNull');
        }

        return {
            type: this.getStreamType(),
            mode: this.configMode,
            videoFileId: this.processOption.videoFileId,
            isEnable: this.isEnable(),
        };
    }

    protected abstract getStreamType(): 'RecordedStream' | 'RecordedHLS';
}
