import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DeleteSweepOutlined from '@mui/icons-material/DeleteSweepOutlined';
import DriveFileMoveOutlined from '@mui/icons-material/DriveFileMoveOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import MoreVertOutlined from '@mui/icons-material/MoreVertOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SelectAllOutlined from '@mui/icons-material/SelectAllOutlined';
import UploadOutlined from '@mui/icons-material/UploadOutlined';
import {
    Box,
    Alert,
    Autocomplete,
    Button,
    Card,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    Divider,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    LinearProgress,
    Menu,
    MenuItem,
    Pagination,
    Popover,
    Select,
    Stack,
    Table,
    TableBody,
    TableCell,
    TableContainer,
    TableHead,
    TableRow,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { GetRecordedOption, RecordedCleanupPlanResult, RecordedItem } from '../../../api';
import { type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ChannelSelector } from '../components/ChannelSelector';
import { DateTextInput } from '../components/DateTimeInput';
import { RecordedItemActions } from '../components/RecordedItemActions';
import { UserSelector } from '../components/UserSelector';
import { api } from '../core/api/queries';
import { createRecordedRelatedSearchOption } from '../core/media/recorded';
import { useNotifications } from '../core/notifications/Notifications';
import { withBasePath } from '../core/path';
import { formatProgramTime, genreNames, programDuration } from '../core/program';
import type { ActiveUserId } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';

interface RecordedFilters {
    keyword: string;
    ruleId: number | '';
    manualOnly: boolean;
    channelId: number | '';
    genre: number | '';
    encodeModes: string[];
    encodeModeMatch: 'include' | 'only';
    hasOriginalFile: boolean;
    hasDrop: boolean;
    hasError: boolean;
    hasScrambling: boolean;
    startDate: string;
    endDate: string;
    dateMode: 'range' | 'specific';
    year: string;
    month: string;
    day: string;
}

const emptyFilters: RecordedFilters = {
    keyword: '',
    ruleId: '',
    manualOnly: false,
    channelId: '',
    genre: '',
    encodeModes: [],
    encodeModeMatch: 'include',
    hasOriginalFile: false,
    hasDrop: false,
    hasError: false,
    hasScrambling: false,
    startDate: '',
    endDate: '',
    dateMode: 'range',
    year: '',
    month: '',
    day: '',
};

function specificDateRange(filters: RecordedFilters): { start?: number; end?: number } {
    const year = Number(filters.year);
    const month = filters.month === '' ? undefined : Number(filters.month);
    const day = filters.day === '' ? undefined : Number(filters.day);
    if (!Number.isInteger(year) || year < 1) return {};
    if (month !== undefined && (!Number.isInteger(month) || month < 1 || month > 12)) return {};
    if (day !== undefined && (month === undefined || !Number.isInteger(day) || day < 1 || day > 31)) return {};
    const start = new Date(year, (month ?? 1) - 1, day ?? 1).getTime();
    const endExclusive =
        day !== undefined ? new Date(year, month! - 1, day + 1).getTime() : month !== undefined ? new Date(year, month, 1).getTime() : new Date(year + 1, 0, 1).getTime();
    return { start, end: endExclusive - 1 };
}

function recordedTime(item: RecordedItem): string {
    const start = new Intl.DateTimeFormat('ja-JP', {
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(item.startAt));
    return `${start} - ${formatProgramTime(item.endAt)} (${programDuration(item)} m)`;
}

function toStartOfDay(value: string): number | undefined {
    if (value.length === 0) return undefined;
    const result = new Date(`${value}T00:00:00`).getTime();
    return Number.isFinite(result) ? result : undefined;
}

function toEndOfDay(value: string): number | undefined {
    const start = toStartOfDay(value);
    return start === undefined ? undefined : start + 24 * 60 * 60 * 1000 - 1;
}

function RecordedCard({
    item,
    channel,
    editMode,
    selected,
    focused,
    showDrop,
    onOpen,
    onSelect,
    onSearch,
    onChanged,
    onDeleted,
}: {
    item: RecordedItem;
    channel: string;
    editMode: boolean;
    selected: boolean;
    focused: boolean;
    showDrop: boolean;
    onOpen: () => void;
    onSelect: () => void;
    onSearch: () => void;
    onChanged: () => void;
    onDeleted: () => void;
}): ReactNode {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const thumbnail = item.thumbnails?.[0];
    const drop = item.dropLogFile;
    const hasError = drop !== undefined && (drop.dropCnt > 0 || drop.errorCnt > 0 || drop.scramblingCnt > 0);
    const clickCard = (): void => (editMode ? onSelect() : onOpen());
    return (
        <Card
            id={`recorded-card-${item.id}`}
            elevation={0}
            onDragStart={event => {
                if (editMode) event.preventDefault();
            }}
            sx={{
                width: '100%',
                maxWidth: { xs: 'none', sm: 300 },
                height: { xs: 108, sm: 'auto' },
                display: { xs: 'flex', sm: 'block' },
                overflow: 'hidden',
                cursor: 'pointer',
                outline: selected || focused ? 2 : 0,
                outlineColor: focused ? 'warning.main' : 'primary.main',
                bgcolor: selected ? 'action.selected' : focused ? 'action.hover' : 'background.paper',
                transition: 'box-shadow 120ms ease, transform 120ms ease',
                '&:hover': { boxShadow: 5, transform: 'translateY(-1px)' },
            }}
        >
            <Box
                onClick={clickCard}
                sx={{
                    position: 'relative',
                    width: { xs: '32%', sm: '100%' },
                    maxWidth: { xs: 190, sm: 'none' },
                    height: { xs: '100%', sm: 'auto' },
                    aspectRatio: { xs: 'auto', sm: '16 / 9' },
                    flexShrink: 0,
                    bgcolor: '#000',
                    overflow: 'hidden',
                }}
            >
                <Box
                    component="img"
                    src={thumbnail === undefined ? undefined : withBasePath(`/api/thumbnails/${thumbnail}`)}
                    alt=""
                    draggable={!editMode}
                    loading="lazy"
                    onError={event => {
                        event.currentTarget.style.display = 'none';
                    }}
                    sx={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                />
                {editMode && <Checkbox checked={selected} sx={{ position: 'absolute', top: 2, left: 2, bgcolor: 'rgba(0,0,0,.45)' }} />}
            </Box>
            <Box sx={{ p: 1, flex: 1, minWidth: 0, alignSelf: { xs: 'center', sm: 'auto' } }} onClick={clickCard}>
                <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
                    <Typography variant="body2" noWrap title={item.name} sx={{ flex: 1, fontWeight: 700 }}>
                        {item.name}
                    </Typography>
                    {!editMode && (
                        <IconButton
                            size="small"
                            aria-label="録画メニュー"
                            onClick={event => {
                                event.stopPropagation();
                                setAnchor(event.currentTarget);
                            }}
                        >
                            <MoreVertOutlined fontSize="small" />
                        </IconButton>
                    )}
                </Stack>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {channel}
                </Typography>
                <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                    {recordedTime(item)}
                </Typography>
                {showDrop && drop !== undefined ? (
                    <Typography variant="caption" color={hasError ? 'error' : 'text.secondary'} noWrap sx={{ display: 'block' }}>
                        drop: {drop.dropCnt}, error: {drop.errorCnt}, scrambling: {drop.scramblingCnt}
                    </Typography>
                ) : (
                    <Typography variant="caption" noWrap title={item.description} sx={{ display: 'block' }}>
                        {item.description ?? '\u00a0'}
                    </Typography>
                )}
            </Box>
            <RecordedItemActions item={item} anchorEl={anchor} onClose={() => setAnchor(null)} onSearch={onSearch} onEncode={onOpen} onChanged={onChanged} onDeleted={onDeleted} />
        </Card>
    );
}

function RecordedTableRow({
    item,
    channel,
    editMode,
    selected,
    focused,
    showDrop,
    onOpen,
    onSelect,
    onSearch,
    onChanged,
    onDeleted,
}: {
    item: RecordedItem;
    channel: string;
    editMode: boolean;
    selected: boolean;
    focused: boolean;
    showDrop: boolean;
    onOpen: () => void;
    onSelect: () => void;
    onSearch: () => void;
    onChanged: () => void;
    onDeleted: () => void;
}): ReactNode {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    const drop = item.dropLogFile;
    const hasError = drop !== undefined && (drop.dropCnt > 0 || drop.errorCnt > 0 || drop.scramblingCnt > 0);
    return (
        <TableRow
            id={`recorded-card-${item.id}`}
            hover
            selected={selected}
            onClick={() => (editMode ? onSelect() : onOpen())}
            sx={{ cursor: 'pointer', bgcolor: focused ? 'action.hover' : undefined, outline: focused ? 2 : 0, outlineColor: 'warning.main' }}
        >
            <TableCell sx={{ minWidth: 280 }}>
                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                    {editMode && <Checkbox checked={selected} tabIndex={-1} />}
                    <Typography variant="body2" sx={{ fontWeight: 700 }}>
                        {item.name}
                    </Typography>
                    {showDrop && drop !== undefined && (
                        <Typography variant="caption" color={hasError ? 'error' : 'text.secondary'} sx={{ whiteSpace: 'nowrap' }}>
                            drop: {drop.dropCnt}, error: {drop.errorCnt}, scrambling: {drop.scramblingCnt}
                        </Typography>
                    )}
                </Stack>
            </TableCell>
            <TableCell sx={{ minWidth: 150 }}>{channel}</TableCell>
            <TableCell sx={{ minWidth: 220, whiteSpace: 'nowrap' }}>{recordedTime(item)}</TableCell>
            <TableCell align="right" sx={{ width: 60 }}>
                {!editMode && (
                    <IconButton
                        size="small"
                        aria-label="録画メニュー"
                        onClick={event => {
                            event.stopPropagation();
                            setAnchor(event.currentTarget);
                        }}
                    >
                        <MoreVertOutlined fontSize="small" />
                    </IconButton>
                )}
                <RecordedItemActions
                    item={item}
                    anchorEl={anchor}
                    onClose={() => setAnchor(null)}
                    onSearch={onSearch}
                    onEncode={onOpen}
                    onChanged={onChanged}
                    onDeleted={onDeleted}
                />
            </TableCell>
        </TableRow>
    );
}

export function RecordedPage(): ReactNode {
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const settings = useSettings();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const initialPage = Number(searchParams.get('page'));
    const initialUserId = searchParams.get('userId');
    const initialFocus = Number(searchParams.get('focus'));
    const [userId, setUserId] = useState<ActiveUserId>(
        initialUserId === 'master' ? 'master' : Number.isSafeInteger(Number(initialUserId)) && Number(initialUserId) > 0 ? Number(initialUserId) : null,
    );
    const [page, setPage] = useState(Number.isSafeInteger(initialPage) && initialPage > 0 ? initialPage : 1);
    const [focusedRecordedId] = useState<number | null>(Number.isSafeInteger(initialFocus) && initialFocus > 0 ? initialFocus : null);
    const initialRuleIdParam = searchParams.get('ruleId');
    const initialRuleId = initialRuleIdParam === null ? Number.NaN : Number(initialRuleIdParam);
    const initialFilters: RecordedFilters = {
        ...emptyFilters,
        keyword: searchParams.get('keyword') ?? '',
        ruleId: Number.isSafeInteger(initialRuleId) && initialRuleId >= 0 ? initialRuleId : '',
    };
    const [filters, setFilters] = useState<RecordedFilters>(initialFilters);
    const [draftFilters, setDraftFilters] = useState<RecordedFilters>(initialFilters);
    const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null);
    const [mainMenuAnchor, setMainMenuAnchor] = useState<HTMLElement | null>(null);
    const [editMode, setEditMode] = useState(false);
    const [selected, setSelected] = useState<Set<number>>(new Set());
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [bulkUserOpen, setBulkUserOpen] = useState(false);
    const [bulkUserId, setBulkUserId] = useState<ActiveUserId>(null);
    const [moveOpen, setMoveOpen] = useState(false);
    const [moveSubDirectory, setMoveSubDirectory] = useState('');
    const [cleanupOpen, setCleanupOpen] = useState(false);
    const [cleanupConfirmOpen, setCleanupConfirmOpen] = useState(false);
    const [cleanupPath, setCleanupPath] = useState('');
    const [cleanupPlan, setCleanupPlan] = useState<RecordedCleanupPlanResult | null>(null);
    const specificMonthRef = useRef<HTMLInputElement>(null);
    const specificDayRef = useRef<HTMLInputElement>(null);
    useEffect(() => {
        if (!searchParams.has('page') && !searchParams.has('userId') && !searchParams.has('focus')) return;
        const next = new URLSearchParams(searchParams);
        next.delete('page');
        next.delete('userId');
        next.delete('focus');
        setSearchParams(next, { replace: true });
    }, [searchParams, setSearchParams]);
    const onUserChange = useCallback((value: ActiveUserId) => {
        setUserId(value);
        setPage(1);
    }, []);
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const searchOptions = useQuery({ queryKey: ['recorded-options'], queryFn: api.getRecordedSearchOptions, staleTime: 60_000 });
    const rules = useQuery({ queryKey: ['recorded-search-rules'], queryFn: () => api.getRules({ type: 'normal', limit: 1000 }), staleTime: 60_000 });
    const specificRange = specificDateRange(filters);
    const requestOption: GetRecordedOption = {
        isHalfWidth: settings.isHalfWidthDisplayed,
        offset: (page - 1) * settings.recordedLength,
        limit: settings.recordedLength,
        keyword: filters.keyword.length === 0 ? undefined : filters.keyword,
        ruleId: filters.manualOnly ? 0 : typeof filters.ruleId === 'number' ? filters.ruleId : undefined,
        channelId: typeof filters.channelId === 'number' ? filters.channelId : undefined,
        genre: typeof filters.genre === 'number' ? filters.genre : undefined,
        encodeModes: filters.encodeModes.length === 0 ? undefined : filters.encodeModes,
        encodeModeMatch: filters.encodeModes.length === 0 ? undefined : filters.encodeModeMatch,
        hasOriginalFile: filters.hasOriginalFile || undefined,
        hasDrop: filters.hasDrop || undefined,
        hasError: filters.hasError || undefined,
        hasScrambling: filters.hasScrambling || undefined,
        recordedStartAt: filters.dateMode === 'range' ? toStartOfDay(filters.startDate) : specificRange.start,
        recordedEndAt: filters.dateMode === 'range' ? toEndOfDay(filters.endDate) : specificRange.end,
        userId: typeof userId === 'number' ? userId : undefined,
    };
    const records = useQuery({
        queryKey: ['recorded', requestOption],
        queryFn: () => api.getRecorded(requestOption),
        enabled: userId !== null,
    });
    const subDirectories = useQuery({
        queryKey: ['recorded-sub-directories'],
        queryFn: api.getRecordedSubDirectories,
        enabled: moveOpen,
        staleTime: 30_000,
    });
    const finishBulkEdit = async (): Promise<void> => {
        setBulkUserOpen(false);
        setMoveOpen(false);
        setEditMode(false);
        setSelected(new Set());
        await queryClient.invalidateQueries({ queryKey: ['recorded'] });
    };
    const bulkUpdateUser = useMutation({
        mutationFn: (nextUserId: number) =>
            api.bulkUpdateRecordedUser({
                recordedIds: Array.from(selected),
                userId: nextUserId,
            }),
        onSuccess: async result => {
            notify(`${result.updatedCount} 件のユーザーを変更しました。`, 'success');
            await finishBulkEdit();
        },
        onError: async error => {
            notify(`ユーザーの一括変更に失敗しました: ${error.message}`, 'error');
            await queryClient.invalidateQueries({ queryKey: ['recorded'] });
        },
    });
    const moveSelected = useMutation({
        mutationFn: () =>
            api.moveRecordedToSubDirectory({
                recordedIds: Array.from(selected),
                subDirectory: moveSubDirectory,
            }),
        onSuccess: async result => {
            const destination = moveSubDirectory.trim().length === 0 ? '録画ルート直下' : moveSubDirectory.trim();
            notify(`${result.updatedCount} 件（${result.movedFileCount} ファイル）を「${destination}」へ移動しました。`, 'success');
            await queryClient.invalidateQueries({ queryKey: ['recorded-sub-directories'] });
            await finishBulkEdit();
        },
        onError: async error => {
            notify(`サブディレクトリ移動に失敗しました: ${error.message}`, 'error');
            await Promise.all([queryClient.invalidateQueries({ queryKey: ['recorded'] }), queryClient.invalidateQueries({ queryKey: ['recorded-sub-directories'] })]);
        },
    });
    const deleteSelected = useMutation({
        mutationFn: async () => {
            const items = records.data?.records.filter(value => selected.has(value.id)) ?? [];
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
            setDeleteOpen(false);
            setSelected(new Set(result.failed.map(entry => entry.item.id)));
            setEditMode(result.failed.length > 0);
            if (result.succeeded.length > 0) notify(`${result.succeeded.length}件の番組を削除しました。`, 'success');
            if (result.failed.length > 0) {
                const detail = result.failed
                    .slice(0, 3)
                    .map(entry => `${entry.item.name}: ${entry.result.reason instanceof Error ? entry.result.reason.message : String(entry.result.reason)}`)
                    .join(' / ');
                notify(`${result.failed.length}件を削除できませんでした: ${detail}`, 'error');
            }
            await queryClient.invalidateQueries({ queryKey: ['recorded'] });
        },
        onError: async error => {
            notify(`削除に失敗しました: ${error.message}`, 'error');
            await queryClient.invalidateQueries({ queryKey: ['recorded'] });
        },
    });
    const createCleanupPlan = useMutation({
        mutationFn: async () => {
            const [result] = await Promise.all([api.createRecordedCleanupPlan(), new Promise(resolve => window.setTimeout(resolve, 1_000))]);
            return result;
        },
        onSuccess: result => {
            setCleanupPlan(result);
            setCleanupPath(result.planPath);
            notify(`削除候補をリストへ書き出しました（録画 ${result.recordedFileCount} 件、サムネイル ${result.thumbnailFileCount} 件）。`, 'success');
        },
        onError: error => notify(`クリーンアップ候補を作成できません: ${error.message}`, 'error'),
    });
    const executeCleanup = useMutation({
        mutationFn: async () => {
            const [result] = await Promise.all([api.executeRecordedCleanupPlan(cleanupPath), new Promise(resolve => window.setTimeout(resolve, 1_000))]);
            return result;
        },
        onSuccess: async result => {
            setCleanupConfirmOpen(false);
            setCleanupOpen(false);
            const deletedFileCount = result.deletedRecordedFileCount + result.deletedDropLogFileCount + result.deletedThumbnailFileCount;
            const removedDbCount = result.removedMissingVideoFileCount + result.removedMissingDropLogFileCount + result.removedMissingThumbnailFileCount;
            notify(`クリーンアップ完了: ファイル${deletedFileCount}件, DB${removedDbCount}件`, 'success');
            await queryClient.invalidateQueries({ queryKey: ['recorded'] });
        },
        onError: error => notify(`クリーンアップに失敗しました: ${error.message}`, 'error'),
    });
    const channelMap = useMemo(() => new Map(channels.data?.map(channel => [channel.id, channel.name])), [channels.data]);
    const recordedChannelOptions = useMemo(
        () =>
            (searchOptions.data?.channels ?? []).map(option => {
                const name = channelMap.get(option.channelId) ?? option.channelId.toString(10);
                return { id: option.channelId, label: `${name} (${option.cnt})`, searchText: name };
            }),
        [channelMap, searchOptions.data?.channels],
    );
    const totalPages = Math.max(1, Math.ceil((records.data?.total ?? 0) / settings.recordedLength));
    const selectedRecords = records.data?.records.filter(item => selected.has(item.id)) ?? [];
    const hasEncodingSelection = selectedRecords.some(item => item.isEncoding);
    useEffect(() => {
        if (records.isSuccess && page > totalPages) setPage(totalPages);
    }, [page, records.isSuccess, totalPages]);
    useEffect(() => {
        if (focusedRecordedId === null || !records.data?.records.some(item => item.id === focusedRecordedId)) return;
        const frame = window.requestAnimationFrame(() => {
            document.getElementById(`recorded-card-${focusedRecordedId}`)?.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [focusedRecordedId, records.data?.records]);
    const toggleSelection = (id: number): void =>
        setSelected(current => {
            const next = new Set(current);
            if (next.has(id)) next.delete(id);
            else next.add(id);
            return next;
        });

    return (
        <>
            <PageHeader
                title={editMode ? `${selected.size} 件選択` : '録画済み'}
                actions={
                    editMode ? (
                        <Stack direction="row" spacing={0.5}>
                            <Tooltip title="すべて選択">
                                <IconButton onClick={() => setSelected(new Set(records.data?.records.map(item => item.id) ?? []))}>
                                    <SelectAllOutlined />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="ユーザーを一括変更">
                                <span>
                                    <IconButton
                                        disabled={selected.size === 0}
                                        onClick={() => {
                                            setBulkUserId(null);
                                            setBulkUserOpen(true);
                                        }}
                                    >
                                        <AccountCircleOutlined />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="サブディレクトリへ一括移動">
                                <span>
                                    <IconButton
                                        disabled={selected.size === 0}
                                        onClick={() => {
                                            setMoveSubDirectory('');
                                            setMoveOpen(true);
                                        }}
                                    >
                                        <DriveFileMoveOutlined />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="削除">
                                <span>
                                    <IconButton disabled={selected.size === 0} onClick={() => setDeleteOpen(true)}>
                                        <DeleteOutlineOutlined />
                                    </IconButton>
                                </span>
                            </Tooltip>
                            <Tooltip title="編集を終了">
                                <IconButton
                                    onClick={() => {
                                        setEditMode(false);
                                        setSelected(new Set());
                                    }}
                                >
                                    <CloseOutlined />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                    ) : (
                        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center' }}>
                            <UserSelector value={userId} onChange={onUserChange} minWidth={160} />
                            <Tooltip title="検索">
                                <IconButton
                                    onClick={event => {
                                        setDraftFilters(filters);
                                        setSearchAnchor(event.currentTarget);
                                    }}
                                >
                                    <SearchOutlined />
                                </IconButton>
                            </Tooltip>
                            <Tooltip title="メニュー">
                                <IconButton onClick={(event: MouseEvent<HTMLElement>) => setMainMenuAnchor(event.currentTarget)}>
                                    <MoreVertOutlined />
                                </IconButton>
                            </Tooltip>
                        </Stack>
                    )
                }
            />
            <Menu
                anchorEl={mainMenuAnchor}
                open={mainMenuAnchor !== null}
                onClose={() => setMainMenuAnchor(null)}
                anchorOrigin={{ vertical: 'top', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
            >
                <MenuItem
                    onClick={() => {
                        setMainMenuAnchor(null);
                        setEditMode(true);
                    }}
                >
                    <EditOutlined sx={{ mr: 1.5 }} />
                    編集
                </MenuItem>
                <MenuItem
                    onClick={() => {
                        setMainMenuAnchor(null);
                        setCleanupOpen(true);
                    }}
                >
                    <DeleteSweepOutlined sx={{ mr: 1.5 }} />
                    クリーンアップ
                </MenuItem>
                <MenuItem
                    onClick={() => {
                        setMainMenuAnchor(null);
                        void navigate('/recorded/upload');
                    }}
                >
                    <UploadOutlined sx={{ mr: 1.5 }} />
                    アップロード
                </MenuItem>
            </Menu>
            <Box sx={{ p: 0.5 }}>
                {records.isPending ? (
                    <Box sx={{ py: 8, textAlign: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : records.error !== null ? (
                    <Typography color="error" sx={{ p: 2 }}>
                        録画済み情報を取得できません: {records.error.message}
                    </Typography>
                ) : records.data.records.length === 0 ? (
                    <Typography color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>
                        録画済み番組はありません。
                    </Typography>
                ) : settings.isShowTableMode ? (
                    <TableContainer component={Card} variant="outlined" sx={{ width: 'min(1000px, 100%)', mx: 'auto' }}>
                        <Table size="small">
                            <TableHead>
                                <TableRow>
                                    <TableCell>タイトル</TableCell>
                                    <TableCell>放送局</TableCell>
                                    <TableCell>時間</TableCell>
                                    <TableCell aria-label="操作" />
                                </TableRow>
                            </TableHead>
                            <TableBody>
                                {records.data.records.map(item => (
                                    <RecordedTableRow
                                        key={item.id}
                                        item={item}
                                        channel={channelMap.get(item.channelId) ?? item.channelId.toString(10)}
                                        editMode={editMode}
                                        selected={selected.has(item.id)}
                                        focused={focusedRecordedId === item.id}
                                        showDrop={settings.isShowDropInfoInsteadOfDescription}
                                        onOpen={() => void navigate(`/recorded/detail/${item.id}`)}
                                        onSelect={() => toggleSelection(item.id)}
                                        onSearch={() => {
                                            const option = createRecordedRelatedSearchOption(item);
                                            setFilters(current => ({ ...current, keyword: option.keyword ?? '', ruleId: option.ruleId ?? '' }));
                                            setPage(1);
                                        }}
                                        onChanged={() => void queryClient.invalidateQueries({ queryKey: ['recorded'] })}
                                        onDeleted={() => void queryClient.invalidateQueries({ queryKey: ['recorded'] })}
                                    />
                                ))}
                            </TableBody>
                        </Table>
                    </TableContainer>
                ) : (
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(auto-fill, minmax(min(280px, 100%), 300px))' },
                            justifyContent: 'center',
                            gap: { xs: 0.5, sm: 1 },
                        }}
                    >
                        {records.data.records.map(item => (
                            <RecordedCard
                                key={item.id}
                                item={item}
                                channel={channelMap.get(item.channelId) ?? item.channelId.toString(10)}
                                editMode={editMode}
                                selected={selected.has(item.id)}
                                focused={focusedRecordedId === item.id}
                                showDrop={settings.isShowDropInfoInsteadOfDescription}
                                onOpen={() => void navigate(`/recorded/detail/${item.id}`)}
                                onSelect={() => toggleSelection(item.id)}
                                onSearch={() => {
                                    const option = createRecordedRelatedSearchOption(item);
                                    setFilters(current => ({ ...current, keyword: option.keyword ?? '', ruleId: option.ruleId ?? '' }));
                                    setPage(1);
                                }}
                                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['recorded'] })}
                                onDeleted={() => void queryClient.invalidateQueries({ queryKey: ['recorded'] })}
                            />
                        ))}
                    </Box>
                )}
                {totalPages > 1 && (
                    <Pagination count={totalPages} page={page} onChange={(_event, value) => setPage(value)} sx={{ my: 2, display: 'flex', justifyContent: 'center' }} />
                )}
            </Box>

            <Popover
                open={searchAnchor !== null}
                anchorEl={searchAnchor}
                onClose={() => setSearchAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { width: 640, maxWidth: 'calc(100vw - 16px)' } } }}
            >
                <Box sx={{ p: 2 }}>
                    <Typography variant="h6" sx={{ mb: 1 }}>
                        録画済み検索
                    </Typography>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <TextField
                            autoFocus
                            label="キーワード"
                            value={draftFilters.keyword}
                            onChange={event => setDraftFilters(value => ({ ...value, keyword: event.target.value }))}
                        />
                        <FormControl fullWidth>
                            <InputLabel>ルール</InputLabel>
                            <Select
                                label="ルール"
                                value={draftFilters.ruleId}
                                disabled={draftFilters.manualOnly}
                                onChange={event => setDraftFilters(value => ({ ...value, ruleId: event.target.value as number | '' }))}
                            >
                                <MenuItem value="">
                                    <em>すべて</em>
                                </MenuItem>
                                {rules.data?.rules.map(rule => (
                                    <MenuItem key={rule.id} value={rule.id}>
                                        {rule.searchOption.keyword ?? `ルール ${rule.id}`}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <ChannelSelector
                            options={recordedChannelOptions}
                            value={draftFilters.channelId}
                            placeholder="すべて／局名を入力して絞り込み"
                            loading={searchOptions.isLoading || channels.isLoading}
                            onChange={value => setDraftFilters(current => ({ ...current, channelId: value }))}
                        />
                        <FormControl fullWidth>
                            <InputLabel>ジャンル</InputLabel>
                            <Select
                                label="ジャンル"
                                value={draftFilters.genre}
                                onChange={event => setDraftFilters(value => ({ ...value, genre: event.target.value as number | '' }))}
                            >
                                <MenuItem value="">
                                    <em>すべて</em>
                                </MenuItem>
                                {searchOptions.data?.genres.map(option => (
                                    <MenuItem key={option.genre} value={option.genre}>
                                        {genreNames[option.genre] ?? option.genre} ({option.cnt})
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                            <FormControl fullWidth>
                                <InputLabel>ファイルタイプ</InputLabel>
                                <Select
                                    multiple
                                    label="ファイルタイプ"
                                    value={draftFilters.encodeModes}
                                    onChange={event => setDraftFilters(value => ({ ...value, encodeModes: event.target.value as string[] }))}
                                    renderValue={values => values.join('、')}
                                >
                                    <MenuItem value="__ts__">
                                        <Checkbox checked={draftFilters.encodeModes.includes('__ts__')} />
                                        TS
                                    </MenuItem>
                                    {searchOptions.data?.encode.map(option => (
                                        <MenuItem key={option.name} value={option.name}>
                                            <Checkbox checked={draftFilters.encodeModes.includes(option.name)} />
                                            {option.suffix === undefined ? option.name : `${option.name} (${option.suffix})`}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <ToggleButtonGroup
                                exclusive
                                size="small"
                                value={draftFilters.encodeModeMatch}
                                onChange={(_event, value: 'include' | 'only' | null) => value !== null && setDraftFilters(current => ({ ...current, encodeModeMatch: value }))}
                                sx={{ flex: '0 0 auto', '& .MuiToggleButton-root': { whiteSpace: 'nowrap', px: 1.5 } }}
                            >
                                <ToggleButton value="include">含む</ToggleButton>
                                <ToggleButton value="only">のみ</ToggleButton>
                            </ToggleButtonGroup>
                        </Stack>
                        <Stack>
                            <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={draftFilters.hasOriginalFile}
                                            onChange={event => setDraftFilters(value => ({ ...value, hasOriginalFile: event.target.checked }))}
                                        />
                                    }
                                    label="元ファイルを含む"
                                />
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={draftFilters.manualOnly}
                                            onChange={event => setDraftFilters(value => ({ ...value, manualOnly: event.target.checked, ruleId: '' }))}
                                        />
                                    }
                                    label="手動録画のみ"
                                />
                            </Stack>
                            <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                                <FormControlLabel
                                    control={
                                        <Checkbox checked={draftFilters.hasDrop} onChange={event => setDraftFilters(value => ({ ...value, hasDrop: event.target.checked }))} />
                                    }
                                    label="drop"
                                />
                                <FormControlLabel
                                    control={
                                        <Checkbox checked={draftFilters.hasError} onChange={event => setDraftFilters(value => ({ ...value, hasError: event.target.checked }))} />
                                    }
                                    label="error"
                                />
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={draftFilters.hasScrambling}
                                            onChange={event => setDraftFilters(value => ({ ...value, hasScrambling: event.target.checked }))}
                                        />
                                    }
                                    label="scrambling"
                                />
                            </Stack>
                        </Stack>
                        <ToggleButtonGroup
                            exclusive
                            size="small"
                            value={draftFilters.dateMode}
                            onChange={(_event, value: 'range' | 'specific' | null) => value !== null && setDraftFilters(current => ({ ...current, dateMode: value }))}
                        >
                            <ToggleButton value="range">期間</ToggleButton>
                            <ToggleButton value="specific">日付指定</ToggleButton>
                        </ToggleButtonGroup>
                        {draftFilters.dateMode === 'range' ? (
                            <Stack direction="row" spacing={1}>
                                <DateTextInput label="開始日" value={draftFilters.startDate} onChange={value => setDraftFilters(current => ({ ...current, startDate: value }))} />
                                <DateTextInput label="終了日" value={draftFilters.endDate} onChange={value => setDraftFilters(current => ({ ...current, endDate: value }))} />
                            </Stack>
                        ) : (
                            <Stack direction="row" spacing={1}>
                                <TextField
                                    fullWidth
                                    label="年"
                                    inputMode="numeric"
                                    value={draftFilters.year}
                                    slotProps={{ htmlInput: { maxLength: 4 } }}
                                    onChange={event => {
                                        const year = event.target.value.replace(/\D/g, '').slice(0, 4);
                                        setDraftFilters(value => ({ ...value, year }));
                                        if (year.length === 4) specificMonthRef.current?.focus();
                                    }}
                                />
                                <TextField
                                    fullWidth
                                    label="月"
                                    inputMode="numeric"
                                    inputRef={specificMonthRef}
                                    disabled={draftFilters.year.length !== 4}
                                    value={draftFilters.month}
                                    slotProps={{ htmlInput: { maxLength: 2 } }}
                                    onChange={event => {
                                        const month = event.target.value.replace(/\D/g, '').slice(0, 2);
                                        setDraftFilters(value => ({ ...value, month, day: '' }));
                                        if (month.length === 2) specificDayRef.current?.focus();
                                    }}
                                />
                                <TextField
                                    fullWidth
                                    label="日"
                                    inputMode="numeric"
                                    inputRef={specificDayRef}
                                    disabled={draftFilters.month === ''}
                                    value={draftFilters.day}
                                    slotProps={{ htmlInput: { maxLength: 2 } }}
                                    onChange={event => setDraftFilters(value => ({ ...value, day: event.target.value.replace(/\D/g, '').slice(0, 2) }))}
                                />
                            </Stack>
                        )}
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ mt: 2, alignItems: 'center' }}>
                        <Button color="error" onClick={() => setDraftFilters(emptyFilters)}>
                            クリア
                        </Button>
                        <Box sx={{ flex: 1 }} />
                        <Button onClick={() => setSearchAnchor(null)}>閉じる</Button>
                        <Button
                            variant="contained"
                            onClick={() => {
                                setFilters(draftFilters);
                                setPage(1);
                                setSearchAnchor(null);
                            }}
                        >
                            検索
                        </Button>
                    </Stack>
                </Box>
            </Popover>

            <Dialog open={bulkUserOpen} onClose={() => !bulkUpdateUser.isPending && setBulkUserOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>ユーザーを一括変更</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        選択した {selected.size} 件の録画を別のユーザーへ変更します。
                    </Typography>
                    <UserSelector value={bulkUserId} onChange={setBulkUserId} includeMaster={false} label="変更先ユーザー" minWidth={220} />
                </DialogContent>
                <DialogActions>
                    <Button disabled={bulkUpdateUser.isPending} onClick={() => setBulkUserOpen(false)}>
                        キャンセル
                    </Button>
                    <Button
                        variant="contained"
                        disabled={typeof bulkUserId !== 'number' || bulkUpdateUser.isPending}
                        onClick={() => typeof bulkUserId === 'number' && bulkUpdateUser.mutate(bulkUserId)}
                    >
                        変更
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={moveOpen} onClose={() => !moveSelected.isPending && setMoveOpen(false)} maxWidth="sm" fullWidth>
                <DialogTitle>サブディレクトリへ一括移動</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        選択した {selected.size} 件に紐づく、元録画とエンコード済みを含むすべての動画ファイルを移動します。
                    </Typography>
                    {hasEncodingSelection && (
                        <Alert severity="warning" sx={{ mb: 2 }}>
                            エンコード中の録画が含まれています。エンコード完了または停止後に移動してください。
                        </Alert>
                    )}
                    <Autocomplete
                        freeSolo
                        options={subDirectories.data?.directories ?? []}
                        value={moveSubDirectory}
                        loading={subDirectories.isPending}
                        onInputChange={(_event, value) => setMoveSubDirectory(value)}
                        onChange={(_event, value) => setMoveSubDirectory(value ?? '')}
                        renderInput={params => (
                            <TextField
                                {...params}
                                autoFocus
                                label="移動先サブディレクトリ"
                                placeholder="既存の保存先を選択、または新しい名前を入力"
                                helperText="存在しない名前は新しく作成します。空欄のまま実行すると録画ルート直下へ移動します。"
                            />
                        )}
                    />
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 1.5 }}>
                        複数の録画保存ルートにファイルがある場合は、それぞれのルート内に同じサブディレクトリを作成して移動します。
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button disabled={moveSelected.isPending} onClick={() => setMoveOpen(false)}>
                        キャンセル
                    </Button>
                    <Button variant="contained" disabled={hasEncodingSelection || moveSelected.isPending} onClick={() => moveSelected.mutate()}>
                        移動
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>録画を削除</DialogTitle>
                <DialogContent>
                    <Typography>選択した {selected.size} 件の番組と録画ファイルを削除しますか。</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteOpen(false)}>キャンセル</Button>
                    <Button color="error" variant="contained" disabled={deleteSelected.isPending} onClick={() => deleteSelected.mutate()}>
                        削除
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={cleanupOpen}
                onClose={() => {
                    if (!createCleanupPlan.isPending && !executeCleanup.isPending) setCleanupOpen(false);
                }}
                maxWidth="sm"
                fullWidth
                scroll="paper"
            >
                {createCleanupPlan.isPending || executeCleanup.isPending ? (
                    <DialogContent sx={{ py: 4 }}>
                        <Typography variant="h6" sx={{ fontWeight: 700 }}>
                            {createCleanupPlan.isPending ? '候補リスト作成中' : 'クリーンアップ実行中'}
                        </Typography>
                        <LinearProgress sx={{ mt: 3, height: 6, borderRadius: 1 }} />
                    </DialogContent>
                ) : (
                    <>
                        <DialogTitle>クリーンアップ</DialogTitle>
                        <DialogContent>
                            <Typography variant="body2" sx={{ mb: 1.5 }}>
                                クリーンアップは、まず削除候補リストを書き出します。ファイルを確認して、消したくない行を削除してから実行してください。
                            </Typography>
                            <Button sx={{ px: 0 }} onClick={() => createCleanupPlan.mutate()}>
                                候補リストを作成
                            </Button>
                            {cleanupPlan !== null && (
                                <Box sx={{ mt: 1.5 }}>
                                    <Typography variant="body2">候補リスト:</Typography>
                                    <TextField value={cleanupPlan.planPath} slotProps={{ input: { readOnly: true } }} size="small" fullWidth />
                                    <Typography variant="caption" color="text.secondary" component="div" sx={{ mt: 1, lineHeight: 1.7 }}>
                                        録画ファイル: {cleanupPlan.recordedFileCount} 件 (EPGStation形式らしいもの {cleanupPlan.epgstationLikeRecordedFileCount} 件 / その他{' '}
                                        {cleanupPlan.otherRecordedFileCount} 件)
                                        <br />
                                        空ディレクトリ候補: {cleanupPlan.recordedDirectoryCount} 件 / 実体の無い録画DB: {cleanupPlan.missingVideoFileCount} 件
                                        <br />
                                        drop log: {cleanupPlan.dropLogFileCount} 件 / 実体の無いdrop log DB: {cleanupPlan.missingDropLogFileCount} 件
                                        <br />
                                        thumbnail: {cleanupPlan.thumbnailFileCount} 件 / 実体の無いthumbnail DB: {cleanupPlan.missingThumbnailFileCount} 件
                                    </Typography>
                                </Box>
                            )}
                            <Divider sx={{ my: 2 }} />
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                編集済みの候補リストを実行
                            </Typography>
                            <TextField
                                label="候補リストのパス"
                                value={cleanupPath}
                                onChange={event => setCleanupPath(event.target.value)}
                                fullWidth
                                slotProps={{
                                    input: {
                                        endAdornment:
                                            cleanupPath.length === 0 ? undefined : (
                                                <IconButton size="small" aria-label="候補リストのパスを消去" onClick={() => setCleanupPath('')}>
                                                    <CloseOutlined fontSize="small" />
                                                </IconButton>
                                            ),
                                    },
                                }}
                            />
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setCleanupOpen(false)}>キャンセル</Button>
                            <Button color="error" disabled={cleanupPath.length === 0} onClick={() => setCleanupConfirmOpen(true)}>
                                リストを実行
                            </Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>
            <Dialog open={cleanupConfirmOpen} onClose={() => setCleanupConfirmOpen(false)} maxWidth="xs" fullWidth>
                <DialogTitle>クリーンアップ最終確認</DialogTitle>
                <DialogContent>
                    <Typography color="error" sx={{ fontWeight: 700 }}>
                        注意: 本当に削除しますか？
                        <br />
                        一度削除したファイルは元に戻せません。
                    </Typography>
                    <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 2 }}>
                        実行する候補リスト:
                    </Typography>
                    <TextField value={cleanupPath} slotProps={{ input: { readOnly: true } }} size="small" fullWidth />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setCleanupConfirmOpen(false)}>キャンセル</Button>
                    <Button
                        color="error"
                        disabled={executeCleanup.isPending}
                        onClick={() => {
                            setCleanupConfirmOpen(false);
                            executeCleanup.mutate();
                        }}
                    >
                        削除を実行
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
