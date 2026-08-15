import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
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
    InputAdornment,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Rule, RuleId } from '../../../api';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { PageSubHeader } from '../components/PageSubHeader';
import { UserSelector } from '../components/UserSelector';
import { VueCompatiblePagination } from '../components/VueCompatiblePagination';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { channelName, channelTypeLabel, genreNames } from '../core/program';
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
        .genres!.map(item => genreNames[item.genre] ?? `ジャンル${item.genre}`)
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
}: {
    rule: Rule;
    channels: Awaited<ReturnType<typeof api.getChannels>> | undefined;
    selected: boolean;
    selecting: boolean;
    onSelect: () => void;
    onToggle: (enable: boolean) => void;
    onEdit: () => void;
    onDelete: () => void;
}): ReactNode {
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
                        </Typography>
                    )}
                </Box>
                {!selecting && (
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        <Switch checked={rule.reserveOption.enable} onChange={event => onToggle(event.target.checked)} slotProps={{ input: { 'aria-label': 'ルール有効' } }} />
                        <IconButton aria-label="編集" onClick={onEdit}>
                            <EditOutlined />
                        </IconButton>
                        <IconButton aria-label="削除" onClick={onDelete}>
                            <DeleteOutlineOutlined />
                        </IconButton>
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
    const [params, setParams] = useSearchParams();
    const page = Math.max(1, Number(params.get('page')) || 1);
    const [userId, setUserId] = useState<ActiveUserId>(activeUser ?? 'master');
    const [keywordInput, setKeywordInput] = useState(params.get('keyword') ?? '');
    const keyword = params.get('keyword') ?? '';
    const hasReserve = params.get('hasReserve') === 'true';
    const [selecting, setSelecting] = useState(false);
    const [selected, setSelected] = useState<Set<RuleId>>(new Set());
    const [deleteTarget, setDeleteTarget] = useState<Rule | null>(null);
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
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
    });
    const pageCount = Math.max(1, Math.ceil((rules.data?.total ?? 0) / settings.rulesLength));

    useEffect(() => {
        setSelecting(false);
        setSelected(new Set());
    }, [userId, keyword, hasReserve, page]);

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
        onSuccess: async (_result, variables) => {
            notify(`ルールを${variables.enable ? '有効' : '無効'}にしました`, 'success');
            await refresh();
        },
        onError: error => notify(`ルールの変更に失敗しました: ${error.message}`, 'error'),
    });
    const remove = useMutation({
        mutationFn: (ruleId: RuleId) => api.deleteRule(ruleId),
        onSuccess: async () => {
            notify('ルールを削除しました', 'success');
            setDeleteTarget(null);
            await refresh();
        },
        onError: error => notify(`ルールの削除に失敗しました: ${error.message}`, 'error'),
    });
    const removeSelected = useMutation({
        mutationFn: async () => {
            const ids = [...selected];
            const results = await Promise.allSettled(ids.map(id => api.deleteRule(id)));
            return {
                succeeded: ids.filter((_id, index) => results[index].status === 'fulfilled'),
                failed: ids
                    .map((id, index) => ({ id, result: results[index] }))
                    .filter((entry): entry is { id: RuleId; result: PromiseRejectedResult } => entry.result.status === 'rejected'),
            };
        },
        onSuccess: async result => {
            setSelected(new Set(result.failed.map(entry => entry.id)));
            setSelecting(result.failed.length > 0);
            if (result.succeeded.length > 0) notify(`${result.succeeded.length}件のルールを削除しました`, 'success');
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
    const updateParams = (values: { keyword?: string; hasReserve?: boolean; page?: number }): void => {
        const next = new URLSearchParams(params);
        if (values.keyword !== undefined) {
            if (values.keyword.length === 0) next.delete('keyword');
            else next.set('keyword', values.keyword);
        }
        if (values.hasReserve !== undefined) {
            if (values.hasReserve) next.set('hasReserve', 'true');
            else next.delete('hasReserve');
        }
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
    const allSelected = useMemo(() => (rules.data?.rules.length ?? 0) > 0 && rules.data!.rules.every(rule => selected.has(rule.id)), [rules.data, selected]);

    return (
        <>
            <PageHeader
                title="ルール"
                actions={
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <UserSelector value={userId} onChange={setUserId} />
                        <Button variant={hasReserve ? 'contained' : 'outlined'} onClick={() => updateParams({ hasReserve: !hasReserve })}>
                            予約有
                        </Button>
                        <Button
                            variant={selecting ? 'contained' : 'outlined'}
                            onClick={() => {
                                setSelecting(value => !value);
                                setSelected(new Set());
                            }}
                        >
                            {selecting ? '完了' : '選択'}
                        </Button>
                        <IconButton aria-label="更新" onClick={() => void refresh()}>
                            <RefreshOutlined />
                        </IconButton>
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
                        indeterminate={selected.size > 0 && !allSelected}
                        onChange={() => setSelected(allSelected ? new Set() : new Set(rules.data?.rules.map(rule => rule.id) ?? []))}
                    />
                    <Typography sx={{ flex: 1 }}>{selected.size}件選択</Typography>
                    <Button color="error" startIcon={<DeleteOutlineOutlined />} disabled={selected.size === 0 || removeSelected.isPending} onClick={() => removeSelected.mutate()}>
                        選択したルールを削除
                    </Button>
                </Stack>
            )}
            {rules.isPending ? (
                <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : rules.error !== null ? (
                <Typography color="error" sx={{ p: 3 }}>
                    ルールの取得に失敗しました: {rules.error.message}
                </Typography>
            ) : (
                <Stack spacing={1.25} sx={{ width: 'min(1100px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                    {rules.data?.rules.map(rule => (
                        <RuleCard
                            key={rule.id}
                            rule={rule}
                            channels={channels.data}
                            selected={selected.has(rule.id)}
                            selecting={selecting}
                            onSelect={() => toggleSelected(rule.id)}
                            onToggle={enable => toggle.mutate({ rule, enable })}
                            onEdit={() => navigate(`/search?ruleId=${rule.id}`)}
                            onDelete={() => setDeleteTarget(rule)}
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
            <Dialog open={deleteTarget !== null} onClose={() => setDeleteTarget(null)}>
                <DialogTitle>ルールを削除</DialogTitle>
                <DialogContent>
                    <Typography>{deleteTarget?.searchOption.keyword || '時刻指定ルール'}</Typography>
                    <Typography color="text.secondary" sx={{ mt: 1 }}>
                        このルールを削除します。作成済みの予約も更新されます。
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteTarget(null)}>戻る</Button>
                    <Button color="error" variant="contained" disabled={remove.isPending} onClick={() => deleteTarget !== null && remove.mutate(deleteTarget.id)}>
                        削除
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
