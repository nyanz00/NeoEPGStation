import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import CastConnectedOutlined from '@mui/icons-material/CastConnectedOutlined';
import CheckCircleOutlineOutlined from '@mui/icons-material/CheckCircleOutlineOutlined';
import ImageOutlined from '@mui/icons-material/ImageOutlined';
import MoreVertOutlined from '@mui/icons-material/MoreVertOutlined';
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';
import PlayCircleOutlineOutlined from '@mui/icons-material/PlayCircleOutlineOutlined';
import ReplayOutlined from '@mui/icons-material/ReplayOutlined';
import StopOutlined from '@mui/icons-material/StopOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import WarningAmberOutlined from '@mui/icons-material/WarningAmberOutlined';
import {
    Box,
    Button,
    Checkbox,
    CircularProgress,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    MenuItem,
    Popover,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { AddManualEncodeProgramOption, AnnictRecordedEpisodeInfo, RecordedItem, VideoFile, VideoFileId } from '../../../api';
import { type ReactElement, type ReactNode, useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { RecordedItemActions } from '../components/RecordedItemActions';
import { RecordedSelectStreamDialog } from '../components/RecordedSelectStreamDialog';
import { api } from '../core/api/queries';
import { markRecordedAnnictEpisodeWatchedKeepalive } from '../core/api/annictEpisode';
import { useAppBack } from '../core/navigation';
import { useNotifications } from '../core/notifications/Notifications';
import { withBasePath } from '../core/path';
import { createRecordedRelatedSearchOption, getRecordedVideoPlaylistURL, getRecordedVideoSchemeURL, loadKodiHost, saveKodiHost } from '../core/media/recorded';
import { formatProgramDate, formatProgramTime, genreNames, programDuration } from '../core/program';
import { loadAddEncodeSettings, saveAddEncodeSettings } from '../core/storage/encode';
import { useSettings } from '../core/storage/settings';
import { useViewerProfile } from '../core/storage/viewerProfile';

function VideoActionButton({
    label,
    icon,
    color,
    files,
    onSelect,
}: {
    label: string;
    icon: ReactElement;
    color: 'primary' | 'success';
    files: VideoFile[];
    onSelect: (file: VideoFile) => void;
}): ReactNode {
    const [anchor, setAnchor] = useState<HTMLElement | null>(null);
    return (
        <>
            <Button variant="contained" color={color} startIcon={icon} onClick={event => setAnchor(event.currentTarget)}>
                {label}
            </Button>
            <Popover
                anchorEl={anchor}
                open={anchor !== null}
                onClose={() => setAnchor(null)}
                disableScrollLock
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { sx: { maxWidth: 220, p: 1 } } }}
            >
                <Box sx={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-start', gap: 1 }}>
                    {files.map(file => (
                        <Button
                            key={file.id}
                            variant="contained"
                            color="success"
                            size="small"
                            onClick={() => {
                                setAnchor(null);
                                onSelect(file);
                            }}
                        >
                            {file.name}
                        </Button>
                    ))}
                </Box>
            </Popover>
        </>
    );
}

function formatBytes(size: number): string {
    if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
    if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(size / 1024))} KB`;
}

function annictPendingMessage(reason: string | undefined): string {
    switch (reason) {
        case 'program_not_found':
            return '放送局と放送開始日時が一致するAnnictの放送予定がまだ見つかりません。';
        case 'program_ambiguous':
            return '一致候補が複数あるため、安全のため自動確定していません。';
        case 'episode_unavailable':
            return '放送予定は見つかりましたが、Annictにエピソードがまだ登録されていません。';
        case 'annict_unavailable':
            return 'Annict APIへ接続できなかったため照合を保留しています。';
        default:
            return 'Annictエピソードとの照合を保留しています。';
    }
}

function AnnictHeaderControl({
    data,
    isError,
    marking,
    unmarking,
    retrying,
    onMark,
    onUnmark,
    onRetry,
}: {
    data: AnnictRecordedEpisodeInfo | undefined;
    isError: boolean;
    marking: boolean;
    unmarking: boolean;
    retrying: boolean;
    onMark: () => void;
    onUnmark: () => void;
    onRetry: () => void;
}): ReactNode {
    const theme = useTheme();
    const isLightTheme = theme.palette.mode === 'light';

    if (isError) {
        return (
            <Tooltip title="Annict連携情報を取得できませんでした。録画・再生機能はそのまま利用できます。">
                <Box
                    role="status"
                    sx={{
                        height: 34,
                        px: 1,
                        display: 'flex',
                        alignItems: 'center',
                        gap: 0.5,
                        border: 1,
                        borderColor: isLightTheme ? 'warning.dark' : 'warning.main',
                        borderRadius: 1,
                        bgcolor: isLightTheme ? 'warning.dark' : 'transparent',
                        color: isLightTheme ? theme.palette.getContrastText(theme.palette.warning.dark) : 'warning.light',
                        boxShadow: isLightTheme ? '0 1px 2px rgba(0, 0, 0, 0.28)' : 'none',
                    }}
                >
                    <WarningAmberOutlined fontSize="small" />
                    <Typography variant="caption" sx={{ display: { xs: 'none', sm: 'block' } }}>
                        Annict
                    </Typography>
                </Box>
            </Tooltip>
        );
    }
    if (data?.state === 'pending') {
        return (
            <Tooltip title={annictPendingMessage(data.pendingReason)}>
                <Button
                    color="warning"
                    size="small"
                    variant={isLightTheme ? 'contained' : 'outlined'}
                    aria-label="Annictエピソードを再照合"
                    startIcon={<ReplayOutlined />}
                    disabled={retrying}
                    onClick={onRetry}
                    sx={{
                        height: 34,
                        minWidth: 0,
                        px: { xs: 0.75, sm: 1.25 },
                        whiteSpace: 'nowrap',
                        '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.5 } },
                    }}
                >
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                        Annict 再照合
                    </Box>
                </Button>
            </Tooltip>
        );
    }
    if (data?.state !== 'matched') return null;

    const episode = data.episodeNumberText ?? (data.episodeNumber === undefined ? 'エピソード' : `第${data.episodeNumber}話`);
    const fullLabel = `Annict ${episode}${data.episodeTitle === undefined ? '' : `「${data.episodeTitle}」`}`;
    const button = data.watched ? (
        <Tooltip
            title={
                !data.writeConfigured
                    ? 'Annict書き込み連携が必要です'
                    : data.canUnwatch
                      ? 'Annictの視聴記録を削除して見てない状態へ戻す'
                      : 'EPGStationが作成した記録ではないため、Annict側で変更してください'
            }
        >
            <span>
                <Button
                    color="inherit"
                    size="small"
                    data-page-header-flat-button="true"
                    aria-label="Annictの視聴記録を削除"
                    disabled={!data.writeConfigured || !data.canUnwatch || unmarking}
                    onClick={onUnmark}
                    startIcon={<CheckCircleOutlineOutlined />}
                    sx={{
                        height: 32,
                        minWidth: 0,
                        px: { xs: 0.75, sm: 1 },
                        borderLeft: 1,
                        borderRadius: 0,
                        borderColor: 'currentColor',
                        whiteSpace: 'nowrap',
                        color: 'inherit',
                        '&.Mui-disabled': {
                            color: isLightTheme ? 'inherit' : undefined,
                            opacity: isLightTheme ? 0.72 : undefined,
                        },
                        '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.4 } },
                    }}
                >
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                        視聴済み
                    </Box>
                </Button>
            </span>
        </Tooltip>
    ) : (
        <Tooltip title={data.writeConfigured ? 'この話を見たとAnnictへ記録' : '書き込み連携済みのユーザーをアクティブにすると記録できます'}>
            <span>
                <Button
                    color="inherit"
                    size="small"
                    data-page-header-flat-button="true"
                    aria-label="この話を見たとAnnictへ記録"
                    disabled={!data.writeConfigured || marking}
                    onClick={onMark}
                    startIcon={<CheckCircleOutlineOutlined />}
                    sx={{
                        height: 32,
                        minWidth: 0,
                        px: { xs: 0.75, sm: 1 },
                        borderLeft: 1,
                        borderRadius: 0,
                        borderColor: 'currentColor',
                        whiteSpace: 'nowrap',
                        color: 'inherit',
                        '&.Mui-disabled': {
                            color: isLightTheme ? 'inherit' : undefined,
                            opacity: isLightTheme ? 0.72 : undefined,
                        },
                        '& .MuiButton-startIcon': { mr: { xs: 0, sm: 0.4 } },
                    }}
                >
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                        見た
                    </Box>
                </Button>
            </span>
        </Tooltip>
    );

    return (
        <Tooltip title={fullLabel}>
            <Box
                sx={{
                    height: 34,
                    minWidth: 0,
                    maxWidth: { xs: 118, sm: 390 },
                    display: 'flex',
                    alignItems: 'center',
                    border: 1,
                    borderColor: isLightTheme ? (data.watched ? 'success.dark' : 'info.dark') : data.watched ? 'success.main' : 'info.main',
                    borderRadius: 1,
                    overflow: 'hidden',
                    bgcolor: isLightTheme ? (data.watched ? 'success.dark' : 'info.dark') : 'transparent',
                    color: isLightTheme
                        ? theme.palette.getContrastText(data.watched ? theme.palette.success.dark : theme.palette.info.dark)
                        : data.watched
                          ? 'success.light'
                          : 'info.light',
                    boxShadow: isLightTheme ? '0 1px 2px rgba(0, 0, 0, 0.28)' : 'none',
                }}
            >
                <Typography
                    component="a"
                    href={`https://annict.com/works/${data.annictId?.toString(10) ?? ''}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    aria-label={`${fullLabel}の作品ページをAnnictで開く`}
                    variant="caption"
                    noWrap
                    sx={{
                        minWidth: 0,
                        maxWidth: { xs: 70, sm: 300 },
                        px: { xs: 0.75, sm: 1 },
                        fontWeight: 700,
                        color: 'inherit',
                        textDecoration: 'none',
                        '&:hover': { textDecoration: 'underline' },
                    }}
                >
                    <Box component="span" sx={{ display: { xs: 'none', sm: 'inline' } }}>
                        {fullLabel}
                    </Box>
                    <Box component="span" sx={{ display: { xs: 'inline', sm: 'none' } }}>
                        {episode}
                    </Box>
                </Typography>
                {button}
            </Box>
        </Tooltip>
    );
}

export function RecordedDetailPage(): ReactNode {
    const { id } = useParams();
    const recordedId = Number(id);
    const navigate = useNavigate();
    const goBack = useAppBack('/recorded');
    const settings = useSettings();
    const viewerProfile = useViewerProfile();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const [initialEncodeSettings] = useState(loadAddEncodeSettings);
    const [moreAnchor, setMoreAnchor] = useState<HTMLElement | null>(null);
    const [encodeOpen, setEncodeOpen] = useState(false);
    const [thumbnailOpen, setThumbnailOpen] = useState(false);
    const [dropLogOpen, setDropLogOpen] = useState(false);
    const [kodiOpen, setKodiOpen] = useState(false);
    const [streamingVideo, setStreamingVideo] = useState<VideoFile | null>(null);
    const [unwatchConfirmOpen, setUnwatchConfirmOpen] = useState(false);
    const [kodiHost, setKodiHost] = useState('');
    const [dropLogText, setDropLogText] = useState('');
    const [dropLogLoading, setDropLogLoading] = useState(false);
    const [sourceVideoFileId, setSourceVideoFileId] = useState<VideoFileId | ''>('');
    const [mode, setMode] = useState(initialEncodeSettings.encodeMode ?? '');
    const [sameDirectory, setSameDirectory] = useState(initialEncodeSettings.isSaveSameDirectory);
    const [parentDir, setParentDir] = useState(initialEncodeSettings.parentDirectory ?? '');
    const [directory, setDirectory] = useState('');
    const [removeOriginal, setRemoveOriginal] = useState(initialEncodeSettings.removeOriginal);
    const [updateThumbnail, setUpdateThumbnail] = useState(initialEncodeSettings.updateThumbnail);
    const persistEncodeSettings = (): void => {
        saveAddEncodeSettings({
            encodeMode: mode.length > 0 ? mode : null,
            parentDirectory: parentDir.length > 0 ? parentDir : null,
            isSaveSameDirectory: sameDirectory,
            removeOriginal,
            updateThumbnail,
        });
    };
    const closeEncodeDialog = (): void => {
        persistEncodeSettings();
        setEncodeOpen(false);
    };
    const recordedDetailKey = ['recorded-detail', recordedId, settings.isHalfWidthDisplayed] as const;
    const recorded = useQuery({
        queryKey: recordedDetailKey,
        queryFn: () => api.getRecordedItem(recordedId, settings.isHalfWidthDisplayed),
        enabled: Number.isSafeInteger(recordedId),
    });
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const annictEpisodeKey = ['recorded-annict-episode', recordedId, viewerProfile.profileId] as const;
    const annictEpisode = useQuery({
        queryKey: annictEpisodeKey,
        queryFn: () => api.getRecordedAnnictEpisode(recordedId),
        enabled: recorded.data !== undefined,
        retry: false,
    });
    const addEncode = useMutation({
        mutationFn: (option: AddManualEncodeProgramOption) => api.addManualEncode(option),
        onSuccess: async () => {
            setEncodeOpen(false);
            notify('エンコードキューに追加しました。', 'success');
            queryClient.setQueryData<RecordedItem>(recordedDetailKey, current => (current === undefined ? current : { ...current, isEncoding: true }));
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['encode'] }),
                queryClient.invalidateQueries({ queryKey: ['recorded'] }),
                queryClient.invalidateQueries({ queryKey: recordedDetailKey }),
            ]);
        },
        onError: error => notify(`エンコードを追加できません: ${error.message}`, 'error'),
    });
    const replaceThumbnail = useMutation({
        mutationFn: (videoFileId: VideoFileId) => api.replaceThumbnail(videoFileId),
        onSuccess: () => {
            setThumbnailOpen(false);
            notify('サムネイル再生成を開始しました。', 'success');
        },
        onError: error => notify(`サムネイルを再生成できません: ${error.message}`, 'error'),
    });
    const stopEncode = useMutation({
        mutationFn: () => api.stopRecordedEncode(recordedId),
        onSuccess: async () => {
            notify('エンコードを停止しました。', 'success');
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: recordedDetailKey }),
                queryClient.invalidateQueries({ queryKey: ['encode'] }),
                queryClient.invalidateQueries({ queryKey: ['recorded'] }),
            ]);
        },
        onError: error => notify(`エンコードを停止できません: ${error.message}`, 'error'),
    });
    const sendToKodi = useMutation({
        mutationFn: ({ videoFileId, host }: { videoFileId: VideoFileId; host: string }) => api.sendVideoToKodi(videoFileId, host),
        onSuccess: () => notify('Kodiへ送信しました。', 'success'),
        onError: error => notify(`Kodiへ送信できません: ${error.message}`, 'error'),
    });
    const retryAnnictEpisode = useMutation({
        mutationFn: () => api.retryRecordedAnnictEpisode(recordedId),
        onSuccess: data => {
            queryClient.setQueryData(annictEpisodeKey, data);
            notify(
                data.state === 'matched' ? 'Annictエピソードを照合しました。' : 'Annictエピソードはまだ確定できませんでした。',
                data.state === 'matched' ? 'success' : 'warning',
            );
        },
        onError: error => notify(`Annictエピソードを再照合できません: ${error.message}`, 'error'),
    });
    const markAnnictEpisodeWatched = useMutation({
        mutationFn: () => markRecordedAnnictEpisodeWatchedKeepalive(recordedId),
        onSuccess: data => {
            queryClient.setQueryData(annictEpisodeKey, data);
            notify('Annictへ「見た」を記録しました。', 'success');
        },
        onError: error => notify(`Annictへ視聴記録を書き込めません: ${error.message}`, 'error'),
    });
    const unmarkAnnictEpisodeWatched = useMutation({
        mutationFn: () => api.unmarkRecordedAnnictEpisodeWatched(recordedId),
        onSuccess: data => {
            setUnwatchConfirmOpen(false);
            queryClient.setQueryData(annictEpisodeKey, data);
            notify('Annictの視聴記録を削除しました。', 'success');
        },
        onError: error => notify(`Annictの視聴記録を削除できません: ${error.message}`, 'error'),
    });

    useEffect(() => {
        const item = recorded.data;
        if (item === undefined) return;
        setSourceVideoFileId(current => (current === '' ? (item.videoFiles?.[0]?.id ?? '') : current));
    }, [recorded.data]);
    useEffect(() => {
        const data = config.data;
        if (data === undefined) return;
        setMode(current => (data.encode.includes(current) ? current : (data.encode[0] ?? '')));
        setParentDir(current => (data.recorded.includes(current) ? current : (data.recorded[0] ?? '')));
    }, [config.data]);

    if (!Number.isSafeInteger(recordedId))
        return (
            <Typography color="error" sx={{ p: 3 }}>
                録画IDが不正です。
            </Typography>
        );

    const item = recorded.data;
    const channel = channels.data?.find(value => value.id === item?.channelId);
    const files = item?.videoFiles ?? [];
    const streamingFiles = files.filter(
        video => (video.type === 'ts' && config.data?.isEnableTSRecordedStream === true) || (video.type === 'encoded' && config.data?.isEnableEncodedRecordedStream === true),
    );
    const kodiHosts = config.data?.kodiHosts ?? [];
    const totalSize = files.reduce((sum, file) => sum + file.size, 0);
    const thumbnail = item?.thumbnails?.[0];
    const genre = item?.genre1 === undefined ? undefined : genreNames[item.genre1];
    const drop = item?.dropLogFile;
    const hasDrop = drop !== undefined && (drop.dropCnt > 0 || drop.errorCnt > 0 || drop.scramblingCnt > 0);
    const hasAnnictHeaderControl = annictEpisode.isError || annictEpisode.data?.state === 'pending' || annictEpisode.data?.state === 'matched';
    const canEncode = sourceVideoFileId !== '' && mode.length > 0 && (sameDirectory || parentDir.length > 0);
    const markAtPlaybackStart = (): void => {
        if (settings.annictAutoWatchMode === 'start' && annictEpisode.data?.state === 'matched' && annictEpisode.data.writeConfigured && !annictEpisode.data.watched) {
            markAnnictEpisodeWatched.mutate();
        }
    };
    const play = (video: VideoFile): void => {
        markAtPlaybackStart();
        if (video.type === 'encoded' && settings.isPreferredPlayingOnWeb) {
            void navigate(`/recorded/watch?videoId=${video.id}&recordedId=${recordedId}`, { flushSync: true });
            return;
        }
        const schemeURL = config.data === undefined ? null : getRecordedVideoSchemeURL(video, config.data, settings, 'video');
        window.location.href = schemeURL ?? getRecordedVideoPlaylistURL(video.id);
    };
    const streaming = (video: VideoFile): void => {
        setStreamingVideo(video);
    };
    const showDropLog = async (): Promise<void> => {
        if (drop === undefined) return;
        setDropLogOpen(true);
        setDropLogLoading(true);
        try {
            setDropLogText(await api.getDropLog(drop.id));
        } catch (error) {
            notify(`ドロップログを取得できません: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            setDropLogLoading(false);
        }
    };

    return (
        <>
            <PageHeader
                title="録画詳細"
                leading={
                    <Tooltip title="録画済みに戻る">
                        <IconButton onClick={goBack}>
                            <ArrowBackOutlined />
                        </IconButton>
                    </Tooltip>
                }
                actions={
                    <Stack direction="row" sx={{ ml: { xs: 0.25, sm: 1 }, alignItems: 'center' }}>
                        {hasAnnictHeaderControl && (
                            <AnnictHeaderControl
                                data={annictEpisode.data}
                                isError={annictEpisode.isError}
                                marking={markAnnictEpisodeWatched.isPending}
                                unmarking={unmarkAnnictEpisodeWatched.isPending}
                                retrying={retryAnnictEpisode.isPending}
                                onMark={() => markAnnictEpisodeWatched.mutate()}
                                onUnmark={() => setUnwatchConfirmOpen(true)}
                                onRetry={() => retryAnnictEpisode.mutate()}
                            />
                        )}
                        <Box
                            sx={{
                                ml: { xs: 0.5, sm: 1 },
                                pl: { xs: 0.25, sm: 0.5 },
                                borderLeft: 1,
                                borderColor: 'divider',
                            }}
                        >
                            <Tooltip title="詳細メニュー">
                                <IconButton aria-label="詳細メニューを開く" disabled={files.length === 0} onClick={event => setMoreAnchor(event.currentTarget)}>
                                    <MoreVertOutlined />
                                </IconButton>
                            </Tooltip>
                        </Box>
                    </Stack>
                }
            />
            <Dialog open={unwatchConfirmOpen} onClose={() => setUnwatchConfirmOpen(false)}>
                <DialogTitle>Annictの視聴記録を削除</DialogTitle>
                <DialogContent>
                    <Typography>このエピソードをAnnictで「見てない」状態へ戻しますか？</Typography>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUnwatchConfirmOpen(false)}>キャンセル</Button>
                    <Button color="warning" variant="contained" disabled={unmarkAnnictEpisodeWatched.isPending} onClick={() => unmarkAnnictEpisodeWatched.mutate()}>
                        視聴記録を削除
                    </Button>
                </DialogActions>
            </Dialog>
            {item !== undefined && (
                <RecordedItemActions
                    item={item}
                    anchorEl={moreAnchor}
                    onClose={() => setMoreAnchor(null)}
                    onSearch={() => {
                        const option = createRecordedRelatedSearchOption(item);
                        const query = option.ruleId === undefined ? `keyword=${encodeURIComponent(option.keyword ?? '')}` : `ruleId=${option.ruleId.toString(10)}`;
                        void navigate(`/recorded?${query}`);
                    }}
                    onEncode={() => setEncodeOpen(true)}
                    onSubtitle={() => void navigate(`/recorded/subtitle/${recordedId.toString(10)}`)}
                    onChanged={() => void queryClient.invalidateQueries({ queryKey: ['recorded-detail', recordedId] })}
                    onDeleted={goBack}
                    includeDownload
                />
            )}
            {recorded.isPending ? (
                <Box sx={{ py: 10, textAlign: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : recorded.error !== null || item === undefined ? (
                <Typography color="error" sx={{ p: 3 }}>
                    録画情報を取得できません: {recorded.error?.message}
                </Typography>
            ) : (
                <Box sx={{ p: { xs: 1.5, sm: 2, md: 3 }, maxWidth: 1500, mx: 'auto' }}>
                    <Box sx={{ display: { xs: 'block', md: 'flex' }, alignItems: 'center', gap: 1 }}>
                        <Box sx={{ width: { xs: '100%', md: 400 }, flex: '0 0 auto', aspectRatio: '16 / 9', overflow: 'hidden', bgcolor: '#000' }}>
                            <Box
                                component="img"
                                src={thumbnail === undefined ? undefined : withBasePath(`/api/thumbnails/${thumbnail}`)}
                                alt=""
                                onError={event => {
                                    event.currentTarget.style.display = 'none';
                                }}
                                sx={{ width: '100%', height: '100%', objectFit: 'cover' }}
                            />
                        </Box>
                        <Box sx={{ flex: 1, minWidth: 0, mt: { xs: 1, md: 0 } }}>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                {item.name}
                            </Typography>
                            <Typography variant="body1" sx={{ mt: 0.5 }}>
                                {channel?.name ?? item.channelId.toString(10)}
                            </Typography>
                            {genre !== undefined && (
                                <Typography variant="body2" color="text.secondary">
                                    {genre}
                                </Typography>
                            )}
                            <Typography variant="body2" color="text.secondary">
                                {formatProgramDate(item.startAt)} - {formatProgramTime(item.endAt)} ({programDuration(item)} m)
                            </Typography>
                            <Typography
                                component={drop === undefined ? 'div' : 'button'}
                                variant="body2"
                                color={hasDrop ? 'error' : 'text.secondary'}
                                onClick={drop === undefined ? undefined : () => void showDropLog()}
                                sx={{
                                    mt: 1,
                                    p: 0,
                                    border: 0,
                                    bgcolor: 'transparent',
                                    color: hasDrop ? 'error.main' : 'text.secondary',
                                    font: 'inherit',
                                    textAlign: 'left',
                                    cursor: drop === undefined ? 'default' : 'pointer',
                                    fontWeight: hasDrop ? 700 : 400,
                                }}
                            >
                                drop: {drop?.dropCnt ?? 0}, error: {drop?.errorCnt ?? 0}, scrambling: {drop?.scramblingCnt ?? 0}
                                {totalSize > 0 ? ` ${formatBytes(totalSize)}` : ''}
                            </Typography>
                            <Stack direction="row" spacing={1} sx={{ mt: 1.5, flexWrap: 'wrap', rowGap: 1 }}>
                                {files.length > 0 && <VideoActionButton label="PLAY" icon={<PlayArrowOutlined />} color="primary" files={files} onSelect={play} />}
                                {streamingFiles.length > 0 && (
                                    <VideoActionButton label="STREAMING" icon={<PlayCircleOutlineOutlined />} color="primary" files={streamingFiles} onSelect={streaming} />
                                )}
                                {files.length > 0 && (
                                    <Button variant="contained" color="success" startIcon={<ImageOutlined />} onClick={() => setThumbnailOpen(true)}>
                                        THUMB
                                    </Button>
                                )}
                                {files.length > 0 && (
                                    <Button variant="contained" color="success" startIcon={<SyncOutlined />} onClick={() => setEncodeOpen(true)}>
                                        ENCODE
                                    </Button>
                                )}
                                {item.isEncoding && (
                                    <Button variant="contained" color="error" startIcon={<StopOutlined />} disabled={stopEncode.isPending} onClick={() => stopEncode.mutate()}>
                                        STOP
                                    </Button>
                                )}
                                {!item.isRecording && kodiHosts.length > 0 && files.length > 0 && (
                                    <Button
                                        variant="contained"
                                        color="success"
                                        startIcon={<CastConnectedOutlined />}
                                        onClick={() => {
                                            const saved = loadKodiHost();
                                            setKodiHost(saved !== null && kodiHosts.includes(saved) ? saved : kodiHosts[0]);
                                            setKodiOpen(true);
                                        }}
                                    >
                                        KODI
                                    </Button>
                                )}
                            </Stack>
                        </Box>
                    </Box>
                    <Box sx={{ mt: 3 }}>
                        {item.description !== undefined && (
                            <Typography variant="body2" sx={{ whiteSpace: 'pre-wrap' }}>
                                {item.description}
                            </Typography>
                        )}
                        {item.extended !== undefined && (
                            <Typography variant="body2" sx={{ mt: 1.5, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                                {item.extended}
                            </Typography>
                        )}
                    </Box>
                </Box>
            )}

            <Dialog open={thumbnailOpen} onClose={() => setThumbnailOpen(false)} fullWidth maxWidth="xs" disableScrollLock>
                <DialogTitle>サムネイル再生成</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        選んだ録画ファイルタイプを元にサムネイルを再生成します。
                    </Typography>
                    <FormControl fullWidth>
                        <InputLabel>録画ファイル</InputLabel>
                        <Select label="録画ファイル" value={sourceVideoFileId} onChange={event => setSourceVideoFileId(Number(event.target.value))}>
                            {files.map(video => (
                                <MenuItem key={video.id} value={video.id}>
                                    {video.name}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setThumbnailOpen(false)}>キャンセル</Button>
                    <Button
                        disabled={sourceVideoFileId === '' || replaceThumbnail.isPending}
                        onClick={() => sourceVideoFileId !== '' && replaceThumbnail.mutate(sourceVideoFileId)}
                    >
                        再生成
                    </Button>
                </DialogActions>
            </Dialog>

            <RecordedSelectStreamDialog
                recordedId={recordedId}
                video={streamingVideo}
                config={config.data}
                settings={settings}
                onClose={() => setStreamingVideo(null)}
                onWatch={path => {
                    markAtPlaybackStart();
                    void navigate(path, { flushSync: true });
                }}
            />

            <Dialog open={dropLogOpen} onClose={() => setDropLogOpen(false)} fullWidth maxWidth="md">
                <DialogTitle>{item?.name ?? '録画'} - ドロップログ</DialogTitle>
                <DialogContent dividers>
                    {dropLogLoading ? (
                        <Box sx={{ py: 4, textAlign: 'center' }}>
                            <CircularProgress />
                        </Box>
                    ) : (
                        <Box component="pre" sx={{ m: 0, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere', fontFamily: 'monospace', fontSize: 13 }}>
                            {dropLogText}
                        </Box>
                    )}
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDropLogOpen(false)}>閉じる</Button>
                </DialogActions>
            </Dialog>

            <Dialog
                open={kodiOpen}
                onClose={() => {
                    saveKodiHost(kodiHost || null);
                    setKodiOpen(false);
                }}
                fullWidth
                maxWidth="xs"
            >
                <DialogTitle>{item?.name ?? '録画'} - Kodi</DialogTitle>
                <DialogContent>
                    <FormControl fullWidth sx={{ mt: 1, mb: 2 }}>
                        <InputLabel>Kodi host</InputLabel>
                        <Select label="Kodi host" value={kodiHost} onChange={event => setKodiHost(event.target.value)}>
                            {kodiHosts.map(host => (
                                <MenuItem key={host} value={host}>
                                    {host}
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1 }}>
                        {files.map(video => (
                            <Button
                                key={video.id}
                                variant="contained"
                                color="success"
                                disabled={kodiHost.length === 0 || sendToKodi.isPending}
                                onClick={() => {
                                    saveKodiHost(kodiHost);
                                    sendToKodi.mutate({ videoFileId: video.id, host: kodiHost });
                                }}
                            >
                                {video.name}
                            </Button>
                        ))}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button
                        onClick={() => {
                            saveKodiHost(kodiHost || null);
                            setKodiOpen(false);
                        }}
                    >
                        閉じる
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={encodeOpen} onClose={closeEncodeDialog} fullWidth maxWidth="sm" disableScrollLock>
                <DialogTitle>エンコード追加</DialogTitle>
                <DialogContent>
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <FormControl fullWidth>
                            <InputLabel>元ファイル</InputLabel>
                            <Select label="元ファイル" value={sourceVideoFileId} onChange={event => setSourceVideoFileId(Number(event.target.value))}>
                                {files.map(video => (
                                    <MenuItem key={video.id} value={video.id}>
                                        {video.name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth>
                            <InputLabel>エンコードプリセット</InputLabel>
                            <Select label="エンコードプリセット" value={mode} onChange={event => setMode(event.target.value)}>
                                {config.data?.encode.map(value => (
                                    <MenuItem key={value} value={value}>
                                        {value}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControlLabel
                            control={<Checkbox checked={sameDirectory} onChange={event => setSameDirectory(event.target.checked)} />}
                            label="元ファイルと同じ場所に保存"
                        />
                        {!sameDirectory && (
                            <>
                                <FormControl fullWidth>
                                    <InputLabel>保存先</InputLabel>
                                    <Select label="保存先" value={parentDir} onChange={event => setParentDir(event.target.value)}>
                                        {config.data?.recorded.map(value => (
                                            <MenuItem key={value} value={value}>
                                                {value}
                                            </MenuItem>
                                        ))}
                                    </Select>
                                </FormControl>
                                <TextField label="サブディレクトリ" value={directory} onChange={event => setDirectory(event.target.value)} />
                            </>
                        )}
                        <FormControlLabel control={<Checkbox checked={removeOriginal} onChange={event => setRemoveOriginal(event.target.checked)} />} label="元ファイル削除" />
                        <FormControlLabel control={<Checkbox checked={updateThumbnail} onChange={event => setUpdateThumbnail(event.target.checked)} />} label="サムネイル再生成" />
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={closeEncodeDialog}>キャンセル</Button>
                    <Button
                        variant="contained"
                        disabled={!canEncode || addEncode.isPending}
                        onClick={() => {
                            if (sourceVideoFileId === '') return;
                            persistEncodeSettings();
                            const option: AddManualEncodeProgramOption = {
                                recordedId,
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
        </>
    );
}
