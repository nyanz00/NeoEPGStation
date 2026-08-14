import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import CancelOutlined from '@mui/icons-material/CancelOutlined';
import DragIndicatorOutlined from '@mui/icons-material/DragIndicatorOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SwapVertOutlined from '@mui/icons-material/SwapVertOutlined';
import {
    Alert,
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
    LinearProgress,
    Stack,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelItem, EncodeId, EncodeProgramItem } from '../../../api';
import { type DragEvent, type ReactNode, useEffect, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ProgramThumbnail } from '../components/ProgramThumbnail';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { formatProgramDate, formatProgramTime, programDuration } from '../core/program';
import { useSettings } from '../core/storage/settings';

function EncodeCard({
    item,
    waiting,
    editing,
    reordering,
    position,
    selected,
    channel,
    onSelect,
    onCancel,
    onMoveUp,
    onMoveDown,
    onDragStart,
    onDragOver,
    onDrop,
}: {
    item: EncodeProgramItem;
    waiting: boolean;
    editing: boolean;
    reordering: boolean;
    position?: number;
    selected: boolean;
    channel?: ChannelItem;
    onSelect: () => void;
    onCancel: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onDragStart?: (event: DragEvent<HTMLElement>) => void;
    onDragOver?: (event: DragEvent<HTMLElement>) => void;
    onDrop?: (event: DragEvent<HTMLElement>) => void;
}): ReactNode {
    const percent = Math.min(100, Math.max(0, (item.percent ?? 0) * 100));
    return (
        <Card
            variant="outlined"
            onDragOver={onDragOver}
            onDrop={onDrop}
            sx={{ borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'action.selected' : undefined }}
        >
            <CardContent sx={{ display: 'flex', gap: 1.5, p: 1.5, '&:last-child': { pb: 1.5 } }} onClick={editing ? onSelect : undefined}>
                {editing && <Checkbox checked={selected} onChange={onSelect} onClick={event => event.stopPropagation()} />}
                {reordering && waiting && (
                    <Box
                        draggable
                        aria-label={`${item.recorded.name}をドラッグして並べ替え`}
                        onDragStart={onDragStart}
                        sx={{
                            display: { xs: 'none', sm: 'grid' },
                            alignSelf: 'stretch',
                            placeItems: 'center',
                            color: 'text.secondary',
                            cursor: 'grab',
                            '&:active': { cursor: 'grabbing' },
                        }}
                    >
                        <DragIndicatorOutlined />
                    </Box>
                )}
                <ProgramThumbnail
                    thumbnailId={item.recorded.thumbnails?.[0]}
                    channel={channel}
                    sx={{ width: { xs: 120, sm: 200 }, height: { xs: 67.5, sm: 112.5 }, aspectRatio: '16 / 9', alignSelf: 'center' }}
                />
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }}>
                            {item.recorded.name}
                        </Typography>
                        <Chip size="small" color={waiting ? 'default' : 'primary'} label={waiting ? (position === undefined ? '待機中' : `待機 ${position}`) : item.mode} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                        {channel?.name ?? item.recorded.channelId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {formatProgramDate(item.recorded.startAt)} - {formatProgramTime(item.recorded.endAt)}（{programDuration(item.recorded)}分）
                    </Typography>
                    {!waiting && (
                        <Box sx={{ mt: 1 }}>
                            <Stack direction="row" sx={{ mb: 0.35, justifyContent: 'space-between' }}>
                                <Typography variant="body2">{item.mode}</Typography>
                                <Typography variant="body2">{Math.floor(percent)}%</Typography>
                            </Stack>
                            <LinearProgress variant={item.percent === undefined ? 'indeterminate' : 'determinate'} value={percent} sx={{ height: 8, borderRadius: 1 }} />
                            {item.log !== undefined && (
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.75 }} noWrap title={item.log}>
                                    {item.log}
                                </Typography>
                            )}
                        </Box>
                    )}
                </Box>
                {reordering && waiting ? (
                    <Stack spacing={0.25} sx={{ alignSelf: 'center' }}>
                        <IconButton size="small" aria-label={`${item.recorded.name}を一つ上へ移動`} disabled={onMoveUp === undefined} onClick={onMoveUp}>
                            <ArrowUpwardOutlined />
                        </IconButton>
                        <IconButton size="small" aria-label={`${item.recorded.name}を一つ下へ移動`} disabled={onMoveDown === undefined} onClick={onMoveDown}>
                            <ArrowDownwardOutlined />
                        </IconButton>
                    </Stack>
                ) : (
                    !editing && (
                        <IconButton
                            aria-label="エンコードをキャンセル"
                            color="error"
                            onClick={event => {
                                event.stopPropagation();
                                onCancel();
                            }}
                        >
                            <CancelOutlined />
                        </IconButton>
                    )
                )}
            </CardContent>
        </Card>
    );
}

export function EncodePage(): ReactNode {
    const settings = useSettings();
    const [editing, setEditing] = useState(false);
    const [reordering, setReordering] = useState(false);
    const [orderedWaitItems, setOrderedWaitItems] = useState<EncodeProgramItem[]>([]);
    const [reorderBaseIds, setReorderBaseIds] = useState<EncodeId[]>([]);
    const [draggedId, setDraggedId] = useState<EncodeId | null>(null);
    const [selected, setSelected] = useState<Set<EncodeId>>(new Set());
    const [targets, setTargets] = useState<EncodeId[]>([]);
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const encodes = useQuery({ queryKey: ['encode', settings.isHalfWidthDisplayed], queryFn: () => api.getEncodes(settings.isHalfWidthDisplayed) });
    const allItems = [...(encodes.data?.runningItems ?? []), ...(encodes.data?.waitItems ?? [])];

    useEffect(() => {
        if (!reordering && encodes.data !== undefined) {
            setOrderedWaitItems(encodes.data.waitItems);
        }
    }, [encodes.data, reordering]);

    const cancel = useMutation({
        mutationFn: async (ids: EncodeId[]) => {
            const results = await Promise.allSettled(ids.map(id => api.cancelEncode(id)));
            return {
                succeeded: ids.filter((_id, index) => results[index].status === 'fulfilled'),
                failed: ids
                    .map((id, index) => ({ id, result: results[index] }))
                    .filter((entry): entry is { id: EncodeId; result: PromiseRejectedResult } => entry.result.status === 'rejected'),
            };
        },
        onSuccess: async result => {
            setTargets([]);
            setSelected(new Set(result.failed.map(entry => entry.id)));
            setEditing(result.failed.length > 0);
            if (result.succeeded.length > 0) notify(`${result.succeeded.length}件のエンコードをキャンセルしました`, 'success');
            if (result.failed.length > 0) {
                const detail = result.failed
                    .slice(0, 3)
                    .map(entry => `ID ${entry.id}: ${entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason)}`)
                    .join(' / ');
                notify(`${result.failed.length}件をキャンセルできませんでした: ${detail}`, 'error');
            }
            await queryClient.invalidateQueries({ queryKey: ['encode'] });
        },
        onError: async error => {
            notify(`エンコードのキャンセルに失敗しました: ${error.message}`, 'error');
            await queryClient.invalidateQueries({ queryKey: ['encode'] });
        },
    });
    const reorder = useMutation({
        mutationFn: (ids: EncodeId[]) => api.reorderEncodes(ids, reorderBaseIds),
        onSuccess: async () => {
            notify('待機中エンコードの順番を変更しました', 'success');
            setReordering(false);
            setDraggedId(null);
            await queryClient.invalidateQueries({ queryKey: ['encode'] });
        },
        onError: async error => {
            notify(
                error.message === 'EncodeQueueChangedError'
                    ? '編集中にエンコードキューが更新されました。最新の順番を読み込み直しました。'
                    : `エンコードの並べ替えに失敗しました: ${error.message}`,
                'error',
            );
            setReordering(false);
            setDraggedId(null);
            await queryClient.invalidateQueries({ queryKey: ['encode'] });
        },
    });
    const toggle = (id: EncodeId): void =>
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const selectAll = (): void => setSelected(current => (current.size === allItems.length ? new Set() : new Set(allItems.map(item => item.id))));
    const moveWaitingItem = (encodeId: EncodeId, destinationIndex: number): void => {
        setOrderedWaitItems(current => {
            const sourceIndex = current.findIndex(item => item.id === encodeId);
            if (sourceIndex === -1 || destinationIndex < 0 || destinationIndex >= current.length || sourceIndex === destinationIndex) return current;
            const next = [...current];
            const [item] = next.splice(sourceIndex, 1);
            next.splice(destinationIndex, 0, item);
            return next;
        });
    };
    const beginReordering = (): void => {
        const items = encodes.data?.waitItems ?? [];
        setOrderedWaitItems(items);
        setReorderBaseIds(items.map(item => item.id));
        setReordering(true);
    };
    const cancelReordering = (): void => {
        setReordering(false);
        setDraggedId(null);
        setOrderedWaitItems(encodes.data?.waitItems ?? []);
    };
    const currentWaitIds = encodes.data?.waitItems.map(item => item.id) ?? [];
    const queueChangedWhileReordering = reordering && (currentWaitIds.length !== reorderBaseIds.length || currentWaitIds.some((id, index) => id !== reorderBaseIds[index]));
    const orderChanged = orderedWaitItems.length === reorderBaseIds.length && orderedWaitItems.some((item, index) => item.id !== reorderBaseIds[index]);
    const renderItems = (items: EncodeProgramItem[], waiting: boolean): ReactNode => (
        <Stack spacing={1.25}>
            {items.map((item, index) => (
                <EncodeCard
                    key={item.id}
                    item={item}
                    waiting={waiting}
                    editing={editing}
                    reordering={reordering}
                    position={reordering && waiting ? index + 1 : undefined}
                    selected={selected.has(item.id)}
                    channel={channels.data?.find(channel => channel.id === item.recorded.channelId)}
                    onSelect={() => toggle(item.id)}
                    onCancel={() => setTargets([item.id])}
                    onMoveUp={reordering && waiting && index > 0 ? () => moveWaitingItem(item.id, index - 1) : undefined}
                    onMoveDown={reordering && waiting && index < items.length - 1 ? () => moveWaitingItem(item.id, index + 1) : undefined}
                    onDragStart={
                        reordering && waiting
                            ? event => {
                                  setDraggedId(item.id);
                                  event.dataTransfer.effectAllowed = 'move';
                                  event.dataTransfer.setData('text/plain', item.id.toString(10));
                              }
                            : undefined
                    }
                    onDragOver={
                        reordering && waiting
                            ? event => {
                                  event.preventDefault();
                                  event.dataTransfer.dropEffect = 'move';
                              }
                            : undefined
                    }
                    onDrop={
                        reordering && waiting
                            ? event => {
                                  event.preventDefault();
                                  if (draggedId !== null) moveWaitingItem(draggedId, index);
                                  setDraggedId(null);
                              }
                            : undefined
                    }
                />
            ))}
        </Stack>
    );

    return (
        <>
            <PageHeader
                title={editing ? `${selected.size}件選択` : 'エンコード'}
                actions={
                    <Stack direction="row" spacing={0.5}>
                        {reordering ? (
                            <>
                                <Button
                                    variant="contained"
                                    disabled={reorder.isPending || !orderChanged || queueChangedWhileReordering}
                                    onClick={() => reorder.mutate(orderedWaitItems.map(item => item.id))}
                                >
                                    順番を保存
                                </Button>
                                <Button disabled={reorder.isPending} onClick={cancelReordering}>
                                    キャンセル
                                </Button>
                            </>
                        ) : editing ? (
                            <>
                                <Button onClick={selectAll}>すべて選択</Button>
                                <Button color="error" startIcon={<CancelOutlined />} disabled={selected.size === 0} onClick={() => setTargets([...selected])}>
                                    キャンセル
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
                            <>
                                <Button
                                    startIcon={<SwapVertOutlined />}
                                    disabled={(encodes.data?.waitItems.length ?? 0) < 2}
                                    onClick={beginReordering}
                                    sx={{ whiteSpace: 'nowrap' }}
                                >
                                    並べ替え
                                </Button>
                                <IconButton aria-label="選択" disabled={allItems.length === 0} onClick={() => setEditing(true)}>
                                    <EditOutlined />
                                </IconButton>
                            </>
                        )}
                        <IconButton aria-label="更新" onClick={() => void queryClient.invalidateQueries({ queryKey: ['encode'] })}>
                            <RefreshOutlined />
                        </IconButton>
                    </Stack>
                }
            />
            <Box sx={{ width: 'min(900px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                {encodes.isPending || channels.isPending ? (
                    <Box sx={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : encodes.isError || channels.isError ? (
                    <Typography color="error">エンコード情報を取得できませんでした</Typography>
                ) : allItems.length === 0 ? (
                    <Typography color="text.secondary" sx={{ py: 7, textAlign: 'center' }}>
                        実行中または待機中のエンコードはありません
                    </Typography>
                ) : (
                    <Stack spacing={3}>
                        {queueChangedWhileReordering && <Alert severity="warning">編集中に待機キューが更新されました。キャンセルして最新の順番からやり直してください。</Alert>}
                        {encodes.data.runningItems.length > 0 && (
                            <Box>
                                <Typography variant="h6" sx={{ mb: 1 }}>
                                    エンコード中
                                </Typography>
                                {renderItems(encodes.data.runningItems, false)}
                            </Box>
                        )}
                        {encodes.data.waitItems.length > 0 && (
                            <Box>
                                <Typography variant="h6" sx={{ mb: 1 }}>
                                    待機中
                                </Typography>
                                {renderItems(reordering ? orderedWaitItems : encodes.data.waitItems, true)}
                            </Box>
                        )}
                    </Stack>
                )}
            </Box>
            <Dialog open={targets.length > 0} onClose={() => setTargets([])}>
                <DialogTitle>エンコードをキャンセルしますか？</DialogTitle>
                <DialogContent>
                    <Typography>{targets.length}件のエンコードをキャンセルします。</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTargets([])}>閉じる</Button>
                    <Button color="error" variant="contained" disabled={cancel.isPending} onClick={() => cancel.mutate(targets)}>
                        キャンセル実行
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
