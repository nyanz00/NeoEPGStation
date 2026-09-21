import ArrowDownwardOutlined from '@mui/icons-material/ArrowDownwardOutlined';
import ArrowUpwardOutlined from '@mui/icons-material/ArrowUpwardOutlined';
import CancelOutlined from '@mui/icons-material/CancelOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DragIndicatorOutlined from '@mui/icons-material/DragIndicatorOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import SelectAllOutlined from '@mui/icons-material/SelectAllOutlined';
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
    Tooltip,
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
import { EncodeRecoverySection } from './EncodeRecoverySection';

function EncodeCard({
    item,
    waiting,
    editing,
    reordering,
    selected,
    dragged,
    channel,
    onSelect,
    onCancel,
    onMoveUp,
    onMoveDown,
    onDragStart,
    onDragEnd,
    onDragOver,
    onDrop,
}: {
    item: EncodeProgramItem;
    waiting: boolean;
    editing: boolean;
    reordering: boolean;
    selected: boolean;
    dragged: boolean;
    channel?: ChannelItem;
    onSelect: () => void;
    onCancel: () => void;
    onMoveUp?: () => void;
    onMoveDown?: () => void;
    onDragStart?: (event: DragEvent<HTMLElement>) => void;
    onDragEnd?: () => void;
    onDragOver?: (event: DragEvent<HTMLElement>) => void;
    onDrop?: (event: DragEvent<HTMLElement>) => void;
}): ReactNode {
    const percent = Math.min(100, Math.max(0, (item.percent ?? 0) * 100));
    const scheduled = item.scheduledAt !== undefined;
    const reorderable = waiting && !scheduled;
    return (
        <Card
            variant="outlined"
            onDragOver={onDragOver}
            onDrop={onDrop}
            sx={{
                borderColor: selected || dragged ? 'primary.main' : 'divider',
                bgcolor: selected || dragged ? 'action.selected' : undefined,
                opacity: dragged ? 0.72 : 1,
            }}
        >
            <CardContent sx={{ display: 'flex', gap: 1.5, p: 1.5, '&:last-child': { pb: 1.5 } }} onClick={editing ? onSelect : undefined}>
                {editing && <Checkbox checked={selected} onChange={onSelect} onClick={event => event.stopPropagation()} />}
                {reordering && reorderable && (
                    <Box
                        draggable
                        aria-label={`${item.recorded.name}をドラッグして並べ替え`}
                        onDragStart={onDragStart}
                        onDragEnd={onDragEnd}
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
                        <Chip size="small" color={waiting ? 'default' : 'primary'} label={scheduled ? (item.scheduledAtLabel ?? '開始予約') : item.mode} />
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
                {reordering && reorderable ? (
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

function useDragScroll(active: boolean): void {
    useEffect(() => {
        if (!active) return;

        let pointerY: number | null = null;
        let animationFrame = 0;
        let previousTime = performance.now();
        const edgeSize = Math.min(140, Math.max(72, window.innerHeight * 0.12));
        const maximumSpeed = 1_000;
        const handleWheel = (event: WheelEvent): void => {
            if (event.deltaX === 0 && event.deltaY === 0) return;
            event.preventDefault();
            window.scrollBy({ left: event.deltaX, top: event.deltaY, behavior: 'auto' });
        };
        const handleDragOver = (event: globalThis.DragEvent): void => {
            pointerY = event.clientY;
        };
        const scrollAtEdge = (time: number): void => {
            const elapsedSeconds = Math.min(0.05, (time - previousTime) / 1_000);
            previousTime = time;
            let speed = 0;
            if (pointerY !== null && pointerY < edgeSize) {
                speed = -maximumSpeed * (1 - Math.max(0, pointerY) / edgeSize);
            } else if (pointerY !== null && pointerY > window.innerHeight - edgeSize) {
                speed = maximumSpeed * (1 - Math.max(0, window.innerHeight - pointerY) / edgeSize);
            }
            if (speed !== 0) window.scrollBy(0, speed * elapsedSeconds);
            animationFrame = window.requestAnimationFrame(scrollAtEdge);
        };

        window.addEventListener('wheel', handleWheel, { capture: true, passive: false });
        document.addEventListener('dragover', handleDragOver, true);
        animationFrame = window.requestAnimationFrame(scrollAtEdge);
        return () => {
            window.removeEventListener('wheel', handleWheel, true);
            document.removeEventListener('dragover', handleDragOver, true);
            window.cancelAnimationFrame(animationFrame);
        };
    }, [active]);
}

function setCompactDragImage(event: DragEvent<HTMLElement>): void {
    const image = document.createElement('div');
    image.textContent = '↕';
    Object.assign(image.style, {
        position: 'fixed',
        top: '-100px',
        left: '-100px',
        width: '36px',
        height: '36px',
        display: 'grid',
        placeItems: 'center',
        borderRadius: '18px',
        color: '#fff',
        background: 'rgba(45, 49, 54, 0.92)',
        fontSize: '22px',
        boxShadow: '0 3px 10px rgba(0, 0, 0, 0.35)',
        pointerEvents: 'none',
    });
    document.body.append(image);
    event.dataTransfer.setDragImage(image, 18, 18);
    window.setTimeout(() => image.remove(), 0);
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
    const allItems = [...(encodes.data?.runningItems ?? []), ...(encodes.data?.waitItems ?? []), ...(encodes.data?.scheduledItems ?? [])];
    const recoveryItems = encodes.data?.recoveryItems ?? [];
    const currentItemIds = new Set(allItems.map(item => item.id));
    const currentTargets = targets.filter(id => currentItemIds.has(id));
    const singleCancelTarget = currentTargets.length === 1 ? allItems.find(item => item.id === currentTargets[0]) : undefined;
    const isAllSelected = allItems.length > 0 && allItems.every(item => selected.has(item.id));
    const selectAllLabel = isAllSelected ? 'すべて解除' : 'すべて選択';
    useDragScroll(draggedId !== null);

    useEffect(() => {
        setSelected(current => {
            const next = new Set([...current].filter(id => currentItemIds.has(id)));
            return next.size === current.size ? current : next;
        });
        setTargets(current => {
            const next = current.filter(id => currentItemIds.has(id));
            return next.length === current.length ? current : next;
        });
    }, [encodes.data]);

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
    const selectAll = (): void =>
        setSelected(current => (allItems.length > 0 && allItems.every(item => current.has(item.id)) ? new Set() : new Set(allItems.map(item => item.id))));
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
                    selected={selected.has(item.id)}
                    dragged={draggedId === item.id}
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
                                  setCompactDragImage(event);
                              }
                            : undefined
                    }
                    onDragEnd={reordering && waiting ? () => setDraggedId(null) : undefined}
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
                                <Tooltip title="順番を保存">
                                    <Box component="span" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
                                        <IconButton
                                            aria-label="順番を保存"
                                            color="primary"
                                            disabled={reorder.isPending || !orderChanged || queueChangedWhileReordering}
                                            onClick={() => reorder.mutate(orderedWaitItems.map(item => item.id))}
                                        >
                                            <SaveOutlined />
                                        </IconButton>
                                    </Box>
                                </Tooltip>
                                <Button
                                    variant="contained"
                                    disabled={reorder.isPending || !orderChanged || queueChangedWhileReordering}
                                    onClick={() => reorder.mutate(orderedWaitItems.map(item => item.id))}
                                    sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                                >
                                    順番を保存
                                </Button>
                                <Tooltip title="並べ替えをキャンセル">
                                    <IconButton
                                        aria-label="並べ替えをキャンセル"
                                        disabled={reorder.isPending}
                                        onClick={cancelReordering}
                                        sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                                    >
                                        <CloseOutlined />
                                    </IconButton>
                                </Tooltip>
                                <Button disabled={reorder.isPending} onClick={cancelReordering} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
                                    キャンセル
                                </Button>
                            </>
                        ) : editing ? (
                            <>
                                <Tooltip title={selectAllLabel}>
                                    <IconButton aria-label={selectAllLabel} onClick={selectAll} sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
                                        <SelectAllOutlined />
                                    </IconButton>
                                </Tooltip>
                                <Button onClick={selectAll} sx={{ display: { xs: 'none', sm: 'inline-flex' } }}>
                                    {selectAllLabel}
                                </Button>
                                <Tooltip title="キャンセル">
                                    <Box component="span" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
                                        <IconButton aria-label="キャンセル" color="error" disabled={selected.size === 0} onClick={() => setTargets([...selected])}>
                                            <CancelOutlined />
                                        </IconButton>
                                    </Box>
                                </Tooltip>
                                <Button
                                    color="error"
                                    startIcon={<CancelOutlined />}
                                    disabled={selected.size === 0}
                                    onClick={() => setTargets([...selected])}
                                    sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                                >
                                    キャンセル
                                </Button>
                                <Tooltip title="選択を終了">
                                    <IconButton
                                        aria-label="選択を終了"
                                        onClick={() => {
                                            setEditing(false);
                                            setSelected(new Set());
                                        }}
                                        sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                                    >
                                        <CloseOutlined />
                                    </IconButton>
                                </Tooltip>
                                <Button
                                    onClick={() => {
                                        setEditing(false);
                                        setSelected(new Set());
                                    }}
                                    sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                                >
                                    終了
                                </Button>
                            </>
                        ) : (
                            <>
                                <Tooltip title="並べ替え">
                                    <Box component="span" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
                                        <IconButton aria-label="並べ替え" disabled={(encodes.data?.waitItems.length ?? 0) < 2} onClick={beginReordering}>
                                            <SwapVertOutlined />
                                        </IconButton>
                                    </Box>
                                </Tooltip>
                                <Button
                                    startIcon={<SwapVertOutlined />}
                                    disabled={(encodes.data?.waitItems.length ?? 0) < 2}
                                    onClick={beginReordering}
                                    sx={{ whiteSpace: 'nowrap', display: { xs: 'none', sm: 'inline-flex' } }}
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
                {encodes.isPending ? (
                    <Box sx={{ minHeight: 300, display: 'grid', placeItems: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : encodes.isError ? (
                    <Typography color="error">エンコード情報を取得できませんでした</Typography>
                ) : allItems.length === 0 && recoveryItems.length === 0 ? (
                    <Typography color="text.secondary" sx={{ py: 7, textAlign: 'center' }}>
                        実行中、待機中、または開始予約中のエンコードはありません
                    </Typography>
                ) : (
                    <Stack spacing={3}>
                        {channels.isError && allItems.length > 0 && <Alert severity="warning">放送局情報を取得できないため、放送局IDで表示しています。</Alert>}
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
                        {encodes.data.scheduledItems.length > 0 && (
                            <Box>
                                <Typography variant="h6" sx={{ mb: 1 }}>
                                    エンコード予約
                                </Typography>
                                {renderItems(encodes.data.scheduledItems, true)}
                            </Box>
                        )}
                        <EncodeRecoverySection items={recoveryItems} />
                    </Stack>
                )}
            </Box>
            <Dialog open={currentTargets.length > 0} onClose={() => setTargets([])}>
                <DialogTitle>エンコードをキャンセルしますか？</DialogTitle>
                <DialogContent>
                    {singleCancelTarget !== undefined ? (
                        <Typography>
                            ［{singleCancelTarget.mode}］{singleCancelTarget.recorded.name}を停止しますか？
                        </Typography>
                    ) : (
                        <Typography>{currentTargets.length}件のエンコードをキャンセルします。</Typography>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTargets([])}>閉じる</Button>
                    <Button color="error" variant="contained" disabled={cancel.isPending} onClick={() => cancel.mutate(currentTargets)}>
                        キャンセル実行
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
