import { alpha, type Theme } from '@mui/material/styles';

// Shared by the guide and encode dialogs without changing other dialogs.
export const programDialogPaper = (theme: Theme) => ({
    borderRadius: '12px',
    backgroundImage: 'none',
    border: `1px solid ${theme.palette.divider}`,
    boxShadow: '0 16px 56px rgba(0,0,0,0.35)',
    width: { xs: 'calc(100% - 24px)', sm: 'calc(100% - 64px)' },
    m: { xs: 1.5, sm: 4 },
    maxHeight: 'calc(100dvh - 24px)',
    '& .MuiDialogTitle-root': { p: { xs: 2, sm: 3 }, pr: { xs: 7, sm: 8 }, fontWeight: 700, lineHeight: 1.5, overflowWrap: 'anywhere', flexShrink: 0 },
    '& .MuiDialogActions-root': {
        p: { xs: 1.5, sm: 2 },
        gap: 1,
        borderTop: 1,
        borderColor: 'divider',
        flexWrap: 'wrap',
        '& .MuiButton-root': { minHeight: 42, borderRadius: '7px' },
    },
    '& .MuiInputLabel-root': { position: 'static', transform: 'none', mb: 0.75, fontSize: '0.875rem', maxWidth: '100%', pointerEvents: 'auto' },
    '& .MuiOutlinedInput-root': { borderRadius: '7px', bgcolor: alpha(theme.palette.text.primary, 0.025), minHeight: 44 },
    '& .MuiOutlinedInput-notchedOutline legend': { display: 'none' },
    '& .MuiOutlinedInput-notchedOutline': { top: 0 },
    '& .MuiFormControl-root': { minWidth: 0 },
    '& .MuiFormControlLabel-root': { mr: 2, '& .MuiFormControlLabel-label': { fontSize: '0.9375rem' } },
});

export const programDialogClose = {
    position: 'absolute',
    right: { xs: 12, sm: 16 },
    top: { xs: 12, sm: 16 },
    bgcolor: 'action.hover',
    color: 'text.secondary',
    width: 36,
    height: 36,
} as const;

export const programDialogFields = {
    display: 'grid',
    gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'minmax(0, 2fr) minmax(0, 3fr)' },
    gap: 2,
} as const;
