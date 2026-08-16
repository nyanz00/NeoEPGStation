import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import { Box, Button, Card, CardActionArea, CardContent, Chip, CircularProgress, IconButton, Stack, Typography } from '@mui/material';
import { useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelItem, RecordedItem, ReserveItem } from '../../../api';
import { type ReactNode, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ProgramThumbnail } from '../components/ProgramThumbnail';
import { api } from '../core/api/queries';
import { appIconAssetUrl, getAppIconSet } from '../core/icons/appIcons';
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

function ProgramCard({ item, channel, thumbnailId, onClick }: { item: RecordedItem | ReserveItem; channel?: ChannelItem; thumbnailId?: number; onClick?: () => void }): ReactNode {
    const showThumbnail = thumbnailId !== undefined || channel !== undefined;
    return (
        <Card variant="outlined" sx={{ overflow: 'hidden' }}>
            <CardActionArea
                disabled={onClick === undefined}
                onClick={onClick}
                sx={{
                    minHeight: showThumbnail ? 100 : undefined,
                    display: showThumbnail ? 'flex' : 'block',
                    alignItems: 'stretch',
                }}
            >
                {showThumbnail && (
                    <ProgramThumbnail
                        thumbnailId={thumbnailId}
                        channel={channel}
                        sx={{
                            width: { xs: 128, sm: '34%' },
                            maxWidth: 180,
                            minHeight: 100,
                            alignSelf: 'stretch',
                            borderRadius: 0,
                        }}
                    />
                )}
                <CardContent sx={{ minWidth: 0, flex: 1, py: 1.25, px: 1.5, '&:last-child': { pb: 1.25 } }}>
                    <Typography variant="subtitle2" noWrap title={item.name}>
                        {item.name}
                    </Typography>
                    {channel !== undefined && (
                        <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                            {channel.name}
                        </Typography>
                    )}
                    <Typography variant="caption" color="text.secondary">
                        {formatDate(item.startAt)} - {formatDate(item.endAt)}
                    </Typography>
                    {item.description !== undefined && (
                        <Typography variant="caption" noWrap title={item.description} sx={{ display: 'block', mt: 0.25 }}>
                            {item.description}
                        </Typography>
                    )}
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
    const appIcon = getAppIconSet(settings.appIconSet);
    const logoIcon = settings.isAppLogoLinkedToIcon ? appIcon.original : 'nyanz-smile.png';
    const activeUser = useActiveUser();
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const version = useQuery({ queryKey: ['version'], queryFn: api.getVersion, staleTime: 60_000 });
    const userId = typeof activeUser === 'number' ? activeUser : undefined;
    const [recording, recorded, reserves, reserveCounts, channels] = useQueries({
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
            {
                queryKey: ['channels'],
                queryFn: api.getChannels,
                staleTime: 60_000,
            },
        ],
    });
    const channelMap = useMemo(() => new Map(channels.data?.map(channel => [channel.id, channel])), [channels.data]);
    const isPending = recording.isPending || recorded.isPending || reserves.isPending || reserveCounts.isPending;
    const error = recording.error ?? recorded.error ?? reserves.error ?? reserveCounts.error;

    return (
        <>
            <PageHeader
                title={
                    <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography component="h1" variant="h6" noWrap sx={{ fontSize: { xs: '0.95rem', sm: '1.25rem' } }}>
                            NeoEPGStation v{version.data?.version ?? '1.0.0-beta.2'}
                        </Typography>
                        {!settings.isAppLogoHidden && <Box component="img" src={appIconAssetUrl(logoIcon)} alt="" sx={{ height: 25, width: 'auto', flex: '0 0 auto' }} />}
                    </Box>
                }
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
                            <ProgramCard
                                key={item.id}
                                item={item}
                                thumbnailId={item.thumbnails?.[0]}
                                channel={channelMap.get(item.channelId)}
                                onClick={() => void navigate(`/recorded/detail/${item.id}`)}
                            />
                        ))}
                        {recording.data?.records.length === 0 && <Typography color="text.secondary">録画中の番組はありません</Typography>}
                    </DashboardColumn>
                    <DashboardColumn title="録画済み" total={recorded.data?.total} morePath="/recorded">
                        {recorded.data?.records.map(item => (
                            <ProgramCard
                                key={item.id}
                                item={item}
                                thumbnailId={item.thumbnails?.[0]}
                                channel={channelMap.get(item.channelId)}
                                onClick={() => void navigate(`/recorded/detail/${item.id}`)}
                            />
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
