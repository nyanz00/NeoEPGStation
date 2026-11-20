import type { DropLogFile, VideoFile } from '../../../api';

export function hasRecordedDropError(drop: DropLogFile): boolean;
export function sumRecordedVideoFileSize(videoFiles: VideoFile[] | undefined): number;
export function formatRecordedVideoFileSize(size: number): string;
