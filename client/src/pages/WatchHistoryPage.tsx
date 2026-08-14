import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import ViewListOutlined from '@mui/icons-material/ViewListOutlined';
import { Alert, Box, Card, CardActionArea, CircularProgress, IconButton, LinearProgress, Stack, Switch, Tooltip, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecordedPlaybackHistoryItem } from '../../../api';
import { type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ProgramThumbnail } from '../components/ProgramThumbnail';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { useActiveUser } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';

function mediaTime(value: number): string {
    const seconds = Math.max(0, Math.floor(value));
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const remainingSeconds = seconds % 60;
    return hours > 0
        ? `${hours}:${minutes.toString(10).padStart(2, '0')}:${remainingSeconds.toString(10).padStart(2, '0')}`
        : `${minutes}:${remainingSeconds.toString(10).padStart(2, '0')}`;
}

function watchedAt(value?: number): string {
    if (value === undefined) return '';
    return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(value));
}

function HistoryItem({
    item,
    channelName,
    deleting,
    locating,
    onOpen,
    onDelete,
    onLocate,
}: {
    item: RecordedPlaybackHistoryItem;
    channelName: string;
    deleting: boolean;
    locating: boolean;
    onOpen: () => void;
    onDelete: () => void;
    onLocate: () => void;
}): ReactNode {
    const { recorded, playback } = item;
    const progress = playback.duration > 0 ? Math.min(100, Math.max(0, (playback.position / playback.duration) * 100)) : 0;
    return (
        <Card variant="outlined" sx={{ position: 'relative' }}>
            <CardActionArea onClick={onOpen} sx={{ display: 'flex', alignItems: 'stretch', textAlign: 'left' }}>
                <ProgramThumbnail
                    thumbnailId={recorded.thumbnails?.[0]}
                    sx={{ width: { xs: 132, sm: 220 }, alignSelf: 'stretch', borderRadius: 0, minHeight: { xs: 96, sm: 124 } }}
                />
                <Box sx={{ flex: 1, minWidth: 0, p: { xs: 1.25, sm: 2 }, pr: { xs: 10, sm: 11 } }}>
                    <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
                        {recorded.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary" noWrap>
                        {channelName}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.25 }}>
                        最終視聴: {watchedAt(playback.updatedAt)}
                    </Typography>
                    <Box sx={{ mt: { xs: 1, sm: 1.5 } }}>
                        <LinearProgress variant="determinate" value={progress} sx={{ height: 7, borderRadius: 999 }} />
                        <Stack direction="row" sx={{ justifyContent: 'space-between', mt: 0.5 }}>
                            <Typography variant="caption">{mediaTime(playback.position)}</Typography>
                            <Typography variant="caption" color="text.secondary">
                                {mediaTime(playback.duration)}・{Math.round(progress)}%
                            </Typography>
                        </Stack>
                    </Box>
                </Box>
            </CardActionArea>
            <Stack direction="row" spacing={0.25} sx={{ position: 'absolute', top: { xs: 5, sm: 10 }, right: { xs: 5, sm: 10 }, zIndex: 1 }}>
                <Tooltip title="録画済み一覧で表示">
                    <IconButton
                        aria-label={`${recorded.name}を録画済み一覧で表示`}
                        disabled={locating}
                        onClick={event => {
                            event.stopPropagation();
                            onLocate();
                        }}
                    >
                        {locating ? <CircularProgress size={20} /> : <ViewListOutlined />}
                    </IconButton>
                </Tooltip>
                <Tooltip title="このユーザーの視聴履歴から削除">
                    <IconButton
                        aria-label={`${recorded.name}を視聴履歴から削除`}
                        disabled={deleting}
                        onClick={event => {
                            event.stopPropagation();
                            onDelete();
                        }}
                    >
                        {deleting ? <CircularProgress size={20} /> : <DeleteOutlineOutlined />}
                    </IconButton>
                </Tooltip>
            </Stack>
        </Card>
    );
}

export function WatchHistoryPage(): ReactNode {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const activeUser = useActiveUser();
    const settings = useSettings();
    const userId = typeof activeUser === 'number' ? activeUser : null;
    const history = useQuery({
        queryKey: ['recorded-playback-history', userId, settings.isHalfWidthDisplayed, settings.watchHistoryLength],
        queryFn: () => api.getRecordedPlaybackHistory(userId!, settings.isHalfWidthDisplayed, settings.watchHistoryLength),
        enabled: userId !== null,
        retry: false,
    });
    const historySettings = useQuery({
        queryKey: ['recorded-playback-history-settings', userId],
        queryFn: () => api.getRecordedPlaybackHistorySettings(userId!),
        enabled: userId !== null,
        retry: false,
    });
    const updateHistorySettings = useMutation({
        mutationFn: (enabled: boolean) => api.updateRecordedPlaybackHistorySettings(userId!, enabled),
        onSuccess: result => {
            queryClient.setQueryData(['recorded-playback-history-settings', userId], result);
            notify(result.enabled ? 'このユーザーの視聴履歴保存を有効にしました' : 'このユーザーの視聴履歴保存を無効にしました', 'success');
        },
        onError: error => notify(`視聴履歴設定を変更できませんでした: ${error.message}`, 'error'),
    });
    const removeHistory = useMutation({
        mutationFn: (recordedId: number) => api.removeRecordedPlaybackHistory(recordedId, userId!),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['recorded-playback-history', userId] });
            notify('視聴履歴から削除しました', 'success');
        },
        onError: error => notify(`視聴履歴から削除できませんでした: ${error.message}`, 'error'),
    });
    const locateRecorded = useMutation({
        mutationFn: (recordedId: number) => api.getRecordedListPosition(recordedId, settings.recordedLength),
        onSuccess: (position, recordedId) => {
            const params = new URLSearchParams({
                page: position.page.toString(10),
                userId: position.userId?.toString(10) ?? 'master',
                focus: recordedId.toString(10),
            });
            void navigate(`/recorded?${params.toString()}`);
        },
        onError: error => notify(`録画済み一覧のページを特定できませんでした: ${error.message}`, 'error'),
    });
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const channelNames = new Map((channels.data ?? []).map(channel => [channel.id, channel.name]));

    return (
        <>
            <PageHeader
                title="視聴履歴"
                actions={
                    <IconButton aria-label="視聴履歴を更新" disabled={userId === null || history.isFetching} onClick={() => void history.refetch()}>
                        <RefreshOutlined />
                    </IconButton>
                }
            />
            <Box sx={{ width: 'min(1040px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                {userId === null ? (
                    <Alert severity="info">視聴履歴を表示するには通常ユーザーへ切り替えてください。masterでは視聴履歴を記録しません。</Alert>
                ) : (
                    <Stack spacing={1.5}>
                        <Card variant="outlined">
                            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', gap: 2, p: { xs: 1.5, sm: 2 } }}>
                                <Box>
                                    <Typography sx={{ fontWeight: 700 }}>視聴履歴を保存</Typography>
                                    <Typography variant="body2" color="text.secondary">
                                        現在のアクティブユーザーだけに適用します。オフにしても既存の履歴とリジューム再生位置は残ります。
                                    </Typography>
                                </Box>
                                <Switch
                                    checked={historySettings.data?.enabled ?? true}
                                    disabled={historySettings.isPending || updateHistorySettings.isPending}
                                    onChange={event => updateHistorySettings.mutate(event.target.checked)}
                                    slotProps={{ input: { 'aria-label': '視聴履歴を保存' } }}
                                />
                            </Stack>
                        </Card>
                        {historySettings.error !== null && <Alert severity="warning">視聴履歴設定を取得できませんでした: {historySettings.error.message}</Alert>}
                        {history.isPending ? (
                            <Box sx={{ minHeight: 280, display: 'grid', placeItems: 'center' }}>
                                <CircularProgress />
                            </Box>
                        ) : history.error !== null ? (
                            <Alert severity="error">視聴履歴を取得できませんでした: {history.error.message}</Alert>
                        ) : history.data.items.length === 0 ? (
                            <Alert severity="info">このユーザーの視聴履歴はありません。</Alert>
                        ) : (
                            <Stack spacing={1.5}>
                                {history.data.items.map(item => (
                                    <HistoryItem
                                        key={item.recorded.id}
                                        item={item}
                                        channelName={channelNames.get(item.recorded.channelId) ?? `チャンネル ${item.recorded.channelId}`}
                                        deleting={removeHistory.isPending && removeHistory.variables === item.recorded.id}
                                        locating={locateRecorded.isPending && locateRecorded.variables === item.recorded.id}
                                        onOpen={() => void navigate(`/recorded/detail/${item.recorded.id}`)}
                                        onDelete={() => removeHistory.mutate(item.recorded.id)}
                                        onLocate={() => locateRecorded.mutate(item.recorded.id)}
                                    />
                                ))}
                            </Stack>
                        )}
                    </Stack>
                )}
            </Box>
        </>
    );
}
