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
    ListSubheader,
    Menu,
    MenuItem,
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
import { useLocation, useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ChannelSelector } from '../components/ChannelSelector';
import { DateTextInput } from '../components/DateTimeInput';
import { RecordedItemActions } from '../components/RecordedItemActions';
import { UserSelector } from '../components/UserSelector';
import { VueCompatiblePagination } from '../components/VueCompatiblePagination';
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

function formatElapsedTime(totalSeconds: number): string {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return [hours, minutes, seconds].map(value => String(value).padStart(2, '0')).join(':');
}

interface RecordedReturnPosition {
    url: string;
    recordedId: number;
    scrollY: number;
    savedAt: number;
}

let recordedReturnPosition: RecordedReturnPosition | null = null;
const RECORDED_RETURN_POSITION_MAX_AGE_MS = 30 * 60 * 1000;

const recordedFilterParamNames = [
    'keyword',
    'ruleId',
    'manualOnly',
    'channelId',
    'genre',
    'encodeMode',
    'encodeModes',
    'encodeModeMatch',
    'hasOriginalFile',
    'hasDrop',
    'hasError',
    'hasScrambling',
    'startDate',
    'endDate',
    'dateMode',
    'recordedDateMode',
    'year',
    'recordedYear',
    'month',
    'recordedMonth',
    'day',
    'recordedDay',
    'recordedStartAt',
    'recordedEndAt',
] as const;

function parseFilterNumber(value: string | null, minimum: number): number | '' {
    if (value === null) return '';
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= minimum ? number : '';
}

function isTrueQuery(value: string | null): boolean {
    return value === '1' || value === 'true';
}

function localDateInput(value: number, endExclusive = false): string {
    const date = new Date(endExclusive ? value - 1 : value);
    if (!Number.isFinite(date.getTime())) return '';
    const year = date.getFullYear().toString(10).padStart(4, '0');
    const month = (date.getMonth() + 1).toString(10).padStart(2, '0');
    const day = date.getDate().toString(10).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function readRecordedFilters(params: URLSearchParams): RecordedFilters {
    const queryRuleId = parseFilterNumber(params.get('ruleId'), 0);
    const legacyEncodeModes = params.getAll('encodeModes');
    const recordedStartAtParam = params.get('recordedStartAt');
    const recordedEndAtParam = params.get('recordedEndAt');
    const recordedStartAt = recordedStartAtParam === null ? Number.NaN : Number(recordedStartAtParam);
    const recordedEndAt = recordedEndAtParam === null ? Number.NaN : Number(recordedEndAtParam);
    return {
        keyword: params.get('keyword') ?? '',
        ruleId: queryRuleId === 0 ? '' : queryRuleId,
        manualOnly: queryRuleId === 0 || isTrueQuery(params.get('manualOnly')),
        channelId: parseFilterNumber(params.get('channelId'), 1),
        genre: parseFilterNumber(params.get('genre'), 0),
        encodeModes: [...new Set([...params.getAll('encodeMode'), ...legacyEncodeModes].filter(value => value.length > 0))],
        encodeModeMatch: params.get('encodeModeMatch') === 'only' ? 'only' : 'include',
        hasOriginalFile: isTrueQuery(params.get('hasOriginalFile')),
        hasDrop: isTrueQuery(params.get('hasDrop')),
        hasError: isTrueQuery(params.get('hasError')),
        hasScrambling: isTrueQuery(params.get('hasScrambling')),
        startDate: params.get('startDate') ?? (Number.isFinite(recordedStartAt) ? localDateInput(recordedStartAt) : ''),
        endDate: params.get('endDate') ?? (Number.isFinite(recordedEndAt) ? localDateInput(recordedEndAt, true) : ''),
        dateMode: params.get('dateMode') === 'specific' || params.get('recordedDateMode') === 'specific' ? 'specific' : 'range',
        year: params.get('year') ?? params.get('recordedYear') ?? '',
        month: params.get('month') ?? params.get('recordedMonth') ?? '',
        day: params.get('day') ?? params.get('recordedDay') ?? '',
    };
}

function writeRecordedFilters(params: URLSearchParams, filters: RecordedFilters): void {
    for (const name of recordedFilterParamNames) params.delete(name);
    if (filters.keyword.length > 0) params.set('keyword', filters.keyword);
    if (filters.manualOnly) params.set('ruleId', '0');
    else if (typeof filters.ruleId === 'number') params.set('ruleId', filters.ruleId.toString(10));
    if (typeof filters.channelId === 'number') params.set('channelId', filters.channelId.toString(10));
    if (typeof filters.genre === 'number') params.set('genre', filters.genre.toString(10));
    for (const encodeMode of filters.encodeModes) params.append('encodeModes', encodeMode);
    if (filters.encodeModeMatch === 'only') params.set('encodeModeMatch', 'only');
    if (filters.hasOriginalFile) params.set('hasOriginalFile', 'true');
    if (filters.hasDrop) params.set('hasDrop', 'true');
    if (filters.hasError) params.set('hasError', 'true');
    if (filters.hasScrambling) params.set('hasScrambling', 'true');
    if (filters.dateMode === 'specific') {
        const range = specificDateRange(filters);
        if (range.start !== undefined) params.set('recordedDateMode', 'specific');
        if (filters.year.length > 0) params.set('recordedYear', filters.year);
        if (filters.month.length > 0) params.set('recordedMonth', filters.month);
        if (filters.day.length > 0) params.set('recordedDay', filters.day);
        if (range.start !== undefined) params.set('recordedStartAt', range.start.toString(10));
        if (range.end !== undefined) params.set('recordedEndAt', (range.end + 1).toString(10));
    } else {
        const start = toStartOfDay(filters.startDate);
        const end = toEndOfDay(filters.endDate);
        if (start !== undefined || end !== undefined) params.set('recordedDateMode', 'range');
        if (start !== undefined) params.set('recordedStartAt', start.toString(10));
        if (end !== undefined) params.set('recordedEndAt', (end + 1).toString(10));
    }
}

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

async function waitForRecordedThumbnails(items: RecordedItem[]): Promise<void> {
    const sources = items
        .map(item => item.thumbnails?.[0])
        .filter((thumbnail): thumbnail is number => typeof thumbnail === 'number')
        .map(thumbnail => withBasePath(`/api/thumbnails/${thumbnail}`));
    if (sources.length === 0) return;

    const preload = Promise.allSettled(
        sources.map(
            source =>
                new Promise<void>(resolve => {
                    const image = new Image();
                    image.onload = () => resolve();
                    image.onerror = () => resolve();
                    image.src = source;
                    if (image.complete) resolve();
                }),
        ),
    );
    // Do not let a slow or unavailable thumbnail hold the whole page hostage.
    await Promise.race([preload, new Promise(resolve => window.setTimeout(resolve, 400))]);
}

function createRecordedRequestOption(
    filters: RecordedFilters,
    page: number,
    userId: ActiveUserId,
    settings: { isHalfWidthDisplayed: boolean; recordedLength: number },
): GetRecordedOption {
    const specificRange = specificDateRange(filters);
    return {
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
                    loading="eager"
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
    const location = useLocation();
    const searchParams = useMemo(() => new URLSearchParams(location.search), [location.search]);
    const settings = useSettings();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const initialPage = Number(searchParams.get('page'));
    const initialUserId = searchParams.get('userId');
    const initialFocus = Number(searchParams.get('focus'));
    const currentListUrl = `${location.pathname}${location.search}`;
    const savedReturnPosition =
        recordedReturnPosition !== null && recordedReturnPosition.url === currentListUrl && Date.now() - recordedReturnPosition.savedAt <= RECORDED_RETURN_POSITION_MAX_AGE_MS
            ? recordedReturnPosition
            : null;
    const [userId, setUserId] = useState<ActiveUserId>(
        initialUserId === 'master' ? 'master' : Number.isSafeInteger(Number(initialUserId)) && Number(initialUserId) > 0 ? Number(initialUserId) : null,
    );
    const [page, setPage] = useState(Number.isSafeInteger(initialPage) && initialPage > 0 ? initialPage : 1);
    const [focusedRecordedId, setFocusedRecordedId] = useState<number | null>(
        Number.isSafeInteger(initialFocus) && initialFocus > 0 ? initialFocus : (savedReturnPosition?.recordedId ?? null),
    );
    const initialFilters = readRecordedFilters(searchParams);
    const [filters, setFilters] = useState<RecordedFilters>(initialFilters);
    const [draftFilters, setDraftFilters] = useState<RecordedFilters>(initialFilters);
    const [searchAnchor, setSearchAnchor] = useState<HTMLElement | null>(null);
    const [fileTypeMenuOpen, setFileTypeMenuOpen] = useState(false);
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
    const [cleanupElapsedSeconds, setCleanupElapsedSeconds] = useState(0);
    const specificMonthRef = useRef<HTMLInputElement>(null);
    const specificDayRef = useRef<HTMLInputElement>(null);

    /**
     * Vue's router always pushed a new route when the recorded query changed.
     * Keep that behavior here, while making a no-op update a true no-op so
     * opening/closing the search menu cannot create duplicate history entries.
     */
    const navigateRecordedQuery = useCallback(
        (next: URLSearchParams, replace = false): void => {
            const nextSearch = next.toString();
            const currentSearch = location.search.startsWith('?') ? location.search.slice(1) : location.search;
            if (nextSearch === currentSearch) return;
            const target = `${location.pathname}${nextSearch.length > 0 ? `?${nextSearch}` : ''}`;
            void navigate(target, replace ? { replace: true } : undefined);
        },
        [location.pathname, location.search, navigate],
    );

    // A POP navigation keeps the RecordedPage mounted. Re-read all URL state
    // on every route change so the displayed page/filter never diverges from
    // the address bar (for example page 24 becoming page 4 after Back).
    useEffect(() => {
        const params = new URLSearchParams(location.search);
        const nextPageValue = Number(params.get('page'));
        const nextPage = Number.isSafeInteger(nextPageValue) && nextPageValue > 0 ? nextPageValue : 1;
        const nextUserIdValue = params.get('userId');
        const nextUserId: ActiveUserId =
            nextUserIdValue === 'master' ? 'master' : Number.isSafeInteger(Number(nextUserIdValue)) && Number(nextUserIdValue) > 0 ? Number(nextUserIdValue) : null;
        const nextFilters = readRecordedFilters(params);
        const nextFocusValue = Number(params.get('focus'));
        const nextFocus =
            Number.isSafeInteger(nextFocusValue) && nextFocusValue > 0
                ? nextFocusValue
                : recordedReturnPosition !== null && recordedReturnPosition.url === `${location.pathname}${location.search}`
                  ? recordedReturnPosition.recordedId
                  : null;

        setPage(nextPage);
        setUserId(nextUserId);
        setFilters(nextFilters);
        setDraftFilters(nextFilters);
        // Keep a focus marker alive while the one-shot focus query is removed
        // with replace; otherwise the highlight disappears before scrolling.
        if (nextFocus !== null) setFocusedRecordedId(nextFocus);
    }, [location.pathname, location.search]);

    useEffect(() => {
        if (!searchParams.has('focus')) return;
        const next = new URLSearchParams(searchParams);
        next.delete('focus');
        navigateRecordedQuery(next, true);
    }, [navigateRecordedQuery, searchParams]);
    const changePage = useCallback(
        (value: number, replace = false): void => {
            setPage(value);
            const next = new URLSearchParams(searchParams);
            if (value <= 1) next.delete('page');
            else next.set('page', value.toString(10));
            navigateRecordedQuery(next, replace);
        },
        [navigateRecordedQuery, searchParams],
    );
    const applyFilters = useCallback(
        (value: RecordedFilters): void => {
            const nextFilters = { ...value, encodeModes: [...value.encodeModes] };
            setFilters(nextFilters);
            setDraftFilters(nextFilters);
            setPage(1);
            const next = new URLSearchParams(searchParams);
            next.delete('page');
            writeRecordedFilters(next, nextFilters);
            navigateRecordedQuery(next);
        },
        [navigateRecordedQuery, searchParams],
    );
    const onUserChange = useCallback(
        (value: ActiveUserId) => {
            setUserId(value);
            setPage(1);
            const next = new URLSearchParams(searchParams);
            next.delete('page');
            if (value === null) next.delete('userId');
            else next.set('userId', value.toString());
            // UserSelector initializes itself after its users query resolves;
            // replacing avoids an extra history entry for that initialization.
            navigateRecordedQuery(next, true);
        },
        [navigateRecordedQuery, searchParams],
    );
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const searchOptions = useQuery({ queryKey: ['recorded-options'], queryFn: api.getRecordedSearchOptions, staleTime: 60_000 });
    const rules = useQuery({ queryKey: ['recorded-search-rules'], queryFn: () => api.getRules({ type: 'normal', limit: 1000 }), staleTime: 60_000 });
    const requestOption = createRecordedRequestOption(filters, page, userId, settings);
    const routePageValue = Number(searchParams.get('page'));
    const routePage = Number.isSafeInteger(routePageValue) && routePageValue > 0 ? routePageValue : 1;
    const routeUserIdValue = searchParams.get('userId');
    const routeUserId: ActiveUserId =
        routeUserIdValue === 'master' ? 'master' : Number.isSafeInteger(Number(routeUserIdValue)) && Number(routeUserIdValue) > 0 ? Number(routeUserIdValue) : null;
    const routeFilters = readRecordedFilters(searchParams);
    const routeRequestOption = createRecordedRequestOption(routeFilters, routePage, routeUserId, settings);
    const requestMatchesRoute = JSON.stringify(requestOption) === JSON.stringify(routeRequestOption);
    const recordedListUrlKey = useMemo(() => {
        const params = new URLSearchParams(location.search);
        params.delete('focus');
        const query = params.toString();
        return `${location.pathname}${query.length > 0 ? `?${query}` : ''}`;
    }, [location.pathname, location.search]);
    const [visibleRecordedListKey, setVisibleRecordedListKey] = useState('');
    const requestSignature = JSON.stringify(requestOption);
    const recordedTransitionRef = useRef({ requestSignature: '', duration: 500 });
    if (recordedTransitionRef.current.requestSignature !== requestSignature) {
        recordedTransitionRef.current = {
            requestSignature,
            duration: queryClient.getQueryData(['recorded', requestOption]) === undefined ? 500 : 320,
        };
    }
    const recordedListFadeDuration = recordedTransitionRef.current.duration;
    const records = useQuery({
        queryKey: ['recorded', requestOption],
        queryFn: () => api.getRecorded(requestOption),
        enabled: userId !== null,
    });
    useEffect(() => {
        if (!requestMatchesRoute || (!records.isSuccess && !records.isError)) return;
        let cancelled = false;
        const reveal = async (): Promise<void> => {
            if (records.isSuccess) await waitForRecordedThumbnails(records.data.records);
            if (!cancelled) setVisibleRecordedListKey(recordedListUrlKey);
        };
        void reveal();
        return () => {
            cancelled = true;
        };
    }, [recordedListUrlKey, records.data, records.isError, records.isSuccess, requestMatchesRoute]);
    const isRecordedListVisible = visibleRecordedListKey === recordedListUrlKey && requestMatchesRoute && (records.isPending || records.isSuccess || records.isError);
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
    useEffect(() => {
        if (!createCleanupPlan.isPending && !executeCleanup.isPending) {
            setCleanupElapsedSeconds(0);
            return;
        }

        const startedAt = Date.now();
        setCleanupElapsedSeconds(0);
        const timerId = window.setInterval(() => {
            setCleanupElapsedSeconds(Math.floor((Date.now() - startedAt) / 1000));
        }, 1_000);
        return () => window.clearInterval(timerId);
    }, [createCleanupPlan.isPending, executeCleanup.isPending]);
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
        if (records.isSuccess && page > totalPages) changePage(totalPages, true);
    }, [changePage, page, records.isSuccess, totalPages]);
    useEffect(() => {
        if (focusedRecordedId === null || !records.data?.records.some(item => item.id === focusedRecordedId)) return;
        const timer = window.setTimeout(() => setFocusedRecordedId(null), 1_000);
        return () => window.clearTimeout(timer);
    }, [focusedRecordedId, records.data?.records]);
    useEffect(() => {
        if (focusedRecordedId === null || !records.data?.records.some(item => item.id === focusedRecordedId)) return;
        let innerFrame = 0;
        const frame = window.requestAnimationFrame(() => {
            innerFrame = window.requestAnimationFrame(() => {
                const element = document.getElementById(`recorded-card-${focusedRecordedId}`);
                if (savedReturnPosition !== null) {
                    window.scrollTo({ top: savedReturnPosition.scrollY, behavior: 'auto' });
                    const bounds = element?.getBoundingClientRect();
                    if (bounds !== undefined && (bounds.bottom <= 0 || bounds.top >= window.innerHeight)) element?.scrollIntoView({ behavior: 'auto', block: 'center' });
                    if (recordedReturnPosition === savedReturnPosition) recordedReturnPosition = null;
                    return;
                }
                element?.scrollIntoView({ behavior: 'smooth', block: 'center' });
            });
        });
        return () => {
            window.cancelAnimationFrame(frame);
            window.cancelAnimationFrame(innerFrame);
        };
    }, [focusedRecordedId, records.data?.records, savedReturnPosition]);
    const openRecorded = useCallback(
        (recordedId: number): void => {
            recordedReturnPosition = {
                url: `${location.pathname}${location.search}`,
                recordedId,
                scrollY: window.scrollY,
                savedAt: Date.now(),
            };
            void navigate(`/recorded/detail/${recordedId}`, { state: { appBack: currentListUrl } });
        },
        [currentListUrl, navigate],
    );
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
            <Box
                key={visibleRecordedListKey}
                sx={{
                    p: 0.5,
                    opacity: isRecordedListVisible ? 1 : 0,
                    visibility: isRecordedListVisible ? 'visible' : 'hidden',
                    animation: isRecordedListVisible ? `recorded-list-fade-in ${recordedListFadeDuration}ms ease both` : 'none',
                    '@keyframes recorded-list-fade-in': {
                        from: { opacity: 0 },
                        to: { opacity: 1 },
                    },
                }}
            >
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
                                        focused={settings.isHighlightRecordedOnReturn && focusedRecordedId === item.id}
                                        showDrop={settings.isShowDropInfoInsteadOfDescription}
                                        onOpen={() => openRecorded(item.id)}
                                        onSelect={() => toggleSelection(item.id)}
                                        onSearch={() => {
                                            const option = createRecordedRelatedSearchOption(item);
                                            applyFilters({ ...filters, keyword: option.keyword ?? '', ruleId: option.ruleId ?? '' });
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
                                focused={settings.isHighlightRecordedOnReturn && focusedRecordedId === item.id}
                                showDrop={settings.isShowDropInfoInsteadOfDescription}
                                onOpen={() => openRecorded(item.id)}
                                onSelect={() => toggleSelection(item.id)}
                                onSearch={() => {
                                    const option = createRecordedRelatedSearchOption(item);
                                    applyFilters({ ...filters, keyword: option.keyword ?? '', ruleId: option.ruleId ?? '' });
                                }}
                                onChanged={() => void queryClient.invalidateQueries({ queryKey: ['recorded'] })}
                                onDeleted={() => void queryClient.invalidateQueries({ queryKey: ['recorded'] })}
                            />
                        ))}
                    </Box>
                )}
                {totalPages > 1 && <VueCompatiblePagination count={totalPages} page={page} onChange={(_event, value) => changePage(value)} sx={{ my: 2 }} />}
            </Box>

            <Popover
                open={searchAnchor !== null}
                anchorEl={searchAnchor}
                onClose={() => {
                    setFileTypeMenuOpen(false);
                    setSearchAnchor(null);
                }}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { width: 640, maxWidth: 'calc(100vw - 16px)' } } }}
            >
                <Box
                    component="form"
                    onSubmit={event => {
                        event.preventDefault();
                        applyFilters(draftFilters);
                        setFileTypeMenuOpen(false);
                        setSearchAnchor(null);
                    }}
                    sx={{ p: 2 }}
                >
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
                                    open={fileTypeMenuOpen}
                                    onOpen={() => setFileTypeMenuOpen(true)}
                                    onClose={() => setFileTypeMenuOpen(false)}
                                    label="ファイルタイプ"
                                    value={draftFilters.encodeModes}
                                    onChange={event => setDraftFilters(value => ({ ...value, encodeModes: event.target.value as string[] }))}
                                    renderValue={values => values.join('、')}
                                    MenuProps={{
                                        slotProps: {
                                            paper: {
                                                sx: {
                                                    maxHeight: 'min(65vh, 520px)',
                                                },
                                            },
                                        },
                                    }}
                                >
                                    <ListSubheader
                                        sx={{
                                            display: 'flex',
                                            alignItems: 'center',
                                            gap: 1,
                                            borderBottom: 1,
                                            borderColor: 'divider',
                                            bgcolor: 'background.paper',
                                            lineHeight: 1,
                                            py: 1,
                                            zIndex: 1,
                                        }}
                                    >
                                        <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                                            {draftFilters.encodeModes.length} 件選択中
                                        </Typography>
                                        <Button
                                            type="button"
                                            size="small"
                                            variant="outlined"
                                            onClick={event => {
                                                event.preventDefault();
                                                event.stopPropagation();
                                                setFileTypeMenuOpen(false);
                                            }}
                                        >
                                            完了
                                        </Button>
                                    </ListSubheader>
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
                        <Button type="button" color="error" onClick={() => setDraftFilters(emptyFilters)}>
                            クリア
                        </Button>
                        <Box sx={{ flex: 1 }} />
                        <Button
                            type="button"
                            onClick={() => {
                                setFileTypeMenuOpen(false);
                                setSearchAnchor(null);
                            }}
                        >
                            閉じる
                        </Button>
                        <Button type="submit" variant="contained">
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
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 1.5 }}>
                            処理継続中・経過時間 {formatElapsedTime(cleanupElapsedSeconds)}
                        </Typography>
                        {createCleanupPlan.isPending && (
                            <Typography variant="caption" color="text.secondary" sx={{ display: 'block', mt: 0.5 }}>
                                録画件数が多い場合、ファイル走査には時間がかかります。このままお待ちください。
                            </Typography>
                        )}
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
