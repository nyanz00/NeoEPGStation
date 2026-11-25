import { Link } from '@mui/material';
import { getContrastRatio, type Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';

const urlPattern = /(https?:\/\/[\x21-\x7e]+)/gi;

/**
 * Keep accent links readable on both standard application surfaces. A custom
 * light theme may use white as its accent, in which case the generated
 * `primary.dark` is still too light; fall back to the normal text color.
 */
export function readableLinkColor(theme: Theme): string {
    const preferred = theme.palette.mode === 'light' ? theme.palette.primary.dark : theme.palette.primary.light;
    const surfaces = [theme.palette.background.default, theme.palette.background.paper];
    if (surfaces.every(surface => getContrastRatio(theme.palette.primary.main, surface) >= 4.5)) return theme.palette.primary.main;
    if (surfaces.every(surface => getContrastRatio(preferred, surface) >= 4.5)) return preferred;

    const textColor = theme.palette.text.primary;
    if (surfaces.every(surface => getContrastRatio(textColor, surface) >= 4.5)) return textColor;
    return theme.palette.getContrastText(theme.palette.background.paper);
}

export function LinkifiedProgramText({ text }: { text: string }): ReactNode {
    return (
        <>
            {text.split(urlPattern).map((part, index) =>
                /^https?:\/\//i.test(part) ? (
                    <Link key={index} href={part} target="_blank" rel="noopener noreferrer" sx={{ color: readableLinkColor, textDecorationColor: 'currentColor' }}>
                        {part}
                    </Link>
                ) : (
                    part
                ),
            )}
        </>
    );
}
