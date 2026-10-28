import { Typography } from '@mui/material';
import type { DropLogFile, VideoFile } from '../../../api';
import { formatRecordedVideoFileSize, hasRecordedDropError, sumRecordedVideoFileSize } from './recordedDropInfoHelpers.mjs';
import type { SxProps, Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

export function RecordedDropInfo({
    drop,
    videoFiles,
    description,
    isRecording = false,
    showDrop,
    noWrap,
    sx,
}: {
    drop?: DropLogFile;
    videoFiles?: VideoFile[];
    description?: string;
    isRecording?: boolean;
    showDrop: boolean;
    noWrap?: boolean;
    sx?: SxProps<Theme>;
}): ReactNode {
    const dropInfo = showDrop && !isRecording ? drop : undefined;

    return (
        <Typography
            variant="caption"
            color={dropInfo !== undefined ? (hasRecordedDropError(dropInfo) ? 'error' : 'text.secondary') : undefined}
            noWrap={noWrap}
            title={dropInfo !== undefined ? undefined : description}
            sx={sx}
        >
            {dropInfo !== undefined
                ? `drop: ${dropInfo.dropCnt}, error: ${dropInfo.errorCnt}, scrambling: ${dropInfo.scramblingCnt}, size: ${formatRecordedVideoFileSize(sumRecordedVideoFileSize(videoFiles))}`
                : (description ?? '\u00a0')}
        </Typography>
    );
}
