import { Box } from '@mui/material';
import type { ReactNode } from 'react';

export function PageSubHeader({ children }: { children: ReactNode }): ReactNode {
    return (
        <Box
            data-page-subheader="true"
            sx={{
                position: 'sticky',
                top: 56,
                zIndex: theme => theme.zIndex.appBar - 1,
                bgcolor: 'background.default',
                borderBottom: 1,
                borderColor: 'divider',
            }}
        >
            {children}
        </Box>
    );
}
