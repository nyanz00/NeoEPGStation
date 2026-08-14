import { Box, type SxProps, type Theme } from '@mui/material';
import type { ChannelItem } from '../../../api';
import { type ReactNode, useEffect, useState } from 'react';
import { withBasePath } from '../core/path';

interface ProgramThumbnailProps {
    thumbnailId?: number;
    channel?: Pick<ChannelItem, 'id' | 'name' | 'hasLogoData'>;
    sx?: SxProps<Theme>;
}

export function ProgramThumbnail({ thumbnailId, channel, sx }: ProgramThumbnailProps): ReactNode {
    const [thumbnailFailed, setThumbnailFailed] = useState(false);
    const [logoFailed, setLogoFailed] = useState(false);

    useEffect(() => setThumbnailFailed(false), [thumbnailId]);
    useEffect(() => setLogoFailed(false), [channel?.id]);

    const showThumbnail = thumbnailId !== undefined && !thumbnailFailed;
    const showLogo = !showThumbnail && channel?.hasLogoData === true && !logoFailed;

    return (
        <Box
            sx={[
                {
                    aspectRatio: '16 / 9',
                    flex: '0 0 auto',
                    display: 'grid',
                    placeItems: 'center',
                    overflow: 'hidden',
                    borderRadius: 1,
                    bgcolor: 'action.hover',
                },
                ...(Array.isArray(sx) ? sx : [sx]),
            ]}
        >
            {showThumbnail ? (
                <Box
                    component="img"
                    src={withBasePath(`/api/thumbnails/${thumbnailId}`)}
                    alt=""
                    onError={() => setThumbnailFailed(true)}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                />
            ) : showLogo ? (
                <Box
                    component="img"
                    src={withBasePath(`/api/channels/${channel.id}/logo`)}
                    alt={`${channel.name} ロゴ`}
                    onError={() => setLogoFailed(true)}
                    sx={{ width: '94%', height: '94%', objectFit: 'contain' }}
                />
            ) : null}
        </Box>
    );
}
