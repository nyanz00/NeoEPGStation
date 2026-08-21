import ArticleOutlined from '@mui/icons-material/ArticleOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import DeveloperBoardOutlined from '@mui/icons-material/DeveloperBoardOutlined';
import MemoryOutlined from '@mui/icons-material/MemoryOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SettingsInputAntennaOutlined from '@mui/icons-material/SettingsInputAntennaOutlined';
import StorageOutlined from '@mui/icons-material/StorageOutlined';
import { Box, Button, Card, CardContent, Chip, CircularProgress, Divider, Grid, IconButton, LinearProgress, Stack, Tooltip, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useState } from 'react';
import type { StorageItem, SystemGpuInfo, SystemResourceInfo, SystemStorageVolume, SystemStorageVolumeType } from '../../../api';
import { PageHeader } from '../components/PageHeader';
import { SystemLogsPanel } from '../components/SystemLogsPanel';
import { SystemMirakurunPanel } from '../components/SystemMirakurunPanel';
import { api } from '../core/api/queries';

function fileSize(value: number): string {
    if (value <= 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB', 'PiB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    const size = value / 1024 ** index;
    return `${size >= 100 || index === 0 ? size.toFixed(0) : size.toFixed(1)} ${units[index]}`;
}

function percentage(value: number): string {
    return `${Math.round(value)}%`;
}

function duration(value: number): string {
    const days = Math.floor(value / 86_400);
    const hours = Math.floor((value % 86_400) / 3_600);
    const minutes = Math.floor((value % 3_600) / 60);
    return [days > 0 ? `${days}日` : '', `${hours}時間`, `${minutes}分`].filter(Boolean).join(' ');
}

function volumeTypeLabel(type: SystemStorageVolumeType): string {
    if (type === 'removable') return 'リムーバブル';
    if (type === 'network') return 'ネットワーク';
    if (type === 'fixed') return '固定ディスク';
    return 'その他';
}

interface UsageCardProps {
    icon: ReactNode;
    title: string;
    subtitle: string;
    value?: number;
    detail?: string;
}

function UsageCard({ icon, title, subtitle, value, detail }: UsageCardProps): ReactNode {
    const normalized = value === undefined ? 0 : Math.min(100, Math.max(0, value));
    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mb: 2 }}>
                    <Box sx={{ display: 'grid', placeItems: 'center', color: 'primary.main' }}>{icon}</Box>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography variant="h6">{title}</Typography>
                        <Typography variant="body2" color="text.secondary" noWrap title={subtitle}>
                            {subtitle}
                        </Typography>
                    </Box>
                </Stack>
                {value === undefined ? (
                    <Typography color="text.secondary" sx={{ py: 1.5 }}>
                        使用率を取得できません
                    </Typography>
                ) : (
                    <>
                        <Stack direction="row" sx={{ alignItems: 'baseline', justifyContent: 'space-between', mb: 0.75 }}>
                            <Typography variant="h4" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                                {percentage(normalized)}
                            </Typography>
                            {detail !== undefined && (
                                <Typography variant="body2" color="text.secondary">
                                    {detail}
                                </Typography>
                            )}
                        </Stack>
                        <LinearProgress variant="determinate" value={normalized} sx={{ height: 10, borderRadius: 1 }} />
                    </>
                )}
            </CardContent>
        </Card>
    );
}

function GpuUsageCard({ gpu }: { gpu: SystemGpuInfo }): ReactNode {
    const detail =
        gpu.memoryTotal !== undefined
            ? gpu.memoryUsed !== undefined
                ? `${fileSize(gpu.memoryUsed)} / ${fileSize(gpu.memoryTotal)} VRAM`
                : `VRAM 合計 ${fileSize(gpu.memoryTotal)}`
            : undefined;
    return <UsageCard icon={<DeveloperBoardOutlined />} title="GPU" subtitle={gpu.name} value={gpu.usagePercent} detail={detail} />;
}

function PrimaryStorageSection({ items }: { items: StorageItem[] }): ReactNode {
    return (
        <Box component="section">
            <Typography variant="h5" sx={{ mb: 1.5 }}>
                プライマリストレージ
            </Typography>
            {items.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 4, textAlign: 'center' }}>
                    録画先ストレージ情報はありません
                </Typography>
            ) : (
                <Stack spacing={2}>
                    {items.map(item => {
                        const rate = item.total > 0 ? Math.min(100, Math.max(0, (item.used / item.total) * 100)) : 0;
                        const breakdownPending = item.breakdownPending === true;
                        const breakdownTotal = item.breakdown.recorded + item.breakdown.dropLogs + item.breakdown.thumbnails + item.breakdown.other;
                        const segmentWidth = (value: number): string => `${breakdownTotal > 0 ? (value / breakdownTotal) * 100 : 0}%`;
                        return (
                            <Card key={item.name} variant="outlined">
                                <CardContent>
                                    <Stack direction="row" sx={{ mb: 1.25, alignItems: 'baseline', justifyContent: 'space-between' }}>
                                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                            <StorageOutlined color="primary" />
                                            <Typography variant="h6">{item.name}</Typography>
                                        </Stack>
                                        <Typography color="text.secondary">合計 {fileSize(item.total)}</Typography>
                                    </Stack>
                                    <LinearProgress variant="determinate" value={rate} sx={{ height: 12, borderRadius: 1 }} />
                                    <Stack direction="row" sx={{ mt: 0.75, justifyContent: 'space-between' }}>
                                        <Typography variant="body2">{fileSize(item.used)} 使用済み</Typography>
                                        <Typography variant="body2" color="text.secondary">
                                            {fileSize(item.available)} 空き（{Math.floor(rate)}% 使用）
                                        </Typography>
                                    </Stack>
                                    <Divider sx={{ my: 2 }} />
                                    <Stack direction="row" spacing={1} sx={{ mb: 1, alignItems: 'center' }}>
                                        <Typography variant="subtitle2">使用済み容量の内訳</Typography>
                                        {breakdownPending && (
                                            <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                                                <Typography variant="caption" color="text.secondary">
                                                    更新中
                                                </Typography>
                                                <CircularProgress size={12} thickness={5} />
                                            </Stack>
                                        )}
                                    </Stack>
                                    <Box sx={{ display: 'flex', height: 14, overflow: 'hidden', borderRadius: 1, bgcolor: 'action.hover' }}>
                                        <Box sx={{ width: segmentWidth(item.breakdown.recorded), bgcolor: 'primary.main' }} />
                                        <Box sx={{ width: segmentWidth(item.breakdown.dropLogs), bgcolor: 'warning.main' }} />
                                        <Box sx={{ width: segmentWidth(item.breakdown.thumbnails), bgcolor: 'secondary.main' }} />
                                        <Box sx={{ width: segmentWidth(item.breakdown.other), bgcolor: 'text.disabled' }} />
                                    </Box>
                                    <Grid container spacing={1.5} sx={{ mt: 0.5 }}>
                                        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                            <Typography variant="body2" color="text.secondary">
                                                録画データ
                                            </Typography>
                                            <Typography>{fileSize(item.breakdown.recorded)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                            <Typography variant="body2" color="text.secondary">
                                                ドロップログ
                                            </Typography>
                                            <Typography>{fileSize(item.breakdown.dropLogs)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                            <Typography variant="body2" color="text.secondary">
                                                サムネイル
                                            </Typography>
                                            <Typography>{fileSize(item.breakdown.thumbnails)}</Typography>
                                        </Grid>
                                        <Grid size={{ xs: 12, sm: 6, md: 3 }}>
                                            <Typography variant="body2" color="text.secondary">
                                                その他
                                            </Typography>
                                            <Typography>{fileSize(item.breakdown.other)}</Typography>
                                        </Grid>
                                    </Grid>
                                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                                        録画データはNeoEPGStationが管理する動画ファイル、ドロップログとサムネイルはconfig.ymlの各保存先を集計しています。
                                    </Typography>
                                </CardContent>
                            </Card>
                        );
                    })}
                </Stack>
            )}
        </Box>
    );
}

interface ResourceSectionProps {
    system: SystemResourceInfo;
    gpuItems?: SystemGpuInfo[];
    gpuPending: boolean;
    gpuError: boolean;
}

function ResourceSection({ system, gpuItems, gpuPending, gpuError }: ResourceSectionProps): ReactNode {
    return (
        <Box component="section">
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ mb: 1.5, alignItems: { xs: 'flex-start', sm: 'center' }, justifyContent: 'space-between' }}>
                <Typography variant="h5">リソース</Typography>
                <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                    <Chip size="small" label={system.hostname} />
                    <Chip size="small" variant="outlined" label={`${system.platform} / ${system.arch}`} />
                </Stack>
            </Stack>
            <Grid container spacing={2}>
                <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
                    <UsageCard icon={<MemoryOutlined />} title="CPU" subtitle={`${system.cpu.model}（${system.cpu.logicalCores} 論理コア）`} value={system.cpu.usagePercent} />
                </Grid>
                <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
                    <UsageCard
                        icon={<MemoryOutlined />}
                        title="メモリ"
                        subtitle={`合計 ${fileSize(system.memory.total)}`}
                        value={system.memory.usagePercent}
                        detail={`${fileSize(system.memory.used)} 使用中`}
                    />
                </Grid>
                {gpuPending ? (
                    <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
                        <Card variant="outlined" sx={{ height: '100%', minHeight: 150, display: 'grid', placeItems: 'center' }}>
                            <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                                <CircularProgress size={28} />
                                <Typography variant="body2">GPU情報を取得中</Typography>
                            </Stack>
                        </Card>
                    </Grid>
                ) : gpuError || gpuItems === undefined || gpuItems.length === 0 ? (
                    <Grid size={{ xs: 12, sm: 6, lg: 4 }}>
                        <UsageCard icon={<DeveloperBoardOutlined />} title="GPU" subtitle="GPU情報を取得できません" />
                    </Grid>
                ) : (
                    gpuItems.map((gpu, index) => (
                        <Grid key={`${gpu.name}-${index}`} size={{ xs: 12, sm: 6, lg: 4 }}>
                            <GpuUsageCard gpu={gpu} />
                        </Grid>
                    ))
                )}
            </Grid>
            <Card variant="outlined" sx={{ mt: 2 }}>
                <CardContent>
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={{ xs: 1, sm: 3 }} divider={<Divider flexItem orientation="vertical" />}>
                        <Box>
                            <Typography variant="body2" color="text.secondary">
                                OS稼働時間
                            </Typography>
                            <Typography>{duration(system.uptime)}</Typography>
                        </Box>
                        <Box>
                            <Typography variant="body2" color="text.secondary">
                                NeoEPGStationプロセス
                            </Typography>
                            <Typography>
                                PID {system.process.pid}・{duration(system.process.uptime)}
                            </Typography>
                        </Box>
                        <Box>
                            <Typography variant="body2" color="text.secondary">
                                サーバープロセスのメモリ
                            </Typography>
                            <Typography>{fileSize(system.process.memoryUsed)}</Typography>
                        </Box>
                    </Stack>
                </CardContent>
            </Card>
        </Box>
    );
}

function StorageVolumeCard({ volume }: { volume: SystemStorageVolume }): ReactNode {
    const rate = volume.total > 0 ? Math.min(100, Math.max(0, (volume.used / volume.total) * 100)) : 0;
    return (
        <Card variant="outlined">
            <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center', mb: 1.25 }}>
                    <StorageOutlined color="primary" />
                    <Box sx={{ minWidth: 0, flex: 1 }}>
                        <Typography variant="h6" noWrap title={volume.name}>
                            {volume.name}
                        </Typography>
                        <Typography variant="caption" color="text.secondary">
                            {volume.path}
                        </Typography>
                    </Box>
                    <Chip size="small" variant="outlined" label={volumeTypeLabel(volume.type)} />
                </Stack>
                <LinearProgress variant="determinate" value={rate} sx={{ height: 10, borderRadius: 1 }} />
                <Stack direction="row" sx={{ mt: 0.75, justifyContent: 'space-between' }}>
                    <Typography variant="body2">{fileSize(volume.used)} 使用済み</Typography>
                    <Typography variant="body2" color="text.secondary">
                        {fileSize(volume.available)} 空き / 合計 {fileSize(volume.total)}
                    </Typography>
                </Stack>
            </CardContent>
        </Card>
    );
}

interface OtherStorageSectionProps {
    items?: SystemStorageVolume[];
    pending: boolean;
    error: boolean;
}

function OtherStorageSection({ items, pending, error }: OtherStorageSectionProps): ReactNode {
    return (
        <Box component="section">
            <Typography variant="h5" sx={{ mb: 1.5 }}>
                ストレージ
            </Typography>
            {pending ? (
                <Box sx={{ minHeight: 120, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress size={30} />
                </Box>
            ) : error ? (
                <Typography color="error">接続ストレージ情報を取得できませんでした</Typography>
            ) : items === undefined || items.length === 0 ? (
                <Typography color="text.secondary">録画先以外の接続ストレージはありません。</Typography>
            ) : (
                <Grid container spacing={2}>
                    {items.map(volume => (
                        <Grid key={volume.id} size={{ xs: 12, md: 6 }}>
                            <StorageVolumeCard volume={volume} />
                        </Grid>
                    ))}
                </Grid>
            )}
        </Box>
    );
}

export function StoragesPage(): ReactNode {
    const queryClient = useQueryClient();
    const [displayMode, setDisplayMode] = useState<'resources' | 'mirakurun' | 'logs'>('resources');
    const resourceMode = displayMode === 'resources';
    const mirakurunMode = displayMode === 'mirakurun';
    const storageInfo = useQuery({
        queryKey: ['storages'],
        queryFn: api.getStorages,
        enabled: resourceMode,
        refetchInterval: 5_000,
        refetchIntervalInBackground: false,
    });
    const systemInfo = useQuery({
        queryKey: ['system-resources'],
        queryFn: api.getSystemResources,
        enabled: resourceMode,
        refetchInterval: 5_000,
        refetchIntervalInBackground: false,
    });
    const gpuInfo = useQuery({
        queryKey: ['system-gpus'],
        queryFn: api.getSystemGpus,
        enabled: resourceMode,
        refetchInterval: 5_000,
        refetchIntervalInBackground: false,
    });
    const storageVolumes = useQuery({
        queryKey: ['system-volumes'],
        queryFn: api.getSystemVolumes,
        enabled: resourceMode,
        refetchInterval: 30_000,
        refetchIntervalInBackground: false,
    });

    const refresh = (): void => {
        if (displayMode === 'logs') {
            void queryClient.invalidateQueries({ queryKey: ['system-logs'] });
            return;
        }
        if (mirakurunMode) {
            void queryClient.invalidateQueries({ queryKey: ['system-mirakurun'] });
            return;
        }
        void Promise.all([
            queryClient.invalidateQueries({ queryKey: ['storages'] }),
            queryClient.invalidateQueries({ queryKey: ['system-resources'] }),
            queryClient.invalidateQueries({ queryKey: ['system-gpus'] }),
            queryClient.invalidateQueries({ queryKey: ['system-volumes'] }),
        ]);
    };

    return (
        <>
            <PageHeader
                title="システム"
                actions={
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Tooltip title={mirakurunMode ? 'リソース表示' : 'Mirakurun'}>
                            <Button
                                color="inherit"
                                aria-label={mirakurunMode ? 'リソース表示' : 'Mirakurun'}
                                startIcon={mirakurunMode ? <DashboardOutlined /> : <SettingsInputAntennaOutlined />}
                                onClick={() => setDisplayMode(mirakurunMode ? 'resources' : 'mirakurun')}
                                sx={{
                                    minWidth: { xs: 40, sm: 64 },
                                    px: { xs: 1, sm: 2 },
                                    whiteSpace: 'nowrap',
                                    '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 } },
                                }}
                            >
                                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                                    {mirakurunMode ? 'リソース表示' : 'Mirakurun'}
                                </Box>
                            </Button>
                        </Tooltip>
                        <Tooltip title={displayMode === 'logs' ? 'リソース表示' : 'ログ表示'}>
                            <Button
                                color="inherit"
                                aria-label={displayMode === 'logs' ? 'リソース表示' : 'ログ表示'}
                                startIcon={displayMode === 'logs' ? <DashboardOutlined /> : <ArticleOutlined />}
                                onClick={() => setDisplayMode(displayMode === 'logs' ? 'resources' : 'logs')}
                                sx={{
                                    minWidth: { xs: 40, sm: 64 },
                                    px: { xs: 1, sm: 2 },
                                    whiteSpace: 'nowrap',
                                    '& .MuiButton-startIcon': { mr: { xs: 0, sm: 1 } },
                                }}
                            >
                                <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                                    {displayMode === 'logs' ? 'リソース表示' : 'ログ表示'}
                                </Box>
                            </Button>
                        </Tooltip>
                        <Tooltip title="更新">
                            <IconButton aria-label="更新" onClick={refresh}>
                                <RefreshOutlined />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                }
            />
            <Box sx={{ width: 'min(1180px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                {displayMode === 'logs' ? (
                    <SystemLogsPanel />
                ) : displayMode === 'mirakurun' ? (
                    <SystemMirakurunPanel />
                ) : (
                    <Stack spacing={3}>
                        {storageInfo.isPending ? (
                            <Box sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                                <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                                    <CircularProgress size={30} />
                                    <Typography variant="body2">プライマリストレージ情報を取得中</Typography>
                                </Stack>
                            </Box>
                        ) : storageInfo.isError ? (
                            <Typography color="error">ストレージ情報を取得できませんでした: {storageInfo.error.message}</Typography>
                        ) : (
                            <PrimaryStorageSection items={storageInfo.data.items} />
                        )}
                        {systemInfo.isPending ? (
                            <Box sx={{ minHeight: 180, display: 'grid', placeItems: 'center' }}>
                                <Stack spacing={1} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                                    <CircularProgress size={30} />
                                    <Typography variant="body2">システムリソース情報を取得中</Typography>
                                </Stack>
                            </Box>
                        ) : systemInfo.isError ? (
                            <Typography color="error">システムリソース情報を取得できませんでした: {systemInfo.error.message}</Typography>
                        ) : (
                            <ResourceSection system={systemInfo.data} gpuItems={gpuInfo.data?.items} gpuPending={gpuInfo.isPending} gpuError={gpuInfo.isError} />
                        )}
                        <OtherStorageSection items={storageVolumes.data?.items} pending={storageVolumes.isPending} error={storageVolumes.isError} />
                    </Stack>
                )}
            </Box>
        </>
    );
}
