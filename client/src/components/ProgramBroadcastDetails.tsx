import AccessTimeOutlined from '@mui/icons-material/AccessTimeOutlined';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import HeadphonesOutlined from '@mui/icons-material/HeadphonesOutlined';
import VideocamOutlined from '@mui/icons-material/VideocamOutlined';
import { Box, ButtonBase, Collapse, IconButton, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useState } from 'react';
import type { ScheduleProgramItem } from '../../../api';
import { formatProgramDate, formatProgramDateCompact, formatProgramTime, programDuration, programGenrePathLabels } from '../core/program';
import { withBasePath } from '../core/path';

type ProgramBroadcastItem = Pick<
    ScheduleProgramItem,
    | 'channelId'
    | 'startAt'
    | 'endAt'
    | 'genre1'
    | 'subGenre1'
    | 'genre2'
    | 'subGenre2'
    | 'genre3'
    | 'subGenre3'
    | 'videoType'
    | 'videoResolution'
    | 'audioSamplingRate'
    | 'audioComponentType'
>;

interface ProgramChannelSummary {
    id: number;
    name: string;
    hasLogoData: boolean;
}

const audioComponentLabels: Record<number, string> = {
    0x01: '1/0モード（モノラル）',
    0x02: '1/0＋1/0モード（デュアルモノ）',
    0x03: '2/0モード（ステレオ）',
    0x04: '2/1モード',
    0x05: '3/0モード',
    0x06: '2/2モード',
    0x07: '3/1モード',
    0x08: '3/2モード',
    0x09: '3/2＋LFEモード（5.1ch）',
    0x0a: '3/3.1モード',
    0x0b: '2/0/0-2/0/2-0.1モード',
    0x0c: '5/2.1モード',
    0x0d: '3/2/2.1モード',
    0x0e: '2/0/0-3/0/2-0.1モード',
    0x0f: '0/2/0-3/0/2-0.1モード',
    0x10: '2/0/0-3/2/3-0.2モード',
    0x11: '3/3/3-5/2/3-3/0/0.2モード',
};

function videoCodecLabel(value: ProgramBroadcastItem['videoType']): string | undefined {
    if (value === 'mpeg2') return 'MPEG-2';
    if (value === 'h.264') return 'H.264';
    if (value === 'h.265') return 'H.265';
    return undefined;
}

function audioSamplingRateLabel(value: ProgramBroadcastItem['audioSamplingRate']): string | undefined {
    if (value === undefined) return undefined;
    const kiloHertz = value / 1000;
    return `${Number.isInteger(kiloHertz) ? kiloHertz.toFixed(0) : kiloHertz.toString()}kHz`;
}

function detailValue(parts: Array<string | undefined>): string {
    return parts.filter((part): part is string => part !== undefined && part.length > 0).join(' / ') || '情報なし';
}

function DetailRow({ icon, label, children }: { icon: ReactNode; label: string; children: ReactNode }): ReactNode {
    return (
        <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', minWidth: 0 }}>
            <Box sx={{ display: 'flex', color: 'text.secondary', pt: '2px', flexShrink: 0 }}>{icon}</Box>
            <Typography variant="body2" sx={{ minWidth: 56, fontWeight: 600, flexShrink: 0 }}>
                {label}
            </Typography>
            <Box sx={{ minWidth: 0, overflowWrap: 'anywhere' }}>{children}</Box>
        </Stack>
    );
}

export function ProgramBroadcastDetails({
    program,
    channel,
    onTimeClick,
}: {
    program: ProgramBroadcastItem;
    channel?: ProgramChannelSummary;
    onTimeClick?: () => void;
}): ReactNode {
    const [expanded, setExpanded] = useState(false);
    const genres = programGenrePathLabels(program);
    const time = (
        <>
            <AccessTimeOutlined fontSize="small" color="action" />
            <Typography variant="body2" sx={{ display: { xs: 'none', sm: 'block' } }}>
                {formatProgramDate(program.startAt)} – {formatProgramTime(program.endAt)}
            </Typography>
            <Typography sx={{ display: { xs: 'block', sm: 'none' }, fontSize: '0.78rem' }}>
                {formatProgramDateCompact(program.startAt)}–{formatProgramTime(program.endAt)}
            </Typography>
            <Typography variant="body2" sx={{ fontSize: { xs: '0.78rem', sm: '0.875rem' } }}>
                ({programDuration(program)}分)
            </Typography>
        </>
    );
    const timeSx = {
        display: 'flex',
        alignItems: 'center',
        gap: { xs: 0.5, sm: 1 },
        alignSelf: { xs: 'flex-start', sm: 'auto' },
        flex: '0 0 auto',
        whiteSpace: 'nowrap',
        borderRadius: 1,
    } as const;

    return (
        <Box sx={{ px: { xs: 2, sm: 3 }, py: 1, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                <Stack
                    direction={{ xs: 'column', sm: 'row' }}
                    spacing={{ xs: 1, sm: 1.5 }}
                    useFlexGap
                    sx={{ alignItems: { xs: 'stretch', sm: 'center' }, flexWrap: { sm: 'wrap' }, minWidth: 0, flex: 1 }}
                >
                    <Stack direction="row" spacing={1.5} sx={{ alignItems: 'center', minWidth: 0 }}>
                        {channel?.hasLogoData && (
                            <Box
                                component="img"
                                src={withBasePath(`/api/channels/${channel.id}/logo`)}
                                alt=""
                                sx={{ width: 48, height: 32, objectFit: 'contain', flexShrink: 0 }}
                            />
                        )}
                        <Typography sx={{ fontWeight: 600 }}>{channel?.name ?? program.channelId}</Typography>
                    </Stack>
                    {onTimeClick === undefined ? (
                        <Stack direction="row" sx={timeSx}>
                            {time}
                        </Stack>
                    ) : (
                        <ButtonBase onClick={onTimeClick} aria-label="この番組の時刻とチャンネルを番組表で表示" sx={timeSx}>
                            {time}
                        </ButtonBase>
                    )}
                </Stack>
                <IconButton
                    size="small"
                    aria-label={expanded ? 'ジャンルと映像・音声情報を閉じる' : 'ジャンルと映像・音声情報を表示'}
                    aria-expanded={expanded}
                    onClick={() => setExpanded(value => !value)}
                    sx={{ width: 36, height: 36, mr: { xs: -0.5, sm: -1 }, flexShrink: 0, color: 'text.secondary' }}
                >
                    <ExpandMoreOutlined sx={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: theme => theme.transitions.create('transform') }} />
                </IconButton>
            </Stack>
            <Collapse in={expanded} timeout="auto" unmountOnExit>
                <Stack spacing={0.75} sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
                    <DetailRow icon={<CategoryOutlined fontSize="small" />} label="ジャンル">
                        <Stack spacing={0.25}>
                            {genres.length > 0 ? (
                                genres.map((genre, index) => (
                                    <Typography key={`${index.toString(10)}-${genre}`} variant="body2">
                                        {genre}
                                    </Typography>
                                ))
                            ) : (
                                <Typography variant="body2">情報なし</Typography>
                            )}
                        </Stack>
                    </DetailRow>
                    <DetailRow icon={<VideocamOutlined fontSize="small" />} label="映像">
                        <Typography variant="body2">{detailValue([videoCodecLabel(program.videoType), program.videoResolution])}</Typography>
                    </DetailRow>
                    <DetailRow icon={<HeadphonesOutlined fontSize="small" />} label="主音声">
                        <Typography variant="body2">
                            {detailValue([
                                program.audioComponentType === undefined
                                    ? undefined
                                    : (audioComponentLabels[program.audioComponentType] ?? `音声モード 0x${program.audioComponentType.toString(16).padStart(2, '0')}`),
                                audioSamplingRateLabel(program.audioSamplingRate),
                            ])}
                        </Typography>
                    </DetailRow>
                </Stack>
            </Collapse>
        </Box>
    );
}
