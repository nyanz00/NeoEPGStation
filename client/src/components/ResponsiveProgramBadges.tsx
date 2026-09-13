import { Box, Chip, Popover, Stack, Typography } from '@mui/material';
import type { MouseEvent as ReactMouseEvent, ReactNode } from 'react';
import { useLayoutEffect, useMemo, useRef, useState } from 'react';

type BadgeLayout = 'duration' | 'full' | 'without-duration' | 'summary';

const badgeSx = {
    height: { xs: 24, sm: 32 },
    maxWidth: '100%',
    '& .MuiChip-label': {
        px: { xs: 0.65, sm: 1.25 },
        fontSize: { xs: '0.7rem', sm: '0.8125rem' },
        overflow: 'hidden',
        textOverflow: 'ellipsis',
    },
} as const;

function compactGenreLabel(label: string): string {
    return label.split('・')[0] || label;
}

export function ResponsiveProgramBadges({ duration, genres }: { duration: number; genres: string[] }): ReactNode {
    const containerRef = useRef<HTMLDivElement>(null);
    const durationMeasureRef = useRef<HTMLDivElement>(null);
    const genreMeasureRef = useRef<HTMLDivElement>(null);
    const moreMeasureRef = useRef<HTMLDivElement>(null);
    const [layout, setLayout] = useState<BadgeLayout>('summary');
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const primaryLabel = useMemo(() => (genres.length > 1 ? compactGenreLabel(genres[0]) : (genres[0] ?? '')), [genres]);
    const hiddenCount = Math.max(0, genres.length - 1);

    useLayoutEffect(() => {
        const container = containerRef.current;
        if (container === null) return;
        let active = true;
        const update = (): void => {
            if (!active) return;
            const available = container.clientWidth;
            const gap = 4;
            const durationWidth = durationMeasureRef.current?.offsetWidth ?? 0;
            const genreWidth = genreMeasureRef.current?.offsetWidth ?? 0;
            const moreWidth = moreMeasureRef.current?.offsetWidth ?? 0;

            if (genres.length === 0) {
                setLayout('duration');
            } else if (genres.length === 1) {
                setLayout(durationWidth + genreWidth + gap <= available ? 'full' : 'without-duration');
            } else if (durationWidth + genreWidth + moreWidth + gap * 2 <= available) {
                setLayout('full');
            } else if (genreWidth + moreWidth + gap <= available) {
                setLayout('without-duration');
            } else {
                setLayout('summary');
            }
        };
        const observer = new ResizeObserver(update);
        observer.observe(container);
        update();
        void document.fonts?.ready.then(update);
        return () => {
            active = false;
            observer.disconnect();
        };
    }, [duration, genres, hiddenCount, primaryLabel]);

    const openGenres = (event: ReactMouseEvent<HTMLElement>): void => {
        event.stopPropagation();
        setAnchor(event.currentTarget);
    };

    return (
        <Box ref={containerRef} sx={{ position: 'relative', minWidth: 0, flex: '1 1 auto', overflow: 'hidden' }} onClick={event => event.stopPropagation()}>
            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center', minWidth: 0, width: '100%', flexWrap: 'nowrap' }}>
                {(layout === 'duration' || layout === 'full') && <Chip size="small" variant="outlined" label={`${duration}分`} sx={{ ...badgeSx, flex: '0 0 auto' }} />}
                {(layout === 'full' || layout === 'without-duration') && genres.length > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        clickable
                        label={primaryLabel}
                        title={genres[0]}
                        aria-label={`${genres[0]}のジャンル一覧を表示`}
                        onClick={openGenres}
                        sx={{ ...badgeSx, minWidth: 0, flex: '0 1 auto' }}
                    />
                )}
                {(layout === 'full' || layout === 'without-duration') && hiddenCount > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        clickable
                        label={`+${hiddenCount}`}
                        aria-label={`その他のジャンル${hiddenCount}件を表示`}
                        onClick={openGenres}
                        sx={{ ...badgeSx, flex: '0 0 auto' }}
                    />
                )}
                {layout === 'summary' && genres.length > 0 && (
                    <Chip
                        size="small"
                        variant="outlined"
                        clickable
                        label={`ジャンル +${genres.length}`}
                        aria-label={`ジャンル${genres.length}件を表示`}
                        onClick={openGenres}
                        sx={{ ...badgeSx, minWidth: 0, maxWidth: '100%' }}
                    />
                )}
            </Stack>

            <Stack
                aria-hidden
                direction="row"
                spacing={0.5}
                sx={{ position: 'fixed', left: -10000, top: -10000, visibility: 'hidden', pointerEvents: 'none', whiteSpace: 'nowrap' }}
            >
                <Chip ref={durationMeasureRef} size="small" variant="outlined" label={`${duration}分`} sx={badgeSx} />
                <Chip ref={genreMeasureRef} size="small" variant="outlined" label={primaryLabel} sx={badgeSx} />
                <Chip ref={moreMeasureRef} size="small" variant="outlined" label={`+${hiddenCount}`} sx={badgeSx} />
            </Stack>

            <Popover
                open={anchor !== null}
                anchorEl={anchor}
                onClose={() => setAnchor(null)}
                disableScrollLock
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { p: 1.25, maxWidth: 'min(320px, calc(100vw - 24px))' } } }}
            >
                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mb: 0.75 }}>
                    ジャンル
                </Typography>
                <Stack spacing={0.75} sx={{ alignItems: 'flex-start' }}>
                    {genres.map(genre => (
                        <Chip key={genre} size="small" variant="outlined" label={genre} />
                    ))}
                </Stack>
            </Popover>
        </Box>
    );
}
