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
    IconButton,
    InputLabel,
    ListItemIcon,
    Menu,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddManualEncodeProgramOption, ChannelItem, GetRecordedOption, RecordedItem, ReserveItem, VideoFileId } from '../../../api';
import { type ReactNode, type UIEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ProgramThumbnail } from '../components/ProgramThumbnail';
import { RecordedItemActions } from '../components/RecordedItemActions';
import { api } from '../core/api/queries';
import { appIconAssetUrl, getAppIconSet } from '../core/icons/appIcons';
import { createRecordedRelatedSearchOption } from '../core/media/recorded';
import { useNotifications } from '../core/notifications/Notifications';
import { channelName, formatProgramDate, formatProgramTime, genreNames, programDuration } from '../core/program';
import { useActiveUser } from '../core/storage/activeUser';
import { loadAddEncodeSettings, saveAddEncodeSettings } from '../core/storage/encode';
import { useSettings } from '../core/storage/settings';

type DashboardColumnName = 'recording' | 'recorded' | 'reserves';
type DashboardScrollPositions = Record<DashboardColumnName, number>;

const dashboardScrollPositions = new Map<string, DashboardScrollPositions>();
const dashboardDesktopMedia = '@media (min-width:1023px)';

function parseInteger(value: string | null, minimum = 0): number | undefined {
    if (value === null || value.trim().length === 0) return undefined;
    const number = Number(value);
    return Number.isSafeInteger(number) && number >= minimum ? number : undefined;
}

function isTrueQuery(value: string | null): boolean {
    return value === 'true' || value === '1';
}

function reserveStatus(item: ReserveItem): string | null {
    if (item.isConflict) return '競合';
    if (item.isSkip) return '除外';
    if (item.isOverlap) return '重複';
    return null;
}

function RecordedDashboardCard({
    item,
    channel,
    showThumbnail,
    showDrop,
    onOpen,
    onSearch,
    onEncode,
    onStop,
    onChanged,
    onDeleted,
}: {
    item: RecordedItem;
    channel?: ChannelItem;
    showThumbnail: boolean;
    showDrop: boolean;
    onOpen: () => void;
    onSearch: () => void;
    onEncode: () => void;
    onStop: () => void;
    onChanged: () => void;
    onDeleted: () => void;
}): ReactNode {
    const [menuAnchor, setMenuAnchor] = useState<HTMLElement | null>(null);
    const thumbnailId = item.thumbnails?.[0];
    const hasVisual = showThumbnail && (thumbnailId !== undefined || channel !== undefined);
    const drop = item.dropLogFile;
    const hasDropError = drop !== undefined && (drop.dropCnt > 0 || drop.errorCnt > 0 || drop.scramblingCnt > 0);

    return (
        <Card variant="outlined" sx={{ position: 'relative', overflow: 'hidden', flex: '0 0 auto' }}>
            <CardActionArea onClick={onOpen} sx={{ minHeight: hasVisual ? 100 : undefined, display: hasVisual ? 'flex' : 'block', alignItems: 'stretch' }}>
                {hasVisual && (
                    <ProgramThumbnail
                        thumbnailId={thumbnailId}
                        channel={channel}
                        sx={{ width: { xs: 128, sm: '34%' }, maxWidth: 180, minHeight: 100, alignSelf: 'stretch', borderRadius: 0 }}
                    />
                )}
                <CardContent sx={{ minWidth: 0, flex: 1, py: 1.25, pl: 1.5, pr: 5.5, '&:last-child': { pb: 1.25 } }}>
                    <Typography variant="subtitle2" noWrap title={item.name}>
                        {item.name}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {channel?.name ?? item.channelId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {formatProgramDate(item.startAt)} - {formatProgramTime(item.endAt)}（{programDuration(item)}分）
                    </Typography>
                    {showDrop && drop !== undefined ? (
                        <Typography variant="caption" color={hasDropError ? 'error' : 'text.secondary'} noWrap sx={{ display: 'block', mt: 0.25 }}>
                            drop: {drop.dropCnt}, error: {drop.errorCnt}, scrambling: {drop.scramblingCnt}
                        </Typography>
                    ) : (
                        <Typography variant="caption" noWrap title={item.description} sx={{ display: 'block', mt: 0.25 }}>
                            {item.description ?? '\u00a0'}
                        </Typography>
                    )}
                </CardContent>
            </CardActionArea>
            <IconButton
                size="small"
                aria-label={`${item.name}の操作メニュー`}
                aria-haspopup="menu"
                onClick={event => {
                    event.stopPropagation();
                    setMenuAnchor(event.currentTarget);
                }}
                sx={{ position: 'absolute', top: 5, right: 5 }}
            >
                <MoreVertOutlined fontSize="small" />
            </IconButton>
            <RecordedItemActions
                item={item}
                anchorEl={menuAnchor}
                onClose={() => setMenuAnchor(null)}
                onSearch={onSearch}
                onEncode={onEncode}
                onStop={item.isRecording || item.isEncoding ? onStop : undefined}
                onChanged={onChanged}
                onDeleted={onDeleted}
            />
        </Card>
    );
}

function ReserveDashboardCard({
    item,
    channel,
    onOpen,
    onMenu,
}: {
    item: ReserveItem;
    channel?: ChannelItem;
    onOpen: () => void;
    onMenu: (anchor: HTMLElement) => void;
}): ReactNode {
    const status = reserveStatus(item);
    return (
        <Card
            variant="outlined"
            sx={{
                position: 'relative',
                flex: '0 0 auto',
                borderColor: item.isConflict ? 'error.main' : 'divider',
                bgcolor: item.isSkip || item.isOverlap ? 'action.disabledBackground' : undefined,
                opacity: item.isSkip ? 0.72 : 1,
            }}
        >
            <CardActionArea onClick={onOpen}>
                <CardContent sx={{ py: 1.25, pl: 1.5, pr: 5.5, '&:last-child': { pb: 1.25 } }}>
                    <Stack direction="row" spacing={0.75} sx={{ alignItems: 'center', minWidth: 0 }}>
                        <Typography variant="subtitle2" noWrap title={item.name} sx={{ minWidth: 0, flex: 1, textDecoration: item.isSkip ? 'line-through' : undefined }}>
                            {item.name}
                        </Typography>
                        {status !== null && <Chip size="small" color={item.isConflict ? 'error' : 'default'} label={status} sx={{ flex: '0 0 auto' }} />}
                        <Chip size="small" variant="outlined" label={item.ruleId === undefined ? '手動' : 'ルール'} sx={{ flex: '0 0 auto' }} />
                    </Stack>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {channel?.name ?? item.channelId}
                    </Typography>
                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block' }}>
                        {formatProgramDate(item.startAt)} - {formatProgramTime(item.endAt)}（{programDuration(item)}分）
                    </Typography>
                    {item.description !== undefined && (
                        <Typography variant="caption" noWrap title={item.description} sx={{ display: 'block', mt: 0.25 }}>
                            {item.description}
                        </Typography>
                    )}
                </CardContent>
            </CardActionArea>
            <IconButton
                size="small"
                aria-label={`${item.name}の予約操作`}
                aria-haspopup="menu"
                onClick={event => {
                    event.stopPropagation();
                    onMenu(event.currentTarget);
                }}
                sx={{ position: 'absolute', top: 5, right: 5 }}
            >
                <MoreVertOutlined fontSize="small" />
            </IconButton>
        </Card>
    );
}

interface DashboardColumnProps {
    title: string;
    displayed?: number;
    total?: number;
    children: ReactNode;
    morePath: string;
    badge?: number;
    error?: Error | null;
    loading?: boolean;
    onRetry: () => void;
    onBadgeClick?: () => void;
    scrollRef: (element: HTMLDivElement | null) => void;
    onScroll: (event: UIEvent<HTMLDivElement>) => void;
}

function DashboardColumn({ title, displayed, total, children, morePath, badge, error, loading, onRetry, onBadgeClick, scrollRef, onScroll }: DashboardColumnProps): ReactNode {
    const navigate = useNavigate();
    const hasMore = displayed !== undefined && total !== undefined && total > displayed;
    return (
        <Card variant="outlined" sx={{ minWidth: 0, minHeight: 0, display: 'flex', flexDirection: 'column', overflow: 'hidden' }}>
            <Box sx={{ px: 2, py: 1.5, display: 'flex', alignItems: 'center', gap: 1, borderBottom: 1, borderColor: 'divider', flex: '0 0 auto' }}>
                <Typography variant="subtitle1" sx={{ fontWeight: 700 }}>
                    {title}
                    {displayed !== undefined && total !== undefined ? ` ${displayed}/${total}` : ''}
                </Typography>
                {typeof badge === 'number' && badge > 0 && (
                    <Chip
                        size="small"
                        color="error"
                        label={`競合 ${badge}`}
                        clickable={onBadgeClick !== undefined}
                        onClick={onBadgeClick}
                        aria-label={`競合予約${badge}件を表示`}
                    />
                )}
            </Box>
            <Stack
                ref={scrollRef}
                onScroll={onScroll}
                spacing={1}
                sx={{ p: 1.5, minHeight: 0, flex: 1, overflowY: 'visible', WebkitOverflowScrolling: 'touch', [dashboardDesktopMedia]: { overflowY: 'auto' } }}
            >
                {loading ? (
                    <Box sx={{ minHeight: 160, display: 'grid', placeItems: 'center' }}>
                        <CircularProgress size={28} />
                    </Box>
                ) : error !== null && error !== undefined ? (
                    <Stack spacing={1} sx={{ py: 3, alignItems: 'center', textAlign: 'center' }}>
                        <Typography color="error">
                            {title}の取得に失敗しました: {error.message}
                        </Typography>
                        <Button onClick={onRetry}>再試行</Button>
                    </Stack>
                ) : (
                    children
                )}
            </Stack>
            {hasMore && (
                <Button fullWidth onClick={() => void navigate(morePath)} sx={{ borderRadius: 0, flex: '0 0 auto' }}>
                    more
                </Button>
            )}
        </Card>
    );
}

function RecordedEncodeDialog({ item, open, onClose, onChanged }: { item: RecordedItem | null; open: boolean; onClose: () => void; onChanged: () => void }): ReactNode {
    const [initialSettings] = useState(loadAddEncodeSettings);
    const [sourceVideoFileId, setSourceVideoFileId] = useState<VideoFileId | ''>('');
    const [mode, setMode] = useState(initialSettings.encodeMode ?? '');
    const [sameDirectory, setSameDirectory] = useState(initialSettings.isSaveSameDirectory);
    const [parentDir, setParentDir] = useState(initialSettings.parentDirectory ?? '');
    const [directory, setDirectory] = useState('');
    const [removeOriginal, setRemoveOriginal] = useState(initialSettings.removeOriginal);
    const [updateThumbnail, setUpdateThumbnail] = useState(initialSettings.updateThumbnail);
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const files = item?.videoFiles ?? [];

    useEffect(() => {
        if (!open || item === null) return;
        setSourceVideoFileId(item.videoFiles?.[0]?.id ?? '');
        setDirectory('');
    }, [item, open]);

    const persist = (): void => {
        saveAddEncodeSettings({
            encodeMode: mode.length > 0 ? mode : null,
            parentDirectory: parentDir.length > 0 ? parentDir : null,
            isSaveSameDirectory: sameDirectory,
            removeOriginal,
            updateThumbnail,
        });
    };
    const close = (): void => {
        persist();
        onClose();
    };
    const addEncode = useMutation({
        mutationFn: (option: AddManualEncodeProgramOption) => api.addManualEncode(option),
        onSuccess: async () => {
            notify('エンコードキューに追加しました。', 'success');
            onClose();
            onChanged();
            await Promise.all([queryClient.invalidateQueries({ queryKey: ['encode'] }), queryClient.invalidateQueries({ queryKey: ['recorded'] })]);
        },
        onError: error => notify(`エンコードを追加できません: ${error.message}`, 'error'),
    });
    const canEncode = item !== null && sourceVideoFileId !== '' && mode.length > 0 && (sameDirectory || parentDir.length > 0);

    return (
        <Dialog open={open} onClose={close} fullWidth maxWidth="sm" disableScrollLock>
            <DialogTitle>{item?.name ?? '録画'}</DialogTitle>
            <DialogContent dividers>
                <Stack spacing={1.5}>
                    <FormControl fullWidth size="small">
                        <InputLabel>元ファイル</InputLabel>
                        <Select label="元ファイル" value={sourceVideoFileId} onChange={event => setSourceVideoFileId(Number(event.target.value))}>
                            {files.map(video => (
                                <MenuItem key={video.id} value={video.id}>
                                    {video.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl fullWidth size="small">
                        <InputLabel>エンコードプリセット</InputLabel>
                        <Select label="エンコードプリセット" value={mode} onChange={event => setMode(event.target.value)}>
                            {config.data?.encode.map(value => (
                                <MenuItem key={value} value={value}>
                                    {value}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <FormControl fullWidth size="small" disabled={sameDirectory}>
                        <InputLabel>保存先</InputLabel>
                        <Select label="保存先" value={parentDir} onChange={event => setParentDir(event.target.value)}>
                            {config.data?.recorded.map(value => (
                                <MenuItem key={value} value={value}>
                                    {value}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <TextField disabled={sameDirectory} size="small" label="サブディレクトリ" value={directory} onChange={event => setDirectory(event.target.value)} />
                    <Stack spacing={0}>
                        <FormControlLabel
                            control={<Checkbox checked={sameDirectory} onChange={event => setSameDirectory(event.target.checked)} />}
                            label="元ファイルと同じ場所に保存"
                        />
                        <FormControlLabel control={<Checkbox checked={removeOriginal} onChange={event => setRemoveOriginal(event.target.checked)} />} label="元ファイル削除" />
                        <FormControlLabel control={<Checkbox checked={updateThumbnail} onChange={event => setUpdateThumbnail(event.target.checked)} />} label="サムネイル再生成" />
                    </Stack>
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button onClick={close}>キャンセル</Button>
                <Button
                    variant="contained"
                    disabled={!canEncode || addEncode.isPending}
                    onClick={() => {
                        if (item === null || sourceVideoFileId === '') return;
                        persist();
                        const option: AddManualEncodeProgramOption = {
                            recordedId: item.id,
                            sourceVideoFileId,
                            mode,
                            removeOriginal,
                            updateThumbnail,
                            isSaveSameDirectory: sameDirectory,
                        };
                        if (!sameDirectory) {
                            option.parentDir = parentDir;
                            if (directory.trim().length > 0) option.directory = directory.trim();
                        }
                        addEncode.mutate(option);
                    }}
                >
                    追加
                </Button>
            </DialogActions>
        </Dialog>
    );
}

export function DashboardPage(): ReactNode {
    const settings = useSettings();
    const appIcon = getAppIconSet(settings.appIconSet);
    const logoIcon = settings.isAppLogoLinkedToIcon ? appIcon.original : 'nyanz-smile.png';
    const activeUser = useActiveUser();
    const navigate = useNavigate();
    const location = useLocation();
    const [searchParams] = useSearchParams();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const [encodeTarget, setEncodeTarget] = useState<RecordedItem | null>(null);
    const [reserveDetailTarget, setReserveDetailTarget] = useState<ReserveItem | null>(null);
    const [reserveMenuTarget, setReserveMenuTarget] = useState<{ item: ReserveItem; anchor: HTMLElement } | null>(null);
    const [reserveRemoveTarget, setReserveRemoveTarget] = useState<ReserveItem | null>(null);
    const scrollElements = useRef<Record<DashboardColumnName, HTMLDivElement | null>>({ recording: null, recorded: null, reserves: null });
    const restoredScrollKey = useRef<string | null>(null);
    const version = useQuery({ queryKey: ['version'], queryFn: api.getVersion, staleTime: 60_000 });
    const updateInfo = useQuery({
        queryKey: ['system-update'],
        queryFn: () => api.getSystemUpdateInfo(false),
        staleTime: 10 * 60_000,
        enabled: settings.isShowVersionUpdateNotification,
    });
    const userId = typeof activeUser === 'number' ? activeUser : undefined;
    const recordedOption = useMemo<GetRecordedOption>(
        () => ({
            isHalfWidth: settings.isHalfWidthDisplayed,
            userId,
            offset: 0,
            limit: settings.recordedLength,
            keyword: searchParams.get('keyword') || undefined,
            ruleId: parseInteger(searchParams.get('ruleId')),
            channelId: parseInteger(searchParams.get('channelId'), 1),
            genre: parseInteger(searchParams.get('genre')),
            hasOriginalFile: isTrueQuery(searchParams.get('hasOriginalFile')) || undefined,
        }),
        [searchParams, settings.isHalfWidthDisplayed, settings.recordedLength, userId],
    );
    const [recording, recorded, reserves, reserveCounts, channels] = useQueries({
        queries: [
            {
                queryKey: ['recording', userId, settings.isHalfWidthDisplayed, settings.recordingLength],
                queryFn: () => api.getRecording({ isHalfWidth: settings.isHalfWidthDisplayed, userId, offset: 0, limit: settings.recordingLength }),
            },
            { queryKey: ['recorded', recordedOption], queryFn: () => api.getRecorded(recordedOption) },
            {
                queryKey: ['reserves', 'all', userId, settings.isHalfWidthDisplayed, settings.reservesLength],
                queryFn: () => api.getReserves({ type: 'all', isHalfWidth: settings.isHalfWidthDisplayed, userId, offset: 0, limit: settings.reservesLength }),
            },
            { queryKey: ['reserve-counts'], queryFn: api.getReserveCounts },
            { queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 },
        ],
    });
    const channelMap = useMemo(() => new Map(channels.data?.map(channel => [channel.id, channel])), [channels.data]);
    const allSettled = !recording.isPending && !recorded.isPending && !reserves.isPending;
    const recordedMoreParams = useMemo(() => {
        const params = new URLSearchParams();
        for (const name of ['keyword', 'ruleId', 'channelId', 'genre', 'hasOriginalFile']) {
            const value = searchParams.get(name);
            if (value !== null) params.set(name, value);
        }
        params.set('page', '2');
        return params.toString();
    }, [searchParams]);

    useEffect(() => {
        if (!allSettled || restoredScrollKey.current === location.key) return;
        restoredScrollKey.current = location.key;
        const saved = dashboardScrollPositions.get(location.key);
        if (saved === undefined) return;
        const frame = window.requestAnimationFrame(() => {
            for (const name of ['recording', 'recorded', 'reserves'] as const) scrollElements.current[name]?.scrollTo({ top: saved[name], behavior: 'auto' });
        });
        return () => window.cancelAnimationFrame(frame);
    }, [allSettled, location.key]);

    const saveColumnScroll = (name: DashboardColumnName, scrollTop: number): void => {
        const previous = dashboardScrollPositions.get(location.key) ?? { recording: 0, recorded: 0, reserves: 0 };
        dashboardScrollPositions.set(location.key, { ...previous, [name]: scrollTop });
    };
    const refreshRecorded = (): void => {
        void Promise.all([queryClient.invalidateQueries({ queryKey: ['recording'] }), queryClient.invalidateQueries({ queryKey: ['recorded'] })]);
    };
    const stopRecording = useMutation({
        mutationFn: (item: RecordedItem) => (item.isRecording ? api.stopRecording(item.id) : api.stopRecordedEncode(item.id)),
        onSuccess: async (_data, item) => {
            notify(item.isRecording ? '録画を停止しました。録画済みの部分は保存されます。' : 'エンコードを停止しました。', 'success');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['recording'] }),
                queryClient.invalidateQueries({ queryKey: ['recorded'] }),
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
                queryClient.invalidateQueries({ queryKey: ['encode'] }),
            ]);
        },
        onError: error => notify(`停止できませんでした: ${error.message}`, 'error'),
    });
    const removeReserve = useMutation({
        mutationFn: async (item: ReserveItem) => {
            if (item.isSkip) await api.removeReserveSkip(item.id);
            else if (item.isOverlap) await api.removeReserveOverlap(item.id);
            else await api.cancelReserve(item.id);
        },
        onSuccess: async (_data, item) => {
            notify(item.isSkip ? '除外から予約に戻しました。' : item.isOverlap ? '重複状態を解除しました。' : '予約をキャンセルしました。', 'success');
            setReserveRemoveTarget(null);
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
            ]);
        },
        onError: async error => {
            notify(`予約を変更できませんでした: ${error.message}`, 'error');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
            ]);
        },
    });
    const openRelatedRecorded = (item: RecordedItem): void => {
        const option = createRecordedRelatedSearchOption(item);
        const params = new URLSearchParams();
        if (option.ruleId !== undefined) params.set('ruleId', option.ruleId.toString(10));
        if (option.keyword !== undefined) params.set('keyword', option.keyword);
        void navigate(`/recorded?${params.toString()}`);
    };

    return (
        <>
            <PageHeader
                title={
                    <Box sx={{ minWidth: 0, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                        <Typography component="h1" variant="h6" noWrap sx={{ fontSize: { xs: '0.95rem', sm: '1.25rem' } }}>
                            NeoEPGStation v{version.data?.version ?? '1.0.0-beta.2'}
                            {version.data?.branch === 'develop' ? ' +dev' : ''}
                        </Typography>
                        {settings.isShowVersionUpdateNotification && updateInfo.data?.hasStableUpdate === true && (
                            <Chip
                                size="small"
                                color="primary"
                                label="更新あり"
                                onClick={() => void navigate('/system')}
                                aria-label={`${updateInfo.data.targets.stable?.label ?? '新しい安定版'}へ更新できます`}
                                sx={{ cursor: 'pointer', flex: '0 0 auto' }}
                            />
                        )}
                        {!settings.isAppLogoHidden && <Box component="img" src={appIconAssetUrl(logoIcon)} alt="" sx={{ height: 25, width: 'auto', flex: '0 0 auto' }} />}
                    </Box>
                }
                actions={
                    <IconButton onClick={() => void queryClient.invalidateQueries()} aria-label="更新">
                        <RefreshOutlined />
                    </IconButton>
                }
            />
            {channels.error !== null && (
                <Typography color="warning.main" sx={{ px: 2, pt: 1 }}>
                    チャンネル情報を取得できないため、チャンネルIDで表示しています。
                </Typography>
            )}
            <Box
                sx={{
                    p: { xs: 1.5, md: 2.5 },
                    display: 'grid',
                    gridTemplateColumns: 'minmax(0, 1fr)',
                    gap: 2,
                    alignItems: 'stretch',
                    boxSizing: 'border-box',
                    height: 'auto',
                    overflow: 'visible',
                    [dashboardDesktopMedia]: {
                        gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                        height: 'calc(100dvh - 56px)',
                        minHeight: 0,
                        overflow: 'hidden',
                    },
                }}
            >
                <DashboardColumn
                    title="録画中"
                    displayed={recording.data?.records.length}
                    total={recording.data?.total}
                    morePath="/recording?page=2"
                    loading={recording.isPending}
                    error={recording.error}
                    onRetry={() => void recording.refetch()}
                    scrollRef={element => {
                        scrollElements.current.recording = element;
                    }}
                    onScroll={event => saveColumnScroll('recording', event.currentTarget.scrollTop)}
                >
                    {recording.data?.records.map(item => (
                        <RecordedDashboardCard
                            key={item.id}
                            item={item}
                            channel={channelMap.get(item.channelId)}
                            showThumbnail
                            showDrop={false}
                            onOpen={() => void navigate(`/recorded/detail/${item.id}`)}
                            onSearch={() => openRelatedRecorded(item)}
                            onEncode={() => setEncodeTarget(item)}
                            onStop={() => stopRecording.mutate(item)}
                            onChanged={refreshRecorded}
                            onDeleted={refreshRecorded}
                        />
                    ))}
                    {recording.data?.records.length === 0 && <Typography color="text.secondary">録画中の番組はありません</Typography>}
                </DashboardColumn>
                <DashboardColumn
                    title="録画済み"
                    displayed={recorded.data?.records.length}
                    total={recorded.data?.total}
                    morePath={`/recorded?${recordedMoreParams}`}
                    loading={recorded.isPending}
                    error={recorded.error}
                    onRetry={() => void recorded.refetch()}
                    scrollRef={element => {
                        scrollElements.current.recorded = element;
                    }}
                    onScroll={event => saveColumnScroll('recorded', event.currentTarget.scrollTop)}
                >
                    {recorded.data?.records.map(item => (
                        <RecordedDashboardCard
                            key={item.id}
                            item={item}
                            channel={channelMap.get(item.channelId)}
                            showThumbnail
                            showDrop={settings.isShowDropInfoInsteadOfDescription}
                            onOpen={() => void navigate(`/recorded/detail/${item.id}`)}
                            onSearch={() => openRelatedRecorded(item)}
                            onEncode={() => setEncodeTarget(item)}
                            onStop={() => stopRecording.mutate(item)}
                            onChanged={refreshRecorded}
                            onDeleted={refreshRecorded}
                        />
                    ))}
                    {recorded.data?.records.length === 0 && <Typography color="text.secondary">録画済み番組はありません</Typography>}
                </DashboardColumn>
                <DashboardColumn
                    title="予約"
                    displayed={reserves.data?.reserves.length}
                    total={reserves.data?.total}
                    morePath="/reserves?type=all&page=2"
                    badge={reserveCounts.data?.conflicts}
                    onBadgeClick={() => void navigate('/reserves?type=conflict')}
                    loading={reserves.isPending}
                    error={reserves.error}
                    onRetry={() => void reserves.refetch()}
                    scrollRef={element => {
                        scrollElements.current.reserves = element;
                    }}
                    onScroll={event => saveColumnScroll('reserves', event.currentTarget.scrollTop)}
                >
                    {reserveCounts.error !== null && (
                        <Typography variant="caption" color="warning.main">
                            競合件数を取得できませんでした。
                        </Typography>
                    )}
                    {reserves.data?.reserves.map(item => (
                        <ReserveDashboardCard
                            key={item.id}
                            item={item}
                            channel={channelMap.get(item.channelId)}
                            onOpen={() => setReserveDetailTarget(item)}
                            onMenu={anchor => setReserveMenuTarget({ item, anchor })}
                        />
                    ))}
                    {reserves.data?.reserves.length === 0 && <Typography color="text.secondary">予約はありません</Typography>}
                </DashboardColumn>
            </Box>

            <RecordedEncodeDialog item={encodeTarget} open={encodeTarget !== null} onClose={() => setEncodeTarget(null)} onChanged={refreshRecorded} />

            <Menu
                anchorEl={reserveMenuTarget?.anchor ?? null}
                open={reserveMenuTarget !== null}
                onClose={() => setReserveMenuTarget(null)}
                disableScrollLock
                slotProps={{ list: { 'aria-label': '予約の操作' } }}
            >
                {reserveMenuTarget?.item.ruleId !== undefined && (
                    <MenuItem
                        onClick={() => {
                            const ruleId = reserveMenuTarget.item.ruleId!;
                            setReserveMenuTarget(null);
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
                        const item = reserveMenuTarget!.item;
                        setReserveMenuTarget(null);
                        void navigate(item.ruleId === undefined ? `/reserves/manual?reserveId=${item.id.toString(10)}` : `/search?ruleId=${item.ruleId.toString(10)}`);
                    }}
                >
                    <ListItemIcon>
                        <EditOutlined fontSize="small" />
                    </ListItemIcon>
                    edit
                </MenuItem>
                {reserveMenuTarget !== null && !reserveMenuTarget.item.isConflict && (
                    <MenuItem
                        onClick={() => {
                            setReserveRemoveTarget(reserveMenuTarget.item);
                            setReserveMenuTarget(null);
                        }}
                    >
                        <ListItemIcon>
                            {reserveMenuTarget.item.isSkip || reserveMenuTarget.item.isOverlap ? <LockOpenOutlined fontSize="small" /> : <DeleteOutlineOutlined fontSize="small" />}
                        </ListItemIcon>
                        {reserveMenuTarget.item.isSkip || reserveMenuTarget.item.isOverlap ? 'unlock' : 'delete'}
                    </MenuItem>
                )}
            </Menu>

            <Dialog open={reserveDetailTarget !== null} onClose={() => setReserveDetailTarget(null)} fullWidth maxWidth="sm" disableScrollLock>
                {reserveDetailTarget !== null && (
                    <>
                        <DialogTitle>{reserveDetailTarget.name}</DialogTitle>
                        <DialogContent dividers>
                            <Stack spacing={1}>
                                <Typography color="text.secondary">{channelName(channels.data, reserveDetailTarget.channelId)}</Typography>
                                <Button
                                    variant="text"
                                    sx={{ alignSelf: 'flex-start', px: 0, justifyContent: 'flex-start' }}
                                    onClick={() => void navigate(`/guide?time=${reserveDetailTarget.startAt.toString(10)}&channelId=${reserveDetailTarget.channelId.toString(10)}`)}
                                >
                                    {formatProgramDate(reserveDetailTarget.startAt)} - {formatProgramTime(reserveDetailTarget.endAt)}（{programDuration(reserveDetailTarget)}分）
                                </Button>
                                {[reserveDetailTarget.genre1, reserveDetailTarget.genre2, reserveDetailTarget.genre3].some(value => value !== undefined) && (
                                    <Stack direction="row" spacing={0.75} sx={{ flexWrap: 'wrap' }}>
                                        {[reserveDetailTarget.genre1, reserveDetailTarget.genre2, reserveDetailTarget.genre3]
                                            .filter((value): value is number => value !== undefined)
                                            .map((value, index) => (
                                                <Chip key={`${value}-${index}`} size="small" label={genreNames[value] ?? `ジャンル ${value}`} />
                                            ))}
                                    </Stack>
                                )}
                                {reserveDetailTarget.description !== undefined && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{reserveDetailTarget.description}</Typography>}
                                {reserveDetailTarget.extended !== undefined && <Typography sx={{ whiteSpace: 'pre-wrap' }}>{reserveDetailTarget.extended}</Typography>}
                            </Stack>
                        </DialogContent>
                        <DialogActions>
                            <Button onClick={() => setReserveDetailTarget(null)}>閉じる</Button>
                        </DialogActions>
                    </>
                )}
            </Dialog>

            <Dialog open={reserveRemoveTarget !== null} onClose={() => setReserveRemoveTarget(null)} disableScrollLock>
                <DialogTitle>{reserveRemoveTarget?.isSkip ? '除外から予約に戻す' : reserveRemoveTarget?.isOverlap ? '重複状態を解除' : '予約をキャンセル'}</DialogTitle>
                <DialogContent>
                    <Typography>{reserveRemoveTarget?.name}</Typography>
                    <Typography color="text.secondary" sx={{ mt: 1 }}>
                        {reserveRemoveTarget?.isSkip
                            ? 'この番組を除外から予約に戻します。'
                            : reserveRemoveTarget?.isOverlap
                              ? 'この番組の重複状態を解除して予約に戻します。'
                              : reserveRemoveTarget?.ruleId === undefined
                                ? 'この予約をキャンセルします。'
                                : 'ルールから作成された予約は除外扱いになります。'}
                    </Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setReserveRemoveTarget(null)}>戻る</Button>
                    <Button
                        color={reserveRemoveTarget?.isSkip || reserveRemoveTarget?.isOverlap ? 'primary' : 'error'}
                        variant="contained"
                        disabled={removeReserve.isPending}
                        onClick={() => reserveRemoveTarget !== null && removeReserve.mutate(reserveRemoveTarget)}
                    >
                        実行
                    </Button>
                </DialogActions>
            </Dialog>
        </>
    );
}
