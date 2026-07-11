import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';

export function PageHeader({ title, actions }: { title: string; actions?: ReactNode }): ReactNode {
    return (
        <Box
            component="header"
            sx={{
                minHeight: 56,
                px: { xs: 2, md: 3 },
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                borderBottom: 1,
                borderColor: 'divider',
                bgcolor: 'background.paper',
            }}
        >
            <Typography component="h1" variant="h6">
                {title}
            </Typography>
            {actions}
        </Box>
    );
}
