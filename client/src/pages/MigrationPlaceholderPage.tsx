import ConstructionOutlined from '@mui/icons-material/ConstructionOutlined';
import { Box, Typography } from '@mui/material';
import type { ReactNode } from 'react';
import { PageHeader } from '../components/PageHeader';

export function MigrationPlaceholderPage({ title }: { title: string }): ReactNode {
    return (
        <>
            <PageHeader title={title} />
            <Box sx={{ minHeight: 'calc(100dvh - 56px)', display: 'grid', placeItems: 'center', p: 3 }}>
                <Box sx={{ textAlign: 'center', color: 'text.secondary' }}>
                    <ConstructionOutlined sx={{ fontSize: 54, mb: 1 }} />
                    <Typography variant="h6">React版へ移行中</Typography>
                    <Typography variant="body2">この画面は次の移行工程で実装します。</Typography>
                </Box>
            </Box>
        </>
    );
}
