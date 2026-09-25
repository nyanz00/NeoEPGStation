import ClearOutlined from '@mui/icons-material/ClearOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import PlaylistAddOutlined from '@mui/icons-material/PlaylistAddOutlined';
import RefreshOutlined from '@mui/icons-material/RefreshOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Alert,
    Box,
    Button,
    Card,
    CardActionArea,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    FormControl,
    FormControlLabel,
    InputLabel,
    ListSubheader,
    MenuItem,
    Select,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import { useQuery } from '@tanstack/react-query';
import type { ChannelId, ChannelType, ReserveItem, RuleSearchOption, ScheduleProgramItem } from '../../../api';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ChannelSelector } from '../components/ChannelSelector';
import { DateTextInput, TimeTextInput } from '../components/DateTimeInput';
import { ReserveProgramDialog } from '../components/ReserveProgramDialog';
import { RuleEditorDialog } from '../components/RuleEditorDialog';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { channelName, channelTypeLabel, formatProgramDate, formatProgramTime, genreNames, programDuration, searchableGenreItems, subGenreNames, weekItems } from '../core/program';
import {
    allKeywordFields,
    animeKeywordFields,
    createDefaultSearchForm,
    fromSearchOption,
    jstDateTimeToEpoch,
    type KeywordFields,
    normalizeSearchForm,
    searchPeriodError,
    type SearchFormState,
    subGenreKey,
    toSearchOption,
} from '../core/search/options';
import { secondsToTime } from '../core/search/timeRule';
import { clearSearchHistory, loadSearchHistory, saveSearchHistory } from '../core/storage/search';
import { useSettings } from '../core/storage/settings';
import { GuideProgramDialog, reserveIndex, type ProgramReserve } from './GuidePage';

type AnimeReturnContext = {
    annictId: number;
    year?: number;
    season?: 'winter' | 'spring' | 'summer' | 'autumn';
    mode?: 'initial' | 'rerun';
};

function parseAnimeReturnContext(params: URLSearchParams): AnimeReturnContext | null {
    if (params.get('origin') !== 'anime') return null;
    const annictId = Number(params.get('annictId'));
    if (!Number.isInteger(annictId) || annictId <= 0) return null;

    const yearValue = params.get('year');
    const year = yearValue !== null && /^\d{4}$/.test(yearValue) ? Number(yearValue) : undefined;
    const seasonValue = params.get('season');
    const season = seasonValue === 'winter' || seasonValue === 'spring' || seasonValue === 'summer' || seasonValue === 'autumn' ? seasonValue : undefined;
    const mode = params.get('mode') === 'rerun' ? 'rerun' : params.get('mode') === 'initial' ? 'initial' : undefined;
    return {
        annictId,
        ...(year !== undefined && year >= 2000 && year <= 2100 ? { year } : {}),
        ...(season !== undefined ? { season } : {}),
        ...(mode !== undefined ? { mode } : {}),
    };
}

function animeDetailReturnPath(context: AnimeReturnContext): string {
    const params = new URLSearchParams();
    if (context.mode !== undefined) params.set('mode', context.mode);
    if (context.year !== undefined) params.set('year', String(context.year));
    if (context.season !== undefined) params.set('season', context.season);
    const query = params.toString();
    return `/anime/${context.annictId}${query.length > 0 ? `?${query}` : ''}`;
}

function channelIdsFromParams(params: URLSearchParams): ChannelId[] {
    return params
        .getAll('channelId')
        .map(value => Number(value))
        .filter((value): value is ChannelId => Number.isInteger(value) && value > 0);
}

function weekFromParams(params: URLSearchParams): number {
    const value = Number(params.get('week'));
    return Number.isInteger(value) && value > 0 && value <= 0x7f ? value : 0x7f;
}

function dateFromParams(params: URLSearchParams, key: string): string {
    const value = params.get(key);
    if (value === null || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return '';
    return jstDateTimeToEpoch(value, '00:00') === undefined ? '' : value;
}

function genresFromParams(params: URLSearchParams): number[] {
    return [
        ...new Set(
            params
                .getAll('genre')
                .map(value => Number(value))
                .filter(value => Number.isInteger(value) && value >= 0 && value <= 15),
        ),
    ];
}

function subGenresFromParams(params: URLSearchParams, genres: number[]): string[] {
    if (genres.length !== 1) return [];
    return [
        ...new Set(
            params
                .getAll('subGenre')
                .map(value => Number(value))
                .filter(value => Number.isInteger(value) && value >= 0 && value <= 15)
                .map(subGenre => subGenreKey(genres[0], subGenre)),
        ),
    ];
}

function timeFromParams(params: URLSearchParams, key: string, fallback: string): string {
    const value = params.get(key);
    return value !== null && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value) ? value : fallback;
}

function formFromParams(params: URLSearchParams): SearchFormState {
    const genres = genresFromParams(params);
    return {
        ...createDefaultSearchForm(),
        keyword: params.get('keyword') ?? '',
        keywordFields: { ...(params.get('origin') === 'anime' ? animeKeywordFields : allKeywordFields) },
        channelIds: channelIdsFromParams(params),
        week: weekFromParams(params),
        genres,
        subGenres: subGenresFromParams(params, genres),
        startDate: dateFromParams(params, 'startDate'),
        startTime: timeFromParams(params, 'startTime', '00:00'),
        endDate: dateFromParams(params, 'endDate'),
        endTime: timeFromParams(params, 'endTime', '23:59'),
    };
}

function KeywordOptions({ value, onChange }: { value: KeywordFields; onChange: (value: KeywordFields) => void }): ReactNode {
    const items: { key: keyof KeywordFields; label: string }[] = [
        { key: 'caseSensitive', label: '大小区別' },
        { key: 'regexp', label: '正規表現' },
        { key: 'name', label: '名前' },
        { key: 'description', label: '概要' },
        { key: 'extended', label: '詳細' },
    ];
    return (
        <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
            {items.map(item => (
                <FormControlLabel
                    key={item.key}
                    control={<Checkbox size="small" checked={value[item.key]} onChange={event => onChange({ ...value, [item.key]: event.target.checked })} />}
                    label={item.label}
                />
            ))}
        </Stack>
    );
}

function reserveLabel(reserve: ProgramReserve): string {
    const labels = { normal: '予約済み', conflict: '競合', skip: '除外', overlap: '重複' } as const;
    const primary = reserve.primary.kind;
    const secondary = Array.from(new Set(reserve.entries.map(entry => entry.kind))).filter(kind => kind !== primary);
    return secondary.length === 0 ? labels[primary] : `${labels[primary]}＋${secondary.map(kind => `${labels[kind]}あり`).join('・')}`;
}

function timeReserveStatus(item: ReserveItem): { label: string; color: 'error' | 'default' | 'primary' } | null {
    if (item.isConflict) return { label: '競合', color: 'error' };
    if (item.isSkip) return { label: '除外', color: 'default' };
    if (item.isOverlap) return { label: '重複', color: 'default' };
    return { label: '予約済み', color: 'primary' };
}

function TimeRuleReserveCard({ item, channel, onOpen }: { item: ReserveItem; channel: string; onOpen: () => void }): ReactNode {
    const status = timeReserveStatus(item);
    return (
        <Card variant="outlined">
            <CardActionArea onClick={onOpen}>
                <CardContent>
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }}>
                            {item.name}
                        </Typography>
                        {status !== null && <Chip size="small" color={status.color} label={status.label} />}
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
                </CardContent>
            </CardActionArea>
        </Card>
    );
}

function timeRuleScheduleLabel(option: RuleSearchOption): string {
    const time = option.times?.[0];
    if (time?.start === undefined || time.range === undefined) return '時刻情報なし';
    const days = weekItems.filter(day => ((time.week ?? 0x7f) & day.bit) !== 0).map(day => day.label);
    return `${days.length === 7 ? '毎日' : days.join('・')} ${secondsToTime(time.start)}～${secondsToTime(time.start + time.range)}`;
}

export function SearchPage(): ReactNode {
    const settings = useSettings();
    const [params] = useSearchParams();
    const location = useLocation();
    const navigationType = useNavigationType();
    const navigate = useNavigate();
    const parsedRuleId = Number(params.get('ruleId') ?? params.get('rule'));
    const ruleId = Number.isInteger(parsedRuleId) && parsedRuleId > 0 ? parsedRuleId : null;
    const animeReturnContext = parseAnimeReturnContext(params);
    const animeReturnPath = animeReturnContext === null ? null : animeDetailReturnPath(animeReturnContext);
    const fromAnimeDetail = (location.state as { fromAnimeDetail?: boolean } | null)?.fromAnimeDetail === true;
    const resetSearchRequested = (location.state as { resetPage?: string } | null)?.resetPage === 'search';
    const routeSignature = `${location.key}:${location.search}:${resetSearchRequested ? 'reset' : 'normal'}`;
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const rule = useQuery({ queryKey: ['rule', ruleId], queryFn: () => api.getRule(ruleId!), enabled: ruleId !== null });
    const [form, setForm] = useState<SearchFormState>(() => formFromParams(params));
    const [submittedOption, setSubmittedOption] = useState<RuleSearchOption | null>(null);
    const [searchRevision, setSearchRevision] = useState(0);
    const [selectedProgram, setSelectedProgram] = useState<ScheduleProgramItem | null>(null);
    const [selectedTimeReserve, setSelectedTimeReserve] = useState<ReserveItem | null>(null);
    const [lastSelectedProgram, setLastSelectedProgram] = useState<ScheduleProgramItem | null>(null);
    const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
    const [inputValidity, setInputValidity] = useState({ startDate: true, startTime: true, endDate: true, endTime: true });
    const [inputResetVersion, setInputResetVersion] = useState(0);
    const [readyRouteSignature, setReadyRouteSignature] = useState<string | null>(null);
    const [readyRuleRouteSignature, setReadyRuleRouteSignature] = useState<string | null>(null);
    const [ruleRetryVersion, setRuleRetryVersion] = useState(0);
    const autoSearchStarted = useRef(false);
    const initializedRouteSignature = useRef<string | null>(null);
    const channelTypesInitialized = useRef(false);
    const restoredSearchNeedsRefresh = useRef(false);
    const shouldScrollToResults = useRef(false);
    const autoScrollEditingRule = useRef(settings.isEnableAutoScrollWhenEditingRule);
    autoScrollEditingRule.current = settings.isEnableAutoScrollWhenEditingRule;
    const historySnapshot = useRef({ form, submittedOption });
    const keywordInputRef = useRef<HTMLInputElement | null>(null);
    const resultsRef = useRef<HTMLDivElement | null>(null);
    const topRuleButtonRef = useRef<HTMLButtonElement | null>(null);
    const bottomRuleButtonRef = useRef<HTMLButtonElement | null>(null);
    const [topRuleButtonVisible, setTopRuleButtonVisible] = useState(true);
    const [bottomRuleButtonVisible, setBottomRuleButtonVisible] = useState(false);
    const { notify } = useNotifications();
    const isRuleReady = ruleId !== null && readyRuleRouteSignature === routeSignature && rule.data !== undefined;
    const isTimeRule = isRuleReady && rule.data.isTimeSpecification === true;

    const historyForm = submittedOption === null ? form : normalizeSearchForm(form);
    historySnapshot.current = {
        form: historyForm,
        submittedOption: submittedOption === null ? null : toSearchOption(historyForm),
    };

    const searchPrograms = useQuery({
        queryKey: ['schedule-search', submittedOption, settings.isHalfWidthDisplayed, settings.searchLength, searchRevision],
        queryFn: () => api.searchPrograms({ option: submittedOption!, isHalfWidth: settings.isHalfWidthDisplayed, limit: settings.searchLength }),
        enabled: readyRouteSignature === routeSignature && submittedOption !== null && !isTimeRule,
        staleTime: Number.POSITIVE_INFINITY,
        refetchOnMount: 'always',
    });
    const programs = submittedOption === null ? null : (searchPrograms.data ?? null);
    const timeRuleReserves = useQuery({
        queryKey: ['reserves', 'rule-search', ruleId, settings.isHalfWidthDisplayed],
        queryFn: () => api.getReserves({ type: 'all', isHalfWidth: settings.isHalfWidthDisplayed, ruleId: ruleId! }),
        enabled: readyRouteSignature === routeSignature && ruleId !== null && isTimeRule,
    });

    useEffect(() => {
        const locationKey = location.key;
        const routeSearch = location.search;
        const shouldSave = ruleId === null;
        return () => {
            if (shouldSave) saveSearchHistory(locationKey, { routeSearch, ...historySnapshot.current });
        };
    }, [location.key, location.search, ruleId]);

    useEffect(() => {
        if (initializedRouteSignature.current === routeSignature) return;
        initializedRouteSignature.current = routeSignature;

        const restored = !resetSearchRequested && navigationType === 'POP' && ruleId === null ? loadSearchHistory(location.key, location.search) : null;
        const nextForm = restored?.form ?? formFromParams(new URLSearchParams(location.search));
        if (resetSearchRequested) clearSearchHistory(location.key);
        setForm(nextForm);
        setSubmittedOption(restored?.submittedOption ?? null);
        setSearchRevision(current => current + 1);
        setSelectedProgram(null);
        setSelectedTimeReserve(null);
        setLastSelectedProgram(null);
        setRuleEditorOpen(false);
        setInputValidity({ startDate: true, startTime: true, endDate: true, endTime: true });
        setInputResetVersion(current => current + 1);
        autoSearchStarted.current = restored?.submittedOption !== null && restored?.submittedOption !== undefined;
        restoredSearchNeedsRefresh.current = restored?.submittedOption !== null && restored?.submittedOption !== undefined;
        setReadyRuleRouteSignature(null);
        channelTypesInitialized.current = restored !== null || nextForm.channelIds.length > 0 || nextForm.channelTypes.length > 0;
        shouldScrollToResults.current = false;
        setReadyRouteSignature(routeSignature);
        if (resetSearchRequested) {
            window.scrollTo({ top: 0, behavior: 'smooth' });
            window.requestAnimationFrame(() => keywordInputRef.current?.focus({ preventScroll: true }));
        }
    }, [location.key, location.search, navigationType, resetSearchRequested, routeSignature, ruleId]);

    useEffect(() => {
        if (readyRouteSignature !== routeSignature || !restoredSearchNeedsRefresh.current || submittedOption === null || isTimeRule) return;
        restoredSearchNeedsRefresh.current = false;
        if (!searchPrograms.isFetching) void searchPrograms.refetch();
    }, [isTimeRule, readyRouteSignature, routeSignature, searchPrograms.isFetching, searchPrograms.refetch, submittedOption]);

    useEffect(() => {
        if (ruleId !== null) return;
        const frame = window.requestAnimationFrame(() => keywordInputRef.current?.focus({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frame);
    }, [location.key, ruleId]);

    const reserveRange = useMemo(() => {
        if (programs === null || programs.length === 0) return null;
        return { startAt: Math.min(...programs.map(program => program.startAt)), endAt: Math.max(...programs.map(program => program.endAt)) };
    }, [programs]);
    const reserveLists = useQuery({
        queryKey: ['reserve-lists', reserveRange?.startAt, reserveRange?.endAt],
        queryFn: () => api.getReserveLists(reserveRange!),
        enabled: reserveRange !== null,
    });
    const reserves = useMemo(() => reserveIndex(reserveLists.data), [reserveLists.data]);
    const reserveStatusReady = programs !== null && (programs.length === 0 || (reserveLists.data !== undefined && reserveLists.error === null));
    useEffect(() => {
        if (reserveLists.error !== null) setSelectedProgram(null);
    }, [reserveLists.error]);

    useEffect(() => {
        if (!reserveStatusReady) {
            setTopRuleButtonVisible(true);
            setBottomRuleButtonVisible(false);
            return;
        }
        const topButton = topRuleButtonRef.current;
        const bottomButton = bottomRuleButtonRef.current;
        if (topButton === null || bottomButton === null) return;
        const isVisible = (element: HTMLElement): boolean => {
            const rect = element.getBoundingClientRect();
            return rect.bottom > 56 && rect.top < window.innerHeight && rect.right > 0 && rect.left < window.innerWidth;
        };
        setTopRuleButtonVisible(isVisible(topButton));
        setBottomRuleButtonVisible(isVisible(bottomButton));
        const observer = new IntersectionObserver(
            entries => {
                entries.forEach(entry => {
                    if (entry.target === topButton) setTopRuleButtonVisible(entry.isIntersecting);
                    if (entry.target === bottomButton) setBottomRuleButtonVisible(entry.isIntersecting);
                });
            },
            { rootMargin: '-56px 0px 0px' },
        );
        observer.observe(topButton);
        observer.observe(bottomButton);
        return () => observer.disconnect();
    }, [reserveStatusReady, programs]);

    const availableTypes = useMemo(() => {
        if (channels.data === undefined || config.data === undefined) return [];
        const types = new Set<ChannelType>();
        channels.data.forEach(channel => {
            if (config.data.broadcast[channel.channelType] !== false) types.add(channel.channelType);
        });
        return [...types];
    }, [channels.data, config.data]);
    useEffect(() => {
        if (channelTypesInitialized.current || form.channelIds.length > 0 || availableTypes.length === 0) return;
        channelTypesInitialized.current = true;
        setForm(current => ({ ...current, channelTypes: availableTypes }));
    }, [availableTypes, form.channelIds.length, routeSignature]);

    const runSearch = useCallback((nextForm: SearchFormState, scroll: boolean): void => {
        const normalized = normalizeSearchForm(nextForm);
        setForm(normalized);
        setSelectedProgram(null);
        setLastSelectedProgram(null);
        shouldScrollToResults.current = scroll;
        setSubmittedOption(toSearchOption(normalized));
        setSearchRevision(current => current + 1);
    }, []);

    useEffect(() => {
        if (readyRouteSignature !== routeSignature || ruleId === null) return;
        let cancelled = false;
        void rule.refetch({ cancelRefetch: false }).then(result => {
            if (cancelled || result.error !== null || result.data === undefined) return;
            const nextForm = fromSearchOption(result.data.searchOption);
            setForm(nextForm);
            channelTypesInitialized.current = true;
            if (result.data.isTimeSpecification) setSubmittedOption(null);
            else runSearch(nextForm, autoScrollEditingRule.current);
            setReadyRuleRouteSignature(routeSignature);
        });
        return () => {
            cancelled = true;
        };
    }, [readyRouteSignature, routeSignature, ruleId, rule.refetch, ruleRetryVersion, runSearch]);

    useEffect(() => {
        if (
            readyRouteSignature !== routeSignature ||
            params.get('auto') !== '1' ||
            ruleId !== null ||
            autoSearchStarted.current ||
            channels.data === undefined ||
            config.data === undefined ||
            (form.channelIds.length === 0 && form.channelTypes.length === 0)
        )
            return;
        autoSearchStarted.current = true;
        runSearch(form, true);
    }, [channels.data, config.data, form, params, readyRouteSignature, routeSignature, ruleId, runSearch]);

    useEffect(() => {
        if (!reserveStatusReady || searchPrograms.dataUpdatedAt === 0 || !shouldScrollToResults.current) return;
        shouldScrollToResults.current = false;
        const frame = window.requestAnimationFrame(() => window.requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
        return () => window.cancelAnimationFrame(frame);
    }, [reserveStatusReady, searchPrograms.dataUpdatedAt]);
    const channelOptions = useMemo(
        () => (channels.data ?? []).map(channel => ({ id: channel.id, label: channel.name, searchText: `${channel.name} ${channel.halfWidthName}` })),
        [channels.data],
    );
    const priorityEncodeChannelIds = useMemo(() => {
        const ids: ChannelId[] = [];
        programs?.forEach(program => {
            if (!ids.includes(program.channelId)) ids.push(program.channelId);
        });
        timeRuleReserves.data?.reserves.forEach(reserve => {
            if (!ids.includes(reserve.channelId)) ids.push(reserve.channelId);
        });
        if (ids.length === 0) form.channelIds.forEach(id => ids.push(id));
        return ids;
    }, [form.channelIds, programs, timeRuleReserves.data]);
    const patch = useCallback(<K extends keyof SearchFormState>(key: K, value: SearchFormState[K]) => setForm(current => ({ ...current, [key]: value })), []);

    const prepareForm = useCallback((): SearchFormState | null => {
        if (Object.values(inputValidity).some(valid => !valid)) {
            notify('検索期間の日時を正しく入力してください', 'error');
            return null;
        }
        const error = searchPeriodError(form);
        if (error !== null) {
            notify(error, 'error');
            return null;
        }
        const normalized = normalizeSearchForm(form);
        if (normalized !== form) setForm(normalized);
        return normalized;
    }, [form, inputValidity, notify]);

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        const nextForm = prepareForm();
        if (nextForm !== null) runSearch(nextForm, true);
    };

    const clearSearchForm = useCallback((): void => {
        setForm({ ...createDefaultSearchForm(), channelTypes: availableTypes });
        setSubmittedOption(null);
        setSearchRevision(current => current + 1);
        setSelectedProgram(null);
        setLastSelectedProgram(null);
        setInputValidity({ startDate: true, startTime: true, endDate: true, endTime: true });
        setInputResetVersion(current => current + 1);
        channelTypesInitialized.current = true;
    }, [availableTypes]);

    const resetSearchState = useCallback((): void => {
        autoSearchStarted.current = false;
        clearSearchForm();
    }, [clearSearchForm]);

    const resetSearchPage = (): void => {
        clearSearchHistory(location.key);
        resetSearchState();
        navigate('/search', { replace: true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.requestAnimationFrame(() => keywordInputRef.current?.focus({ preventScroll: true }));
    };

    const openRuleEditor = (): void => {
        if (!isTimeRule && prepareForm() === null) return;
        setRuleEditorOpen(true);
    };

    const leaveRuleEditor = (): void => {
        navigate('/rule', { replace: true });
    };

    const handleRuleSaved = (): void => {
        const historyState = window.history.state as { idx?: unknown } | null;
        if (typeof historyState?.idx === 'number' && historyState.idx > 0) {
            navigate(-1);
        } else if (animeReturnPath !== null) {
            navigate(animeReturnPath, { replace: true });
        } else if (ruleId !== null) {
            navigate('/rule', { replace: true });
        } else {
            resetSearchPage();
        }
    };

    const showNormalSearch = ruleId === null || (isRuleReady && !isTimeRule);
    const normalDependenciesPending = config.isPending || channels.isPending;
    const normalDependencyError = config.data === undefined ? config.error : channels.data === undefined ? channels.error : null;

    return (
        <>
            <PageHeader
                title={ruleId === null ? '検索' : 'ルール編集'}
                actions={
                    isTimeRule ? (
                        <Button variant="outlined" startIcon={<EditOutlined />} onClick={openRuleEditor}>
                            ルール設定
                        </Button>
                    ) : undefined
                }
            />
            {ruleId !== null && !isRuleReady && rule.error === null && (
                <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            )}
            {ruleId !== null && rule.error !== null && (
                <Alert
                    severity="error"
                    sx={{ m: { xs: 1.5, md: 3 } }}
                    action={
                        <Stack direction="row" spacing={1}>
                            <Button
                                color="inherit"
                                size="small"
                                startIcon={<RefreshOutlined />}
                                disabled={rule.isFetching}
                                onClick={() => {
                                    if (isRuleReady) void rule.refetch();
                                    else setRuleRetryVersion(current => current + 1);
                                }}
                            >
                                再試行
                            </Button>
                            <Button color="inherit" size="small" onClick={leaveRuleEditor}>
                                ルール一覧へ戻る
                            </Button>
                        </Stack>
                    }
                >
                    ルールの取得に失敗しました: {rule.error.message}
                </Alert>
            )}
            {isTimeRule && rule.data !== undefined && (
                <Stack spacing={1.5} sx={{ width: 'min(980px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                    <Card variant="outlined">
                        <CardContent>
                            <Typography variant="overline" color="text.secondary">
                                時刻指定ルール
                            </Typography>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                {rule.data.searchOption.keyword ?? '番組名未指定'}
                            </Typography>
                            <Typography color="text.secondary">
                                {channelName(channels.data, rule.data.searchOption.channelIds?.[0] ?? 0)} ・ {timeRuleScheduleLabel(rule.data.searchOption)}
                            </Typography>
                        </CardContent>
                    </Card>
                    {timeRuleReserves.isPending && (
                        <Box sx={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
                            <CircularProgress />
                        </Box>
                    )}
                    {timeRuleReserves.error !== null && (
                        <Alert
                            severity="error"
                            action={
                                <Button color="inherit" size="small" startIcon={<RefreshOutlined />} onClick={() => void timeRuleReserves.refetch()}>
                                    再試行
                                </Button>
                            }
                        >
                            このルールの予約取得に失敗しました: {timeRuleReserves.error.message}
                        </Alert>
                    )}
                    {timeRuleReserves.data !== undefined && (
                        <>
                            <Typography color="text.secondary" sx={{ textAlign: 'right' }}>
                                予約数 {timeRuleReserves.data.total}件
                            </Typography>
                            {timeRuleReserves.data.reserves.map(item => (
                                <TimeRuleReserveCard key={item.id} item={item} channel={channelName(channels.data, item.channelId)} onOpen={() => setSelectedTimeReserve(item)} />
                            ))}
                            {timeRuleReserves.data.reserves.length === 0 && (
                                <Typography color="text.secondary" sx={{ py: 6, textAlign: 'center' }}>
                                    このルールの予約はありません
                                </Typography>
                            )}
                        </>
                    )}
                </Stack>
            )}
            {showNormalSearch && normalDependenciesPending && normalDependencyError === null && (
                <Box sx={{ minHeight: 320, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            )}
            {showNormalSearch && normalDependencyError !== null && (
                <Alert
                    severity="error"
                    sx={{ m: { xs: 1.5, md: 3 } }}
                    action={
                        <Button color="inherit" size="small" startIcon={<RefreshOutlined />} onClick={() => void Promise.all([config.refetch(), channels.refetch()])}>
                            再試行
                        </Button>
                    }
                >
                    検索画面の初期化に失敗しました: {normalDependencyError.message}
                </Alert>
            )}
            {showNormalSearch && !normalDependenciesPending && normalDependencyError === null && (
                <Box component="form" autoComplete="off" onSubmit={submit} sx={{ width: 'min(980px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                    <Card variant="outlined">
                        <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                            <Stack spacing={2}>
                                <Box>
                                    <TextField
                                        inputRef={keywordInputRef}
                                        fullWidth
                                        label="キーワード"
                                        value={form.keyword}
                                        onChange={event => patch('keyword', event.target.value)}
                                    />
                                    <KeywordOptions value={form.keywordFields} onChange={value => patch('keywordFields', value)} />
                                </Box>
                                <Box>
                                    <TextField fullWidth label="除外キーワード" value={form.ignoreKeyword} onChange={event => patch('ignoreKeyword', event.target.value)} />
                                    <KeywordOptions value={form.ignoreFields} onChange={value => patch('ignoreFields', value)} />
                                </Box>
                                <ChannelSelector multiple options={channelOptions} value={form.channelIds} onChange={value => patch('channelIds', value)} />
                                <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                                    {availableTypes.map(type => (
                                        <FormControlLabel
                                            key={type}
                                            control={
                                                <Checkbox
                                                    checked={form.channelTypes.includes(type)}
                                                    disabled={form.channelIds.length > 0}
                                                    onChange={event =>
                                                        patch(
                                                            'channelTypes',
                                                            event.target.checked ? [...form.channelTypes, type] : form.channelTypes.filter(value => value !== type),
                                                        )
                                                    }
                                                />
                                            }
                                            label={channelTypeLabel(type)}
                                        />
                                    ))}
                                </Stack>
                                <Accordion variant="outlined" defaultExpanded>
                                    <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                                        <Typography>詳細条件</Typography>
                                    </AccordionSummary>
                                    <AccordionDetails>
                                        <Stack spacing={2}>
                                            <FormControl fullWidth size="small">
                                                <InputLabel shrink>大ジャンル</InputLabel>
                                                <Select
                                                    multiple
                                                    displayEmpty
                                                    label="大ジャンル"
                                                    value={form.genres}
                                                    renderValue={selected => (selected.length === 0 ? 'すべて' : selected.map(value => genreNames[value] ?? value).join('、'))}
                                                    onChange={event => {
                                                        const selected =
                                                            typeof event.target.value === 'string' ? event.target.value.split(',').map(value => Number(value)) : event.target.value;
                                                        const genres = selected.includes(-1) ? [] : selected;
                                                        setForm(current => ({
                                                            ...current,
                                                            genres,
                                                            subGenres: current.subGenres.filter(value => genres.includes(Number(value.slice(0, value.indexOf(':'))))),
                                                        }));
                                                    }}
                                                >
                                                    <MenuItem value={-1}>
                                                        <Checkbox size="small" checked={form.genres.length === 0} />
                                                        すべて
                                                    </MenuItem>
                                                    {searchableGenreItems.map(item => (
                                                        <MenuItem key={item.genre} value={item.genre}>
                                                            <Checkbox size="small" checked={form.genres.includes(item.genre)} />
                                                            {item.name}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                            <FormControl fullWidth size="small" disabled={form.genres.length === 0}>
                                                <InputLabel shrink>小ジャンル</InputLabel>
                                                <Select
                                                    multiple
                                                    displayEmpty
                                                    label="小ジャンル"
                                                    value={form.subGenres}
                                                    renderValue={() =>
                                                        form.genres
                                                            .map(genre => {
                                                                const selected = form.subGenres
                                                                    .filter(value => value.startsWith(`${genre}:`))
                                                                    .map(value => Number(value.slice(value.indexOf(':') + 1)));
                                                                return selected.length === 0
                                                                    ? `${genreNames[genre]}: すべて`
                                                                    : `${genreNames[genre]}: ${selected.map(value => subGenreNames[genre]?.[value] ?? value).join('、')}`;
                                                            })
                                                            .join(' / ')
                                                    }
                                                    onChange={event => {
                                                        const selected = typeof event.target.value === 'string' ? event.target.value.split(',') : event.target.value;
                                                        const allGenres = selected.filter(value => value.endsWith(':*')).map(value => Number(value.slice(0, value.indexOf(':'))));
                                                        patch(
                                                            'subGenres',
                                                            selected.filter(
                                                                value =>
                                                                    !value.endsWith(':*') &&
                                                                    form.genres.includes(Number(value.slice(0, value.indexOf(':')))) &&
                                                                    !allGenres.includes(Number(value.slice(0, value.indexOf(':')))),
                                                            ),
                                                        );
                                                    }}
                                                >
                                                    {form.genres.flatMap(genre => {
                                                        const selectedForGenre = form.subGenres.filter(value => value.startsWith(`${genre}:`));
                                                        return [
                                                            <ListSubheader key={`${genre}-header`}>{genreNames[genre]}</ListSubheader>,
                                                            <MenuItem key={`${genre}-all`} value={`${genre}:*`}>
                                                                <Checkbox size="small" checked={selectedForGenre.length === 0} />
                                                                すべて
                                                            </MenuItem>,
                                                            ...(subGenreNames[genre] ?? [])
                                                                .map((name, subGenre) => ({ name, subGenre }))
                                                                .filter(item => item.name.length > 0)
                                                                .map(item => {
                                                                    const value = subGenreKey(genre, item.subGenre);
                                                                    return (
                                                                        <MenuItem key={value} value={value}>
                                                                            <Checkbox size="small" checked={form.subGenres.includes(value)} />
                                                                            {item.name}
                                                                        </MenuItem>
                                                                    );
                                                                }),
                                                        ];
                                                    })}
                                                </Select>
                                            </FormControl>
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5} sx={{ alignItems: { sm: 'center' } }}>
                                                <FormControl size="small" sx={{ minWidth: 140 }}>
                                                    <InputLabel>開始時刻</InputLabel>
                                                    <Select
                                                        label="開始時刻"
                                                        value={form.startHour}
                                                        onChange={event => patch('startHour', event.target.value as number | '')}
                                                        MenuProps={{
                                                            slotProps: {
                                                                paper: {
                                                                    sx: { maxHeight: 360 },
                                                                },
                                                            },
                                                        }}
                                                    >
                                                        <MenuItem value="">指定なし</MenuItem>
                                                        {Array.from({ length: 24 }, (_, hour) => (
                                                            <MenuItem key={hour} value={hour}>
                                                                {hour}時
                                                            </MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                                <Typography>～</Typography>
                                                <FormControl size="small" sx={{ minWidth: 140 }}>
                                                    <InputLabel>範囲</InputLabel>
                                                    <Select
                                                        label="範囲"
                                                        value={form.rangeHour}
                                                        onChange={event => patch('rangeHour', event.target.value as number | '')}
                                                        MenuProps={{
                                                            slotProps: {
                                                                paper: {
                                                                    sx: { maxHeight: 360 },
                                                                },
                                                            },
                                                        }}
                                                    >
                                                        <MenuItem value="">指定なし</MenuItem>
                                                        {Array.from({ length: 23 }, (_, index) => index + 1).map(hour => (
                                                            <MenuItem key={hour} value={hour}>
                                                                {hour}時間
                                                            </MenuItem>
                                                        ))}
                                                    </Select>
                                                </FormControl>
                                                <Typography>以内</Typography>
                                            </Stack>
                                            <Stack direction="row" sx={{ flexWrap: 'wrap' }}>
                                                {weekItems.map(day => (
                                                    <FormControlLabel
                                                        key={day.label}
                                                        control={
                                                            <Checkbox
                                                                checked={(form.week & day.bit) !== 0}
                                                                onChange={event => patch('week', event.target.checked ? form.week | day.bit : form.week & ~day.bit)}
                                                            />
                                                        }
                                                        label={day.label}
                                                    />
                                                ))}
                                            </Stack>
                                            <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                                <TextField
                                                    size="small"
                                                    type="number"
                                                    label="最小（分）"
                                                    value={form.durationMin}
                                                    onChange={event => patch('durationMin', event.target.value)}
                                                />
                                                <TextField
                                                    size="small"
                                                    type="number"
                                                    label="最大（分）"
                                                    value={form.durationMax}
                                                    onChange={event => patch('durationMax', event.target.value)}
                                                />
                                            </Stack>
                                            <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5}>
                                                <Stack direction="row" spacing={1} sx={{ flex: 1 }}>
                                                    <DateTextInput
                                                        key={`start-date-${inputResetVersion.toString(10)}`}
                                                        label="開始日"
                                                        value={form.startDate}
                                                        onChange={value => patch('startDate', value)}
                                                        onValidityChange={valid => setInputValidity(current => ({ ...current, startDate: valid }))}
                                                    />
                                                    <TimeTextInput
                                                        key={`start-time-${inputResetVersion.toString(10)}`}
                                                        label="開始時刻"
                                                        value={form.startTime}
                                                        onChange={value => patch('startTime', value)}
                                                        onValidityChange={valid => setInputValidity(current => ({ ...current, startTime: valid }))}
                                                    />
                                                </Stack>
                                                <Stack direction="row" spacing={1} sx={{ flex: 1 }}>
                                                    <DateTextInput
                                                        key={`end-date-${inputResetVersion.toString(10)}`}
                                                        label="終了日"
                                                        value={form.endDate}
                                                        onChange={value => patch('endDate', value)}
                                                        onValidityChange={valid => setInputValidity(current => ({ ...current, endDate: valid }))}
                                                    />
                                                    <TimeTextInput
                                                        key={`end-time-${inputResetVersion.toString(10)}`}
                                                        label="終了時刻"
                                                        value={form.endTime}
                                                        onChange={value => patch('endTime', value)}
                                                        onValidityChange={valid => setInputValidity(current => ({ ...current, endTime: valid }))}
                                                    />
                                                </Stack>
                                            </Stack>
                                            <FormControlLabel
                                                control={<Switch checked={form.isFree} onChange={event => patch('isFree', event.target.checked)} />}
                                                label="無料放送のみ"
                                            />
                                        </Stack>
                                    </AccordionDetails>
                                </Accordion>
                                <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                                    <Button startIcon={<ClearOutlined />} onClick={clearSearchForm}>
                                        クリア
                                    </Button>
                                    <Button type="submit" variant="contained" startIcon={<SearchOutlined />} disabled={searchPrograms.isFetching}>
                                        検索
                                    </Button>
                                    <Button
                                        ref={topRuleButtonRef}
                                        variant="outlined"
                                        startIcon={<PlaylistAddOutlined />}
                                        disabled={ruleId !== null && rule.data === undefined}
                                        onClick={openRuleEditor}
                                    >
                                        {ruleId === null ? 'ルール作成' : 'ルール設定'}
                                    </Button>
                                </Stack>
                            </Stack>
                        </CardContent>
                    </Card>
                    {submittedOption !== null && searchPrograms.isPending && (
                        <Box sx={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
                            <CircularProgress />
                        </Box>
                    )}
                    {submittedOption !== null && searchPrograms.error !== null && (
                        <Alert
                            severity="error"
                            sx={{ mt: 3 }}
                            action={
                                <Button color="inherit" size="small" startIcon={<RefreshOutlined />} onClick={() => void searchPrograms.refetch()}>
                                    再試行
                                </Button>
                            }
                        >
                            検索に失敗しました: {searchPrograms.error.message}
                        </Alert>
                    )}
                    {programs !== null && programs.length > 0 && reserveLists.isPending && (
                        <Box sx={{ minHeight: 220, display: 'grid', placeItems: 'center' }}>
                            <CircularProgress />
                        </Box>
                    )}
                    {programs !== null && programs.length > 0 && reserveLists.error !== null && (
                        <Alert
                            severity="error"
                            sx={{ mt: 3 }}
                            action={
                                <Button color="inherit" size="small" startIcon={<RefreshOutlined />} onClick={() => void reserveLists.refetch()}>
                                    再試行
                                </Button>
                            }
                        >
                            予約情報の取得に失敗しました: {reserveLists.error.message}
                        </Alert>
                    )}
                    {reserveStatusReady && (
                        <Stack ref={resultsRef} spacing={1.25} sx={{ mt: 3, scrollMarginTop: 72 }}>
                            <Typography color="text.secondary" sx={{ textAlign: 'right' }}>
                                {programs.length}件ヒット
                            </Typography>
                            {programs.map(program => {
                                const reserve = reserves.get(program.id);
                                return (
                                    <Card
                                        key={program.id}
                                        variant="outlined"
                                        sx={{
                                            // MuiCard's outlined style uses an !important divider color in the
                                            // theme. Keep Vue's red reservation decoration from being replaced
                                            // by that default color.
                                            borderColor: theme =>
                                                reserve?.primary.kind === 'conflict' || reserve?.primary.kind === 'normal'
                                                    ? `${theme.palette.error.main} !important`
                                                    : lastSelectedProgram?.id === program.id || reserve !== undefined
                                                      ? 'primary.main'
                                                      : 'divider',
                                            borderWidth: reserve?.primary.kind === 'normal' || reserve?.primary.kind === 'conflict' ? 4 : 1,
                                            borderStyle: reserve?.primary.kind === 'conflict' ? 'dashed' : undefined,
                                            outline: theme =>
                                                reserve?.primary.kind === 'normal' || reserve?.primary.kind === 'conflict'
                                                    ? `3px ${reserve.primary.kind === 'conflict' ? 'dashed' : 'solid'} ${theme.palette.error.main}`
                                                    : undefined,
                                            outlineOffset: reserve?.primary.kind === 'normal' || reserve?.primary.kind === 'conflict' ? -4 : undefined,
                                            ...(reserve?.primary.kind === 'normal' || reserve?.primary.kind === 'conflict'
                                                ? {
                                                      // The shared outlined-card override targets
                                                      // `.MuiPaper-outlined` with equal importance. Increase
                                                      // specificity as well so the reservation color wins.
                                                      '&&.MuiPaper-outlined': {
                                                          borderColor: theme => `${theme.palette.error.main} !important`,
                                                      },
                                                  }
                                                : {}),
                                        }}
                                    >
                                        <CardActionArea
                                            onClick={() => {
                                                setLastSelectedProgram(program);
                                                setSelectedProgram(program);
                                            }}
                                        >
                                            <CardContent>
                                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                                    <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }}>
                                                        {program.name}
                                                    </Typography>
                                                    {reserve !== undefined && (
                                                        <Chip size="small" color={reserve.primary.kind === 'conflict' ? 'error' : 'primary'} label={reserveLabel(reserve)} />
                                                    )}
                                                </Stack>
                                                <Typography variant="body2" color="text.secondary">
                                                    {channelName(channels.data, program.channelId)}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {formatProgramDate(program.startAt)} - {formatProgramTime(program.endAt)}（{programDuration(program)}分）
                                                </Typography>
                                                {program.description !== undefined && (
                                                    <Typography variant="body2" sx={{ mt: 1 }}>
                                                        {program.description}
                                                    </Typography>
                                                )}
                                            </CardContent>
                                        </CardActionArea>
                                    </Card>
                                );
                            })}
                            {programs.length === 0 && (
                                <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
                                    条件に一致する番組はありません
                                </Typography>
                            )}
                            <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', pt: 1.5 }}>
                                <Button
                                    variant="outlined"
                                    onClick={
                                        animeReturnPath !== null
                                            ? () => {
                                                  if (fromAnimeDetail) navigate(-1);
                                                  else navigate(animeReturnPath, { replace: true });
                                              }
                                            : clearSearchForm
                                    }
                                >
                                    {animeReturnPath !== null ? 'キャンセル' : 'クリア'}
                                </Button>
                                <Button
                                    ref={bottomRuleButtonRef}
                                    variant="contained"
                                    startIcon={<PlaylistAddOutlined />}
                                    disabled={ruleId !== null && rule.data === undefined}
                                    onClick={openRuleEditor}
                                >
                                    {ruleId === null ? 'ルール作成' : 'ルール設定'}
                                </Button>
                            </Stack>
                        </Stack>
                    )}
                </Box>
            )}
            {showNormalSearch && reserveStatusReady && !topRuleButtonVisible && !bottomRuleButtonVisible && (
                <Button
                    variant="contained"
                    startIcon={<PlaylistAddOutlined />}
                    disabled={ruleId !== null && rule.data === undefined}
                    onClick={openRuleEditor}
                    sx={{
                        position: 'fixed',
                        right: { xs: 12, lg: '16vw' },
                        bottom: { xs: 16, lg: '4vh' },
                        zIndex: theme => theme.zIndex.appBar - 1,
                        boxShadow: 6,
                    }}
                >
                    {ruleId === null ? 'ルール作成' : 'ルール設定'}
                </Button>
            )}
            <GuideProgramDialog
                program={reserveStatusReady ? selectedProgram : null}
                channel={selectedProgram === null ? null : (channels.data?.find(channel => channel.id === selectedProgram.channelId) ?? null)}
                reserve={selectedProgram === null ? undefined : reserves.get(selectedProgram.id)}
                onClose={() => setSelectedProgram(null)}
            />
            <ReserveProgramDialog
                item={selectedTimeReserve}
                channel={selectedTimeReserve === null ? undefined : channels.data?.find(channel => channel.id === selectedTimeReserve.channelId)}
                onClose={() => setSelectedTimeReserve(null)}
            />
            {(ruleId === null || isRuleReady) && (
                <RuleEditorDialog
                    open={ruleEditorOpen}
                    searchOption={isTimeRule && rule.data !== undefined ? rule.data.searchOption : toSearchOption(form)}
                    priorityChannelIds={priorityEncodeChannelIds}
                    annictId={animeReturnContext?.annictId}
                    rule={rule.data}
                    onClose={() => setRuleEditorOpen(false)}
                    onSaved={handleRuleSaved}
                />
            )}
        </>
    );
}
