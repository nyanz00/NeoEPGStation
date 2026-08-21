import * as apid from '../../../../api';

export interface EncodeOption extends apid.AddEncodeProgramOption {
    encodeId: apid.EncodeId;
    /** Internal recovery metadata. It is never accepted from the public API. */
    resumeExistingAmatsukaze?: boolean;
    restartInterruptedAmatsukaze?: boolean;
    amatsukazeTaskId?: number;
    recoveryStartedAt?: number;
    recoveryOutputFilePath?: string;
}

export interface EncodeProgressInfo {
    percent: number;
    log: string;
}

export type EncoderModelProvider = () => Promise<IEncoderModel>;

export interface IEncoderModel {
    setOption(encodeOption: EncodeOption): void;
    setOnFinish(
        callback: (
            isError: boolean,
            outputFilePath: string | null,
            isCanceled: boolean,
            encoderMessage?: string,
        ) => void,
    ): void;
    setOnAmatsukazeTaskMatched(callback: (taskId: number) => void): void;
    start(): Promise<void>;
    cancel(): Promise<void>;
    getEncodeOption(): EncodeOption | null;
    getProgressInfo(): EncodeProgressInfo | null;
    getEncodeId(): apid.EncodeId | null;
    getOutputFilePath(): string | null;
}
