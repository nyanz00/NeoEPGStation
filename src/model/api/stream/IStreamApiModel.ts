import { ChildProcess } from 'child_process';
import internal from 'stream';
import * as apid from '../../../../api';
import IPlayList from '../IPlayList';

export interface SegmentStreamResponse {
    process: ChildProcess | null;
    processes: ChildProcess[];
    cleanup: () => Promise<void>;
    stream: internal.Readable;
}

export interface StreamResponse {
    streamId: apid.StreamId;
    stream: internal.Readable;
    release?: () => Promise<void>;
}

export default interface IStreamApiModel {
    startLiveM2TsStream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    startLiveM2TsLLStream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    startLiveWebmStream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    startMp4Stream(option: apid.LiveStreamOption): Promise<StreamResponse>;
    startLiveHLSStream(option: apid.LiveStreamOption): Promise<apid.StreamId>;
    startRecordedM2TsLLStream(option: apid.RecordedStreanOption): Promise<StreamResponse>;
    startRecordedWebMStream(option: apid.RecordedStreanOption): Promise<StreamResponse>;
    startRecordedMp4Stream(option: apid.RecordedStreanOption): Promise<StreamResponse>;
    startRecordedHLSStream(option: apid.RecordedStreanOption): Promise<apid.StreamId>;
    getRecordedVODHLSPlaylist(option: apid.RecordedStreanOption, startupBufferSegments?: number): Promise<string>;
    createRecordedVODHLSSegmentStream(
        option: apid.RecordedStreanOption,
        sequence: number,
    ): Promise<SegmentStreamResponse>;
    keepRecordedVODHLSSession(sessionId: string): void;
    releaseRecordedVODHLSSession(sessionId: string): void;
    getLiveM2TsStreamM3u8(host: string, isSecure: boolean, option: apid.LiveStreamOption): Promise<IPlayList | null>;
    stop(streamId: apid.StreamId, isForce?: boolean): Promise<void>;
    stopAll(): Promise<void>;
    keep(streamId: apid.StreamId): void;
    getStreamInfos(isHalfWidth: boolean): Promise<apid.StreamInfo>;
}
