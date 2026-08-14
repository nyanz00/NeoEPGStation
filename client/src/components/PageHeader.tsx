import MenuIcon from '@mui/icons-material/Menu';
import { Box, IconButton, Typography } from '@mui/material';
import { alpha, type Theme } from '@mui/material/styles';
import type { ReactNode } from 'react';
import { useAppLayout } from './AppLayout';

function headerForeground(theme: Theme): string {
    return theme.palette.getContrastText(theme.appHeader.background);
}

export function PageHeader({ title, leading, actions }: { title: ReactNode; leading?: ReactNode; actions?: ReactNode }): ReactNode {
    const { toggleDrawer } = useAppLayout();
    return (
        <Box
            component="div"
            role="banner"
            data-page-header="true"
            sx={{
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
                '& .MuiIconButton-root': { color: 'inherit' },
                '& .MuiButton-root:not(.MuiButton-contained)': { color: 'inherit' },
                '& .MuiButton-contained.MuiButton-colorPrimary': {
                    bgcolor: theme => (theme.palette.mode === 'light' ? `${theme.palette.common.white} !important` : undefined),
                    color: theme => (theme.palette.mode === 'light' ? `${theme.palette.primary.dark} !important` : undefined),
                    '&:hover': {
                        bgcolor: theme => (theme.palette.mode === 'light' ? `${theme.palette.grey[100]} !important` : undefined),
                    },
                    '&.Mui-disabled': {
                        bgcolor: theme => (theme.palette.mode === 'light' ? 'rgba(255, 255, 255, 0.42) !important' : undefined),
                        color: theme => (theme.palette.mode === 'light' ? 'rgba(0, 0, 0, 0.38) !important' : undefined),
                    },
                },
                '& .MuiButton-outlined.MuiButton-colorPrimary': {
                    borderColor: theme => `${alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.32 : 0.22)} !important`,
                    bgcolor: 'transparent !important',
                    '&:hover': {
                        borderColor: theme => `${alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.48 : 0.38)} !important`,
                        bgcolor: theme => `${alpha(headerForeground(theme), theme.palette.mode === 'light' ? 0.08 : 0.06)} !important`,
                    },
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
                '& .MuiInputLabel-root, & .MuiSelect-icon': {
                    color: theme => (theme.palette.mode === 'light' ? 'inherit' : undefined),
                },
                '& .MuiOutlinedInput-root': {
                    color: theme => (theme.palette.mode === 'light' ? 'inherit' : undefined),
                    '& .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme => (theme.palette.mode === 'light' ? 'rgba(255, 255, 255, 0.55)' : undefined),
                    },
                    '&:hover .MuiOutlinedInput-notchedOutline': {
                        borderColor: theme => (theme.palette.mode === 'light' ? 'rgba(255, 255, 255, 0.8)' : undefined),
                    },
                },
            }}
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
