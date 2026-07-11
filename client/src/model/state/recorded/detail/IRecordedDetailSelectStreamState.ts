import * as apid from '../../../../../../api';

export type RecordedStreamType = 'M2TS-LL' | 'WebM' | 'MP4' | 'HLS-TS' | 'HLS';

export interface StreamConfigItem {
    text: string;
    value: number;
}

export interface SubtitleConfigItem {
    text: string;
    value: string;
}

export default interface IRecordedDetailSelectStreamState {
    isOpen: boolean;
    streamTypeItems: RecordedStreamType[];
    streamModeItems: StreamConfigItem[];
    subtitleItems: SubtitleConfigItem[];
    selectedStreamType: RecordedStreamType | undefined;
    selectedStreamMode: number | undefined;
    selectedSubtitleIndex: string;
    isLoadingSubtitles: boolean;
    title: string | null;
    open(videoFile: apid.VideoFile, recordedId: apid.RecordedId): Promise<void>;
    close(): void;
    updateModeItems(): Promise<void>;
    getVideoFileId(): apid.VideoFileId | null;
    getRecordedId(): apid.RecordedId | null;
    getVideoFileType(): apid.VideoFileType | null;
}
