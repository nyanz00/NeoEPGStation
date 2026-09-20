import EventAvailableOutlined from '@mui/icons-material/EventAvailableOutlined';
import DescriptionOutlined from '@mui/icons-material/DescriptionOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import { programDialogPaper, programDialogClose } from '../components/programDialogStyles';
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
import type { ChannelScheduleOption, ChannelType, ManualReserveOption, ReserveListItem, ScheduleChannleItem, ScheduleOption, ScheduleProgramItem } from '../../../api';
import { type MouseEvent as ReactMouseEvent, type ReactNode, useCallback, useDeferredValue, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useNavigationType, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { LinkifiedProgramText } from '../components/LinkifiedProgramText';
import { OnAirSelectStreamDialog } from '../components/OnAirSelectStreamDialog';
import { ProgramDialogTitle, programDialogCloseTop, programDialogTitleBottomPadding } from '../components/ProgramDialogTitle';
import { ProgramBroadcastDetails } from '../components/ProgramBroadcastDetails';
import { UserSelector } from '../components/UserSelector';
import { api } from '../core/api/queries';
import { isDefaultVisibleChannel } from '../core/channels';
import { guideChannelDisplayName } from '../core/guide/channels';
import { formatGuideTime, formatJstDateLabel, getJstHour, jstDateAndHourToEpoch, parseGuideTime, startOfJstDay, startOfJstHour } from '../core/guide/time';
import { useNotifications } from '../core/notifications/Notifications';
import { channelTypeLabel, createProgramSearchKeyword, genreNames, normalizeChannelFilter } from '../core/program';
import { withBasePath } from '../core/path';
import { loadGuideScrollPosition, rememberGuideScrollPosition } from '../core/scrollRestoration';
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
export interface ProgramReserveEntry {
    kind: ReserveKind;
    item: ReserveListItem;
}
export interface ProgramReserve {
    primary: ProgramReserveEntry;
    entries: ProgramReserveEntry[];
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
const HOUR_MS = 3_600_000;
const DAY_MS = 24 * HOUR_MS;
const SINGLE_STATION_DAYS = 8;
const reserveKindPriority: Record<ReserveKind, number> = { normal: 4, conflict: 3, overlap: 2, skip: 1 };

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
    const entriesByProgram = new Map<number, ProgramReserveEntry[]>();
    if (lists === undefined) return new Map();
    const add = (kind: ReserveKind, items: ReserveListItem[]): void =>
        items.forEach(item => {
            if (typeof item.programId !== 'number') return;
            const entries = entriesByProgram.get(item.programId) ?? [];
            if (!entries.some(entry => entry.item.reserveId === item.reserveId && entry.kind === kind)) entries.push({ kind, item });
            entriesByProgram.set(item.programId, entries);
        });
    add('normal', lists.normal);
    add('conflict', lists.conflicts);
    add('skip', lists.skips);
    add('overlap', lists.overlaps);

    const result = new Map<number, ProgramReserve>();
    entriesByProgram.forEach((entries, programId) => {
        entries.sort((a, b) => reserveKindPriority[b.kind] - reserveKindPriority[a.kind]);
        result.set(programId, { primary: entries[0], entries });
    });
    return result;
}

function reserveLabel(kind: ReserveKind): string {
    return { normal: '予約', conflict: '競合', skip: '除外', overlap: '重複' }[kind];
}

function reserveSecondaryLabel(reserve: ProgramReserve): string | undefined {
    const secondaryKinds = Array.from(new Set(reserve.entries.map(entry => entry.kind))).filter(kind => kind !== reserve.primary.kind);
    if (secondaryKinds.length === 0) return undefined;
    return secondaryKinds.map(kind => `${reserveLabel(kind)}あり`).join('・');
}

function reserveSummaryLabel(reserve: ProgramReserve): string {
    const secondary = reserveSecondaryLabel(reserve);
    return secondary === undefined ? reserveLabel(reserve.primary.kind) : `${reserveLabel(reserve.primary.kind)}＋${secondary}`;
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

function GuideDateHeader({ startAt, size, dark }: { startAt: number; size: GuideSizeValue; dark: boolean }): ReactNode {
    const borderColor = dark ? '#888' : '#ccc';
    return (
        <Box
            sx={{
                width: size.channelWidth,
                flex: `0 0 ${size.channelWidth}px`,
                height: size.channelHeight,
                minWidth: size.channelWidth,
                maxWidth: size.channelWidth,
                display: 'grid',
                placeItems: 'center',
                boxSizing: 'border-box',
                bgcolor: dark ? '#393e46' : '#999',
                color: '#fff',
                borderLeft: `1px solid ${borderColor}`,
                borderRight: `1px solid ${borderColor}`,
            }}
        >
            <Typography sx={{ fontSize: size.channelFontsize, fontWeight: 700, whiteSpace: 'nowrap' }}>{formatJstDateLabel(startAt)}</Typography>
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
    const reservationUsers = useQuery({ queryKey: ['users'], queryFn: api.getUsers, enabled: program !== null && reserve !== undefined });
    const actionableReserve = typeof activeUser === 'number' ? reserve?.entries.find(entry => entry.item.userId === activeUser) : undefined;
    const [userId, setUserId] = useState<ActiveUserId>(typeof activeUser === 'number' ? activeUser : null);
    const [encodeMode, setEncodeMode] = useState(initialDialogSettings.encode === 'TS' ? '' : initialDialogSettings.encode);
    const [deleteOriginal, setDeleteOriginal] = useState(initialDialogSettings.isDeleteOriginalAfterEncode);
    const [updateThumbnail, setUpdateThumbnail] = useState(initialDialogSettings.updateThumbnail);
    const recordingTypeLabel = encodeMode.length === 0 ? 'オリジナル' : 'エンコード';
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
            if (actionableReserve === undefined || program === null) return null;
            const selectedProgramId = program.id;
            const successMessage =
                actionableReserve.kind === 'skip'
                    ? '除外から予約に戻しました'
                    : actionableReserve.kind === 'overlap'
                      ? '重複状態を解除して予約に戻しました'
                      : '予約をキャンセルしました';
            if (actionableReserve.kind === 'skip') await api.removeReserveSkip(actionableReserve.item.reserveId);
            else if (actionableReserve.kind === 'overlap') await api.removeReserveOverlap(actionableReserve.item.reserveId);
            else await api.cancelReserve(actionableReserve.item.reserveId);
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
        <Dialog
            open={program !== null}
            onClose={() => onClose(program?.id)}
            fullWidth
            maxWidth="md"
            aria-labelledby="guide-program-title"
            slotProps={{
                paper: {
                    sx: theme => ({
                        ...programDialogPaper(theme),
                        maxWidth: 640,
                        maxHeight: 'min(92dvh, 820px)',
                        '& .MuiDialogTitle-root': {
                            ...programDialogPaper(theme)['& .MuiDialogTitle-root'],
                            padding: {
                                xs: `12px 56px ${programDialogTitleBottomPadding} 16px`,
                                sm: `12px 64px ${programDialogTitleBottomPadding} 24px`,
                            },
                        },
                    }),
                },
            }}
        >
            {program !== null && (
                <>
                    <ProgramDialogTitle id="guide-program-title">{program.name}</ProgramDialogTitle>
                    <IconButton aria-label="閉じる" onClick={() => onClose(program.id)} sx={{ ...programDialogClose, top: programDialogCloseTop }}>
                        <CloseOutlined />
                    </IconButton>
                    <DialogContent
                        dividers
                        sx={{
                            p: 0,
                            display: 'flex',
                            flexDirection: 'column',
                            minHeight: 0,
                            overflow: 'hidden',
                        }}
                    >
                        <ProgramBroadcastDetails key={program.id} program={program} channel={channel ?? undefined} autoExpandMaxHeight="min(92dvh, 820px)" />
                        <Stack
                            spacing={2}
                            sx={{
                                px: { xs: 2, sm: 3 },
                                py: 1.5,
                                flex: '1 1 auto',
                                minHeight: 0,
                                overflowY: 'auto',
                                overflowWrap: 'anywhere',
                                '& .MuiTypography-root': { lineHeight: 1.8 },
                            }}
                        >
                            {program.description !== undefined && (
                                <Typography>
                                    <LinkifiedProgramText text={program.description} />
                                </Typography>
                            )}
                            {program.extended !== undefined && (
                                <Box sx={{ whiteSpace: 'pre-wrap' }}>
                                    {program.extended.split(/(^[◇◆].+$)/m).map((part, index) => (
                                        <Typography key={index} sx={{ fontWeight: /^[◇◆]/.test(part) ? 600 : 400, mt: /^[◇◆]/.test(part) ? 1 : 0 }}>
                                            <LinkifiedProgramText text={part.trim()} />
                                        </Typography>
                                    ))}
                                </Box>
                            )}
                        </Stack>
                        <Box
                            sx={{
                                px: { xs: 2, sm: 3 },
                                py: 1,
                                flex: '0 0 auto',
                                borderTop: 1,
                                borderColor: 'divider',
                                bgcolor: 'action.hover',
                            }}
                        >
                            {reserve === undefined ? (
                                <Stack spacing={0.5} sx={{ '& .MuiCheckbox-root': { py: 0.5 }, '& .MuiInputLabel-root': { mb: 0.5 } }}>
                                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: { xs: 1, sm: 2 } }}>
                                        <FormControl size="small" fullWidth>
                                            <InputLabel sx={{ display: { xs: 'none', sm: 'block' } }}>{recordingTypeLabel}</InputLabel>
                                            <Select displayEmpty label={recordingTypeLabel} value={encodeMode} onChange={event => setEncodeMode(event.target.value)}>
                                                <MenuItem value="">TS</MenuItem>
                                                {encodeModes.map(mode => (
                                                    <MenuItem key={mode} value={mode}>
                                                        {mode}
                                                    </MenuItem>
                                                ))}
                                            </Select>
                                        </FormControl>
                                        <UserSelector value={userId} onChange={setUserId} includeMaster={false} minWidth={0} hideLabelOnMobile />
                                    </Box>
                                    <Stack
                                        direction="row"
                                        useFlexGap
                                        sx={{
                                            flexWrap: 'wrap',
                                            columnGap: 1,
                                            '& .MuiFormControlLabel-root': { mr: { xs: 0.5, sm: 2 } },
                                            '& .MuiFormControlLabel-label': { fontSize: { xs: '0.8rem', sm: '0.9375rem' } },
                                        }}
                                    >
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
                                <Stack direction="row" spacing={1} useFlexGap sx={{ flexWrap: 'wrap' }}>
                                    <Chip color={reserve.primary.kind === 'conflict' ? 'error' : 'primary'} label={reserveSummaryLabel(reserve)} />
                                    {reserve.entries.map(entry => {
                                        const reservationUserName = reservationUsers.data?.users.find(user => user.id === entry.item.userId)?.name;
                                        const userLabel = reservationUsers.isError
                                            ? '予約ユーザー取得失敗'
                                            : reservationUsers.isPending
                                              ? 'ユーザー読込中…'
                                              : (reservationUserName ?? (entry.item.userId === undefined ? 'ユーザー未指定' : `ユーザーID: ${entry.item.userId}`));
                                        return <Chip key={`${entry.kind}-${entry.item.reserveId}`} variant="outlined" label={`${userLabel}・${reserveLabel(entry.kind)}`} />;
                                    })}
                                    {actionableReserve === undefined && (
                                        <Typography variant="caption" color="text.secondary" sx={{ alignSelf: 'center' }}>
                                            予約を編集するには対象ユーザーへ切り替えてください
                                        </Typography>
                                    )}
                                </Stack>
                            )}
                        </Box>
                    </DialogContent>
                    <DialogActions
                        sx={{
                            flexWrap: { xs: 'nowrap !important', sm: 'wrap' },
                            gap: { xs: 0.5, sm: 1 },
                            '& .MuiButton-root': { minWidth: { xs: 0, sm: 64 }, px: { xs: 0.5, sm: 1.5 }, fontSize: { xs: '0.8125rem', sm: '0.875rem' } },
                            '& .MuiButton-startIcon': { mr: { xs: 0.5, sm: 1 } },
                        }}
                    >
                        <Button sx={{ mr: 'auto' }} startIcon={<SearchOutlined />} onClick={openRelatedSearch}>
                            <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
                                検索
                            </Box>
                            <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                                関連番組を検索
                            </Box>
                        </Button>
                        <Button color="inherit" onClick={() => onClose(program.id)}>
                            閉じる
                        </Button>
                        {(reserve === undefined || actionableReserve !== undefined) &&
                            (actionableReserve?.item.ruleId === undefined ? (
                                <Button
                                    color="inherit"
                                    startIcon={<DescriptionOutlined />}
                                    onClick={() => {
                                        onClose(program.id);
                                        void navigate(
                                            actionableReserve === undefined
                                                ? `/reserves/manual?programId=${program.id}`
                                                : `/reserves/manual?reserveId=${actionableReserve.item.reserveId}`,
                                        );
                                    }}
                                >
                                    詳細
                                </Button>
                            ) : (
                                <Button
                                    color="inherit"
                                    startIcon={<EditOutlined />}
                                    onClick={() => {
                                        onClose(program.id);
                                        void navigate(`/search?ruleId=${actionableReserve.item.ruleId!.toString(10)}`);
                                    }}
                                >
                                    編集
                                </Button>
                            ))}
                        {reserve === undefined ? (
                            <Button variant="contained" startIcon={<EventAvailableOutlined />} disabled={add.isPending || typeof userId !== 'number'} onClick={() => add.mutate()}>
                                予約
                            </Button>
                        ) : actionableReserve !== undefined && actionableReserve.kind !== 'conflict' ? (
                            <Button color="error" disabled={remove.isPending} onClick={() => remove.mutate()}>
                                {actionableReserve?.kind === 'skip' || actionableReserve?.kind === 'overlap'
                                    ? '解除'
                                    : actionableReserve?.item.ruleId === undefined
                                      ? '削除'
                                      : '除外'}
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
    const location = useLocation();
    const navigationType = useNavigationType();
    const [searchParams, setSearchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const defaultStartAt = useRef(startOfJstHour(Date.now())).current;
    const startAt = parseGuideTime(searchParams.get('time')) ?? defaultStartAt;
    const [selected, setSelected] = useState<{ program: ScheduleProgramItem; channel: ScheduleChannleItem } | null>(null);
    const [onAirChannel, setOnAirChannel] = useState<ScheduleChannleItem | null>(null);
    const [dayDialogOpen, setDayDialogOpen] = useState(false);
    const [dayDialogScrollTop, setDayDialogScrollTop] = useState(0);
    const [timeAnchor, setTimeAnchor] = useState<HTMLElement | null>(null);
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const [filterAnchor, setFilterAnchor] = useState<HTMLElement | null>(null);
    const [channelFilter, setChannelFilter] = useState('');
    const [timeDay, setTimeDay] = useState(startOfJstDay(startAt));
    const [timeHour, setTimeHour] = useState(getJstHour(startAt));
    const [genreDialogOpen, setGenreDialogOpen] = useState(false);
    const [genres, setGenres] = useState<GuideGenreSettings>(() => loadGuideGenreSettings());
    const [genreDraft, setGenreDraft] = useState<GuideGenreSettings>(() => loadGuideGenreSettings());
    const [now, setNow] = useState(Date.now());
    const sizeSettings = useMemo(() => loadGuideSizeSettings(), []);
    const colors = useMemo(() => loadGuideColorSettings(), []);
    const size = useMemo(() => getEffectiveGuideSizeValue(sizeSettings, isMobile ? 'mobile' : 'tablet'), [isMobile, sizeSettings]);
    const guideDark = theme.palette.mode === 'dark' && !settings.isForceDisableDarkThemeForGuide;
    const scroller = useRef<HTMLDivElement | null>(null);
    const [scrollerElement, setScrollerElement] = useState<HTMLDivElement | null>(null);
    const [programRootElement, setProgramRootElement] = useState<HTMLDivElement | null>(null);
    const renderer = useRef<GuideDomRenderer | null>(null);
    const visibleFrame = useRef<number | null>(null);
    const lastScrollPosition = useRef({ left: 0, top: 0 });
    const restoredLocationKey = useRef<string | null>(null);
    const focusedLocationKey = useRef<string | null>(null);
    const todayStart = startOfJstDay(Date.now());

    const availableTypes = useMemo(
        () =>
            Object.entries(config.data?.broadcast ?? {})
                .filter(([, enabled]) => enabled)
                .map(([type]) => type as ChannelType),
        [config.data],
    );
    const requestedWave = searchParams.get('type');
    const wave = requestedWave !== null && availableTypes.includes(requestedWave as ChannelType) ? requestedWave : 'ALL';
    const requestedChannelId = Number(searchParams.get('channelId'));
    const channelId = Number.isInteger(requestedChannelId) && requestedChannelId > 0 ? requestedChannelId : null;
    const isSingleStation = channelId !== null;
    const guideHours = isSingleStation ? 24 : settings.guideLength;
    const endAt = startAt + guideHours * HOUR_MS;
    const reserveEndAt = isSingleStation ? startAt + SINGLE_STATION_DAYS * DAY_MS : endAt;
    const columnStartAts = useMemo(
        () => (isSingleStation ? Array.from({ length: SINGLE_STATION_DAYS }, (_, index) => startAt + index * DAY_MS) : undefined),
        [isSingleStation, startAt],
    );
    const changeWave = (value: string): void => {
        setSearchParams(current => {
            const next = new URLSearchParams(current);
            next.delete('channelId');
            if (value === 'ALL') next.delete('type');
            else next.set('type', value);
            return next;
        });
    };
    const changeStartAt = (value: number): void => {
        setSearchParams(current => {
            const next = new URLSearchParams(current);
            next.set('time', formatGuideTime(value));
            return next;
        });
    };
    const scheduleOption = useMemo<ScheduleOption>(() => {
        const selectedType = wave === 'ALL' ? null : (wave as ChannelType);
        const extraTypes =
            wave === 'ALL' ? availableTypes.filter(type => !basicTypes.includes(type)) : selectedType !== null && !basicTypes.includes(selectedType) ? [selectedType] : [];
        return {
            startAt,
            endAt,
            isHalfWidth: settings.isHalfWidthDisplayed,
            isFree: settings.isShowOnlyFreePrograms || undefined,
            GR: selectedType === null || selectedType === 'GR',
            BS: selectedType === null || selectedType === 'BS',
            CS: selectedType === null || selectedType === 'CS',
            SKY: selectedType === null || selectedType === 'SKY',
            channelTypes: extraTypes,
        };
    }, [availableTypes, endAt, settings.isHalfWidthDisplayed, settings.isShowOnlyFreePrograms, startAt, wave]);
    const channelScheduleOption = useMemo<ChannelScheduleOption | null>(
        () =>
            channelId === null
                ? null
                : {
                      startAt,
                      days: SINGLE_STATION_DAYS,
                      isHalfWidth: settings.isHalfWidthDisplayed,
                      isFree: settings.isShowOnlyFreePrograms || undefined,
                      channelId,
                  },
        [channelId, settings.isHalfWidthDisplayed, settings.isShowOnlyFreePrograms, startAt],
    );
    const schedules = useQuery({
        queryKey: isSingleStation ? ['channel-schedules', channelScheduleOption] : ['schedules', scheduleOption],
        queryFn: () => (channelScheduleOption === null ? api.getSchedules(scheduleOption) : api.getChannelSchedules(channelScheduleOption)),
        enabled: config.data !== undefined,
    });
    const displayedSchedules = useMemo(() => {
        if (schedules.data === undefined) return undefined;
        if (isSingleStation) return schedules.data;
        return settings.isShowInformationalChannels ? schedules.data : schedules.data.filter(schedule => isDefaultVisibleChannel(schedule.channel));
    }, [isSingleStation, schedules.data, settings.isShowInformationalChannels]);
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
        if (displayedSchedules === undefined || isSingleStation || channelFilterTokens.length === 0) return displayedSchedules;
        return displayedSchedules.filter(schedule => {
            const name = normalizeChannelFilter(schedule.channel.name);
            return channelFilterTokens.every(token => name.includes(token));
        });
    }, [channelFilterTokens, displayedSchedules, isSingleStation]);
    const reserveLists = useQuery({ queryKey: ['reserve-lists', startAt, reserveEndAt], queryFn: () => api.getReserveLists({ startAt, endAt: reserveEndAt }) });
    const reserves = useMemo(() => reserveIndex(reserveLists.data), [reserveLists.data]);
    const reserveStates = useMemo(
        () => new Map(Array.from(reserves, ([programId, value]) => [programId, { kind: value.primary.kind, note: reserveSecondaryLabel(value) }])),
        [reserves],
    );
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

    const handleGuideScroll = useCallback((): void => {
        const element = scroller.current;
        if (element !== null) lastScrollPosition.current = { left: element.scrollLeft, top: element.scrollTop };
        updateVisible();
    }, [updateVisible]);

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
            columnStartAts,
            columnDurationMs: isSingleStation ? DAY_MS : undefined,
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
    }, [colors, columnStartAts, endAt, filteredSchedules, guideDark, isSingleStation, programRootElement, selectProgram, settings.guideMode, size, startAt, updateVisible]);

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
        const target = navigationType === 'POP' ? loadGuideScrollPosition(location.key) : undefined;
        lastScrollPosition.current = { left: target?.left ?? 0, top: target?.top ?? 0 };
    }, [location.key, navigationType]);

    useEffect(() => {
        return () => {
            rememberGuideScrollPosition(location.key, lastScrollPosition.current.left, lastScrollPosition.current.top);
        };
    }, [location.key]);

    useEffect(() => {
        const element = scrollerElement;
        if (element === null || schedules.data === undefined || restoredLocationKey.current === location.key) return;
        const target = navigationType === 'POP' ? loadGuideScrollPosition(location.key) : undefined;
        lastScrollPosition.current = { left: target?.left ?? 0, top: target?.top ?? 0 };
        const frame = window.requestAnimationFrame(() => {
            if (restoredLocationKey.current === location.key) return;
            restoredLocationKey.current = location.key;
            element.scrollTo({ left: target?.left ?? 0, top: target?.top ?? 0, behavior: 'auto' });
            lastScrollPosition.current = { left: element.scrollLeft, top: element.scrollTop };
            updateVisible();
        });
        return () => window.cancelAnimationFrame(frame);
    }, [location.key, navigationType, schedules.data, scrollerElement, updateVisible]);

    useEffect(() => {
        const element = scrollerElement;
        if (element === null || schedules.data === undefined || focusedLocationKey.current === location.key) return;
        if (typeof navigator !== 'undefined' && /Android/i.test(navigator.userAgent)) return;
        const frame = window.requestAnimationFrame(() => {
            if (focusedLocationKey.current === location.key) return;
            focusedLocationKey.current = location.key;
            element.focus({ preventScroll: true });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [location.key, schedules.data, scrollerElement]);

    useEffect(() => {
        const element = scroller.current;
        if (element === null) return;
        element.scrollLeft = 0;
        lastScrollPosition.current = { left: 0, top: element.scrollTop };
        updateVisible();
    }, [deferredChannelFilter, updateVisible]);

    const dayTargetAt = (dayOffset: number): number => (dayOffset === 0 ? startOfJstHour(now) : todayStart + dayOffset * DAY_MS);
    const openDayDialog = (): void => {
        setDayDialogScrollTop(scroller.current?.scrollTop ?? 0);
        setDayDialogOpen(true);
    };
    const selectDay = (dayOffset: number): void => {
        const targetAt = dayTargetAt(dayOffset);
        setDayDialogOpen(false);
        if (startAt !== targetAt) {
            changeStartAt(targetAt);
            return;
        }

        const element = scroller.current;
        if (element === null) return;
        element.scrollTo({ left: element.scrollLeft, top: 0, behavior: 'auto' });
        lastScrollPosition.current = { left: element.scrollLeft, top: 0 };
        updateVisible();
    };
    const openTimeMenu = (event: ReactMouseEvent<HTMLElement>): void => {
        setTimeDay(startOfJstDay(startAt));
        setTimeHour(getJstHour(startAt));
        setTimeAnchor(event.currentTarget);
    };
    const applyTime = (): void => {
        changeStartAt(jstDateAndHourToEpoch(timeDay, timeHour));
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
    const nowColumnIndex = isSingleStation ? Math.floor((now - startAt) / DAY_MS) : 0;
    const nowColumnStartAt = startAt + nowColumnIndex * DAY_MS;
    const nowLineTop = ((now - nowColumnStartAt) / HOUR_MS) * size.timescaleHeight;
    const showNowLine = nowColumnIndex >= 0 && nowColumnIndex < (isSingleStation ? SINGLE_STATION_DAYS : 1) && nowLineTop >= 0 && nowLineTop <= durationHeight;
    const singleStationName = isSingleStation ? displayedSchedules?.[0]?.channel.name : undefined;

    return (
        <>
            <PageHeader
                title={
                    <Button
                        color="inherit"
                        onClick={openDayDialog}
                        sx={{ minWidth: 0, px: { xs: 0.25, sm: 0.5 }, fontSize: { xs: '0.82rem', sm: '1.15rem' }, fontWeight: 700, whiteSpace: 'nowrap' }}
                    >
                        {isSingleStation ? (singleStationName ?? '番組表') : isMobile ? formatJstDateLabel(startAt) : `番組表 ${formatJstDateLabel(startAt)}`}
                    </Button>
                }
                actions={
                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                        {!isSingleStation &&
                            (isCompactHeader ? (
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
                            ))}
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
                open={!isSingleStation && filterAnchor !== null}
                anchorEl={filterAnchor}
                onClose={() => setFilterAnchor(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { p: 1, width: 'min(320px, calc(100vw - 24px))' } } }}
            >
                <GuideChannelFilterInput value={channelFilter} onChange={setChannelFilter} onClose={() => setFilterAnchor(null)} autoFocus />
            </Popover>
            {config.data === undefined && config.isError ? (
                <Box sx={{ minHeight: 400, display: 'grid', placeItems: 'center', px: 3 }}>
                    <Stack spacing={2} sx={{ alignItems: 'center' }}>
                        <Typography color="error">番組表の設定を取得できませんでした</Typography>
                        <Button variant="outlined" startIcon={<RefreshOutlined />} disabled={config.isFetching} onClick={() => void config.refetch()}>
                            再試行
                        </Button>
                    </Stack>
                </Box>
            ) : schedules.isPending || reserveLists.isPending ? (
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
                    onScroll={handleGuideScroll}
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
                            {filteredSchedules?.map((schedule, index) =>
                                isSingleStation ? (
                                    <GuideDateHeader key={`${schedule.channel.id}-${index}`} startAt={columnStartAts?.[index] ?? startAt} size={size} dark={guideDark} />
                                ) : (
                                    <GuideChannelHeader key={schedule.channel.id} channel={schedule.channel} size={size} dark={guideDark} onSelect={selectChannel} />
                                ),
                            )}
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
                                    const hour = getJstHour(startAt + index * HOUR_MS);
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
                                {showNowLine && (
                                    <Box
                                        sx={{
                                            position: 'absolute',
                                            zIndex: 4,
                                            top: nowLineTop,
                                            left: isSingleStation ? nowColumnIndex * size.channelWidth : 0,
                                            right: isSingleStation ? 'auto' : 0,
                                            width: isSingleStation ? size.channelWidth : 'auto',
                                            height: 2,
                                            bgcolor: '#f00',
                                            pointerEvents: 'none',
                                        }}
                                    />
                                )}
                            </Box>
                        </Box>
                    </Box>
                </Box>
            )}

            <Dialog
                open={dayDialogOpen}
                onClose={() => setDayDialogOpen(false)}
                fullWidth
                maxWidth="xs"
                aria-labelledby="guide-day-dialog-title"
                slotProps={{
                    paper: {
                        sx: theme => ({
                            ...programDialogPaper(theme),
                            maxWidth: 300,
                            '& .MuiDialogTitle-root': { ...programDialogPaper(theme)['& .MuiDialogTitle-root'], py: 1.5 },
                            '& .MuiDialogActions-root': { ...programDialogPaper(theme)['& .MuiDialogActions-root'], py: 1 },
                        }),
                    },
                }}
            >
                <DialogTitle id="guide-day-dialog-title">表示日付</DialogTitle>
                <IconButton aria-label="閉じる" onClick={() => setDayDialogOpen(false)} sx={programDialogClose}>
                    <CloseOutlined />
                </IconButton>
                <DialogContent dividers sx={{ p: 0, bgcolor: 'action.hover' }}>
                    <Stack sx={{ py: 0.5 }}>
                        {Array.from({ length: 8 }, (_, index) => (
                            <Button
                                key={index}
                                fullWidth
                                color="inherit"
                                disabled={startAt === dayTargetAt(index) && dayDialogScrollTop <= 1}
                                onClick={() => selectDay(index)}
                                sx={{ minHeight: 40, borderRadius: 0, py: 0.5 }}
                            >
                                {formatJstDateLabel(todayStart + index * DAY_MS)}
                            </Button>
                        ))}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button color="inherit" onClick={() => setDayDialogOpen(false)}>
                        閉じる
                    </Button>
                </DialogActions>
            </Dialog>

            <Menu anchorEl={timeAnchor} open={timeAnchor !== null} onClose={() => setTimeAnchor(null)} slotProps={{ paper: { sx: { p: 1, minWidth: 310 } } }}>
                <Box sx={{ display: 'flex', gap: 1, px: 1, pt: 1 }}>
                    <FormControl size="small" fullWidth>
                        <InputLabel>日付</InputLabel>
                        <Select label="日付" value={timeDay} onChange={event => setTimeDay(Number(event.target.value))}>
                            {Array.from({ length: 8 }, (_, index) => {
                                const value = todayStart + index * DAY_MS;
                                return (
                                    <MenuItem key={value} value={value}>
                                        {formatJstDateLabel(value)}
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
