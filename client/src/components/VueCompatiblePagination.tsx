import ChevronLeft from '@mui/icons-material/ChevronLeft';
import ChevronRight from '@mui/icons-material/ChevronRight';
import { Box, ButtonBase, type SxProps, type Theme, useMediaQuery } from '@mui/material';
import { type MouseEvent, type ReactNode, useEffect, useMemo, useRef, useState } from 'react';

type PaginationItem = number | '...';

function range(from: number, to: number): number[] {
    const items: number[] = [];
    for (let value = Math.max(1, from); value <= to; value++) items.push(value);
    return items;
}

function desktopItems(length: number, value: number, maxLength: number): PaginationItem[] {
    if (length <= maxLength) return range(1, length);

    // Vuetify 2.7 VPagination (total-visible="12") と同じページ番号生成規則。
    const even = maxLength % 2 === 0 ? 1 : 0;
    const left = Math.floor(maxLength / 2);
    const right = length - left + 1 + even;

    if (value > left && value < right) {
        const start = value - left + 2;
        const end = value + left - 2 - even;
        const secondItem: PaginationItem = start - 1 === 2 ? 2 : '...';
        const beforeLastItem: PaginationItem = end + 1 === length - 1 ? end + 1 : '...';
        return [1, secondItem, ...range(start, end), beforeLastItem, length];
    }
    if (value === left) return [...range(1, value + left - 1 - even), '...', length];
    if (value === right) return [1, '...', ...range(value - left + 1, length)];
    return [...range(1, left), '...', ...range(right, length)];
}

function mobileItems(length: number, value: number): number[] {
    const maxSize = 5;
    const center = Math.ceil(maxSize / 2);
    let start = value <= center - 1 ? 1 : length - value >= center - 1 ? value - (center - 1) : length - maxSize + 1;
    start = Math.max(1, start);
    return range(start, Math.min(length, start + maxSize - 1));
}

export function VueCompatiblePagination({
    count,
    page,
    onChange,
    sx,
}: {
    count: number;
    page: number;
    onChange: (event: MouseEvent<HTMLButtonElement>, value: number) => void;
    sx?: SxProps<Theme>;
}): ReactNode {
    const mobile = useMediaQuery('(max-width:500px)');
    const containerRef = useRef<HTMLElement | null>(null);
    const [containerWidth, setContainerWidth] = useState(0);

    useEffect(() => {
        const element = containerRef.current;
        if (element === null) return;
        const updateWidth = (): void => setContainerWidth(element.parentElement?.clientWidth ?? window.innerWidth);
        updateWidth();
        const observer = new ResizeObserver(updateWidth);
        observer.observe(element.parentElement ?? element);
        return () => observer.disconnect();
    }, []);

    const safeCount = Math.max(1, Math.floor(count));
    const safePage = Math.min(safeCount, Math.max(1, Math.floor(page)));
    const items = useMemo<PaginationItem[]>(() => {
        if (mobile) return mobileItems(safeCount, safePage);
        const maxButtons = containerWidth > 0 ? Math.floor((containerWidth - 96) / 42) : 12;
        const maxLength = Math.min(12, Math.max(1, maxButtons), safeCount);
        return desktopItems(safeCount, safePage, maxLength);
    }, [containerWidth, mobile, safeCount, safePage]);

    if (count <= 1) return null;

    const buttonSx = {
        width: { xs: 36, sm: 40 },
        minWidth: { xs: 36, sm: 40 },
        height: { xs: 36, sm: 40 },
        borderRadius: 1,
        boxShadow: 2,
        fontSize: '1rem',
        fontWeight: 500,
        transition: (theme: Theme) => theme.transitions.create(['background-color', 'box-shadow']),
        '&:disabled': { boxShadow: 1, color: 'text.disabled' },
    } as const;

    return (
        <Box component="nav" ref={containerRef} aria-label="ページ切り替え" sx={sx}>
            <Box component="ul" sx={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: { xs: 0.75, sm: 1 }, m: 0, p: 0, listStyle: 'none' }}>
                <Box component="li">
                    <ButtonBase
                        aria-label="前のページ"
                        disabled={safePage <= 1}
                        onClick={event => onChange(event, safePage - 1)}
                        sx={{ ...buttonSx, bgcolor: 'background.paper', color: 'text.primary', mr: { xs: 0.5, sm: 1 } }}
                    >
                        <ChevronLeft />
                    </ButtonBase>
                </Box>
                {items.map((item, index) => (
                    <Box component="li" key={`${item}-${index}`}>
                        {item === '...' ? (
                            <Box
                                component="span"
                                aria-hidden
                                sx={{ display: 'grid', placeItems: 'center', width: { xs: 28, sm: 32 }, height: { xs: 36, sm: 40 }, fontSize: '1.1rem' }}
                            >
                                …
                            </Box>
                        ) : (
                            <ButtonBase
                                aria-label={`${item}ページ目`}
                                aria-current={item === safePage ? 'page' : undefined}
                                onClick={event => onChange(event, item)}
                                sx={{
                                    ...buttonSx,
                                    bgcolor: item === safePage ? 'primary.main' : 'background.paper',
                                    color: item === safePage ? 'primary.contrastText' : 'text.primary',
                                    '&:hover': { bgcolor: item === safePage ? 'primary.dark' : 'action.hover' },
                                }}
                            >
                                {item}
                            </ButtonBase>
                        )}
                    </Box>
                ))}
                <Box component="li">
                    <ButtonBase
                        aria-label="次のページ"
                        disabled={safePage >= safeCount}
                        onClick={event => onChange(event, safePage + 1)}
                        sx={{ ...buttonSx, bgcolor: 'background.paper', color: 'text.primary', ml: { xs: 0.5, sm: 1 } }}
                    >
                        <ChevronRight />
                    </ButtonBase>
                </Box>
            </Box>
        </Box>
    );
}
