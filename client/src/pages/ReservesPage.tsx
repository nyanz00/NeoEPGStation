import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import MoreVertOutlined from '@mui/icons-material/MoreVertOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
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
    ListItemIcon,
    Menu,
    MenuItem,
    Stack,
    Tab,
    Tabs,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetReserveType, ReserveId, ReserveItem } from '../../../api';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PageSubHeader } from '../components/PageSubHeader';
import { UserSelector } from '../components/UserSelector';
import { VueCompatiblePagination } from '../components/VueCompatiblePagination';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { channelName, formatProgramDate, formatProgramTime, genreNames, programDuration } from '../core/program';
import { useActiveUser, type ActiveUserId } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';

const reserveTypes: { value: Exclude<GetReserveType, 'all'>; label: string }[] = [
    { value: 'normal', label: '予約' },
    { value: 'conflict', label: '競合' },
    { value: 'overlap', label: '重複' },
    { value: 'skip', label: '除外' },
];

function normalizeType(value: string | null): Exclude<GetReserveType, 'all'> {
    return value === 'conflict' || value === 'overlap' || value === 'skip' ? value : 'normal';
}

function statusLabel(item: ReserveItem): string | null {
    if (item.isConflict) return '競合';
    if (item.isSkip) return '除外';
    if (item.isOverlap) return '重複';
    return null;
}

function ReserveCard({
    item,
    channel,
    selected,
    editing,
    onSelect,
    onOpen,
    onMenu,
}: {
    item: ReserveItem;
    channel: string;
    selected: boolean;
    editing: boolean;
    onSelect: () => void;
    onOpen: () => void;
    onMenu: (anchor: HTMLElement) => void;
}): ReactNode {
    const status = statusLabel(item);
    return (
        <Card
            variant="outlined"
            sx={{
                borderColor: item.isConflict ? 'error.main' : selected ? 'primary.main' : 'divider',
                bgcolor: selected ? 'action.selected' : item.isSkip || item.isOverlap ? 'action.disabledBackground' : undefined,
            }}
        >
            <CardContent
                sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 2, '&:last-child': { pb: 2 }, cursor: editing ? 'default' : 'pointer' }}
                onClick={editing ? onSelect : onOpen}
            >
                {editing && <Checkbox checked={selected} onChange={onSelect} onClick={event => event.stopPropagation()} />}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {item.name}
                        </Typography>
                        {status !== null && <Chip size="small" color={item.isConflict ? 'error' : 'default'} label={status} />}
                        <Chip size="small" variant="outlined" label={item.ruleId === undefined ? '手動' : 'ルール'} />
                    </Stack>
                    <Typography variant="body2" color="text.secondary">
                        {channel}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {formatProgramDate(item.startAt)} - {formatProgramTime(item.endAt)}（{programDuration(item)}分）
                    </Typography>
                    {item.description !== undefined && (
                        <Typography variant="body2" sx={{ mt: 1 }}>
                            {item.description}
                        </Typography>
                    )}
                </Box>
                {!editing && (
                    <IconButton
                        aria-label="予約の操作"
                        onClick={event => {
                            event.stopPropagation();
                            onMenu(event.currentTarget);
                        }}
                    >
                        <MoreVertOutlined />
                    </IconButton>
                )}
            </CardContent>
        </Card>
    );
}

export function ReservesPage(): ReactNode {
    const settings = useSettings();
    const activeUser = useActiveUser();
    const theme = useTheme();
    const compact = useMediaQuery(theme.breakpoints.down('md'));
    const [params, setParams] = useSearchParams();
    const navigate = useNavigate();
    const type = normalizeType(params.get('type'));
    const page = Math.max(1, Number(params.get('page')) || 1);
    const [userId, setUserId] = useState<ActiveUserId>(activeUser ?? 'master');
    const [editing, setEditing] = useState(false);
    const [selected, setSelected] = useState<Set<ReserveId>>(new Set());
    const [target, setTarget] = useState<ReserveItem | null>(null);
    const [detailTarget, setDetailTarget] = useState<ReserveItem | null>(null);
    const [menuTarget, setMenuTarget] = useState<{ item: ReserveItem; anchor: HTMLElement } | null>(null);
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const counts = useQuery({ queryKey: ['reserve-counts'], queryFn: api.getReserveCounts });
    const reserves = useQuery({
        queryKey: ['reserves', type, userId, page, settings.isHalfWidthDisplayed, settings.reservesLength],
        queryFn: () =>
            api.getReserves({
                type,
                isHalfWidth: settings.isHalfWidthDisplayed,
                userId: typeof userId === 'number' ? userId : undefined,
                offset: (page - 1) * settings.reservesLength,
                limit: settings.reservesLength,
            }),
    });
    const pageCount = Math.max(1, Math.ceil((reserves.data?.total ?? 0) / settings.reservesLength));
    const countFor = (value: Exclude<GetReserveType, 'all'>): number | undefined => {
        if (value === 'conflict') return counts.data?.conflicts;
        if (value === 'overlap') return counts.data?.overlaps;
        if (value === 'skip') return counts.data?.skips;
        return counts.data?.normal;
    };

    useEffect(() => {
        setEditing(false);
        setSelected(new Set());
    }, [type, userId, page]);

    const refresh = async (): Promise<void> => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['reserves'] }),
            queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
            queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
        ]);
    };
    const removeReserve = async (item: ReserveItem): Promise<void> => {
        if (item.isSkip) await api.removeReserveSkip(item.id);
        else if (item.isOverlap) await api.removeReserveOverlap(item.id);
        else await api.cancelReserve(item.id);
    };
    const remove = useMutation({
        mutationFn: removeReserve,
        onSuccess: async () => {
            notify(target?.isSkip || target?.isOverlap ? '予約状態を解除しました' : '予約をキャンセルしました', 'success');
            setTarget(null);
            await refresh();
        },
        onError: async error => {
            notify(`予約の変更に失敗しました: ${error.message}`, 'error');
            await refresh();
        },
    });
    const removeSelected = useMutation({
        mutationFn: async () => {
            const items = reserves.data?.reserves.filter(item => selected.has(item.id)) ?? [];
            const results = await Promise.allSettled(items.map(removeReserve));
            return {
                succeeded: items.filter((_item, index) => results[index].status === 'fulfilled').map(item => item.id),
                failed: items
                    .map((item, index) => ({ item, result: results[index] }))
                    .filter((entry): entry is { item: ReserveItem; result: PromiseRejectedResult } => entry.result.status === 'rejected'),
            };
        },
        onSuccess: async result => {
            setSelected(new Set(result.failed.map(entry => entry.item.id)));
            setEditing(result.failed.length > 0);
            if (result.succeeded.length > 0) notify(`${result.succeeded.length}件の予約状態を解除しました`, 'success');
            if (result.failed.length > 0) {
                const detail = result.failed
                    .slice(0, 3)
                    .map(entry => `${entry.item.name}: ${entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason)}`)
                    .join(' / ');
                notify(`${result.failed.length}件を解除できませんでした: ${detail}`, 'error');
            }
            await refresh();
        },
        onError: async error => {
            notify(error.message, 'error');
            await refresh();
        },
    });
    const updateParams = (next: { type?: Exclude<GetReserveType, 'all'>; page?: number }, replace = false): void => {
        const value = new URLSearchParams(params);
        if (next.type !== undefined) value.set('type', next.type);
        value.set('page', (next.page ?? 1).toString(10));
        setParams(value, { replace });
    };
    useEffect(() => {
        if (reserves.isSuccess && page > pageCount) updateParams({ page: pageCount }, true);
    }, [page, pageCount, reserves.isSuccess]);
    const toggleSelected = (id: ReserveId): void =>
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const allSelected = useMemo(() => (reserves.data?.reserves.length ?? 0) > 0 && reserves.data!.reserves.every(item => selected.has(item.id)), [reserves.data, selected]);

    return (
        <>
            <PageHeader
                title={reserveTypes.find(item => item.value === type)?.label ?? '予約'}
                actions={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <UserSelector value={userId} onChange={setUserId} />
                        <Button
                            variant={editing ? 'contained' : 'outlined'}
                            onClick={() => {
                                setEditing(value => !value);
                                setSelected(new Set());
                            }}
                        >
                            {editing ? '完了' : '選択'}
                        </Button>
                        <IconButton onClick={() => void refresh()} aria-label="更新">
                            <RefreshOutlined />
                        </IconButton>
                    </Stack>
                }
            />
            <PageSubHeader>
                <Box sx={{ px: { xs: 1, md: 2 } }}>
                    <Tabs value={type} onChange={(_event, value: Exclude<GetReserveType, 'all'>) => updateParams({ type: value })} variant="scrollable" scrollButtons="auto">
                        {reserveTypes.map(item => (
                            <Tab key={item.value} value={item.value} label={`${item.label}${countFor(item.value) === undefined ? '' : ` ${countFor(item.value)}`}`} />
                        ))}
                    </Tabs>
                </Box>
            </PageSubHeader>
            {editing && (
                <Stack direction="row" spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}>
                    <Checkbox
                        checked={allSelected}
                        indeterminate={selected.size > 0 && !allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(reserves.data?.reserves.map(item => item.id) ?? []))}
                    />
                    <Typography sx={{ flex: 1 }}>{selected.size}件選択</Typography>
                    <Button color="error" startIcon={<DeleteOutlineOutlined />} disabled={selected.size === 0 || removeSelected.isPending} onClick={() => removeSelected.mutate()}>
                        選択した予約をキャンセル
                    </Button>
                </Stack>
            )}
            {reserves.isPending ? (
                <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : reserves.error !== null ? (
                <Typography color="error" sx={{ p: 3 }}>
                    予約データの取得に失敗しました: {reserves.error.message}
                </Typography>
            ) : (
                <Stack spacing={1.25} sx={{ width: compact ? '100%' : 'min(1100px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                    {reserves.data?.reserves.map(item => (
                        <ReserveCard
                            key={item.id}
                            item={item}
                            channel={channelName(channels.data, item.channelId)}
                            selected={selected.has(item.id)}
                            editing={editing}
                            onSelect={() => toggleSelected(item.id)}
                            onOpen={() => setDetailTarget(item)}
                            onMenu={anchor => setMenuTarget({ item, anchor })}
                        />
                    ))}
                    {reserves.data?.reserves.length === 0 && (
                        <Typography color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>
                            該当する予約はありません
                        </Typography>
                    )}
                    {pageCount > 1 && (
                        <VueCompatiblePagination count={pageCount} page={page} onChange={(_event, value) => updateParams({ page: value })} sx={{ alignSelf: 'center', pt: 2 }} />
                    )}
                </Stack>
            )}
            <Menu anchorEl={menuTarget?.anchor ?? null} open={menuTarget !== null} onClose={() => setMenuTarget(null)} slotProps={{ list: { 'aria-label': '予約の操作' } }}>
                {menuTarget?.item.ruleId !== undefined && (
                    <MenuItem
                        onClick={() => {
                            const ruleId = menuTarget.item.ruleId!;
                            setMenuTarget(null);
                            void navigate(`/recorded?ruleId=${ruleId.toString(10)}`);
                        }}
                    >
                        <ListItemIcon>
                            <MovieOutlined fontSize="small" />
                        </ListItemIcon>
                        recorded
                    </MenuItem>
                )}
                <MenuItem
                    onClick={() => {
                        const item = menuTarget!.item;
                        setMenuTarget(null);
                        void navigate(item.ruleId === undefined ? `/reserves/manual?reserveId=${item.id.toString(10)}` : `/search?ruleId=${item.ruleId.toString(10)}`);
                    }}
                >
                    <ListItemIcon>
                        <EditOutlined fontSize="small" />
                    </ListItemIcon>
                    edit
                </MenuItem>
                {menuTarget !== null && !menuTarget.item.isConflict && (
                    <MenuItem
                        onClick={() => {
                            setTarget(menuTarget.item);
                            setMenuTarget(null);
                        }}
                    >
                        <ListItemIcon>
                            {menuTarget.item.isSkip || menuTarget.item.isOverlap ? <LockOpenOutlined fontSize="small" /> : <DeleteOutlineOutlined fontSize="small" />}
                        </ListItemIcon>
                        {menuTarget.item.isSkip || menuTarget.item.isOverlap ? 'unlock' : 'delete'}
                    </MenuItem>
                )}
            </Menu>
            <Dialog open={detailTarget !== null} onClose={() => setDetailTarget(null)} fullWidth maxWidth="sm">
                {detailTarget !== null && (
                    <>
                        <DialogTitle>{detailTarget.name}</DialogTitle>
                        <DialogContent dividers>
                            <Stack spacing={1}>
                                <Typography color="text.secondary">{channelName(channels.data, detailTarget.channelId)}</Typography>
                                <Typography>
                                    {formatProgramDate(detailTarget.startAt)} - {formatProgramTime(detailTarget.endAt)}（{programDuration(detailTarget)}分）
                                </Typography>
                                {[detailTarget.genre1, detailTarget.genre2, detailTarget.genre3].some(value => value !== undefined) && (
                                    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                                        {[detailTarget.genre1, detailTarget.genre2, detailTarget.genre3]
                                            .filter((value): value is number => value !== undefined)
                                            .map((value, index) => (
                                                <Chip key={`${value}-${index}`} size="small" label={genreNames[value] ?? `ジャンル ${value}`} />
                                            ))}
                                    </Stack>
                                )}
                                {detailTarget.description !== undefined && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{detailTarget.description}</Typography>}
                                {detailTarget.extended !== undefined && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{detailTarget.extended}</Typography>}
                            </Stack>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setDetailTarget(null)}>閉じる</Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>
            <Dialog open={target !== null} onClose={() => setTarget(null)}>
                <DialogTitle>{target?.isSkip || target?.isOverlap ? '予約状態を解除' : '予約をキャンセル'}</DialogTitle>
                <DialogContent>
                    <Typography>{target?.name}</Typography>
                    <Typography color="text.secondary" sx={{ mt: 1 }}>
                        {target?.ruleId === undefined ? 'この予約をキャンセルします。' : 'ルールから作成された予約は除外扱いになります。'}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setTarget(null)}>戻る</Button>
                    <Button color="error" variant="contained" disabled={remove.isPending} onClick={() => target !== null && remove.mutate(target)}>
                        実行
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
