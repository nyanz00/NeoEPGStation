import AccessTimeOutlined from '@mui/icons-material/AccessTimeOutlined';
import BookmarkOutlined from '@mui/icons-material/BookmarkOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import MoreVertOutlined from '@mui/icons-material/MoreVertOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import {
    Box,
    Button,
    Checkbox,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    InputAdornment,
    ListItemIcon,
    ListItemText,
    Menu,
    MenuItem,
    Popover,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
    useMediaQuery,
    useTheme,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelType, ManualReserveOption, ReserveListItem, ScheduleChannleItem, ScheduleProgramItem } from '../../../api';
import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { OnAirSelectStreamDialog } from '../components/OnAirSelectStreamDialog';
import { UserSelector } from '../components/UserSelector';
import { api } from '../core/api/queries';
import { isDefaultVisibleChannel } from '../core/channels';
import { guideChannelDisplayName } from '../core/guide/channels';
import { useNotifications } from '../core/notifications/Notifications';
import { channelTypeLabel, createProgramSearchKeyword, formatProgramDate, formatProgramTime, genreNames, normalizeChannelFilter, programDuration } from '../core/program';
import { withBasePath } from '../core/path';
import { useActiveUser, type ActiveUserId } from '../core/storage/activeUser';
import {
    getEffectiveGuideSizeValue,
    loadGuideColorSettings,
    loadGuideGenreSettings,
    loadGuideProgramDialogSettings,
    loadGuideSizeSettings,
    saveGuideGenreSettings,
    saveGuideProgramDialogSettings,
    type GuideGenreSettings,
    type GuideSizeValue,
} from '../core/storage/guide';
import { useSettings } from '../core/storage/settings';
import { GuideDomRenderer } from '../guide/GuideDomRenderer';

type ReserveKind = 'normal' | 'conflict' | 'skip' | 'overlap';
export interface ProgramReserve {
    kind: ReserveKind;
    item: ReserveListItem;
}

const basicTypes: ChannelType[] = ['GR', 'BS', 'CS', 'SKY'];
const hourColors = [
    '#652ffc',
    '#3f2cf3',
    '#2923d5',
    '#2520c0',
    '#98c32f',
    '#b4c831',
    '#d1cc34',
    '#efcc35',
    '#ffcd3e',
    '#ffc636',
    '#feaf33',
    '#fe9c30',
    '#fe882f',
    '#fe7b2d',
    '#fe712c',
    '#fd692b',
    '#fd5f25',
    '#fd572b',
    '#f44c3c',
    '#e33f6e',
    '#ce35a2',
    '#b630d9',
    '#9e2ffc',
    '#852ffc',
] as const;
const weekdays = ['日', '月', '火', '水', '木', '金', '土'] as const;

function startOfLocalDay(value: number): number {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function startOfLocalHour(value: number): number {
    const date = new Date(value);
    return new Date(date.getFullYear(), date.getMonth(), date.getDate(), date.getHours()).getTime();
}

function dayTitle(value: number): string {
    const date = new Date(value);
    return `${(date.getMonth() + 1).toString(10).padStart(2, '0')}/${date.getDate().toString(10).padStart(2, '0')}(${weekdays[date.getDay()]})`;
}

function GuideChannelFilterInput({
    value,
    onChange,
    onClose,
    autoFocus = false,
}: {
    value: string;
    onChange: (value: string) => void;
    onClose?: () => void;
    autoFocus?: boolean;
}): ReactNode {
    return (
        <TextField
            value={value}
            onChange={event => onChange(event.target.value)}
            onKeyDown={event => {
                if (event.key === 'Escape') onClose?.();
            }}
            placeholder="放送局を絞り込み"
            size="small"
            fullWidth
            autoFocus={autoFocus}
            autoComplete="off"
            slotProps={{
                htmlInput: {
                    'aria-label': '放送局を絞り込み',
                    name: 'guide-channel-filter',
                },
                input: {
                    startAdornment: (
                        <InputAdornment position="start">
                            <SearchOutlined fontSize="small" />
                        </InputAdornment>
                    ),
                    endAdornment:
                        value.length === 0 ? undefined : (
                            <InputAdornment position="end">
                                <IconButton size="small" aria-label="放送局の絞り込みをクリア" onMouseDown={event => event.preventDefault()} onClick={() => onChange('')}>
                                    <CloseOutlined fontSize="small" />
                                </IconButton>
                            </InputAdornment>
                        ),
                },
            }}
        />
    );
}

export function reserveIndex(
    lists: { normal: ReserveListItem[]; conflicts: ReserveListItem[]; skips: ReserveListItem[]; overlaps: ReserveListItem[] } | undefined,
): Map<number, ProgramReserve> {
    const result = new Map<number, ProgramReserve>();
    if (lists === undefined) return result;
    const add = (kind: ReserveKind, items: ReserveListItem[]): void =>
        items.forEach(item => {
            if (typeof item.programId === 'number') result.set(item.programId, { kind, item });
        });
    add('normal', lists.normal);
    add('conflict', lists.conflicts);
    add('skip', lists.skips);
    add('overlap', lists.overlaps);
    return result;
}

function reserveLabel(kind: ReserveKind): string {
    return { normal: '予約', conflict: '競合', skip: '除外', overlap: '重複' }[kind];
}

function GuideChannelHeader({
    channel,
    size,
    dark,
    onSelect,
}: {
    channel: ScheduleChannleItem;
    size: GuideSizeValue;
    dark: boolean;
    onSelect: (channel: ScheduleChannleItem) => void;
}): ReactNode {
    const displayName = guideChannelDisplayName(channel.name);
    const borderColor = dark ? '#888' : '#ccc';

    return (
        <Box
            component="button"
            type="button"
            data-channel-id={channel.id}
            aria-label={`${channel.name}の視聴設定を開く`}
            onClick={() => onSelect(channel)}
            sx={{
                appearance: 'none',
                width: size.channelWidth,
                flex: `0 0 ${size.channelWidth}px`,
                height: size.channelHeight,
                minWidth: size.channelWidth,
                maxWidth: size.channelWidth,
                minHeight: size.channelHeight,
                maxHeight: size.channelHeight,
                px: '6px',
                py: '2px',
                overflow: 'hidden',
                display: 'flex',
                flexDirection: 'column',
                justifyContent: 'flex-start',
                alignItems: 'stretch',
                gap: '3px',
                boxSizing: 'border-box',
                bgcolor: dark ? '#393e46' : '#999',
                color: '#fff',
                borderTop: 0,
                borderBottom: 0,
                borderLeft: `1px solid ${borderColor}`,
                borderRight: `1px solid ${borderColor}`,
                borderRadius: 0,
                font: 'inherit',
                fontSize: size.channelFontsize,
                fontWeight: 700,
                cursor: 'pointer',
                '&:focus-visible': { outline: '2px solid #90caf9', outlineOffset: -2 },
            }}
        >
            <Box sx={{ minHeight: 28, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                <Box
                    sx={{
                        flex: '0 0 auto',
                        width: 40,
                        height: 30,
                        overflow: 'hidden',
                        display: 'flex',
                        justifyContent: 'flex-start',
                        alignItems: 'center',
                    }}
                >
                    {channel.hasLogoData && (
                        <Box
                            component="img"
                            src={withBasePath(`/api/channels/${channel.id}/logo`)}
                            alt={channel.name}
                            loading="lazy"
                            decoding="async"
                            onError={event => {
                                event.currentTarget.style.display = 'none';
                            }}
                            sx={{ width: '100%', height: '100%', objectFit: 'contain' }}
                        />
                    )}
                </Box>
                <Typography component="span" sx={{ ml: '4px', fontSize: 12, fontWeight: 700, lineHeight: 1, color: 'rgba(255,255,255,.86)', letterSpacing: 0 }}>
                    {channelTypeLabel(channel.channelType)}
                </Typography>
            </Box>
            <Box
                component="span"
                title={channel.name}
                sx={{ width: '100%', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis', lineHeight: 1.15, textAlign: 'left' }}
            >
                {displayName}
            </Box>
        </Box>
    );
}

export function GuideProgramDialog({
    program,
    channel,
    reserve,
    onClose,
}: {
    program: ScheduleProgramItem | null;
    channel: ScheduleChannleItem | null;
    reserve?: ProgramReserve;
    onClose: (programId?: number) => void;
}): ReactNode {
    const activeUser = useActiveUser();
    const settings = useSettings();
    const navigate = useNavigate();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const initialDialogSettings = useMemo(() => loadGuideProgramDialogSettings(), []);
    const [userId, setUserId] = useState<ActiveUserId>(typeof activeUser === 'number' ? activeUser : null);
    const [encodeMode, setEncodeMode] = useState(initialDialogSettings.encode === 'TS' ? '' : initialDialogSettings.encode);
    const [deleteOriginal, setDeleteOriginal] = useState(initialDialogSettings.isDeleteOriginalAfterEncode);
    const [updateThumbnail, setUpdateThumbnail] = useState(initialDialogSettings.updateThumbnail);
    const encodeModes = useMemo(
        () => Array.from(new Set((config.data?.encode ?? []).filter((mode): mode is string => typeof mode === 'string' && mode.trim().length > 0))),
        [config.data?.encode],
    );

    useEffect(() => {
        setUserId(typeof activeUser === 'number' ? activeUser : null);
    }, [activeUser, program]);

    useEffect(() => {
        if (config.data !== undefined && encodeMode.length > 0 && !config.data.encode.includes(encodeMode)) setEncodeMode('');
    }, [config.data, encodeMode]);

    useEffect(() => {
        saveGuideProgramDialogSettings({
            encode: encodeMode.length === 0 ? 'TS' : encodeMode,
            isDeleteOriginalAfterEncode: deleteOriginal,
            updateThumbnail,
        });
    }, [deleteOriginal, encodeMode, updateThumbnail]);

    const finish = async (programId: number): Promise<void> => {
        onClose(programId);
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
            queryClient.invalidateQueries({ queryKey: ['reserves'] }),
            queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
        ]);
    };
    const add = useMutation({
        mutationFn: async () => {
            if (program === null || typeof userId !== 'number') throw new Error('予約するユーザーを選択してください');
            const selectedProgram = program;
            const option: ManualReserveOption = { programId: program.id, userId, allowEndLack: true };
            if (encodeMode.length > 0) option.encodeOption = { mode1: encodeMode, isDeleteOriginalAfterEncode: deleteOriginal, updateThumbnail };
            await api.addReserve(option);
            return { id: selectedProgram.id, name: selectedProgram.name };
        },
        onSuccess: async selectedProgram => {
            notify(`${selectedProgram.name}を予約しました`, 'success');
            await finish(selectedProgram.id);
        },
        onError: error => notify(`予約に失敗しました: ${error.message}`, 'error'),
    });
    const remove = useMutation({
        mutationFn: async () => {
            if (reserve === undefined || program === null) return null;
            const selectedProgramId = program.id;
            const successMessage = reserve.kind === 'skip' || reserve.kind === 'overlap' ? '予約状態を解除しました' : '予約をキャンセルしました';
            if (reserve.kind === 'skip') await api.removeReserveSkip(reserve.item.reserveId);
            else if (reserve.kind === 'overlap') await api.removeReserveOverlap(reserve.item.reserveId);
            else await api.cancelReserve(reserve.item.reserveId);
            return { id: selectedProgramId, message: successMessage };
        },
        onSuccess: async result => {
            if (result === null) return;
            notify(result.message, 'success');
            await finish(result.id);
        },
        onError: error => notify(`予約の変更に失敗しました: ${error.message}`, 'error'),
    });
    const openRelatedSearch = (): void => {
        if (program === null) return;
        const params = new URLSearchParams({ keyword: createProgramSearchKeyword(program.name), auto: '1' });
        if (settings.isIncludeChannelIdWhenSearching) params.set('channelId', program.channelId.toString(10));
        if (settings.isIncludeGenreWhenSearching) {
            const genres = [
                [program.genre1, program.subGenre1],
                [program.genre2, program.subGenre2],
                [program.genre3, program.subGenre3],
            ] as const;
            const genre = genres.find(([value]) => value !== undefined);
            if (genre?.[0] !== undefined) {
                params.set('genre', genre[0].toString(10));
                if (genre[1] !== undefined) params.set('subGenre', genre[1].toString(10));
            }
        }
        onClose(program.id);
        void navigate(`/search?${params.toString()}`);
    };

    return (
        <Dialog open={program !== null} onClose={() => onClose(program?.id)} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { maxHeight: 'min(90vh, 760px)' } } }}>
            {program !== null && (
                <>
                    <DialogTitle>{program.name}</DialogTitle>
                    <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                        <Stack spacing={1.5} sx={{ p: 2, flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
                            <Typography color="text.secondary">{channel?.name ?? program.channelId}</Typography>
                            <Typography>
                                {formatProgramDate(program.startAt)} - {formatProgramTime(program.endAt)}（{programDuration(program)}分）
                            </Typography>
                            {program.description !== undefined && <Typography>{program.description}</Typography>}
                            {program.extended !== undefined && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{program.extended}</Typography>}
                        </Stack>
                        <Box sx={{ p: 2, flex: '0 0 auto', borderTop: 1, borderColor: 'divider' }}>
                            {reserve === undefined ? (
                                <Stack spacing={1.5}>
                                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                        <FormControl size="small" fullWidth>
                                            <InputLabel>録画タイプ</InputLabel>
                                            <Select label="録画タイプ" value={encodeMode} onChange={event => setEncodeMode(event.target.value)}>
                                                <MenuItem value="">TS</MenuItem>
                                                {encodeModes.map(mode => (
                                                    <MenuItem key={mode} value={mode}>
                                                        {mode}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        <UserSelector value={userId} onChange={setUserId} includeMaster={false} minWidth={200} />
                                    </Stack>
                                    <Stack direction={{ xs: 'column', sm: 'row' }}>
                                        <FormControlLabel
                                            control={
                                                <Checkbox checked={deleteOriginal} disabled={encodeMode.length === 0} onChange={event => setDeleteOriginal(event.target.checked)} />
                                            }
                                            label="元ファイル削除"
                                        />
                                        <FormControlLabel
                                            control={
                                                <Checkbox
                                                    checked={updateThumbnail}
                                                    disabled={encodeMode.length === 0}
                                                    onChange={event => setUpdateThumbnail(event.target.checked)}
                                                />
                                            }
                                            label="サムネイル再生成"
                                        />
                                    </Stack>
                                </Stack>
                            ) : (
                                <Chip color={reserve.kind === 'conflict' ? 'error' : 'primary'} label={reserveLabel(reserve.kind)} />
                            )}
                        </Box>
                    </DialogContent>
                    <DialogActions>
                        <Button startIcon={<SearchOutlined />} onClick={openRelatedSearch}>
                            検索
                        </Button>
                        <Button onClick={() => onClose(program.id)}>閉じる</Button>
                        <Button
                            onClick={() => {
                                onClose(program.id);
                                void navigate(reserve === undefined ? `/reserves/manual?programId=${program.id}` : `/reserves/manual?reserveId=${reserve.item.reserveId}`);
                            }}
                        >
                            詳細
                        </Button>
                        {reserve === undefined ? (
                            <Button variant="contained" disabled={add.isPending || typeof userId !== 'number'} onClick={() => add.mutate()}>
                                予約
                            </Button>
                        ) : reserve.kind !== 'conflict' ? (
                            <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate()}>
                                {reserve.kind === 'skip' || reserve.kind === 'overlap' ? '解除' : reserve.item.ruleId === undefined ? '削除' : '除外'}
                            </Button>
                        ) : null}
                    </DialogActions>
                </>
            )}
        </Dialog>
    );
}

export function GuidePage(): ReactNode {
    const settings = useSettings();
    const theme = useTheme();
    const isMobile = useMediaQuery(theme.breakpoints.down('sm'));
    const isCompactHeader = useMediaQuery(theme.breakpoints.down('md'));
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const [startAt, setStartAt] = useState(() => startOfLocalHour(Date.now()));
    const [selected, setSelected] = useState<{ program: ScheduleProgramItem; channel: ScheduleChannleItem } | null>(null);
    const [onAirChannel, setOnAirChannel] = useState<ScheduleChannleItem | null>(null);
    const [dayDialogOpen, setDayDialogOpen] = useState(false);
    const [timeAnchor, setTimeAnchor] = useState<HTMLElement | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
    const [channelFilter, setChannelFilter] = useState('');
    const [timeDay, setTimeDay] = useState(startOfLocalDay(startAt));
    const [timeHour, setTimeHour] = useState(new Date(startAt).getHours());
    const [genreDialogOpen, setGenreDialogOpen] = useState(false);
    const [genres, setGenres] = useState<GuideGenreSettings>(() => loadGuideGenreSettings());
    const [genreDraft, setGenreDraft] = useState<GuideGenreSettings>(() => loadGuideGenreSettings());
    const [now, setNow] = useState(Date.now());
    const sizeSettings = useMemo(() => loadGuideSizeSettings(), []);
    const colors = useMemo(() => loadGuideColorSettings(), []);
    const size = useMemo(() => getEffectiveGuideSizeValue(sizeSettings, isMobile ? 'mobile' : 'tablet'), [isMobile, sizeSettings]);
    const guideDark = theme.palette.mode === 'dark' && !settings.isForceDisableDarkThemeForGuide;
    const guideHours = settings.guideLength;
    const endAt = startAt + guideHours * 3_600_000;
    const scroller = useRef<HTMLDivElement | null>(null);
    const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null);
    const [programRootElement, setProgramRootElement] = useState<HTMLDivElement | null>(null);
    const renderer = useRef<GuideDomRenderer | null>(null);
    const visibleFrame = useRef<number | null>(null);
    const todayStart = startOfLocalDay(Date.now());

    const availableTypes = useMemo(
        () =>
            Object.entries(config.data?.broadcast ?? {})
                .filter(([, enabled]) => enabled)
                .map(([type]) => type as ChannelType),
        [config.data],
    );
    const requestedWave = searchParams.get('type');
    const wave = requestedWave !== null && availableTypes.includes(requestedWave as ChannelType) ? requestedWave : 'ALL';
    const changeWave = (value: string): void => {
        setSearchParams(current => {
            const next = new URLSearchParams(current);
            if (value === 'ALL') next.delete('type');
            else next.set('type', value);
            return next;
        });
    };
    const scheduleOption = useMemo(() => {
        const selectedType = wave === 'ALL' ? null : (wave as ChannelType);
        const extraTypes =
            wave === 'ALL' ? availableTypes.filter(type => !basicTypes.includes(type)) : selectedType !== null && !basicTypes.includes(selectedType) ? [selectedType] : [];
        return {
            startAt,
            endAt,
            isHalfWidth: settings.isHalfWidthDisplayed,
            needsRawExtended: true,
            isFree: settings.isShowOnlyFreePrograms || undefined,
            GR: selectedType === null || selectedType === 'GR',
            BS: selectedType === null || selectedType === 'BS',
            CS: selectedType === null || selectedType === 'CS',
            SKY: selectedType === null || selectedType === 'SKY',
            channelTypes: extraTypes,
        };
    }, [availableTypes, endAt, settings.isHalfWidthDisplayed, settings.isShowOnlyFreePrograms, startAt, wave]);
    const schedules = useQuery({ queryKey: ['schedules', scheduleOption], queryFn: () => api.getSchedules(scheduleOption), enabled: config.data !== undefined });
    const displayedSchedules = useMemo(
        () => (settings.isShowInformationalChannels ? schedules.data : schedules.data?.filter(schedule => isDefaultVisibleChannel(schedule.channel))),
        [schedules.data, settings.isShowInformationalChannels],
    );
    const deferredChannelFilter = useDeferredValue(channelFilter);
    const channelFilterTokens = useMemo(
        () =>
            deferredChannelFilter
                .trim()
                .split(/[\s\u3000]+/)
                .map(normalizeChannelFilter)
                .filter(value => value.length > 0),
        [deferredChannelFilter],
    );
    const filteredSchedules = useMemo(() => {
        if (displayedSchedules === undefined || channelFilterTokens.length === 0) return displayedSchedules;
        return displayedSchedules.filter(schedule => {
            const name = normalizeChannelFilter(schedule.channel.name);
            return channelFilterTokens.every(token => name.includes(token));
        });
    }, [channelFilterTokens, displayedSchedules]);
    const reserveLists = useQuery({ queryKey: ['reserve-lists', startAt, endAt], queryFn: () => api.getReserveLists({ startAt, endAt }) });
    const reserves = useMemo(() => reserveIndex(reserveLists.data), [reserveLists.data]);
    const reserveStates = useMemo(() => new Map(Array.from(reserves, ([programId, value]) => [programId, { kind: value.kind }])), [reserves]);
    const selectProgram = useCallback((program: ScheduleProgramItem, channel: ScheduleChannleItem) => setSelected({ program, channel }), []);
    const selectChannel = useCallback((channel: ScheduleChannleItem) => setOnAirChannel(channel), []);
    const closeSelectedProgram = useCallback((programId?: number): void => {
        setSelected(current => {
            if (current === null || programId === undefined || current.program.id === programId) return null;
            return current;
        });
    }, []);
    const setScrollerRef = useCallback((element: HTMLDivElement | null): void => {
        scroller.current = element;
        setScrollerElement(element);
    }, []);

    const updateVisible = useCallback((): void => {
        if (visibleFrame.current !== null) return;
        visibleFrame.current = window.requestAnimationFrame(() => {
            visibleFrame.current = null;
            const element = scroller.current;
            if (element === null) return;
            const scrollLeft = Math.min(Math.max(element.scrollLeft, 0), Math.max(0, element.scrollWidth - element.clientWidth));
            const scrollTop = Math.min(Math.max(element.scrollTop, 0), Math.max(0, element.scrollHeight - element.clientHeight));
            renderer.current?.updateVisible(scrollLeft, scrollTop, element.clientWidth, element.clientHeight);
        });
    }, []);

    useEffect(() => {
        const interval = window.setInterval(() => setNow(Date.now()), 30_000);
        return () => window.clearInterval(interval);
    }, []);

    useEffect(() => {
        if (programRootElement === null || filteredSchedules === undefined) return;
        renderer.current?.destroy();
        const instance = new GuideDomRenderer({
            root: programRootElement,
            schedules: filteredSchedules,
            startAt,
            endAt,
            size,
            mode: settings.guideMode,
            dark: guideDark,
            colors,
            genres,
            reserves: reserveStates,
            onSelect: selectProgram,
        });
        renderer.current = instance;
        updateVisible();
        return () => {
            instance.destroy();
            if (renderer.current === instance) renderer.current = null;
        };
    }, [colors, endAt, filteredSchedules, guideDark, programRootElement, selectProgram, settings.guideMode, size, startAt, updateVisible]);

    useEffect(() => {
        renderer.current?.updateGenres(genres);
    }, [genres]);

    useEffect(() => {
        renderer.current?.updateReserves(reserveStates);
    }, [reserveStates]);

    useEffect(() => {
        const element = scrollerElement;
        if (element === null) return;
        const observer = new ResizeObserver(updateVisible);
        observer.observe(element);
        return () => observer.disconnect();
    }, [scrollerElement, updateVisible]);

    useEffect(() => {
        const element = scrollerElement;
        if (element === null) return;

        let pointerId: number | null = null;
        let startX = 0;
        let startY = 0;
        let startScrollLeft = 0;
        let startScrollTop = 0;
        let dragging = false;
        let suppressNextPointerClick = false;
        let suppressClickTimer: number | null = null;

        const pointerDown = (event: PointerEvent): void => {
            if ((event.pointerType !== 'mouse' && event.pointerType !== 'pen') || event.button !== 0) return;
            pointerId = event.pointerId;
            startX = event.clientX;
            startY = event.clientY;
            startScrollLeft = element.scrollLeft;
            startScrollTop = element.scrollTop;
            dragging = false;
        };
        const pointerMove = (event: PointerEvent): void => {
            if (pointerId !== event.pointerId) return;
            const offsetX = event.clientX - startX;
            const offsetY = event.clientY - startY;
            if (!dragging && Math.hypot(offsetX, offsetY) < 4) return;
            if (!dragging) {
                dragging = true;
                element.classList.add('is-dragging');
                element.setPointerCapture(event.pointerId);
            }
            element.scrollLeft = startScrollLeft - offsetX;
            element.scrollTop = startScrollTop - offsetY;
            event.preventDefault();
        };
        const resetPointer = (): void => {
            const activePointerId = pointerId;
            dragging = false;
            pointerId = null;
            element.classList.remove('is-dragging');
            if (activePointerId !== null && element.hasPointerCapture(activePointerId)) element.releasePointerCapture(activePointerId);
        };
        const finishPointer = (event: PointerEvent, cancelled = false): void => {
            if (pointerId !== event.pointerId) return;
            if (dragging && !cancelled) {
                suppressNextPointerClick = true;
                if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
                suppressClickTimer = window.setTimeout(() => {
                    suppressNextPointerClick = false;
                    suppressClickTimer = null;
                }, 300);
            }
            resetPointer();
        };
        const pointerCancel = (event: PointerEvent): void => finishPointer(event, true);
        const lostPointerCapture = (event: PointerEvent): void => {
            if (pointerId === event.pointerId) resetPointer();
        };
        const click = (event: globalThis.MouseEvent): void => {
            if (!suppressNextPointerClick || event.detail === 0) return;
            suppressNextPointerClick = false;
            if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
            suppressClickTimer = null;
            event.preventDefault();
            event.stopPropagation();
        };
        const blur = (): void => resetPointer();

        element.addEventListener('pointerdown', pointerDown);
        document.addEventListener('pointermove', pointerMove);
        document.addEventListener('pointerup', finishPointer);
        document.addEventListener('pointercancel', pointerCancel);
        element.addEventListener('lostpointercapture', lostPointerCapture);
        element.addEventListener('click', click, true);
        window.addEventListener('blur', blur);
        return () => {
            element.removeEventListener('pointerdown', pointerDown);
            document.removeEventListener('pointermove', pointerMove);
            document.removeEventListener('pointerup', finishPointer);
            document.removeEventListener('pointercancel', pointerCancel);
            element.removeEventListener('lostpointercapture', lostPointerCapture);
            element.removeEventListener('click', click, true);
            window.removeEventListener('blur', blur);
            if (suppressClickTimer !== null) window.clearTimeout(suppressClickTimer);
            resetPointer();
        };
    }, [scrollerElement]);

    useEffect(() => {
        scroller.current?.scrollTo({ left: 0, top: 0 });
        updateVisible();
    }, [startAt, updateVisible, wave]);

    useEffect(() => {
        const element = scroller.current;
        if (element === null) return;
        element.scrollLeft = 0;
        updateVisible();
    }, [deferredChannelFilter, updateVisible]);

    const selectDay = (dayOffset: number): void => {
        const day = todayStart + dayOffset * 86_400_000;
        setStartAt(dayOffset === 0 ? startOfLocalHour(Date.now()) : day);
        setDayDialogOpen(false);
    };
    const openTimeMenu = (event: ReactMouseEvent<HTMLElement>): void => {
        setTimeDay(startOfLocalDay(startAt));
        setTimeHour(new Date(startAt).getHours());
        setTimeAnchor(event.currentTarget);
    };
    const applyTime = (): void => {
        const date = new Date(timeDay);
        setStartAt(new Date(date.getFullYear(), date.getMonth(), date.getDate(), timeHour).getTime());
        setTimeAnchor(null);
    };
    const saveGenres = (): void => {
        saveGuideGenreSettings(genreDraft);
        setGenres({ ...genreDraft });
        setGenreDialogOpen(false);
    };
    const openGenres = (): void => {
        setGenreDraft({ ...genres });
        setMenuAnchor(null);
        setGenreDialogOpen(true);
    };
    const refreshReserves = async (): Promise<void> => {
        setMenuAnchor(null);
        try {
            await api.updateReserves();
            await queryClient.invalidateQueries({ queryKey: ['reserve-lists'] });
            notify('予約情報の更新を開始しました');
        } catch (error) {
            notify(`予約情報の更新を開始できませんでした: ${error instanceof Error ? error.message : String(error)}`, 'error');
        }
    };
    const durationHeight = guideHours * size.timescaleHeight;
    const guideWidth = (filteredSchedules?.length ?? 0) * size.channelWidth;
    const nowLineTop = ((now - startAt) / 3_600_000) * size.timescaleHeight;

    return (
        <>
            <PageHeader
                title={
                    <Button
                        color="inherit"
                        onClick={() => setDayDialogOpen(true)}
                        sx={{ minWidth: 0, px: { xs: 0.25, sm: 0.5 }, fontSize: { xs: '0.82rem', sm: '1.15rem' }, fontWeight: 700, whiteSpace: 'nowrap' }}
                    >
                        {isMobile ? dayTitle(startAt) : `番組表 ${dayTitle(startAt)}`}
                    </Button>
                }
                actions={
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        {isCompactHeader ? (
                            <>
                                <FormControl size="small" sx={{ minWidth: isMobile ? 82 : 120, width: isMobile ? 82 : 120 }}>
                                    <Select value={wave} onChange={event => changeWave(event.target.value)} aria-label="放送波">
                                        <MenuItem value="ALL">全波</MenuItem>
                                        {availableTypes.map(type => (
                                            <MenuItem key={type} value={type}>
                                                {channelTypeLabel(type)}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <IconButton
                                    aria-label="放送局を絞り込み"
                                    color={channelFilter.trim().length > 0 ? 'secondary' : 'inherit'}
                                    onClick={event => setFilterAnchor(event.currentTarget)}
                                >
                                    <SearchOutlined />
                                </IconButton>
                            </>
                        ) : (
                            <Box sx={{ width: 'clamp(400px, 40vw, 740px)', display: 'flex', gap: 0.5 }}>
                                <FormControl size="small" sx={{ flex: '7 1 0', minWidth: 0 }}>
                                    <Select value={wave} onChange={event => changeWave(event.target.value)} aria-label="放送波">
                                        <MenuItem value="ALL">全波</MenuItem>
                                        {availableTypes.map(type => (
                                            <MenuItem key={type} value={type}>
                                                {channelTypeLabel(type)}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <Box sx={{ flex: '3 1 0', minWidth: 0 }}>
                                    <GuideChannelFilterInput value={channelFilter} onChange={setChannelFilter} />
                                </Box>
                            </Box>
                        )}
                        <IconButton aria-label="表示時刻を選択" onClick={openTimeMenu}>
                            <AccessTimeOutlined />
                        </IconButton>
                        <IconButton aria-label="番組表メニュー" onClick={event => setMenuAnchor(event.currentTarget)}>
                            <MoreVertOutlined />
                        </IconButton>
                    </Stack>
                }
            />
            <Popover
                open={filterAnchor !== null}
                anchorEl={filterAnchor}
                onClose={() => setFilterAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { p: 1, width: 'min(320px, calc(100vw - 24px))' } } }}
            >
                <GuideChannelFilterInput value={channelFilter} onChange={setChannelFilter} onClose={() => setFilterAnchor(null)} autoFocus />
            </Popover>
            {schedules.isPending || reserveLists.isPending ? (
                <Box sx={{ minHeight: 400, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : schedules.isError || reserveLists.isError ? (
                <Typography color="error" sx={{ p: 3 }}>
                    番組表を取得できませんでした
                </Typography>
            ) : (displayedSchedules?.length ?? 0) === 0 ? (
                <Typography color="text.secondary" sx={{ py: 8, textAlign: 'center' }}>
                    番組情報はありません
                </Typography>
            ) : (filteredSchedules?.length ?? 0) === 0 ? (
                <Typography color="text.secondary" sx={{ py: 8, px: 2, textAlign: 'center' }}>
                    「{channelFilter.trim()}」に一致する放送局はありません
                </Typography>
            ) : (
                <Box
                    ref={setScrollerRef}
                    className="guide-scroller"
                    onScroll={updateVisible}
                    tabIndex={0}
                    aria-label="番組表"
                    sx={{
                        height: 'calc(100dvh - 57px)',
                        overflow: 'auto',
                        position: 'relative',
                        bgcolor: settings.isForceDisableDarkThemeForGuide ? '#fff' : 'background.default',
                    }}
                >
                    <Box sx={{ width: size.timescaleWidth + guideWidth, minWidth: '100%', height: size.channelHeight + durationHeight }}>
                        <Box sx={{ position: 'sticky', top: 0, zIndex: 6, display: 'flex', width: size.timescaleWidth + guideWidth, height: size.channelHeight }}>
                            <Box
                                sx={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 7,
                                    width: size.timescaleWidth,
                                    flex: `0 0 ${size.timescaleWidth}px`,
                                    bgcolor: '#282d34',
                                    borderRight: '1px solid rgba(255,255,255,.18)',
                                }}
                            />
                            {filteredSchedules?.map(schedule => (
                                <GuideChannelHeader key={schedule.channel.id} channel={schedule.channel} size={size} dark={guideDark} onSelect={selectChannel} />
                            ))}
                        </Box>
                        <Box sx={{ display: 'flex', width: size.timescaleWidth + guideWidth, height: durationHeight }}>
                            <Box
                                sx={{
                                    position: 'sticky',
                                    left: 0,
                                    zIndex: 5,
                                    width: size.timescaleWidth,
                                    flex: `0 0 ${size.timescaleWidth}px`,
                                    height: durationHeight,
                                    color: '#fff',
                                }}
                            >
                                {Array.from({ length: guideHours }, (_, index) => {
                                    const hour = new Date(startAt + index * 3_600_000).getHours();
                                    return (
                                        <Box
                                            key={index}
                                            sx={{
                                                height: size.timescaleHeight,
                                                bgcolor: hourColors[hour],
                                                borderBottom: '1px solid rgba(255,255,255,.4)',
                                                display: 'flex',
                                                justifyContent: 'center',
                                                pt: 1,
                                            }}
                                        >
                                            <Typography sx={{ fontSize: size.timescaleFontsize, fontWeight: 700, lineHeight: 1.1 }}>{hour}</Typography>
                                        </Box>
                                    );
                                })}
                            </Box>
                            <Box
                                sx={{
                                    position: 'relative',
                                    width: guideWidth,
                                    flex: `0 0 ${guideWidth}px`,
                                    height: durationHeight,
                                    backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${size.timescaleHeight - 1}px, rgba(128,128,128,.28) ${size.timescaleHeight - 1}px, rgba(128,128,128,.28) ${size.timescaleHeight}px), repeating-linear-gradient(to right, transparent 0, transparent ${size.channelWidth - 1}px, rgba(128,128,128,.2) ${size.channelWidth - 1}px, rgba(128,128,128,.2) ${size.channelWidth}px)`,
                                }}
                            >
                                <Box ref={setProgramRootElement} sx={{ position: 'absolute', inset: 0 }} />
                                {nowLineTop >= 0 && nowLineTop <= durationHeight && (
                                    <Box sx={{ position: 'absolute', zIndex: 4, top: nowLineTop, left: 0, right: 0, height: 2, bgcolor: '#f00', pointerEvents: 'none' }} />
                                )}
                            </Box>
                        </Box>
                    </Box>
                </Box>
            )}

            <Dialog open={dayDialogOpen} onClose={() => setDayDialogOpen(false)} maxWidth="xs">
                <DialogContent sx={{ width: 170, p: 1 }}>
                    {Array.from({ length: 8 }, (_, index) => (
                        <Button key={index} fullWidth color="inherit" disabled={startOfLocalDay(startAt) === todayStart + index * 86_400_000} onClick={() => selectDay(index)}>
                            {dayTitle(todayStart + index * 86_400_000)}
                        </Button>
                    ))}
                </DialogContent>
            </Dialog>

            <Menu anchorEl={timeAnchor} open={timeAnchor !== null} onClose={() => setTimeAnchor(null)} slotProps={{ paper: { sx: { p: 1, minWidth: 310 } } }}>
                <Box sx={{ display: 'flex', gap: 1, px: 1, pt: 1 }}>
                    <FormControl size="small" fullWidth>
                        <InputLabel>日付</InputLabel>
                        <Select label="日付" value={timeDay} onChange={event => setTimeDay(Number(event.target.value))}>
                            {Array.from({ length: 8 }, (_, index) => {
                                const value = todayStart + index * 86_400_000;
                                return (
                                    <MenuItem key={value} value={value}>
                                        {dayTitle(value)}
                                    </MenuItem>
                                );
                            })}
                        </Select>
                    </FormControl>
                    <FormControl size="small" sx={{ minWidth: 92 }}>
                        <InputLabel>時刻</InputLabel>
                        <Select label="時刻" value={timeHour} onChange={event => setTimeHour(Number(event.target.value))}>
                            {Array.from({ length: 24 }, (_, hour) => (
                                <MenuItem key={hour} value={hour}>
                                    {hour}時
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </Box>
                <Box sx={{ display: 'flex', justifyContent: 'flex-end', gap: 1, px: 1, pt: 1 }}>
                    <Button color="error" onClick={() => setTimeAnchor(null)}>
                        閉じる
                    </Button>
                    <Button onClick={applyTime}>表示</Button>
                </Box>
            </Menu>

            <Menu anchorEl={menuAnchor} open={menuAnchor !== null} onClose={() => setMenuAnchor(null)}>
                <MenuItem onClick={() => void refreshReserves()}>
                    <ListItemIcon>
                        <RefreshOutlined fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>予約情報更新</ListItemText>
                </MenuItem>
                <MenuItem onClick={openGenres}>
                    <ListItemIcon>
                        <BookmarkOutlined fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>表示ジャンル</ListItemText>
                </MenuItem>
                <MenuItem
                    onClick={() => {
                        setMenuAnchor(null);
                        void navigate('/guide/setting');
                    }}
                >
                    <ListItemIcon>
                        <SettingsOutlined fontSize="small" />
                    </ListItemIcon>
                    <ListItemText>表示設定</ListItemText>
                </MenuItem>
            </Menu>

            <Dialog open={genreDialogOpen} onClose={() => setGenreDialogOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>表示ジャンル</DialogTitle>
                <DialogContent dividers>
                    {genreNames.map((name, index) => (
                        <Box key={index} sx={{ height: 48, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography>{name}</Typography>
                            <Switch checked={genreDraft[index] !== false} onChange={event => setGenreDraft(current => ({ ...current, [index]: event.target.checked }))} />
                        </Box>
                    ))}
                </DialogContent>
                <DialogActions>
                    <Button color="error" onClick={() => setGenreDialogOpen(false)}>
                        キャンセル
                    </Button>
                    <Button onClick={saveGenres}>更新</Button>
                </DialogActions>
            </Dialog>

            <GuideProgramDialog
                program={selected?.program ?? null}
                channel={selected?.channel ?? null}
                reserve={selected === null ? undefined : reserves.get(selected.program.id)}
                onClose={closeSelectedProgram}
            />
            <OnAirSelectStreamDialog channel={onAirChannel} config={config.data} settings={settings} onClose={() => setOnAirChannel(null)} onWatch={path => void navigate(path)} />
        </>
    );
}
