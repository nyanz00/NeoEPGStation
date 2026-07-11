import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import { Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, IconButton, Stack, Typography } from '@mui/material';
import { useQueries, useQueryClient } from '@tanstack/react-query';
import type { RecordedItem, ReserveItem } from '../../../api';
import type { ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { api } from '../core/api/queries';
import { useActiveUser } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';

function formatDate(value: number): string {
    return new Intl.DateTimeFormat('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
    }).format(new Date(value));
}

function ProgramCard({ item, onClick }: { item: RecordedItem | ReserveItem; onClick?: () => void }): ReactNode {
    return (
        <Card variant="outlined">
            <CardActionArea disabled={onClick === undefined} onClick={onClick}>
                <CardContent sx={{ py: 1.5 }}>
                    <Typography variant="subtitle2" noWrap title={item.name}>
                        {item.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {formatDate(item.startAt)} - {formatDate(item.endAt)}
                    </Typography>
                </CardContent>
            </CardActionArea>
        </Card>
    );
}

interface DashboardColumnProps {
    title: string;
    total?: number;
    children: ReactNode;
    morePath: string;
    badge?: number;
}

function DashboardColumn({ title, total, children, morePath, badge }: DashboardColumnProps): ReactNode {
    const navigate = useNavigate();
    return (
        <Card variant="outlined" sx={{ minWidth: 0 }}>
            <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {title}
                </Typography>
                {typeof total === 'number' && <Chip size="small" label={total} />}
                {typeof badge === 'number' && badge > 0 && <Chip size="small" color="error" label={`競合 ${badge}`} />}
            </Box>
            <Stack spacing={1} sx={{ p: 1.5 }}>
                {children}
            </Stack>
            <Button fullWidth onClick={() => void navigate(morePath)} sx={{ borderRadius: 0 }}>
                すべて表示
            </Button>
        </Card>
    );
}

export function DashboardPage(): ReactNode {
    const settings = useSettings();
    const activeUser = useActiveUser();
    const queryClient = useQueryClient();
    const userId = typeof activeUser === 'number' ? activeUser : undefined;
    const [recording, recorded, reserves, reserveCounts] = useQueries({
        queries: [
            {
                queryKey: ['recording', userId, settings.isHalfWidthDisplayed],
                queryFn: () => api.getRecording({ isHalfWidth: settings.isHalfWidthDisplayed, userId, offset: 0, limit: 5 }),
            },
            {
                queryKey: ['recorded', userId, settings.isHalfWidthDisplayed],
                queryFn: () => api.getRecorded({ isHalfWidth: settings.isHalfWidthDisplayed, userId, offset: 0, limit: 5 }),
            },
            {
                queryKey: ['reserves', userId, settings.isHalfWidthDisplayed],
                queryFn: () => api.getReserves({ type: 'normal', isHalfWidth: settings.isHalfWidthDisplayed, userId, offset: 0, limit: 5 }),
            },
            {
                queryKey: ['reserve-counts'],
                queryFn: api.getReserveCounts,
            },
        ],
    });
    const isPending = recording.isPending || recorded.isPending || reserves.isPending || reserveCounts.isPending;
    const error = recording.error ?? recorded.error ?? reserves.error ?? reserveCounts.error;

    return (
        <>
            <PageHeader
                title="ダッシュボード"
                actions={
                    <IconButton onClick={() => void queryClient.invalidateQueries()} aria-label="更新">
                        <RefreshOutlined />
                    </IconButton>
                }
            />
            {isPending ? (
                <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : error !== null ? (
                <Box sx={{ p: 3 }}>
                    <Typography color="error">情報の取得に失敗しました: {error.message}</Typography>
                </Box>
            ) : (
                <Box
                    sx={{
                        p: { xs: 1.5, md: 2.5 },
                        display: 'grid',
                        gridTemplateColumns: { xs: '1fr', lg: 'repeat(3, minmax(0, 1fr))' },
                        gap: 2,
                    }}
                >
                    <DashboardColumn title="録画中" total={recording.data?.total} morePath="/recording">
                        {recording.data?.records.map(item => (
                            <ProgramCard key={item.id} item={item} />
                        ))}
                        {recording.data?.records.length === 0 && <Typography color="text.secondary">録画中の番組はありません</Typography>}
                    </DashboardColumn>
                    <DashboardColumn title="録画済み" total={recorded.data?.total} morePath="/recorded">
                        {recorded.data?.records.map(item => (
                            <ProgramCard key={item.id} item={item} onClick={() => (location.hash = `#/recorded/detail/${item.id}`)} />
                        ))}
                        {recorded.data?.records.length === 0 && <Typography color="text.secondary">録画済み番組はありません</Typography>}
                    </DashboardColumn>
                    <DashboardColumn title="予約" total={reserves.data?.total} morePath="/reserves?type=normal" badge={reserveCounts.data?.conflicts}>
                        {reserves.data?.reserves.map(item => (
                            <ProgramCard key={item.id} item={item} />
                        ))}
                        {reserves.data?.reserves.length === 0 && <Typography color="text.secondary">予約はありません</Typography>}
                    </DashboardColumn>
                </Box>
            )}
        </>
    );
}
