import * as apid from '../../../api';

export interface VideoStreamAnalysis {
    index: number;
    id?: number;
    type: string;
    codec?: string;
    profile?: string;
    language?: string;
    title?: string;
    channels?: number;
    sampleRate?: number;
    width?: number;
    height?: number;
    frameRate?: number;
    pixelFormat?: string;
    bitDepth?: number;
    hdr?: string;
    isDefault: boolean;
    isForced: boolean;
}

export interface VideoTsAnalysis {
    networkId: number | null;
    transportStreamId: number | null;
    serviceId: number | null;
    serviceType: number | null;
    serviceName: string | null;
    serviceProviderName: string | null;
    networkName: string | null;
    eventId: number | null;
    eventName: string | null;
    eventDescription: string | null;
    eventExtended: string | null;
    eventStartAt: number | null;
    eventDuration: number | null;
    videoStreamType: number | null;
    videoPid: number | null;
    audioStreamType: number | null;
    audioPid: number | null;
    pmtPid: number | null;
    pcrPid: number | null;
    subtitlePid: number | null;
    firstTdtAt: number | null;
    analyzedAt: number;
}

export interface VideoAnalysis {
    videoFileId: number;
    fileName: string;
    formatName: string | null;
    size: number;
    duration: number | null;
    startTime: number | null;
    bitRate: number | null;
    videoCodec: string | null;
    videoProfile: string | null;
    width: number | null;
    height: number | null;
    frameRate: number | null;
    pixelFormat: string | null;
    bitDepth: number | null;
    hdr: string | null;
    streams: VideoStreamAnalysis[];
    analyzedAt: number | null;
    analysisError: string | null;
    ts: VideoTsAnalysis | null;
}

export default interface IVideoAnalysisModel {
    get(videoFileId: apid.VideoFileId, force?: boolean, includeEit?: boolean): Promise<VideoAnalysis>;
    enqueue(videoFileId: apid.VideoFileId, includeEit?: boolean): void;
}
