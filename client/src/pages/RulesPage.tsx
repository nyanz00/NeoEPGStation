import AddOutlined from '@mui/icons-material/AddOutlined';
import CheckBoxOutlined from '@mui/icons-material/CheckBoxOutlined';
import DoneOutlined from '@mui/icons-material/DoneOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import FilterAltOutlined from '@mui/icons-material/FilterAltOutlined';
import MoreVertOutlined from '@mui/icons-material/MoreVertOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
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
    Fab,
    IconButton,
    InputAdornment,
    Menu,
    MenuItem,
    Stack,
    Switch,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Rule, RuleId } from '../../../api';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PageSubHeader } from '../components/PageSubHeader';
import { UserSelector } from '../components/UserSelector';
import { VueCompatiblePagination } from '../components/VueCompatiblePagination';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { channelName, channelTypeLabel, genrePathLabel } from '../core/program';
import { useActiveUser, type ActiveUserId } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';

function ruleChannels(rule: Rule, channels: Awaited<ReturnType<typeof api.getChannels>> | undefined): string {
    if ((rule.searchOption.channelIds?.length ?? 0) > 0) {
        return rule.searchOption.channelIds!.map(id => channelName(channels, id)).join('、');
    }
    const types = rule.searchOption.channelTypes ?? [];
    if (types.length > 0) return types.map(channelTypeLabel).join('、');
    const legacy = (['GR', 'BS', 'CS', 'SKY'] as const).filter(type => rule.searchOption[type] === true);
    return legacy.length > 0 ? legacy.join('、') : '全局';
}

function ruleGenres(rule: Rule): string {
    if ((rule.searchOption.genres?.length ?? 0) === 0) return '全ジャンル';
    return rule.searchOption
        .genres!.map(item => genrePathLabel(item.genre, item.subGenre))
        .filter((value, index, values) => values.indexOf(value) === index)
        .join('、');
}

function RuleCard({
    rule,
    channels,
    selected,
    selecting,
    onSelect,
    onToggle,
    onEdit,
    onDelete,
    onRecordings,
}: {
    rule: Rule;
    channels: Awaited<ReturnType<typeof api.getChannels>> | undefined;
    selected: boolean;
    selecting: boolean;
    onSelect: () => void;
    onToggle: (enable: boolean) => void;
    onEdit: () => void;
    onDelete: () => void;
    onRecordings: () => void;
}): ReactNode {
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const keyword = rule.searchOption.keyword?.trim() || (rule.isTimeSpecification ? '時刻指定ルール' : 'キーワード指定なし');
    return (
        <Card variant="outlined" sx={{ borderColor: selected ? 'primary.main' : 'divider', bgcolor: selected ? 'action.selected' : undefined }}>
            <CardContent sx={{ display: 'flex', gap: 1.5, alignItems: 'flex-start', p: 2, '&:last-child': { pb: 2 } }} onClick={selecting ? onSelect : undefined}>
                {selecting && <Checkbox checked={selected} onChange={onSelect} onClick={event => event.stopPropagation()} />}
                <Box sx={{ flex: 1, minWidth: 0 }}>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center', flexWrap: 'wrap' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                            {keyword}
                        </Typography>
                        <Chip size="small" color={rule.reserveOption.enable ? 'primary' : 'default'} label={rule.reserveOption.enable ? '有効' : '無効'} />
                        <Chip size="small" variant="outlined" label={`予約 ${rule.reservesCnt ?? 0}`} />
                        {rule.annictId !== undefined && <Chip size="small" variant="outlined" label="annict" />}
                    </Stack>
                    {rule.searchOption.ignoreKeyword !== undefined && (
                        <Typography variant="body2" color="text.secondary">
                            除外: {rule.searchOption.ignoreKeyword}
                        </Typography>
                    )}
                    <Typography variant="body2" color="text.secondary">
                        {ruleChannels(rule, channels)} / {ruleGenres(rule)}
                    </Typography>
                    {rule.encodeOption?.mode1 !== undefined && (
                        <Typography variant="caption" color="text.secondary">
                            エンコード: {[rule.encodeOption.mode1, rule.encodeOption.mode2, rule.encodeOption.mode3].filter(Boolean).join('、')}
                            {(rule.encodeOption.startDelayMinutes ?? 0) > 0 ? `（録画完了後${rule.encodeOption.startDelayMinutes}分待機）` : ''}
                        </Typography>
                    )}
                </Box>
                {!selecting && (
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Switch
                            checked={rule.reserveOption.enable}
                            onChange={event => onToggle(event.target.checked)}
                            slotProps={{ input: { 'aria-label': `${keyword}のルール有効` } }}
                        />
                        <IconButton aria-label={`${keyword}の操作`} aria-haspopup="menu" aria-expanded={menuAnchor !== null} onClick={event => setMenuAnchor(event.currentTarget)}>
                            <MoreVertOutlined />
                        </IconButton>
                        <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
                            <MenuItem
                                onClick={() => {
                                    setMenuAnchor(null);
                                    onRecordings();
                                }}
                            >
                                <SearchOutlined fontSize="small" sx={{ mr: 1 }} />
                                録画済み
                            </MenuItem>
                            <MenuItem
                                onClick={() => {
                                    setMenuAnchor(null);
                                    onEdit();
                                }}
                            >
                                <EditOutlined fontSize="small" sx={{ mr: 1 }} />
                                編集
                            </MenuItem>
                            <MenuItem
                                onClick={() => {
                                    setMenuAnchor(null);
                                    onDelete();
                                }}
                            >
                                <DeleteOutlineOutlined fontSize="small" sx={{ mr: 1 }} />
                                削除
                            </MenuItem>
                        </Menu>
                    </Stack>
                )}
            </CardContent>
        </Card>
    );
}

export function RulesPage(): ReactNode {
    const settings = useSettings();
    const activeUser = useActiveUser();
    const navigate = useNavigate();
    const location = useLocation();
    const [params, setParams] = useSearchParams();
    const page = Math.max(1, Number(params.get('page')) || 1);
    const [keywordInput, setKeywordInput] = useState(params.get('keyword') ?? '');
    const keyword = params.get('keyword') ?? '';
    const hasReserve = params.get('hasReserve') === 'true';
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<Set<RuleId>>(new Set());
    const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
    const [bulkDeleteConfirmOpen, setBulkDeleteConfirmOpen] = useState(false);
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const users = useQuery({ queryKey: ['users'], queryFn: api.getUsers });
    const routeUserValue = params.get('userId');
    const parsedRouteUser: ActiveUserId | undefined =
        routeUserValue === 'master'
            ? 'master'
            : routeUserValue !== null && /^[1-9]\d*$/.test(routeUserValue) && Number.isSafeInteger(Number(routeUserValue))
              ? Number(routeUserValue)
              : undefined;
    const availableUserIds = users.data?.users.map(user => user.id) ?? [];
    const preferredUser: ActiveUserId =
        activeUser === 'master' || activeUser === null ? 'master' : !users.isSuccess || availableUserIds.includes(activeUser) ? activeUser : (availableUserIds[0] ?? 'master');
    const userId: ActiveUserId =
        parsedRouteUser === 'master'
            ? 'master'
            : typeof parsedRouteUser === 'number' && (!users.isSuccess || availableUserIds.includes(parsedRouteUser))
              ? parsedRouteUser
              : preferredUser;
    const contextKey = `${location.key}:${String(userId)}:${keyword}:${hasReserve}:${page}:${settings.rulesLength}`;
    const contextRef = useRef(contextKey);
    const selectingRef = useRef(selecting);
    const visibleIdsRef = useRef<Set<RuleId>>(new Set());
    contextRef.current = contextKey;
    selectingRef.current = selecting;
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const rules = useQuery({
        queryKey: ['rules', userId, keyword, hasReserve, page, settings.rulesLength],
        queryFn: () =>
            api.getRules({
                type: 'normal',
                userId: typeof userId === 'number' ? userId : undefined,
                keyword: keyword.length > 0 ? keyword : undefined,
                hasReserve: hasReserve || undefined,
                offset: (page - 1) * settings.rulesLength,
                limit: settings.rulesLength,
            }),
        enabled: !users.isPending,
    });
    const pageCount = Math.max(1, Math.ceil((rules.data?.total ?? 0) / settings.rulesLength));
    const visibleSelected = useMemo(() => {
        const visibleIds = new Set(rules.data?.rules.map(rule => rule.id) ?? []);
        return new Set([...selected].filter(id => visibleIds.has(id)));
    }, [rules.data, selected]);
    visibleIdsRef.current = new Set(rules.data?.rules.map(rule => rule.id) ?? []);

    useEffect(() => {
        if (users.isPending) return;
        const resolvedUser = userId ?? 'master';
        const isSameRouteUser = routeUserValue === String(resolvedUser);
        if (!isSameRouteUser) {
            const next = new URLSearchParams(params);
            next.set('userId', String(resolvedUser));
            next.set('page', '1');
            setParams(next, { replace: true });
        }
    }, [params, routeUserValue, setParams, userId, users.isPending]);

    useEffect(() => setKeywordInput(keyword), [keyword]);

    useEffect(() => {
        setSelecting(false);
        setSelected(new Set());
        setDeleteTarget(null);
        setBulkDeleteConfirmOpen(false);
    }, [contextKey]);

    useEffect(() => {
        const visibleIds = new Set(rules.data?.rules.map(rule => rule.id) ?? []);
        setSelected(current => {
            const next = new Set([...current].filter(id => visibleIds.has(id)));
            return next.size === current.size ? current : next;
        });
    }, [rules.data]);

    const refresh = async (): Promise<void> => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['rules'] }),
            queryClient.invalidateQueries({ queryKey: ['reserves'] }),
            queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
            queryClient.invalidateQueries({ queryKey: ['annict', 'viewer-statuses'] }),
        ]);
    };
    const toggle = useMutation({
        mutationFn: ({ rule, enable }: { rule: Rule; enable: boolean }) => (enable ? api.enableRule(rule.id) : api.disableRule(rule.id, settings.annictStopWatchingOnRuleDisable)),
        onSuccess: async (result, variables) => {
            if (result.annictStatusError !== undefined) {
                notify(`ルールは${variables.enable ? '有効' : '無効'}にしましたが、Annict視聴ステータスを更新できませんでした: ${result.annictStatusError}`, 'warning');
            } else {
                notify(`ルールを${variables.enable ? '有効' : '無効'}にしました`, 'success');
            }
            await refresh();
        },
        onError: error => notify(`ルールの変更に失敗しました: ${error.message}`, 'error'),
    });
    const remove = useMutation({
        mutationFn: (ruleId: RuleId) => api.deleteRule(ruleId),
        onSuccess: async result => {
            if (result.annictLinkError !== undefined) {
                notify(`ルールは削除しましたが、Annictとの関連付けを解除できませんでした: ${result.annictLinkError}`, 'warning');
            } else {
                notify('ルールを削除しました', 'success');
            }
            setDeleteTarget(null);
            await refresh();
        },
        onError: error => notify(`ルールの削除に失敗しました: ${error.message}`, 'error'),
    });
    const removeSelected = useMutation({
        mutationFn: async ({ ids, contextKey: requestContextKey }: { ids: RuleId[]; contextKey: string }) => {
            const results = await Promise.allSettled(ids.map(id => api.deleteRule(id)));
            return {
                contextKey: requestContextKey,
                succeeded: ids.filter((_id, index) => results[index].status === 'fulfilled'),
                annictWarnings: ids
                    .map((id, index) => ({ id, result: results[index] }))
                    .filter(
                        (entry): entry is { id: RuleId; result: PromiseFulfilledResult<Awaited<ReturnType<typeof api.deleteRule>>> } =>
                            entry.result.status === 'fulfilled' && entry.result.value.annictLinkError !== undefined,
                    ),
                failed: ids
                    .map((id, index) => ({ id, result: results[index] }))
                    .filter((entry): entry is { id: RuleId; result: PromiseRejectedResult } => entry.result.status === 'rejected'),
            };
        },
        onSuccess: async result => {
            if (contextRef.current === result.contextKey && selectingRef.current) {
                const visibleIds = visibleIdsRef.current;
                const failedIds = result.failed.map(entry => entry.id).filter(id => visibleIds.has(id));
                setSelected(new Set(failedIds));
                setSelecting(failedIds.length > 0);
            }
            if (result.succeeded.length > 0) notify(`${result.succeeded.length}件のルールを削除しました`, 'success');
            if (result.annictWarnings.length > 0) {
                notify(`${result.annictWarnings.length}件のルールは削除しましたが、Annictとの関連付けを解除できませんでした`, 'warning');
            }
            if (result.failed.length > 0) {
                const detail = result.failed
                    .slice(0, 3)
                    .map(entry => `ID ${entry.id}: ${entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason)}`)
                    .join(' / ');
                notify(`${result.failed.length}件を削除できませんでした: ${detail}`, 'error');
            }
            await refresh();
        },
        onError: async error => {
            notify(error.message, 'error');
            await refresh();
        },
    });
    const updateParams = (values: { keyword?: string; hasReserve?: boolean; userId?: ActiveUserId; page?: number }): void => {
        const next = new URLSearchParams(params);
        next.set('userId', String(values.userId ?? userId ?? 'master'));
        if (values.keyword !== undefined) {
            if (values.keyword.length === 0) next.delete('keyword');
            else next.set('keyword', values.keyword);
        }
        if (values.hasReserve !== undefined) {
            if (values.hasReserve) next.set('hasReserve', 'true');
            else next.delete('hasReserve');
        }
        if (values.userId !== undefined) next.set('userId', String(values.userId));
        next.set('page', (values.page ?? 1).toString(10));
        setParams(next);
    };
    useEffect(() => {
        if (rules.isSuccess && page > pageCount) {
            const value = new URLSearchParams(params);
            value.set('page', pageCount.toString(10));
            setParams(value, { replace: true });
        }
    }, [page, pageCount, params, rules.isSuccess, setParams]);
    const toggleSelected = (id: RuleId): void =>
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });
    const allSelected = useMemo(() => (rules.data?.rules.length ?? 0) > 0 && rules.data!.rules.every(rule => visibleSelected.has(rule.id)), [rules.data, visibleSelected]);
    const toggleUser = (value: ActiveUserId): void => updateParams({ userId: value ?? 'master' });

    return (
        <>
            <PageHeader
                title="ルール"
                actions={
                    <Stack direction="row" spacing={{ xs: 0.25, sm: 1 }} sx={{ alignItems: 'center' }}>
                        <UserSelector value={userId} onChange={toggleUser} minWidth={{ xs: 84, sm: 180 }} width={{ xs: 84, sm: 180 }} hideLabelOnMobile />
                        <Button
                            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                            variant={hasReserve ? 'contained' : 'outlined'}
                            onClick={() => updateParams({ hasReserve: !hasReserve })}
                        >
                            予約有
                        </Button>
                        <Tooltip title={hasReserve ? '予約なしも表示' : '予約有のみ表示'}>
                            <IconButton
                                aria-label={hasReserve ? '予約なしも表示' : '予約有のみ表示'}
                                color={hasReserve ? 'primary' : 'inherit'}
                                onClick={() => updateParams({ hasReserve: !hasReserve })}
                                sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                            >
                                <FilterAltOutlined />
                            </IconButton>
                        </Tooltip>
                        <Button
                            sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                            variant={selecting ? 'contained' : 'outlined'}
                            onClick={() => {
                                setSelecting(value => !value);
                                setSelected(new Set());
                            }}
                        >
                            {selecting ? '完了' : '選択'}
                        </Button>
                        <Tooltip title={selecting ? '選択を終了' : '選択'}>
                            <IconButton
                                aria-label={selecting ? '選択を終了' : '選択'}
                                color={selecting ? 'primary' : 'inherit'}
                                onClick={() => {
                                    setSelecting(value => !value);
                                    setSelected(new Set());
                                }}
                                sx={{ display: { xs: 'inline-flex', sm: 'none' } }}
                            >
                                {selecting ? <DoneOutlined /> : <CheckBoxOutlined />}
                            </IconButton>
                        </Tooltip>
                        <Tooltip title="更新">
                            <IconButton aria-label="更新" onClick={() => void refresh()}>
                                <RefreshOutlined />
                            </IconButton>
                        </Tooltip>
                    </Stack>
                }
            />
            <PageSubHeader>
                <Box
                    component="form"
                    autoComplete="off"
                    onSubmit={event => {
                        event.preventDefault();
                        updateParams({ keyword: keywordInput.trim() });
                    }}
                    sx={{ p: 1.5 }}
                >
                    <TextField
                        fullWidth
                        size="small"
                        label="ルールを検索"
                        value={keywordInput}
                        onChange={event => setKeywordInput(event.target.value)}
                        slotProps={{
                            input: {
                                endAdornment: (
                                    <InputAdornment position="end">
                                        <SearchOutlined />
                                    </InputAdornment>
                                ),
                            },
                        }}
                    />
                </Box>
            </PageSubHeader>
            {selecting && (
                <Stack direction="row" spacing={1} sx={{ p: 1.5, borderBottom: 1, borderColor: 'divider', alignItems: 'center' }}>
                    <Checkbox
                        checked={allSelected}
                        indeterminate={visibleSelected.size > 0 && !allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(rules.data?.rules.map(rule => rule.id) ?? []))}
                    />
                    <Typography sx={{ flex: 1 }}>{visibleSelected.size}件選択</Typography>
                    <Tooltip title="選択したルールを削除">
                        <Box component="span" sx={{ display: { xs: 'inline-flex', sm: 'none' } }}>
                            <IconButton
                                color="error"
                                aria-label="選択したルールを削除"
                                disabled={visibleSelected.size === 0 || removeSelected.isPending}
                                onClick={() => setBulkDeleteConfirmOpen(true)}
                            >
                                <DeleteOutlineOutlined />
                            </IconButton>
                        </Box>
                    </Tooltip>
                    <Button
                        color="error"
                        startIcon={<DeleteOutlineOutlined />}
                        disabled={visibleSelected.size === 0 || removeSelected.isPending}
                        onClick={() => setBulkDeleteConfirmOpen(true)}
                        sx={{ display: { xs: 'none', sm: 'inline-flex' } }}
                    >
                        選択したルールを削除
                    </Button>
                </Stack>
            )}
            {rules.isPending && rules.data === undefined ? (
                <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : null}
            {rules.error !== null && (
                <Alert
                    severity={rules.data === undefined ? 'error' : 'warning'}
                    sx={{ m: { xs: 1.5, md: 3 } }}
                    action={
                        <Button color="inherit" size="small" startIcon={<RefreshOutlined />} onClick={() => void rules.refetch()}>
                            再試行
                        </Button>
                    }
                >
                    {rules.data === undefined ? 'ルールの取得に失敗しました' : '最新のルールを取得できませんでした。表示中の結果を続けて利用できます'}: {rules.error.message}
                </Alert>
            )}
            {rules.data !== undefined && (
                <Stack spacing={1.25} sx={{ width: 'min(1100px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 }, pb: { xs: 12, md: 10 } }}>
                    {rules.data?.rules.map(rule => (
                        <RuleCard
                            key={rule.id}
                            rule={rule}
                            channels={channels.data}
                            selected={visibleSelected.has(rule.id)}
                            selecting={selecting}
                            onSelect={() => toggleSelected(rule.id)}
                            onToggle={enable => toggle.mutate({ rule, enable })}
                            onEdit={() => navigate(`/search?ruleId=${rule.id}`)}
                            onDelete={() => setDeleteTarget(rule)}
                            onRecordings={() =>
                                navigate(
                                    `/recorded?${new URLSearchParams({
                                        ruleId: String(rule.id),
                                        userId: String(userId),
                                    }).toString()}`,
                                )
                            }
                        />
                    ))}
                    {rules.data?.rules.length === 0 && (
                        <Typography color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>
                            該当するルールはありません
                        </Typography>
                    )}
                    {pageCount > 1 && (
                        <VueCompatiblePagination count={pageCount} page={page} onChange={(_event, value) => updateParams({ page: value })} sx={{ alignSelf: 'center', pt: 2 }} />
                    )}
                </Stack>
            )}
            {!selecting && (
                <Tooltip title="ルールを作成">
                    <Fab
                        color="primary"
                        aria-label="ルールを作成"
                        onClick={() => navigate('/search')}
                        sx={{
                            position: 'fixed',
                            right: 'calc(16px + env(safe-area-inset-right))',
                            bottom: 'calc(16px + env(safe-area-inset-bottom))',
                            zIndex: theme => theme.zIndex.appBar - 1,
                        }}
                    >
                        <AddOutlined />
                    </Fab>
                </Tooltip>
            )}
            <Dialog open={bulkDeleteConfirmOpen} onClose={() => !removeSelected.isPending && setBulkDeleteConfirmOpen(false)}>
                <DialogTitle>選択したルールを削除</DialogTitle>
                <DialogContent>
                    <Typography>{visibleSelected.size}件のルールを削除します。</Typography>
                    <Typography color="text.secondary" sx={{ mt: 1 }}>
                        作成済みの予約も更新されます。この操作は取り消せません。
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button disabled={removeSelected.isPending} onClick={() => setBulkDeleteConfirmOpen(false)}>
                        キャンセル
                    </Button>
                    <Button
                        color="error"
                        variant="contained"
                        disabled={visibleSelected.size === 0 || removeSelected.isPending}
                        onClick={() => {
                            setBulkDeleteConfirmOpen(false);
                            removeSelected.mutate({ ids: [...visibleSelected], contextKey });
                        }}
                    >
                        {removeSelected.isPending ? '削除中…' : '削除'}
                    </Button>
                </DialogActions>
            </Dialog>
            <Dialog open={deleteTarget !== null} onClose={() => !remove.isPending && setDeleteTarget(null)}>
                <DialogTitle>ルールを削除</DialogTitle>
                <DialogContent>
                    <Typography>{deleteTarget?.searchOption.keyword || '時刻指定ルール'}</Typography>
                    <Typography color="text.secondary" sx={{ mt: 1 }}>
                        このルールを削除します。作成済みの予約も更新されます。
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button disabled={remove.isPending} onClick={() => setDeleteTarget(null)}>
                        戻る
                    </Button>
                    <Button color="error" variant="contained" disabled={remove.isPending} onClick={() => deleteTarget !== null && remove.mutate(deleteTarget.id)}>
                        削除
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
