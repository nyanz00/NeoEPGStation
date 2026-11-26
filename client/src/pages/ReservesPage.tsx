import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import MoreVertOutlined from '@mui/icons-material/MoreVertOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import PersonOutlineOutlined from '@mui/icons-material/PersonOutlineOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import {
    Box,
    Alert,
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
    Tooltip,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetReserveType, ReserveId, ReserveItem } from '../../../api';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PageSubHeader } from '../components/PageSubHeader';
import { ReserveProgramDialog } from '../components/ReserveProgramDialog';
import { UserSelector } from '../components/UserSelector';
import { VueCompatiblePagination } from '../components/VueCompatiblePagination';
import { programDialogPaper } from '../components/programDialogStyles';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { channelName, formatProgramDate, formatProgramTime, programDuration } from '../core/program';
import { reconcileReserveSelection, reserveChangeCopy, reserveChangeKind, resolveReserveUserFilter } from '../core/reserves';
import { useActiveUser, type ActiveUserId } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';

type ReserveViewType = Exclude<GetReserveType, 'all'>;

const reserveTypes: { value: ReserveViewType; label: string }[] = [
    { value: 'normal', label: '予約' },
    { value: 'conflict', label: '競合' },
    { value: 'overlap', label: '重複' },
    { value: 'skip', label: '除外' },
];

function normalizeType(value: string | null): ReserveViewType {
    return value === 'conflict' || value === 'overlap' || value === 'skip' ? value : 'normal';
}

function statusLabel(item: ReserveItem): string | null {
    if (item.isConflict) return '競合';
    if (item.isSkip) return '除外';
    if (item.isOverlap) return '重複';
    return null;
}

function bulkReserveCopy(type: ReserveViewType, items: readonly ReserveItem[]): { label: string; title: string; detail: string; action: string } {
    if (type === 'skip' || type === 'overlap') {
        const copy = reserveChangeCopy[type === 'skip' ? 'restoreSkip' : 'restoreOverlap'];
        return {
            label: type === 'skip' ? '選択した予約の除外を解除' : '選択した重複状態を解除',
            title: copy.title,
            detail: type === 'skip' ? `${items.length}件を除外から予約に戻します。` : `${items.length}件の重複状態を解除します。`,
            action: type === 'skip' ? copy.action : '重複状態を解除',
        };
    }

    const excludeCount = items.filter(item => reserveChangeKind(item) === 'exclude').length;
    const deleteCount = items.length - excludeCount;
    if (excludeCount > 0 && deleteCount > 0) {
        return {
            label: '選択した予約をキャンセル',
            title: '予約をキャンセルしますか？',
            detail: `ルール予約${excludeCount}件を除外し、手動予約など${deleteCount}件を削除します。`,
            action: '予約をキャンセル',
        };
    }
    if (excludeCount > 0) {
        return {
            label: '選択した番組を除外',
            title: reserveChangeCopy.exclude.title,
            detail: `${excludeCount}件を除外します。`,
            action: reserveChangeCopy.exclude.action,
        };
    }
    return {
        label: '選択した予約を削除',
        title: reserveChangeCopy.delete.title,
        detail: `${deleteCount}件の予約を削除します。`,
        action: reserveChangeCopy.delete.action,
    };
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
                borderColor: item.isConflict ? 'error.main' : selected ? 'primary.main' : undefined,
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
    const users = useQuery({ queryKey: ['users'], queryFn: api.getUsers });
    const resolvedUser = resolveReserveUserFilter(
        params.get('userId'),
        activeUser,
        users.data?.users.map(user => user.id),
    );
    const userId = resolvedUser.userId;
    const [editing, setEditing] = useState(false);
    const [selected, setSelected] = useState<Set<ReserveId>>(new Set());
    const [bulkConfirmOpen, setBulkConfirmOpen] = useState(false);
    const [target, setTarget] = useState<ReserveItem | null>(null);
    const [detailTarget, setDetailTarget] = useState<ReserveItem | null>(null);
    const [menuTarget, setMenuTarget] = useState<{ item: ReserveItem; anchor: HTMLElement } | null>(null);
    const [userMenuAnchor, setUserMenuAnchor] = useState<HTMLElement | null>(null);
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const selectedUserId = typeof userId === 'number' ? userId : undefined;
    const typeCounts = useQueries({
        queries: reserveTypes.map(item => ({
            queryKey: ['reserves', 'count', item.value, selectedUserId, settings.isHalfWidthDisplayed],
            queryFn: () =>
                api.getReserves({
                    type: item.value,
                    isHalfWidth: settings.isHalfWidthDisplayed,
                    userId: selectedUserId,
                    offset: 0,
                    limit: 1,
                }),
        })),
    });
    const reserves = useQuery({
        queryKey: ['reserves', type, selectedUserId, page, settings.isHalfWidthDisplayed, settings.reservesLength],
        queryFn: () =>
            api.getReserves({
                type,
                isHalfWidth: settings.isHalfWidthDisplayed,
                userId: selectedUserId,
                offset: (page - 1) * settings.reservesLength,
                limit: settings.reservesLength,
            }),
    });
    const pageCount = Math.max(1, Math.ceil((reserves.data?.total ?? 0) / settings.reservesLength));
    const countFor = (value: ReserveViewType): number | undefined => typeCounts[reserveTypes.findIndex(item => item.value === value)]?.data?.total;

    useEffect(() => {
        setEditing(false);
        setSelected(new Set());
        setBulkConfirmOpen(false);
    }, [type, userId, page]);

    useEffect(() => {
        if (!resolvedUser.replaceRoute) return;
        const next = new URLSearchParams(params);
        next.set('userId', typeof userId === 'number' ? userId.toString(10) : 'master');
        next.set('page', '1');
        setParams(next, { replace: true });
    }, [params, resolvedUser.replaceRoute, setParams, userId]);

    useEffect(() => {
        if (reserves.data === undefined) return;
        setSelected(current =>
            reconcileReserveSelection(
                current,
                reserves.data.reserves.map(item => item.id),
            ),
        );
    }, [reserves.data]);

    useEffect(() => {
        if (selected.size === 0) setBulkConfirmOpen(false);
    }, [selected.size]);

    const refresh = async (): Promise<void> => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['reserves'] }),
            queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
            queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
        ]);
    };
    const updateReserves = useMutation({
        mutationFn: api.updateReserves,
        onSuccess: async () => {
            notify('予約情報を更新しました', 'success');
            await refresh();
        },
        onError: async error => {
            notify(`予約情報の更新に失敗しました: ${error.message}`, 'error');
            await refresh();
        },
    });
    const removeReserve = async (item: ReserveItem): Promise<void> => {
        if (item.isSkip) await api.removeReserveSkip(item.id);
        else if (item.isOverlap) await api.removeReserveOverlap(item.id);
        else await api.cancelReserve(item.id);
    };
    const remove = useMutation({
        mutationFn: async (item: ReserveItem) => {
            await removeReserve(item);
            return item;
        },
        onSuccess: async item => {
            notify(reserveChangeCopy[reserveChangeKind(item)].success, 'success');
            setTarget(current => (current?.id === item.id ? null : current));
            await refresh();
        },
        onError: async error => {
            notify(`予約の変更に失敗しました: ${error.message}`, 'error');
            await refresh();
        },
    });
    const selectedItems = (reserves.data?.reserves ?? []).filter(item => selected.has(item.id));
    const removeSelected = useMutation({
        mutationFn: async () => {
            const items = selectedItems;
            const results = await Promise.allSettled(items.map(removeReserve));
            return {
                succeeded: items.filter((_item, index) => results[index].status === 'fulfilled'),
                failed: items
                    .map((item, index) => ({ item, result: results[index] }))
                    .filter((entry): entry is { item: ReserveItem; result: PromiseRejectedResult } => entry.result.status === 'rejected'),
            };
        },
        onSuccess: async result => {
            setBulkConfirmOpen(false);
            setSelected(new Set(result.failed.map(entry => entry.item.id)));
            setEditing(result.failed.length > 0);
            const kinds = result.succeeded.map(reserveChangeKind);
            const restoredSkip = kinds.filter(kind => kind === 'restoreSkip').length;
            const restoredOverlap = kinds.filter(kind => kind === 'restoreOverlap').length;
            const excluded = kinds.filter(kind => kind === 'exclude').length;
            const deleted = kinds.filter(kind => kind === 'delete').length;
            const messages = [
                restoredSkip > 0 ? `${restoredSkip}件を除外から予約に戻しました` : null,
                restoredOverlap > 0 ? `${restoredOverlap}件の重複状態を解除して予約に戻しました` : null,
                excluded > 0 ? `${excluded}件を除外しました` : null,
                deleted > 0 ? `${deleted}件の予約を削除しました` : null,
            ].filter((message): message is string => message !== null);
            if (result.failed.length > 0) {
                const detail = result.failed
                    .slice(0, 3)
                    .map(entry => `${entry.item.name}: ${entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason)}`)
                    .join(' / ');
                messages.push(`${result.failed.length}件の予約を変更できませんでした: ${detail}`);
            }
            if (messages.length > 0) notify(messages.join('。'), result.failed.length > 0 ? 'error' : 'success');
            await refresh();
        },
        onError: async error => {
            setBulkConfirmOpen(false);
            notify(error.message, 'error');
            await refresh();
        },
    });
    const updateParams = (next: { type?: ReserveViewType; page?: number }, replace = false): void => {
        const value = new URLSearchParams(params);
        if (next.type !== undefined) value.set('type', next.type);
        value.set('page', (next.page ?? 1).toString(10));
        setParams(value, { replace });
    };
    const changeUser = (value: ActiveUserId): void => {
        if (value === null) return;
        setUserMenuAnchor(null);
        const next = new URLSearchParams(params);
        next.set('userId', typeof value === 'number' ? value.toString(10) : 'master');
        next.set('page', '1');
        setParams(next);
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
    const bulkCopy = bulkReserveCopy(type, selectedItems);
    const bulkActionDisabled = selectedItems.length === 0 || removeSelected.isPending;
    const targetKind = target === null ? null : reserveChangeKind(target);
    const targetCopy = targetKind === null ? null : reserveChangeCopy[targetKind];
    const selectedUserName = userId === 'master' ? 'master（すべて）' : (users.data?.users.find(user => user.id === userId)?.name ?? `ユーザーID: ${userId}`);

    return (
        <>
            <PageHeader
                title={editing ? `${selected.size}件選択` : (reserveTypes.find(item => item.value === type)?.label ?? '予約')}
                actions={
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        {!editing &&
                            (compact ? (
                                <Tooltip title={`ユーザー: ${selectedUserName}`}>
                                    <IconButton aria-label="ユーザーを選択" onClick={event => setUserMenuAnchor(event.currentTarget)}>
                                        <PersonOutlineOutlined />
                                    </IconButton>
                                </Tooltip>
                            ) : (
                                <UserSelector value={userId} onChange={changeUser} />
                            ))}
                        <Tooltip title={editing ? '選択を終了' : '選択'}>
                            <IconButton
                                aria-label={editing ? '選択を終了' : '選択'}
                                onClick={() => {
                                    setEditing(value => !value);
                                    setSelected(new Set());
                                }}
                                sx={{ display: { xs: 'inline-flex', md: 'none' } }}
                            >
                                {editing ? <CloseOutlined /> : <EditOutlined />}
                            </IconButton>
                        </Tooltip>
                        <Button
                            variant={editing ? 'contained' : 'outlined'}
                            onClick={() => {
                                setEditing(value => !value);
                                setSelected(new Set());
                            }}
                            sx={{ display: { xs: 'none', md: 'inline-flex' } }}
                        >
                            {editing ? '完了' : '選択'}
                        </Button>
                        {!editing && (
                            <Tooltip title="予約情報更新">
                                <Box component="span" sx={{ display: 'inline-flex' }}>
                                    <IconButton disabled={updateReserves.isPending} onClick={() => updateReserves.mutate()} aria-label="予約情報更新">
                                        <RefreshOutlined />
                                    </IconButton>
                                </Box>
                            </Tooltip>
                        )}
                    </Stack>
                }
            />
            <PageSubHeader>
                <Box sx={{ px: { xs: 1, md: 2 } }}>
                    <Tabs value={type} onChange={(_event, value: ReserveViewType) => updateParams({ type: value })} variant="scrollable" scrollButtons="auto">
                        {reserveTypes.map(item => (
                            <Tab key={item.value} value={item.value} label={`${item.label}${countFor(item.value) === undefined ? '' : ` ${countFor(item.value)}`}`} />
                        ))}
                    </Tabs>
                </Box>
                {editing && (
                    <Stack direction="row" spacing={1} sx={{ p: 1.5, borderTop: 1, borderColor: 'divider', alignItems: 'center' }}>
                        <Checkbox
                            checked={allSelected}
                            indeterminate={selected.size > 0 && !allSelected}
                            onChange={() => setSelected(allSelected ? new Set() : new Set(reserves.data?.reserves.map(item => item.id) ?? []))}
                            slotProps={{ input: { 'aria-label': '表示中の予約をすべて選択' } }}
                        />
                        <Typography sx={{ flex: 1 }}>{selected.size}件選択</Typography>
                        <Tooltip title={bulkCopy.label}>
                            <Box component="span" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
                                <IconButton
                                    color={type === 'skip' || type === 'overlap' ? 'primary' : 'error'}
                                    aria-label={bulkCopy.label}
                                    disabled={bulkActionDisabled}
                                    onClick={() => setBulkConfirmOpen(true)}
                                >
                                    {type === 'skip' || type === 'overlap' ? <LockOpenOutlined /> : <DeleteOutlineOutlined />}
                                </IconButton>
                            </Box>
                        </Tooltip>
                        <Button
                            color={type === 'skip' || type === 'overlap' ? 'primary' : 'error'}
                            startIcon={type === 'skip' || type === 'overlap' ? <LockOpenOutlined /> : <DeleteOutlineOutlined />}
                            disabled={bulkActionDisabled}
                            onClick={() => setBulkConfirmOpen(true)}
                            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                        >
                            {bulkCopy.label}
                        </Button>
                    </Stack>
                )}
            </PageSubHeader>
            {reserves.data === undefined && reserves.isPending ? (
                <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : reserves.data === undefined && reserves.error !== null ? (
                <Alert severity="error" action={<Button onClick={() => void reserves.refetch()}>再試行</Button>} sx={{ m: { xs: 1.5, md: 3 } }}>
                    予約データの取得に失敗しました: {reserves.error.message}
                </Alert>
            ) : (
                <Stack spacing={1.25} sx={{ width: compact ? '100%' : 'min(1100px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                    {reserves.isError && (
                        <Alert severity="warning" action={<Button onClick={() => void reserves.refetch()}>再試行</Button>}>
                            予約データを更新できなかったため、取得済みの一覧を表示しています。
                        </Alert>
                    )}
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
            <Menu anchorEl={userMenuAnchor} open={userMenuAnchor !== null} onClose={() => setUserMenuAnchor(null)} slotProps={{ list: { 'aria-label': '予約ユーザー' } }}>
                <MenuItem selected={userId === 'master'} onClick={() => changeUser('master')}>
                    master（すべて）
                </MenuItem>
                {users.isPending && <MenuItem disabled>ユーザーを読み込み中…</MenuItem>}
                {users.isError && <MenuItem onClick={() => void users.refetch()}>ユーザーの取得に失敗しました（再試行）</MenuItem>}
                {users.data?.users.map(user => (
                    <MenuItem key={user.id} selected={userId === user.id} onClick={() => changeUser(user.id)}>
                        {user.name}
                    </MenuItem>
                ))}
            </Menu>
            <ReserveProgramDialog
                item={detailTarget}
                channel={detailTarget === null ? undefined : channels.data?.find(channel => channel.id === detailTarget.channelId)}
                onClose={() => setDetailTarget(null)}
            />
            <Dialog
                open={bulkConfirmOpen}
                onClose={() => !removeSelected.isPending && setBulkConfirmOpen(false)}
                maxWidth="xs"
                fullWidth
                slotProps={{ paper: { sx: theme => programDialogPaper(theme) } }}
            >
                <DialogTitle>{bulkCopy.title}</DialogTitle>
                <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2, bgcolor: 'action.hover' }}>
                    <Typography>{bulkCopy.detail}</Typography>
                </DialogContent>
                <DialogActions>
                    <Button color="inherit" variant="outlined" disabled={removeSelected.isPending} onClick={() => setBulkConfirmOpen(false)}>
                        キャンセル
                    </Button>
                    <Button
                        color={type === 'skip' || type === 'overlap' ? 'primary' : 'error'}
                        variant="contained"
                        disabled={bulkActionDisabled}
                        onClick={() => removeSelected.mutate()}
                    >
                        {bulkCopy.action}
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog
                open={target !== null}
                onClose={() => !remove.isPending && setTarget(null)}
                maxWidth="xs"
                fullWidth
                slotProps={{ paper: { sx: theme => programDialogPaper(theme) } }}
            >
                <DialogTitle>{targetCopy?.title}</DialogTitle>
                <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2, bgcolor: 'action.hover' }}>
                    <Typography>{target?.name}</Typography>
                    <Typography color="text.secondary" sx={{ mt: 1 }}>
                        {targetKind === 'restoreSkip'
                            ? 'この番組を除外から予約に戻します。'
                            : targetKind === 'restoreOverlap'
                              ? 'この番組の重複状態を解除して予約に戻します。'
                              : targetKind === 'exclude'
                                ? 'ルールを残したまま、この番組を除外します。'
                                : 'この予約を削除します。'}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button color="inherit" variant="outlined" disabled={remove.isPending} onClick={() => setTarget(null)}>
                        キャンセル
                    </Button>
                    <Button
                        color={target?.isSkip || target?.isOverlap ? 'primary' : 'error'}
                        variant="contained"
                        disabled={remove.isPending}
                        onClick={() => target !== null && remove.mutate(target)}
                    >
                        {targetCopy?.action}
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
