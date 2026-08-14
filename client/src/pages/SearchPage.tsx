import ClearOutlined from '@mui/icons-material/ClearOutlined';
import PlaylistAddOutlined from '@mui/icons-material/PlaylistAddOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Card,
    CardActionArea,
    CardContent,
    Checkbox,
    Chip,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
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
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelId, ChannelItem, ChannelType, Genre, ManualReserveOption, ReserveItem, ReserveListItem, RuleSearchOption, ScheduleProgramItem } from '../../../api';
import { type FormEvent, type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ChannelSelector } from '../components/ChannelSelector';
import { DateTextInput } from '../components/DateTimeInput';
import { RuleEditorDialog } from '../components/RuleEditorDialog';
import { UserSelector } from '../components/UserSelector';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import { channelName, channelTypeLabel, formatProgramDate, formatProgramTime, genreNames, programDuration, subGenreNames, weekItems } from '../core/program';
import { useActiveUser, type ActiveUserId } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';

interface KeywordFields {
    caseSensitive: boolean;
    regexp: boolean;
    name: boolean;
    description: boolean;
    extended: boolean;
}

interface SearchFormState {
    keyword: string;
    keywordFields: KeywordFields;
    ignoreKeyword: string;
    ignoreFields: KeywordFields;
    channelIds: ChannelId[];
    channelTypes: ChannelType[];
    genres: number[];
    subGenres: string[];
    startHour: number | '';
    rangeHour: number | '';
    week: number;
    durationMin: string;
    durationMax: string;
    startDate: string;
    endDate: string;
    isFree: boolean;
}

type ReserveKind = 'normal' | 'conflict' | 'skip' | 'overlap';
interface ProgramReserve {
    kind: ReserveKind;
    item: ReserveListItem;
}

function ruleReserveStatus(item: ReserveItem): string | null {
    if (item.isConflict) return '競合';
    if (item.isSkip) return '除外';
    if (item.isOverlap) return '重複';
    return null;
}

const allKeywordFields: KeywordFields = { caseSensitive: false, regexp: false, name: true, description: true, extended: false };
const defaultForm: SearchFormState = {
    keyword: '',
    keywordFields: allKeywordFields,
    ignoreKeyword: '',
    ignoreFields: allKeywordFields,
    channelIds: [],
    channelTypes: [],
    genres: [],
    subGenres: [],
    startHour: '',
    rangeHour: '',
    week: 0x7f,
    durationMin: '',
    durationMax: '',
    startDate: '',
    endDate: '',
    isFree: false,
};

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
    const date = new Date(`${value}T00:00:00`);
    if (Number.isNaN(date.getTime())) return '';
    return localDateValue(date.getTime()) === value ? value : '';
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

function subGenreKey(genre: number, subGenre: number): string {
    return `${genre}:${subGenre}`;
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

function dateBoundary(value: string, end: boolean): number | undefined {
    if (value.length === 0) return undefined;
    const date = new Date(`${value}T${end ? '23:59:59.999' : '00:00:00.000'}`);
    return Number.isNaN(date.getTime()) ? undefined : date.getTime();
}

const openSearchPeriodStartAt = 0;
const openSearchPeriodEndAt = Date.UTC(9999, 11, 31, 23, 59, 59, 999);

function toSearchOption(form: SearchFormState): RuleSearchOption {
    const option: RuleSearchOption = {};
    if (form.keyword.trim().length > 0) {
        option.keyword = form.keyword.trim();
        option.keyCS = form.keywordFields.caseSensitive;
        option.keyRegExp = form.keywordFields.regexp;
        option.name = form.keywordFields.name;
        option.description = form.keywordFields.description;
        option.extended = form.keywordFields.extended;
    }
    if (form.ignoreKeyword.trim().length > 0) {
        option.ignoreKeyword = form.ignoreKeyword.trim();
        option.ignoreKeyCS = form.ignoreFields.caseSensitive;
        option.ignoreKeyRegExp = form.ignoreFields.regexp;
        option.ignoreName = form.ignoreFields.name;
        option.ignoreDescription = form.ignoreFields.description;
        option.ignoreExtended = form.ignoreFields.extended;
    }
    if (form.channelIds.length > 0) option.channelIds = form.channelIds;
    else if (form.channelTypes.length > 0) option.channelTypes = form.channelTypes;
    if (form.genres.length > 0) {
        option.genres = form.genres.flatMap(genre => {
            const subGenres = form.subGenres
                .filter(value => value.startsWith(`${genre}:`))
                .map(value => Number(value.slice(value.indexOf(':') + 1)))
                .filter(value => Number.isInteger(value));
            return subGenres.length === 0 ? [{ genre } satisfies Genre] : subGenres.map(subGenre => ({ genre, subGenre }) satisfies Genre);
        });
    }
    option.times = [{ week: form.week === 0 ? 0x7f : form.week }];
    if (form.startHour !== '' && form.rangeHour !== '') {
        option.times[0].start = form.startHour;
        option.times[0].range = form.rangeHour;
    }
    if (form.durationMin.length > 0) option.durationMin = Number(form.durationMin) * 60;
    if (form.durationMax.length > 0) option.durationMax = Number(form.durationMax) * 60;
    const startAt = dateBoundary(form.startDate, false);
    const endAt = dateBoundary(form.endDate, true);
    if (startAt !== undefined || endAt !== undefined) {
        option.searchPeriods = [{ startAt: startAt ?? openSearchPeriodStartAt, endAt: endAt ?? openSearchPeriodEndAt }];
    }
    if (form.isFree) option.isFree = true;
    return option;
}

function localDateValue(value: number | undefined): string {
    if (value === undefined) return '';
    const date = new Date(value);
    const year = date.getFullYear().toString(10).padStart(4, '0');
    const month = (date.getMonth() + 1).toString(10).padStart(2, '0');
    const day = date.getDate().toString(10).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

function fromSearchOption(option: RuleSearchOption): SearchFormState {
    const legacyTypes = (['GR', 'BS', 'CS', 'SKY'] as const).filter(type => option[type] === true);
    const time = option.times?.[0];
    const genres = [...new Set(option.genres?.map(item => item.genre) ?? [])];
    const wholeGenres = new Set((option.genres ?? []).filter(item => item.subGenre === undefined).map(item => item.genre));
    return {
        keyword: option.keyword ?? '',
        keywordFields: {
            caseSensitive: option.keyCS === true,
            regexp: option.keyRegExp === true,
            name: option.name !== false,
            description: option.description !== false,
            extended: option.extended === true,
        },
        ignoreKeyword: option.ignoreKeyword ?? '',
        ignoreFields: {
            caseSensitive: option.ignoreKeyCS === true,
            regexp: option.ignoreKeyRegExp === true,
            name: option.ignoreName !== false,
            description: option.ignoreDescription !== false,
            extended: option.ignoreExtended === true,
        },
        channelIds: option.channelIds ?? [],
        channelTypes: option.channelTypes ?? legacyTypes,
        genres,
        subGenres: [
            ...new Set(
                (option.genres ?? []).filter(item => item.subGenre !== undefined && !wholeGenres.has(item.genre)).map(item => subGenreKey(item.genre, item.subGenre as number)),
            ),
        ],
        startHour: time?.start ?? '',
        rangeHour: time?.range ?? '',
        week: time?.week ?? 0x7f,
        durationMin: option.durationMin === undefined ? '' : (option.durationMin / 60).toString(10),
        durationMax: option.durationMax === undefined ? '' : (option.durationMax / 60).toString(10),
        startDate:
            option.searchPeriods?.[0]?.startAt === undefined || option.searchPeriods[0].startAt === openSearchPeriodStartAt ? '' : localDateValue(option.searchPeriods[0].startAt),
        endDate: option.searchPeriods?.[0]?.endAt === undefined || option.searchPeriods[0].endAt === openSearchPeriodEndAt ? '' : localDateValue(option.searchPeriods[0].endAt),
        isFree: option.isFree === true,
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

function reserveIndex(
    lists: { normal: ReserveListItem[]; conflicts: ReserveListItem[]; skips: ReserveListItem[]; overlaps: ReserveListItem[] } | undefined,
): Map<number, ProgramReserve> {
    const result = new Map<number, ProgramReserve>();
    if (lists === undefined) return result;
    const add = (kind: ReserveKind, items: ReserveListItem[]): void => {
        items.forEach(item => {
            if (typeof item.programId === 'number') result.set(item.programId, { kind, item });
        });
    };
    add('normal', lists.normal);
    add('conflict', lists.conflicts);
    add('skip', lists.skips);
    add('overlap', lists.overlaps);
    return result;
}

function reserveLabel(kind: ReserveKind): string {
    return { normal: '予約済み', conflict: '競合', skip: '除外', overlap: '重複' }[kind];
}

interface ProgramDialogProps {
    program: ScheduleProgramItem | null;
    channels: ChannelItem[];
    reserve?: ProgramReserve;
    onClose: () => void;
}

function ProgramDialog({ program, channels, reserve, onClose }: ProgramDialogProps): ReactNode {
    const navigate = useNavigate();
    const activeUser = useActiveUser();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const [userId, setUserId] = useState<ActiveUserId>(typeof activeUser === 'number' ? activeUser : null);
    const [encodeMode, setEncodeMode] = useState('');
    const [deleteOriginal, setDeleteOriginal] = useState(false);
    const [updateThumbnail, setUpdateThumbnail] = useState(false);
    const encodeModes = useMemo(
        () => Array.from(new Set((config.data?.encode ?? []).filter((mode): mode is string => typeof mode === 'string' && mode.trim().length > 0))),
        [config.data?.encode],
    );

    useEffect(() => setUserId(typeof activeUser === 'number' ? activeUser : null), [activeUser, program]);

    const finish = async (): Promise<void> => {
        await Promise.all([
            queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
            queryClient.invalidateQueries({ queryKey: ['reserves'] }),
            queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
        ]);
        onClose();
    };
    const add = useMutation({
        mutationFn: async () => {
            if (program === null || typeof userId !== 'number') throw new Error('予約するユーザーを選択してください');
            const option: ManualReserveOption = { programId: program.id, userId, allowEndLack: true };
            if (encodeMode.length > 0) {
                option.encodeOption = { mode1: encodeMode, isDeleteOriginalAfterEncode: deleteOriginal, updateThumbnail };
            }
            return api.addReserve(option);
        },
        onSuccess: async () => {
            notify(`${program?.name ?? '番組'}を予約しました`, 'success');
            await finish();
        },
        onError: error => notify(`予約に失敗しました: ${error.message}`, 'error'),
    });
    const remove = useMutation({
        mutationFn: async () => {
            if (reserve === undefined) return;
            if (reserve.kind === 'skip') await api.removeReserveSkip(reserve.item.reserveId);
            else if (reserve.kind === 'overlap') await api.removeReserveOverlap(reserve.item.reserveId);
            else await api.cancelReserve(reserve.item.reserveId);
        },
        onSuccess: async () => {
            notify(reserve?.kind === 'skip' || reserve?.kind === 'overlap' ? '予約状態を解除しました' : '予約をキャンセルしました', 'success');
            await finish();
        },
        onError: error => notify(`予約の変更に失敗しました: ${error.message}`, 'error'),
    });

    return (
        <Dialog open={program !== null} onClose={onClose} fullWidth maxWidth="sm" slotProps={{ paper: { sx: { maxHeight: 'min(90vh, 760px)' } } }}>
            {program !== null && (
                <>
                    <DialogTitle>{program.name}</DialogTitle>
                    <DialogContent dividers sx={{ p: 0, display: 'flex', flexDirection: 'column', minHeight: 0, overflow: 'hidden' }}>
                        <Stack spacing={1.5} sx={{ p: 2, flex: '1 1 auto', minHeight: 0, overflowY: 'auto' }}>
                            <Typography color="text.secondary">{channelName(channels, program.channelId)}</Typography>
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
                        <Button onClick={onClose}>閉じる</Button>
                        <Button
                            onClick={() => {
                                onClose();
                                void navigate(reserve === undefined ? `/reserves/manual?programId=${program.id}` : `/reserves/manual?reserveId=${reserve.item.reserveId}`);
                            }}
                        >
                            詳細
                        </Button>
                        {reserve === undefined ? (
                            <Button variant="contained" onClick={() => add.mutate()} disabled={add.isPending || typeof userId !== 'number'}>
                                予約
                            </Button>
                        ) : reserve.kind !== 'conflict' ? (
                            <Button color="error" onClick={() => remove.mutate()} disabled={remove.isPending}>
                                {reserve.kind === 'skip' || reserve.kind === 'overlap' ? '解除' : reserve.item.ruleId === undefined ? '削除' : '除外'}
                            </Button>
                        ) : null}
                    </DialogActions>
                </>
            )}
        </Dialog>
    );
}

export function SearchPage(): ReactNode {
    const settings = useSettings();
    const [params] = useSearchParams();
    const navigate = useNavigate();
    const parsedRuleId = Number(params.get('ruleId'));
    const ruleId = Number.isInteger(parsedRuleId) && parsedRuleId > 0 ? parsedRuleId : null;
    const parsedAnimeAnnictId = Number(params.get('annictId'));
    const animeReturnPath = params.get('origin') === 'anime' && Number.isInteger(parsedAnimeAnnictId) && parsedAnimeAnnictId > 0 ? `/anime/${parsedAnimeAnnictId}` : null;
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const rule = useQuery({ queryKey: ['rule', ruleId], queryFn: () => api.getRule(ruleId!), enabled: ruleId !== null });
    const ruleReserves = useQuery({
        queryKey: ['reserves', 'rule', ruleId, settings.isHalfWidthDisplayed],
        queryFn: () => api.getReserves({ type: 'all', isHalfWidth: settings.isHalfWidthDisplayed, ruleId: ruleId! }),
        enabled: ruleId !== null,
    });
    const [form, setForm] = useState<SearchFormState>(() => {
        const genres = genresFromParams(params);
        return {
            ...defaultForm,
            keyword: params.get('keyword') ?? '',
            channelIds: channelIdsFromParams(params),
            week: weekFromParams(params),
            genres,
            subGenres: subGenresFromParams(params, genres),
            startDate: dateFromParams(params, 'startDate'),
        };
    });
    const [programs, setPrograms] = useState<ScheduleProgramItem[] | null>(null);
    const [selectedProgram, setSelectedProgram] = useState<ScheduleProgramItem | null>(null);
    const [lastSelectedProgram, setLastSelectedProgram] = useState<ScheduleProgramItem | null>(null);
    const [ruleEditorOpen, setRuleEditorOpen] = useState(false);
    const autoSearchStarted = useRef(false);
    const ruleSearchStarted = useRef<number | null>(null);
    const keywordInputRef = useRef<HTMLInputElement | null>(null);
    const resultsRef = useRef<HTMLDivElement | null>(null);
    const { notify } = useNotifications();

    useEffect(() => {
        if (ruleId !== null) return;
        const frame = window.requestAnimationFrame(() => keywordInputRef.current?.focus({ preventScroll: true }));
        return () => window.cancelAnimationFrame(frame);
    }, [ruleId]);

    const availableTypes = useMemo(() => {
        const types = new Set<ChannelType>();
        channels.data?.forEach(channel => {
            if (config.data?.broadcast[channel.channelType] !== false) types.add(channel.channelType);
        });
        return [...types];
    }, [channels.data, config.data]);
    useEffect(() => {
        if (form.channelTypes.length === 0 && availableTypes.length > 0) setForm(current => ({ ...current, channelTypes: availableTypes }));
    }, [availableTypes, form.channelTypes.length]);

    const search = useMutation({
        mutationFn: (option?: RuleSearchOption) =>
            api.searchPrograms({ option: option ?? toSearchOption(form), isHalfWidth: settings.isHalfWidthDisplayed, limit: settings.searchLength }),
        onSuccess: result => {
            setSelectedProgram(null);
            setLastSelectedProgram(null);
            setPrograms(result);
            if (ruleId === null || settings.isEnableAutoScrollWhenEditingRule) {
                window.requestAnimationFrame(() => window.requestAnimationFrame(() => resultsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })));
            }
        },
        onError: error => notify(`検索に失敗しました: ${error.message}`, 'error'),
    });
    useEffect(() => {
        if (ruleId === null || rule.data === undefined || ruleSearchStarted.current === ruleId) return;
        const nextForm = fromSearchOption(rule.data.searchOption);
        setForm(nextForm);
        ruleSearchStarted.current = ruleId;
        search.mutate(toSearchOption(nextForm));
    }, [rule.data, ruleId, search]);
    useEffect(() => {
        if (params.get('auto') !== '1' || ruleId !== null || autoSearchStarted.current || channels.isPending || config.isPending || form.channelTypes.length === 0) return;
        autoSearchStarted.current = true;
        search.mutate(undefined);
    }, [channels.isPending, config.isPending, form.channelTypes.length, params, ruleId, search]);
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
    const channelOptions = useMemo(
        () => (channels.data ?? []).map(channel => ({ id: channel.id, label: channel.name, searchText: `${channel.name} ${channel.halfWidthName}` })),
        [channels.data],
    );
    const priorityEncodeChannelIds = useMemo(() => {
        const ids: ChannelId[] = [];
        programs?.forEach(program => {
            if (!ids.includes(program.channelId)) ids.push(program.channelId);
        });
        if (ids.length === 0) form.channelIds.forEach(id => ids.push(id));
        return ids;
    }, [form.channelIds, programs]);
    const patch = useCallback(<K extends keyof SearchFormState>(key: K, value: SearchFormState[K]) => setForm(current => ({ ...current, [key]: value })), []);

    const submit = (event: FormEvent): void => {
        event.preventDefault();
        search.mutate(undefined);
    };

    const clearSearchForm = (): void => {
        setForm({ ...defaultForm, channelTypes: availableTypes });
        setPrograms(null);
        setSelectedProgram(null);
        setLastSelectedProgram(null);
    };

    const resetSearchPage = (): void => {
        clearSearchForm();
        navigate('/search', { replace: true });
        window.scrollTo({ top: 0, behavior: 'smooth' });
        window.requestAnimationFrame(() => keywordInputRef.current?.focus({ preventScroll: true }));
    };

    const handleRuleSaved = (): void => {
        void api
            .getReserveCounts()
            .then(counts => {
                if (counts.conflicts > 0) {
                    navigate('/reserves?type=conflict');
                } else if (ruleId !== null) {
                    navigate('/rule');
                } else if (animeReturnPath !== null) {
                    navigate(`/anime?focus=${parsedAnimeAnnictId}`);
                } else {
                    resetSearchPage();
                }
            })
            .catch(() => {
                if (ruleId !== null) navigate('/rule');
                else if (animeReturnPath !== null) navigate(`/anime?focus=${parsedAnimeAnnictId}`);
                else resetSearchPage();
            });
    };

    return (
        <>
            <PageHeader title={ruleId === null ? '検索' : 'ルール編集'} />
            <Box component="form" autoComplete="off" onSubmit={submit} sx={{ width: 'min(980px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                <Card variant="outlined">
                    <CardContent sx={{ p: { xs: 2, md: 3 } }}>
                        <Stack spacing={2}>
                            <Box>
                                <TextField inputRef={keywordInputRef} fullWidth label="キーワード" value={form.keyword} onChange={event => patch('keyword', event.target.value)} />
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
                                                    patch('channelTypes', event.target.checked ? [...form.channelTypes, type] : form.channelTypes.filter(value => value !== type))
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
                                                {genreNames.map((name, index) => (
                                                    <MenuItem key={`${index}-${name}`} value={index}>
                                                        <Checkbox size="small" checked={form.genres.includes(index)} />
                                                        {name}
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
                                                <Select label="開始時刻" value={form.startHour} onChange={event => patch('startHour', event.target.value as number | '')}>
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
                                                <Select label="範囲" value={form.rangeHour} onChange={event => patch('rangeHour', event.target.value as number | '')}>
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
                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                            <DateTextInput label="開始日" value={form.startDate} onChange={value => patch('startDate', value)} />
                                            <DateTextInput label="終了日" value={form.endDate} onChange={value => patch('endDate', value)} />
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
                                <Button type="submit" variant="contained" startIcon={<SearchOutlined />} disabled={search.isPending}>
                                    検索
                                </Button>
                                <Button
                                    variant="outlined"
                                    startIcon={<PlaylistAddOutlined />}
                                    disabled={ruleId !== null && rule.data === undefined}
                                    onClick={() => setRuleEditorOpen(true)}
                                >
                                    {ruleId === null ? 'ルール作成' : 'ルール設定'}
                                </Button>
                            </Stack>
                        </Stack>
                    </CardContent>
                </Card>
                {ruleId !== null && (
                    <Box sx={{ mt: 3 }}>
                        <Stack direction="row" sx={{ mb: 1.25, alignItems: 'center', justifyContent: 'space-between' }}>
                            <Typography variant="h6">このルールの予約</Typography>
                            {ruleReserves.data !== undefined && <Typography color="text.secondary">{ruleReserves.data.total}件</Typography>}
                        </Stack>
                        {ruleReserves.isPending ? (
                            <Box sx={{ py: 5, textAlign: 'center' }}>
                                <CircularProgress size={28} />
                            </Box>
                        ) : ruleReserves.isError ? (
                            <Typography color="error" sx={{ py: 3, textAlign: 'center' }}>
                                予約情報を読み込めませんでした
                            </Typography>
                        ) : ruleReserves.data.reserves.length === 0 ? (
                            <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                                このルールによる予約はありません
                            </Typography>
                        ) : (
                            <Stack spacing={1.25}>
                                {ruleReserves.data.reserves.map(reserve => {
                                    const status = ruleReserveStatus(reserve);
                                    return (
                                        <Card key={reserve.id} variant="outlined" sx={{ borderColor: reserve.isConflict ? 'error.main' : 'divider' }}>
                                            <CardContent sx={{ p: 2, '&:last-child': { pb: 2 } }}>
                                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                                    <Typography variant="subtitle1" sx={{ flex: 1, fontWeight: 700 }}>
                                                        {reserve.name}
                                                    </Typography>
                                                    {status !== null && <Chip size="small" color={reserve.isConflict ? 'error' : 'default'} label={status} />}
                                                </Stack>
                                                <Typography variant="body2" color="text.secondary">
                                                    {channelName(channels.data, reserve.channelId)}
                                                </Typography>
                                                <Typography variant="caption" color="text.secondary">
                                                    {formatProgramDate(reserve.startAt)} - {formatProgramTime(reserve.endAt)}（{programDuration(reserve)}分）
                                                </Typography>
                                                {reserve.description !== undefined && (
                                                    <Typography variant="body2" sx={{ mt: 1 }}>
                                                        {reserve.description}
                                                    </Typography>
                                                )}
                                            </CardContent>
                                        </Card>
                                    );
                                })}
                            </Stack>
                        )}
                    </Box>
                )}
                {programs !== null && (
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
                                        borderColor:
                                            reserve?.kind === 'conflict'
                                                ? 'error.main'
                                                : lastSelectedProgram?.id === program.id || reserve !== undefined
                                                  ? 'primary.main'
                                                  : 'divider',
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
                                                    <Chip size="small" color={reserve.kind === 'conflict' ? 'error' : 'primary'} label={reserveLabel(reserve.kind)} />
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
                            <Button variant="outlined" onClick={animeReturnPath !== null ? () => navigate(animeReturnPath) : clearSearchForm}>
                                {animeReturnPath !== null ? 'キャンセル' : 'クリア'}
                            </Button>
                            <Button
                                variant="contained"
                                startIcon={<PlaylistAddOutlined />}
                                disabled={ruleId !== null && rule.data === undefined}
                                onClick={() => setRuleEditorOpen(true)}
                            >
                                {ruleId === null ? 'ルール作成' : 'ルール設定'}
                            </Button>
                        </Stack>
                    </Stack>
                )}
            </Box>
            <ProgramDialog
                program={selectedProgram}
                channels={channels.data ?? []}
                reserve={selectedProgram === null ? undefined : reserves.get(selectedProgram.id)}
                onClose={() => setSelectedProgram(null)}
            />
            <RuleEditorDialog
                open={ruleEditorOpen}
                searchOption={toSearchOption(form)}
                priorityChannelIds={priorityEncodeChannelIds}
                annictId={animeReturnPath !== null ? parsedAnimeAnnictId : undefined}
                rule={rule.data}
                onClose={() => setRuleEditorOpen(false)}
                onSaved={handleRuleSaved}
            />
        </>
    );
}
