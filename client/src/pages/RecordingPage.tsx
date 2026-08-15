import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import StopCircleOutlined from '@mui/icons-material/StopCircleOutlined';
import {
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    IconButton,
    Stack,
    SvgIcon,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelItem, RecordedId, RecordedItem, VideoFileId } from '../../../api';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ProgramThumbnail } from '../components/ProgramThumbnail';
import { RecordedItemActions } from '../components/RecordedItemActions';
import { VueCompatiblePagination } from '../components/VueCompatiblePagination';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { formatProgramDate, formatProgramTime, programDuration } from '../core/program';
import { useSettings } from '../core/storage/settings';

function BookEditOutlineIcon(): ReactNode {
    return (
        <SvgIcon>
            <path d="M6 20H11V22H6C4.89 22 4 21.11 4 20V4C4 2.9 4.89 2 6 2H18C19.11 2 20 2.9 20 4V10.3C19.78 10.42 19.57 10.56 19.39 10.74L18 12.13V4H13V12L10.5 9.75L8 12V4H6V20M22.85 13.47L21.53 12.15C21.33 11.95 21 11.95 20.81 12.15L19.83 13.13L21.87 15.17L22.85 14.19C23.05 14 23.05 13.67 22.85 13.47M13 19.96V22H15.04L21.17 15.88L19.13 13.83L13 19.96Z" />
        </SvgIcon>
    );
}

function RecordingCard({
    item,
    channel,
    editing,
    selected,
    onSelect,
    onOpen,
    onSearch,
    onStop,
    onChanged,
    onDeleted,
}: {
    item: RecordedItem;
    channel?: ChannelItem;
    editing: boolean;
    selected: boolean;
    onSelect: () => void;
    onOpen: () => void;
    onSearch: () => void;
    onStop: () => void;
    onChanged: () => void;
    onDeleted: () => void;
}): ReactNode {
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const drop = item.dropLogFile;
    const hasDropError = drop !== undefined && (drop.dropCnt > 0 || drop.errorCnt > 0 || drop.scramblingCnt > 0);
    return (
        <Card variant="outlined" sx={{ borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'action.selected' : undefined }}>
            <CardContent
                role="button"
                tabIndex={0}
                onClick={editing ? onSelect : onOpen}
                onKeyDown={event => {
                    if (event.key !== 'Enter' && event.key !== ' ') return;
                    event.preventDefault();
                    (editing ? onSelect : onOpen)();
                }}
                sx={{
                    position: 'relative',
                    display: 'flex',
                    gap: { xs: 1.25, sm: 1.5 },
                    p: { xs: 1.25, sm: 1.5 },
                    cursor: 'pointer',
                    transition: theme => theme.transitions.create('background-color'),
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:last-child': { pb: { xs: 1.25, sm: 1.5 } },
                }}
            >
                {editing && <Checkbox checked={selected} onChange={onSelect} onClick={event => event.stopPropagation()} />}
                <ProgramThumbnail
                    thumbnailId={item.thumbnails?.[0]}
                    channel={channel}
                    sx={{ width: { xs: 120, sm: 180 }, height: { xs: 67.5, sm: 101.25 }, alignSelf: 'center' }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }} title={item.name}>
                        {item.name}
                    </Typography>
                    <Typography variant="body2" color="text.secondary">
                        {channel?.name ?? item.channelId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {formatProgramDate(item.startAt)} - {formatProgramTime(item.endAt)}（{programDuration(item)}分）
                    </Typography>
                    {drop !== undefined && (
                        <Typography variant="body2" color={hasDropError ? 'error' : 'text.secondary'} sx={{ mt: 0.5 }}>
                            drop: {drop.dropCnt} / error: {drop.errorCnt} / scrambling: {drop.scramblingCnt}
                        </Typography>
                    )}
                    {item.description !== undefined && (
                        <Typography variant="body2" sx={{ mt: 0.75, pr: { xs: 12, sm: 7 } }} noWrap title={item.description}>
                            {item.description}
                        </Typography>
                    )}
                </Box>
                <Stack
                    direction={{ xs: 'row', sm: 'column' }}
                    spacing={{ xs: 0.25, sm: 0.1 }}
                    sx={{
                        position: 'absolute',
                        // Match the original desktop card placement: the status sits beside the
                        // title block, with the action button immediately below it.
                        top: { xs: 'auto', sm: '16px' },
                        right: { xs: 0.75, sm: 8 },
                        bottom: { xs: 0.75, sm: 'auto' },
                        alignItems: 'center',
                        transform: 'none',
                    }}
                >
                    <Chip size="small" color="error" label="録画中" />
                    {!editing && (
                        <Tooltip title="録画操作">
                            <IconButton
                                size="small"
                                aria-label={`${item.name}の操作メニュー`}
                                aria-haspopup="menu"
                                onClick={event => {
                                    event.stopPropagation();
                                    setMenuAnchor(event.currentTarget);
                                }}
                                onKeyDown={event => event.stopPropagation()}
                            >
                                <BookEditOutlineIcon />
                            </IconButton>
                        </Tooltip>
                    )}
                </Stack>
            </CardContent>
            <RecordedItemActions
                item={item}
                anchorEl={menuAnchor}
                onClose={() => setMenuAnchor(null)}
                onSearch={onSearch}
                onEncode={() => undefined}
                onStop={onStop}
                onChanged={onChanged}
                onDeleted={onDeleted}
            />
        </Card>
    );
}

export function RecordingPage(): ReactNode {
    const settings = useSettings();
    const navigate = useNavigate();
    const [params, setParams] = useSearchParams();
    const page = Math.max(1, Number(params.get('page')) || 1);
    const [editing, setEditing] = useState(false);
    const [selected, setSelected] = useState<Set<RecordedId>>(new Set());
    const [confirmOpen, setConfirmOpen] = useState(false);
    const [stopTargets, setStopTargets] = useState<RecordedItem[]>([]);
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const recording = useQuery({
        queryKey: ['recording', page, settings.isHalfWidthDisplayed, settings.recordingLength],
        queryFn: () =>
            api.getRecording({
                isHalfWidth: settings.isHalfWidthDisplayed,
                offset: (page - 1) * settings.recordingLength,
                limit: settings.recordingLength,
            }),
    });
    const pageCount = Math.max(1, Math.ceil((recording.data?.total ?? 0) / settings.recordingLength));
    const selectedVideoIds = useMemo(() => {
        const ids: VideoFileId[] = [];
        recording.data?.records.forEach(item => {
            if (selected.has(item.id)) item.videoFiles?.forEach(video => ids.push(video.id));
        });
        return ids;
    }, [recording.data, selected]);

    useEffect(() => {
        setEditing(false);
        setSelected(new Set());
    }, [page]);
    useEffect(() => {
        if (recording.isSuccess && page > pageCount) setParams(pageCount === 1 ? {} : { page: String(pageCount) }, { replace: true });
    }, [page, pageCount, recording.isSuccess, setParams]);

    const remove = useMutation({
        mutationFn: async () => {
            const items = recording.data?.records.filter(item => selected.has(item.id)) ?? [];
            const results = await Promise.allSettled(
                items.map(async item => {
                    if ((item.videoFiles?.length ?? 0) === 0) throw new Error('削除できる録画ファイルがありません');
                    for (const video of item.videoFiles ?? []) await api.deleteVideo(video.id);
                }),
            );
            return {
                succeeded: items.filter((_item, index) => results[index].status === 'fulfilled').map(item => item.id),
                failed: items
                    .map((item, index) => ({ item, result: results[index] }))
                    .filter((entry): entry is { item: RecordedItem; result: PromiseRejectedResult } => entry.result.status === 'rejected'),
            };
        },
        onSuccess: async result => {
            setConfirmOpen(false);
            setSelected(new Set(result.failed.map(entry => entry.item.id)));
            setEditing(result.failed.length > 0);
            if (result.succeeded.length > 0) notify(`${result.succeeded.length}件の録画を削除しました`, 'success');
            if (result.failed.length > 0) {
                const detail = result.failed
                    .slice(0, 3)
                    .map(entry => `${entry.item.name}: ${entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason)}`)
                    .join(' / ');
                notify(`${result.failed.length}件を削除できませんでした: ${detail}`, 'error');
            }
            await queryClient.invalidateQueries({ queryKey: ['recording'] });
        },
        onError: async error => {
            notify(`録画の削除に失敗しました: ${error.message}`, 'error');
            await queryClient.invalidateQueries({ queryKey: ['recording'] });
        },
    });
    const stop = useMutation({
        mutationFn: async (ids: RecordedId[]) => {
            const results = await Promise.allSettled(ids.map(id => api.stopRecording(id)));
            return {
                succeeded: ids.filter((_id, index) => results[index].status === 'fulfilled'),
                failed: ids
                    .map((id, index) => ({ id, result: results[index] }))
                    .filter((entry): entry is { id: RecordedId; result: PromiseRejectedResult } => entry.result.status === 'rejected'),
            };
        },
        onSuccess: async result => {
            setStopTargets([]);
            setSelected(new Set(result.failed.map(entry => entry.id)));
            setEditing(result.failed.length > 0);
            if (result.succeeded.length > 0) notify(`${result.succeeded.length}件の録画を停止しました。録画済みの部分は保存されます`, 'success');
            if (result.failed.length > 0) {
                const detail = result.failed
                    .slice(0, 3)
                    .map(entry => `ID ${entry.id}: ${entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason)}`)
                    .join(' / ');
                notify(`${result.failed.length}件を停止できませんでした: ${detail}`, 'error');
            }
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['recording'] }),
                queryClient.invalidateQueries({ queryKey: ['recorded'] }),
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
            ]);
        },
        onError: async error => {
            notify(`録画の停止に失敗しました: ${error.message}`, 'error');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['recording'] }),
                queryClient.invalidateQueries({ queryKey: ['recorded'] }),
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
            ]);
        },
    });
    const toggle = (id: RecordedId): void =>
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const selectAll = (): void => {
        const items = recording.data?.records ?? [];
        setSelected(current => (current.size === items.length ? new Set() : new Set(items.map(item => item.id))));
    };

    return (
        <>
            <PageHeader
                title={editing ? `${selected.size}件選択` : '録画中'}
                actions={
                    <Stack direction="row" spacing={0.5}>
                        {editing ? (
                            <>
                                <Button onClick={selectAll}>すべて選択</Button>
                                <Button
                                    color="warning"
                                    startIcon={<StopCircleOutlined />}
                                    disabled={selected.size === 0}
                                    onClick={() => setStopTargets(recording.data?.records.filter(item => selected.has(item.id)) ?? [])}
                                >
                                    録画停止
                                </Button>
                                <Button
                                    color="error"
                                    startIcon={<DeleteOutlineOutlined />}
                                    disabled={selected.size === 0 || selectedVideoIds.length === 0}
                                    onClick={() => setConfirmOpen(true)}
                                >
                                    削除
                                </Button>
                                <Button
                                    onClick={() => {
                                        setEditing(false);
                                        setSelected(new Set());
                                    }}
                                >
                                    終了
                                </Button>
                            </>
                        ) : (
                            <IconButton aria-label="選択" onClick={() => setEditing(true)}>
                                <EditOutlined />
                            </IconButton>
                        )}
                        <IconButton aria-label="更新" onClick={() => void queryClient.invalidateQueries({ queryKey: ['recording'] })}>
                            <RefreshOutlined />
                        </IconButton>
                    </Stack>
                }
            />
            <Box sx={{ width: 'min(1050px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                {recording.isPending || channels.isPending ? (
                    <Box sx={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : recording.isError || channels.isError ? (
                    <Typography color="error">録画中情報を取得できませんでした</Typography>
                ) : recording.data.records.length === 0 ? (
                    <Typography color="text.secondary" sx={{ py: 7, textAlign: 'center' }}>
                        録画中の番組はありません
                    </Typography>
                ) : (
                    <Stack spacing={1.25}>
                        {recording.data.records.map(item => (
                            <RecordingCard
                                key={item.id}
                                item={item}
                                channel={channels.data.find(channel => channel.id === item.channelId)}
                                editing={editing}
                                selected={selected.has(item.id)}
                                onSelect={() => toggle(item.id)}
                                onOpen={() => navigate(`/recorded/detail/${item.id}`)}
                                onSearch={() => navigate(`/recorded?keyword=${encodeURIComponent(item.name)}`)}
                                onStop={() => setStopTargets([item])}
                                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['recording'] })}
                                onDeleted={() => void queryClient.invalidateQueries({ queryKey: ['recording'] })}
                            />
                        ))}
                        {pageCount > 1 && (
                            <VueCompatiblePagination
                                count={pageCount}
                                page={page}
                                onChange={(_event, value) => setParams(value === 1 ? {} : { page: String(value) })}
                                sx={{ alignSelf: 'center', pt: 2 }}
                            />
                        )}
                    </Stack>
                )}
            </Box>
            <Dialog open={confirmOpen} onClose={() => setConfirmOpen(false)}>
                <DialogTitle>録画中のファイルを削除しますか？</DialogTitle>
                <DialogContent>
                    <Typography>{selected.size}件の録画ファイルを削除します。録画処理にも影響します。</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setConfirmOpen(false)}>キャンセル</Button>
                    <Button color="error" variant="contained" disabled={remove.isPending} onClick={() => remove.mutate()}>
                        削除
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog open={stopTargets.length > 0} onClose={() => setStopTargets([])}>
                <DialogTitle>録画を停止しますか？</DialogTitle>
                <DialogContent>
                    <Typography>
                        {stopTargets.length === 1 ? `「${stopTargets[0].name}」` : `${stopTargets.length}件`}
                        の録画を停止します。停止するまでに録画されたファイルは録画済みに残ります。予約も取り消されます。
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setStopTargets([])}>キャンセル</Button>
                    <Button color="warning" variant="contained" disabled={stop.isPending} onClick={() => stop.mutate(stopTargets.map(item => item.id))}>
                        録画停止
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
