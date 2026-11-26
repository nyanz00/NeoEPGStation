import MenuIcon from '@mui/icons-material/Menu';
import { Box, IconButton, Typography } from '@mui/material';
import { alpha, darken, getContrastRatio, lighten, type Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { useAppLayout } from './AppLayout';

function headerForeground(theme: Theme): string {
    const { white, black } = theme.palette.common;
    return getContrastRatio(theme.appHeader.background, white) >= 4.5 ? white : black;
}

function headerAccentStyles(theme: Theme) {
    const background = theme.appHeader.background;
    const { black, white } = theme.palette.common;
    const towardWhite = getContrastRatio(background, white) > getContrastRatio(background, black);
    const adjust = towardWhite ? lighten : darken;
    const contrastTarget = 4.6; // Leave room for sRGB and luminance rounding.

    return Object.fromEntries(
        (['primary', 'secondary', 'warning', 'error'] as const).map(tone => {
            const preferred = theme.palette[tone].main;
            let color = preferred;
            if (getContrastRatio(background, preferred) < contrastTarget) {
                // Keep as much of the palette color as possible while meeting the contrast target.
                let low = 0;
                let high = 1;
                for (let step = 0; step < 8; step++) {
                    const amount = (low + high) / 2;
                    if (getContrastRatio(background, adjust(preferred, amount)) >= contrastTarget) high = amount;
                    else low = amount;
                }
                color = adjust(preferred, high);
            }

            const accentIsLighter = getContrastRatio(color, black) > getContrastRatio(background, black);
            const selected = `[data-page-header-selected='${tone}']`;
            return [
                `& [data-page-header-accent='${tone}']:not(.Mui-disabled), & ${selected}:not(.Mui-disabled)`,
                {
                    color,
                    '&:hover': { bgcolor: (accentIsLighter ? darken : lighten)(background, 0.08) },
                    [`&${selected}`]: { boxShadow: 'inset 0 0 0 1px currentColor' },
                },
            ];
        }),
    );
}

export function PageHeader({ title, leading, actions }: { title: ReactNode; leading?: ReactNode; actions?: ReactNode }): ReactNode {
    const { toggleDrawer } = useAppLayout();
    return (
        <Box
            component="div"
            role="banner"
            data-page-header="true"
            sx={theme => ({
                position: 'sticky',
                top: 0,
                left: 'auto',
                right: 'auto',
                bottom: 'auto',
                zIndex: theme => theme.zIndex.appBar,
                minHeight: 56,
                px: { xs: 0.5, md: 0.75 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: 1,
                borderColor: theme => alpha(headerForeground(theme), 0.18),
                bgcolor: theme => theme.appHeader.background,
                color: theme => headerForeground(theme),
                '& .MuiIconButton-root:not(.Mui-disabled), & .MuiButton-root:not(.MuiButton-contained)': { color: 'inherit' },
                '& .MuiIconButton-root.Mui-disabled': { color: theme => alpha(headerForeground(theme), 0.38) },
                '& .MuiButton-contained.MuiButton-colorPrimary': {
                    bgcolor: theme => (theme.palette.mode === 'light' ? `${headerForeground(theme)} !important` : undefined),
                    color: theme => (theme.palette.mode === 'light' ? `${theme.palette.getContrastText(headerForeground(theme))} !important` : undefined),
                    '&:hover': {
                        bgcolor: theme => (theme.palette.mode === 'light' ? `${alpha(headerForeground(theme), 0.86)} !important` : undefined),
                    },
                    '&.Mui-disabled': {
                        bgcolor: theme => (theme.palette.mode === 'light' ? `${alpha(headerForeground(theme), 0.16)} !important` : undefined),
                        color: theme => (theme.palette.mode === 'light' ? `${alpha(headerForeground(theme), 0.68)} !important` : undefined),
                    },
                },
                '& .MuiButton-outlined.MuiButton-colorPrimary:not(.Mui-disabled)': {
                    borderColor: theme => `${alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.32 : 0.22)} !important`,
                    bgcolor: 'transparent !important',
                    '&:hover': {
                        borderColor: theme => `${alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.48 : 0.38)} !important`,
                        bgcolor: theme => `${alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.08 : 0.06)} !important`,
                    },
                },
                '& .MuiButton-outlined.MuiButton-colorPrimary.Mui-disabled': {
                    borderColor: theme => alpha(headerForeground(theme), 0.14),
                    color: theme => alpha(headerForeground(theme), 0.38),
                },
                "& [data-page-header-actions='true'] .MuiButton-text:not([data-page-header-flat-button='true'])": {
                    border: theme => `1px solid ${alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.32 : 0.22)}`,
                    bgcolor: 'transparent',
                    '&:hover': {
                        borderColor: theme => alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.48 : 0.38),
                        bgcolor: theme => alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.08 : 0.06),
                    },
                    '&.Mui-disabled': {
                        borderColor: theme => alpha(headerForeground(theme), 0.14),
                        color: theme => alpha(headerForeground(theme), 0.38),
                        bgcolor: 'transparent',
                    },
                },
                '& .MuiInputLabel-root, & .MuiInputLabel-root.Mui-focused, & .MuiSelect-icon': {
                    color: theme => (theme.palette.mode === 'light' ? 'inherit' : undefined),
                },
                '& .MuiOutlinedInput-root': {
                    color: theme => (theme.palette.mode === 'light' ? 'inherit' : undefined),
                    '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme => (theme.palette.mode === 'light' ? alpha(headerForeground(theme), 0.55) : undefined),
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline, &.Mui-focused .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme => (theme.palette.mode === 'light' ? alpha(headerForeground(theme), 0.8) : undefined),
                    },
                },
                "& [data-page-header-actions='true']": headerAccentStyles(theme),
            })}
        >
            <Box sx={{ minWidth: 0, flex: 1, display: 'flex', alignItems: 'center', gap: 0.25, overflow: 'hidden' }}>
                <IconButton onClick={toggleDrawer} aria-label="サイドメニューを開閉">
                    <MenuIcon />
                </IconButton>
                {leading}
                {typeof title === 'string' ? (
                    <Typography component="h1" variant="h6" noWrap>
                        {title}
                    </Typography>
                ) : (
                    title
                )}
            </Box>
            <Box data-page-header-actions="true" sx={{ flex: '0 0 auto' }}>
                {actions}
            </Box>
        </Box>
    );
}
