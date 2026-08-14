import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined';
import ErrorOutlineOutlined from '@mui/icons-material/ErrorOutlineOutlined';
import SettingsInputAntennaOutlined from '@mui/icons-material/SettingsInputAntennaOutlined';
import { Alert, Box, Card, CardContent, Chip, CircularProgress, Divider, Grid, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { SystemMirakurunTuner, SystemMirakurunTunerUser } from '../../../api';
import { api } from '../core/api/queries';

function tunerStatus(tuner: SystemMirakurunTuner): { label: string; color: 'default' | 'error' | 'primary' | 'success' | 'warning' } {
    if (tuner.isFault) return { label: '異常', color: 'error' };
    if (!tuner.isAvailable) return { label: '利用不可', color: 'warning' };
    if (tuner.isUsing) return { label: '使用中', color: 'primary' };
    if (tuner.isFree) return { label: '空き', color: 'success' };
    return { label: '待機中', color: 'default' };
}

function channelLabel(user: SystemMirakurunTunerUser): string {
    if (user.channel === undefined) return '選局情報なし';
    return [user.channel.name, `${user.channel.type} ${user.channel.channel}`].filter(Boolean).join('・');
}

function TunerUser({ user }: { user: SystemMirakurunTunerUser }): ReactNode {
    return (
        <Box sx={{ py: 1.25 }}>
            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} sx={{ justifyContent: 'space-between' }}>
                <Box sx={{ minWidth: 0 }}>
                    <Typography variant="subtitle2" noWrap title={user.agent ?? user.id}>
                        {user.agent ?? user.id}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {channelLabel(user)}
                    </Typography>
                </Box>
                <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                    <Chip size="small" variant="outlined" label={`優先度 ${user.priority}`} />
                    {user.serviceId !== undefined && <Chip size="small" variant="outlined" label={`service ${user.serviceId}`} />}
                    {user.eventId !== undefined && <Chip size="small" variant="outlined" label={`event ${user.eventId}`} />}
                </Stack>
            </Stack>
            <Typography variant="caption" color={user.dropCount > 0 ? 'warning.main' : 'text.secondary'} sx={{ display: 'block', mt: 0.75 }}>
                packet {user.packetCount.toLocaleString()}・drop {user.dropCount.toLocaleString()}
            </Typography>
        </Box>
    );
}

function TunerCard({ tuner }: { tuner: SystemMirakurunTuner }): ReactNode {
    const status = tunerStatus(tuner);
    return (
        <Card variant="outlined" sx={{ height: '100%' }}>
            <CardContent>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'center' }}>
                        <SettingsInputAntennaOutlined color={status.color === 'default' ? 'inherit' : status.color} />
                        <Box sx={{ minWidth: 0 }}>
                            <Typography variant="h6" noWrap title={tuner.name}>
                                {tuner.name}
                            </Typography>
                            <Typography variant="caption" color="text.secondary">
                                Tuner #{tuner.index}・PID {tuner.pid > 0 ? tuner.pid : 'なし'}
                            </Typography>
                        </Box>
                    </Stack>
                    <Chip size="small" color={status.color} label={status.label} />
                </Stack>
                <Stack direction="row" spacing={0.75} sx={{ mt: 1.5, flexWrap: 'wrap' }}>
                    {tuner.types.map(type => (
                        <Chip key={type} size="small" variant="outlined" label={type} />
                    ))}
                    {tuner.isRemote && <Chip size="small" variant="outlined" label="リモート" />}
                </Stack>
                <Divider sx={{ my: 1.5 }} />
                {tuner.users.length === 0 ? (
                    <Typography variant="body2" color="text.secondary" sx={{ py: 1 }}>
                        このチューナーを使用しているストリームはありません。
                    </Typography>
                ) : (
                    <Stack divider={<Divider flexItem />}>
                        {tuner.users.map(user => (
                            <TunerUser key={user.id} user={user} />
                        ))}
                    </Stack>
                )}
            </CardContent>
        </Card>
    );
}

export function SystemMirakurunPanel(): ReactNode {
    const status = useQuery({
        queryKey: ['system-mirakurun'],
        queryFn: api.getSystemMirakurun,
        refetchInterval: 3_000,
        refetchIntervalInBackground: false,
    });

    if (status.isPending) {
        return (
            <Box sx={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
                <Stack spacing={1.25} sx={{ alignItems: 'center', color: 'text.secondary' }}>
                    <CircularProgress />
                    <Typography>Mirakurunへ接続しています</Typography>
                </Stack>
            </Box>
        );
    }
    if (status.isError) return <Alert severity="error">Mirakurun状態を取得できませんでした: {status.error.message}</Alert>;

    const info = status.data;
    if (!info.connected) {
        return (
            <Stack spacing={2}>
                <Alert severity="error" icon={<ErrorOutlineOutlined />}>
                    <Typography variant="subtitle1">Mirakurunへ接続できません</Typography>
                    {info.error !== undefined && <Typography variant="body2">{info.error}</Typography>}
                </Alert>
                <Typography variant="body2" color="text.secondary">
                    最終確認: {new Date(info.sampledAt).toLocaleString()}（{info.responseTimeMs.toLocaleString()} ms）
                </Typography>
            </Stack>
        );
    }

    const usingTuners = info.tuners.filter(tuner => tuner.isUsing).length;
    const faultTuners = info.tuners.filter(tuner => tuner.isFault).length;
    const errorTotal = info.errorCount === undefined ? 0 : Object.values(info.errorCount).reduce((sum, count) => sum + count, 0);
    return (
        <Stack spacing={3}>
            <Card variant="outlined">
                <CardContent>
                    <Stack direction={{ xs: 'column', md: 'row' }} spacing={2} sx={{ justifyContent: 'space-between' }}>
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                            <CheckCircleOutlineOutlined color="success" />
                            <Box>
                                <Typography variant="h5">Mirakurun 接続中</Typography>
                                <Typography variant="body2" color="text.secondary">
                                    v{info.version ?? '不明'}・応答 {info.responseTimeMs.toLocaleString()} ms・最終確認 {new Date(info.sampledAt).toLocaleTimeString()}
                                </Typography>
                            </Box>
                        </Stack>
                        <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                            <Chip color="success" label={`チューナー ${info.tuners.length}`} />
                            <Chip color={usingTuners > 0 ? 'primary' : 'default'} label={`使用中 ${usingTuners}`} />
                            {faultTuners > 0 && <Chip color="error" label={`異常 ${faultTuners}`} />}
                        </Stack>
                    </Stack>
                    <Divider sx={{ my: 2 }} />
                    <Grid container spacing={2}>
                        <Grid size={{ xs: 6, md: 3 }}>
                            <Typography variant="body2" color="text.secondary">
                                保存番組数
                            </Typography>
                            <Typography variant="h6">{info.epg?.storedEvents.toLocaleString() ?? '-'}</Typography>
                        </Grid>
                        <Grid size={{ xs: 6, md: 3 }}>
                            <Typography variant="body2" color="text.secondary">
                                EPG取得中
                            </Typography>
                            <Typography variant="h6">{info.epg?.gatheringNetworks.length ?? 0} ネットワーク</Typography>
                        </Grid>
                        <Grid size={{ xs: 6, md: 3 }}>
                            <Typography variant="body2" color="text.secondary">
                                ストリーム
                            </Typography>
                            <Typography variant="h6">{info.streamCount?.tunerDevice ?? 0}</Typography>
                        </Grid>
                        <Grid size={{ xs: 6, md: 3 }}>
                            <Typography variant="body2" color="text.secondary">
                                累積エラー
                            </Typography>
                            <Typography variant="h6" color={errorTotal > 0 ? 'warning.main' : 'text.primary'}>
                                {errorTotal.toLocaleString()}
                            </Typography>
                        </Grid>
                    </Grid>
                </CardContent>
            </Card>

            <Box component="section">
                <Typography variant="h5" sx={{ mb: 1.5 }}>
                    チューナー
                </Typography>
                {info.tuners.length === 0 ? (
                    <Alert severity="info">Mirakurunにチューナーが登録されていません。</Alert>
                ) : (
                    <Grid container spacing={2}>
                        {info.tuners.map(tuner => (
                            <Grid key={tuner.index} size={{ xs: 12, lg: 6 }}>
                                <TunerCard tuner={tuner} />
                            </Grid>
                        ))}
                    </Grid>
                )}
            </Box>
        </Stack>
    );
}
