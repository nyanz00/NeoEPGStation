import * as aribts from 'aribts';
import * as stream from 'stream';

export default interface IDropCheckerModel {
    prepare(logDirPath: string, srcFilePath: string, recordingEndAt?: number): Promise<void>;
    attach(srcFilePath: string, readableStream: stream.Readable): void;
    start(
        logDirPath: string,
        srcFilePath: string,
        readableStream: stream.Readable,
        recordingEndAt?: number,
    ): Promise<void>;
    setRecordingEndAt(recordingEndAt: number): void;
    stop(): Promise<void>;
    getFilePath(): string | null;
    getCurrentResult(): aribts.Result | null;
    getResult(): Promise<aribts.Result>;
}
