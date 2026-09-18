import AccessTimeOutlined from '@mui/icons-material/AccessTimeOutlined';
import CategoryOutlined from '@mui/icons-material/CategoryOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import HeadphonesOutlined from '@mui/icons-material/HeadphonesOutlined';
import VideocamOutlined from '@mui/icons-material/VideocamOutlined';
import { Box, ButtonBase, Collapse, IconButton, Stack, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { useLayoutEffect, useRef, useState } from 'react';
import type { ScheduleProgramItem } from '../../../api';
import {
    formatProgramDate,
    formatProgramDateCompact,
    formatProgramTime,
    programAudioComponentLabel,
    programAudioSamplingRateLabel,
    programDuration,
    programGenrePathLabels,
    programVideoCodecLabel,
} from '../core/program';
import { withBasePath } from '../core/path';
import { useSettings } from '../core/storage/settings';

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

function detailValue(parts: Array<string | undefined>): string {
    return parts.filter((part): part is string => part !== undefined && part.length > 0).join(' / ') || '情報なし';
}

function elementOuterHeight(element: HTMLElement): number {
    const style = window.getComputedStyle(element);
    return element.offsetHeight + (Number.parseFloat(style.marginTop) || 0) + (Number.parseFloat(style.marginBottom) || 0);
}

function elementContentHeight(element: HTMLElement): number {
    const style = window.getComputedStyle(element);
    const verticalPadding = (Number.parseFloat(style.paddingTop) || 0) + (Number.parseFloat(style.paddingBottom) || 0);
    return Math.max(0, element.offsetHeight - verticalPadding);
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
    autoExpandMaxHeight,
}: {
    program: ProgramBroadcastItem;
    channel?: ProgramChannelSummary;
    onTimeClick?: () => void;
    autoExpandMaxHeight?: string;
}): ReactNode {
    const settings = useSettings();
    const [expanded, setExpanded] = useState(false);
    const expandedRef = useRef(expanded);
    expandedRef.current = expanded;
    const rootRef = useRef<HTMLDivElement | null>(null);
    const detailsRef = useRef<HTMLDivElement | null>(null);
    const instantExpansion = useRef(false);
    const autoHeightLocked = useRef(false);
    const manualHeightLock = useRef<{ paper: HTMLElement; previousHeight: string; lockedHeight: string } | null>(null);
    const descriptionOverflowOverride = useRef<{ element: HTMLElement; previousOverflowY: string } | null>(null);
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

    useLayoutEffect(() => {
        if (autoExpandMaxHeight === undefined) return;

        const isDesktop = window.matchMedia('(min-width: 600px)').matches;
        if (!isDesktop && !settings.isAlwaysShowBroadcastDetails) return;

        const root = rootRef.current;
        const details = detailsRef.current;
        const paper = root?.closest<HTMLElement>('.MuiDialog-paper');
        const description = root?.nextElementSibling instanceof HTMLElement ? root.nextElementSibling : null;
        if (root === null || details === null || paper === undefined || paper === null || description === null) return;

        // A short desktop dialog can show both the complete description and these details.
        // Measure before the first paint so it opens in its final expanded size without recentering.
        const collapsedHeight = paper.offsetHeight;
        const previousHeight = paper.style.height;
        paper.style.height = '100000px';
        const maximumHeight = paper.offsetHeight;
        paper.style.height = previousHeight;

        const detailsHeight = elementOuterHeight(details);
        const expandedHeight = Math.ceil(collapsedHeight + detailsHeight);
        const descriptionHeight = elementContentHeight(description);
        const isAtMaximumHeight = collapsedHeight >= maximumHeight - 1;
        const isDescriptionShort = descriptionHeight < detailsHeight;
        const canKeepDescriptionAndDetails = expandedHeight <= maximumHeight;
        if (isDesktop && !isAtMaximumHeight && isDescriptionShort && canKeepDescriptionAndDetails) {
            const previousMinHeight = paper.style.minHeight;
            const lockedMinHeight = `min(${expandedHeight.toString(10)}px, ${autoExpandMaxHeight})`;
            // Retain the initial expanded height when manually collapsed so the toggle does not move.
            paper.style.minHeight = lockedMinHeight;
            autoHeightLocked.current = true;
            instantExpansion.current = true;
            setExpanded(true);

            return () => {
                autoHeightLocked.current = false;
                if (paper.style.minHeight === lockedMinHeight) paper.style.minHeight = previousMinHeight;
            };
        }

        if (!settings.isAlwaysShowBroadcastDetails) return;

        // Grow toward the dialog's maximum height before taking space from the description.
        // Keep that resulting height after collapse so the dialog and toggle do not move.
        const lockedHeight = `min(${expandedHeight.toString(10)}px, ${autoExpandMaxHeight})`;
        paper.style.height = lockedHeight;
        manualHeightLock.current = { paper, previousHeight, lockedHeight };
        instantExpansion.current = true;
        setExpanded(true);
    }, [autoExpandMaxHeight, settings.isAlwaysShowBroadcastDetails]);

    useLayoutEffect(
        () => () => {
            const lock = manualHeightLock.current;
            if (lock !== null && lock.paper.style.height === lock.lockedHeight) lock.paper.style.height = lock.previousHeight;
            const overflowOverride = descriptionOverflowOverride.current;
            if (overflowOverride !== null) overflowOverride.element.style.overflowY = overflowOverride.previousOverflowY;
        },
        [],
    );

    const setDescriptionOverflow = (overflowY: 'auto' | 'hidden'): void => {
        const root = rootRef.current;
        const description = root?.nextElementSibling instanceof HTMLElement ? root.nextElementSibling : null;
        if (description === null) return;

        if (descriptionOverflowOverride.current?.element !== description) {
            descriptionOverflowOverride.current = { element: description, previousOverflowY: description.style.overflowY };
        }
        description.style.overflowY = overflowY;
    };

    const settleDescriptionOverflow = (): void => {
        const root = rootRef.current;
        const description = root?.nextElementSibling instanceof HTMLElement ? root.nextElementSibling : null;
        if (description === null) return;

        // Re-evaluate overflow after the collapse transition. Some browsers keep the
        // former scrollbar painted when a flex child grows enough to fit its content.
        setDescriptionOverflow('hidden');
        const hasScrollableOverflow = description.scrollHeight - description.clientHeight > 1;
        setDescriptionOverflow(hasScrollableOverflow ? 'auto' : 'hidden');
        if (!hasScrollableOverflow) description.scrollTop = 0;
    };

    useLayoutEffect(() => {
        const handleResize = (): void => {
            if (!expandedRef.current) settleDescriptionOverflow();
        };
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const lockPaperHeightForManualExpansion = (): void => {
        if (autoHeightLocked.current || manualHeightLock.current !== null) return;

        const root = rootRef.current;
        const paper = root?.closest<HTMLElement>('.MuiDialog-paper');
        if (root === null || paper === undefined || paper === null) return;

        const previousHeight = paper.style.height;
        const maximumHeight = autoExpandMaxHeight ?? 'calc(100dvh - 24px)';
        const lockedHeight = `min(${paper.offsetHeight.toString(10)}px, ${maximumHeight})`;
        paper.style.height = lockedHeight;
        manualHeightLock.current = { paper, previousHeight, lockedHeight };
    };

    return (
        <Box ref={rootRef} sx={{ px: { xs: 2, sm: 3 }, py: 1, flexShrink: 0, borderBottom: 1, borderColor: 'divider' }}>
            <Stack direction="row" spacing={0.75} useFlexGap sx={{ alignItems: 'center', minWidth: 0 }}>
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
                    onClick={() => {
                        instantExpansion.current = false;
                        if (!expanded) lockPaperHeightForManualExpansion();
                        setExpanded(value => !value);
                    }}
                    sx={{ width: 36, height: 36, mr: { xs: -0.5, sm: -1 }, flexShrink: 0, color: 'text.secondary' }}
                >
                    <ExpandMoreOutlined sx={{ transform: expanded ? 'rotate(180deg)' : 'rotate(0deg)', transition: theme => theme.transitions.create('transform') }} />
                </IconButton>
            </Stack>
            <Collapse in={expanded} timeout={instantExpansion.current ? 0 : 'auto'} onEnter={() => setDescriptionOverflow('auto')} onExited={settleDescriptionOverflow}>
                <Stack ref={detailsRef} spacing={0.75} sx={{ mt: 1, pt: 1, borderTop: 1, borderColor: 'divider' }}>
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
                        <Typography variant="body2">{detailValue([programVideoCodecLabel(program.videoType), program.videoResolution])}</Typography>
                    </DetailRow>
                    <DetailRow icon={<HeadphonesOutlined fontSize="small" />} label="主音声">
                        <Typography variant="body2">
                            {detailValue([programAudioComponentLabel(program.audioComponentType), programAudioSamplingRateLabel(program.audioSamplingRate)])}
                        </Typography>
                    </DetailRow>
                </Stack>
            </Collapse>
        </Box>
    );
}
