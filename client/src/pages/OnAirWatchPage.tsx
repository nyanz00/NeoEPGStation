import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import ChatBubbleOutlineOutlined from '@mui/icons-material/ChatBubbleOutlineOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import LocalFireDepartmentOutlined from '@mui/icons-material/LocalFireDepartmentOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import Pause from '@mui/icons-material/Pause';
import PlayArrow from '@mui/icons-material/PlayArrow';
import RadioButtonCheckedOutlined from '@mui/icons-material/RadioButtonCheckedOutlined';
import SendOutlined from '@mui/icons-material/SendOutlined';
import SensorsOutlined from '@mui/icons-material/SensorsOutlined';
import Twitter from '@mui/icons-material/Twitter';
import {
    Alert,
    BottomNavigation,
    BottomNavigationAction,
    Box,
    Button,
    CircularProgress,
    Divider,
    IconButton,
    MenuItem,
    Select,
    LinearProgress,
    Stack,
    Tab,
    Tabs,
    TextField,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ChannelJikkyoStatus, ChannelType, Schedule, ScheduleChannleItem, ScheduleProgramItem } from '../../../api';
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useSearchParams } from 'react-router-dom';
import { useAppLayout } from '../components/AppLayout';
import { TwitterPanel } from '../components/TwitterPanel';
import { api } from '../core/api/queries';
import { isDefaultVisibleChannel } from '../core/channels';
import { getLiveStreamURL, type LiveStreamType } from '../core/media/live';
import { useAppBack } from '../core/navigation';
import { withBasePath } from '../core/path';
import { LiveMpegTsPlayerCore, type LiveMpegTsPlayerState } from '../core/player/LiveMpegTsPlayerCore';
import { useTouchPlayerControls } from '../core/player/useTouchPlayerControls';
import type { JikkyoComment } from '../core/player/jikkyoComment';
import { channelTypeLabel, formatProgramDate, formatProgramTime, genreNames, isLikelyBroadcastPauseTime, programDuration } from '../core/program';
import { useActiveUser } from '../core/storage/activeUser';
import { useSettings, type WebKitPlaybackMode } from '../core/storage/settings';
import { useViewerProfile } from '../core/storage/viewerProfile';
import { GuideProgramDialog, reserveIndex } from './GuidePage';

type PanelTab = 'program' | 'channels' | 'comments' | 'twitter';

const waveOrder: ChannelType[] = ['GR', 'GR-ALT1', 'GR-ALT2', 'GR-ALT3', 'BS', 'CS', 'SKY'];

function waveSort(left: string, right: string): number {
    const leftIndex = waveOrder.indexOf(left as ChannelType);
    const rightIndex = waveOrder.indexOf(right as ChannelType);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right, 'ja');
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
}

function progress(startAt: number, endAt: number): number {
    const duration = endAt - startAt;
    if (duration <= 0) return 0;
    return Math.min(100, Math.max(0, ((Date.now() - startAt) / duration) * 100));
}

function LivePlayer({
    channelId,
    src,
    lowLatency,
    isHevc,
    webkitPlaybackMode,
    forceSubtitleStroke,
    persistentBottomControls,
    showVolumePercent,
    volumeBoostEnabled,
    volumeBoostMaxPercent,
    sessionIdentity,
    onComment,
    onControlsVisibilityChange,
    onCommentPostAvailabilityChange,
    onSendCommentReady,
    children,
}: {
    channelId: number;
    src: string;
    lowLatency: boolean;
    isHevc: boolean;
    webkitPlaybackMode: WebKitPlaybackMode;
    forceSubtitleStroke: boolean;
    persistentBottomControls: boolean;
    showVolumePercent: boolean;
    volumeBoostEnabled: boolean;
    volumeBoostMaxPercent: number;
    sessionIdentity: string;
    onComment: (comment: JikkyoComment) => void;
    onControlsVisibilityChange: (visible: boolean) => void;
    onCommentPostAvailabilityChange: (available: boolean, detail?: string, target?: 'nicolive' | 'nx-jikkyo' | null) => void;
    onSendCommentReady: (send: ((text: string, color: string, position: 'top' | 'right' | 'bottom', size: 'big' | 'medium' | 'small') => Promise<void>) | null) => void;
    children: ReactNode;
}): ReactNode {
    const theme = useTheme();
    const container = useRef<HTMLDivElement | null>(null);
    const coreRef = useRef<LiveMpegTsPlayerCore | null>(null);
    const [video, setVideo] = useState<HTMLVideoElement | null>(null);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [controlsPortal, setControlsPortal] = useState<HTMLElement | null>(null);
    const [paused, setPaused] = useState(true);
    const [state, setState] = useState<LiveMpegTsPlayerState>({ isLoading: true, isBuffering: false, loadingText: 'プレイヤーを初期化中...' });
    const showPlayerControls = useCallback((): void => {
        setControlsVisible(true);
        coreRef.current?.showControls();
    }, []);
    const hidePlayerControls = useCallback((): void => {
        setControlsVisible(false);
        coreRef.current?.hideControls();
    }, []);
    const activatePlayerAudio = useCallback((): void => coreRef.current?.activateAudio(), []);
    const touchControls = useTouchPlayerControls(controlsVisible, showPlayerControls, hidePlayerControls, activatePlayerAudio);

    useLayoutEffect(() => {
        if (container.current === null) return;
        const core = new LiveMpegTsPlayerCore({
            container: container.current,
            channelId,
            src,
            lowLatency,
            isHevc,
            webkitPlaybackMode,
            forceSubtitleStroke,
            volumeBoostEnabled,
            volumeBoostMaxPercent,
            themeColor: theme.palette.primary.main,
            onReady: setVideo,
            onStateChange: setState,
            onComment,
            onCommentPostAvailabilityChange,
            onControlsVisibilityChange: visible => {
                setControlsVisible(visible);
                onControlsVisibilityChange(visible);
            },
            onControlsPortalReady: setControlsPortal,
            onError: error => console.error('[OnAirWatch]', error),
            onWarn: error => console.warn('[OnAirWatch]', error),
        });
        coreRef.current = core;
        onSendCommentReady((text, color, position, size) => core.sendComment(text, color, position, size));
        void core.init();
        return () => {
            onSendCommentReady(null);
            coreRef.current = null;
            core.destroy();
        };
    }, [
        channelId,
        forceSubtitleStroke,
        isHevc,
        webkitPlaybackMode,
        lowLatency,
        onComment,
        onCommentPostAvailabilityChange,
        onControlsVisibilityChange,
        onSendCommentReady,
        src,
        sessionIdentity,
        theme.palette.primary.main,
        volumeBoostEnabled,
        volumeBoostMaxPercent,
    ]);

    useEffect(() => {
        if (video === null) return;
        const handlePlay = (): void => setPaused(false);
        const handlePause = (): void => setPaused(true);
        video.addEventListener('play', handlePlay);
        video.addEventListener('pause', handlePause);
        setPaused(video.paused);
        return () => {
            video.removeEventListener('play', handlePlay);
            video.removeEventListener('pause', handlePause);
        };
    }, [video]);

    const togglePlay = (): void => {
        if (video === null) return;
        if (video.paused) void video.play().catch(error => console.warn('[OnAirWatch:play]', error));
        else video.pause();
        showPlayerControls();
    };

    return (
        <Box
            data-testid="onair-player"
            {...touchControls}
            onPointerMove={showPlayerControls}
            sx={{
                position: 'relative',
                width: '100%',
                height: { xs: 'auto', lg: '100%' },
                aspectRatio: { xs: persistentBottomControls ? 'auto' : '16 / 9', lg: 'auto' },
                minHeight: { xs: persistentBottomControls ? 'calc(100vw * 9 / 16 + 56px)' : undefined, lg: 0 },
                bgcolor: '#000',
                overflow: 'hidden',
                borderRadius: 0,
                '& .onair-dplayer': { position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1 },
                '& .onair-dplayer.dplayer': { width: '100%', height: '100%', bgcolor: 'transparent' },
                '& .onair-dplayer .dplayer-video-wrap': { bgcolor: '#000 !important' },
                '& .onair-dplayer .dplayer-video-wrap-aspect, & .onair-dplayer video': { width: '100%', height: '100%' },
                '& .onair-dplayer video': { objectFit: 'contain' },
                '& .onair-dplayer .dplayer-controller-mask': {
                    height: '82px !important',
                    background: 'linear-gradient(to top, rgba(0,0,0,.86), transparent) !important',
                },
                '& .onair-dplayer .dplayer-controller': { bottom: '0 !important', px: { xs: '8px !important', sm: '16px !important' }, pb: '10px !important' },
                '& .onair-dplayer .dplayer-comment-box, & .onair-dplayer .dplayer-comment': { display: 'none !important' },
                '& .onair-dplayer.dplayer-mobile .dplayer-mobile-icon-wrap': { display: 'none !important' },
                '& .onair-dplayer [data-dplayer-custom-control="mobile-volume"]': { display: 'none' },
                '& .onair-dplayer.dplayer-mobile [data-dplayer-custom-control="mobile-volume"]': { display: 'inline-block' },
                '& .onair-dplayer.onair-comment-post-enabled .dplayer-comment': { display: 'inline-block !important' },
                '& .onair-dplayer.onair-comment-post-enabled .dplayer-controller-comment .dplayer-comment-box': {
                    display: 'block !important',
                },
                '& .onair-dplayer .neo-player-central-controls-host': {
                    position: 'absolute',
                    inset: persistentBottomControls ? '0 0 56px' : 0,
                    zIndex: 6,
                    pointerEvents: 'none',
                },
                ...(persistentBottomControls
                    ? {
                          '& .onair-dplayer .dplayer-video-wrap, & .onair-dplayer .dplayer-video-wrap-aspect': {
                              height: 'calc(100% - 56px) !important',
                          },
                          '& .onair-dplayer .dplayer-controller-mask': {
                              height: '56px !important',
                              bottom: '0 !important',
                              opacity: '1 !important',
                              background: '#10151b !important',
                          },
                          '& .onair-dplayer .dplayer-controller': {
                              bottom: '0 !important',
                              height: '56px !important',
                              opacity: '1 !important',
                              visibility: 'visible !important',
                              transform: 'none !important',
                              background: '#10151b !important',
                          },
                          '& .onair-dplayer.dplayer-hide-controller .dplayer-controller, & .onair-dplayer.dplayer-hide-controller .dplayer-controller-mask': {
                              opacity: '1 !important',
                              visibility: 'visible !important',
                              transform: 'none !important',
                          },
                      }
                    : {}),
                '& .onair-dplayer .neo-player-volume-percent': {
                    display: showVolumePercent ? 'inline-flex' : 'none',
                    alignItems: 'center',
                    justifyContent: 'center',
                    height: '100%',
                    minWidth: 28,
                    mx: 0.25,
                    verticalAlign: 'middle',
                    color: '#fff',
                    fontSize: 10,
                    lineHeight: 1,
                    textAlign: 'center',
                    pointerEvents: 'none',
                },
                '& .onair-dplayer .dplayer-volume': {
                    marginLeft: showVolumePercent ? '-13px' : 0,
                },
            }}
        >
            {(state.isLoading || state.isBuffering) && (
                <Box
                    sx={{
                        position: 'absolute',
                        inset: persistentBottomControls ? '0 0 56px' : 0,
                        zIndex: 4,
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'center',
                        gap: 1.25,
                        color: '#fff',
                        background: 'radial-gradient(circle, rgba(27,36,48,.62), rgba(0,0,0,.9))',
                    }}
                >
                    <CircularProgress size={46} thickness={4.5} sx={{ color: '#fff' }} />
                    <Typography variant="body2" sx={{ fontWeight: 700, whiteSpace: 'nowrap' }}>
                        {state.loadingText}
                    </Typography>
                </Box>
            )}
            <Box ref={container} className={`onair-dplayer${persistentBottomControls ? ' neo-player-persistent-bottom-controls' : ''}`} />
            {controlsPortal !== null &&
                createPortal(
                    <IconButton
                        data-player-control-ui
                        title={paused ? '再生' : '一時停止'}
                        aria-label={paused ? '再生' : '一時停止'}
                        onClick={togglePlay}
                        disabled={video === null}
                        sx={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            zIndex: 6,
                            width: { xs: 58, sm: 68 },
                            height: { xs: 58, sm: 68 },
                            transform: 'translate(-50%, -50%)',
                            opacity: !state.isLoading && !state.isBuffering && controlsVisible ? 1 : 0,
                            pointerEvents: !state.isLoading && !state.isBuffering && controlsVisible ? 'auto' : 'none',
                            transition: 'opacity 120ms ease',
                            color: '#fff !important',
                            filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.95))',
                        }}
                    >
                        {paused ? <PlayArrow sx={{ fontSize: { xs: 46, sm: 60 } }} /> : <Pause sx={{ fontSize: { xs: 46, sm: 60 } }} />}
                    </IconButton>,
                    controlsPortal,
                )}
            {children}
        </Box>
    );
}

function ProgramPanel({
    schedule,
    program,
    nextProgram,
    force,
    logo,
    isRecording,
    onReserve,
}: {
    schedule: Schedule | undefined;
    program: ScheduleProgramItem | undefined;
    nextProgram: ScheduleProgramItem | undefined;
    force: number | null | undefined;
    logo: string | null;
    isRecording: boolean;
    onReserve: () => void;
}): ReactNode {
    if (schedule === undefined) {
        return (
            <Stack spacing={1.5} sx={{ p: 2, alignItems: 'center' }}>
                <CircularProgress size={30} />
                <Typography color="text.secondary">番組情報を取得中...</Typography>
            </Stack>
        );
    }
    if (program === undefined) {
        const isLikelyPaused = isLikelyBroadcastPauseTime();
        return (
            <Stack spacing={1.25} sx={{ p: 2, alignItems: 'center', textAlign: 'center' }}>
                {logo !== null && <Box component="img" src={logo} alt="" sx={{ width: 76, height: 46, objectFit: 'contain' }} />}
                <Typography sx={{ fontWeight: 800 }}>{schedule.channel.name}</Typography>
                <Typography color="text.secondary">{isLikelyPaused ? 'この時間は放送を休止しています' : '現在の番組情報を取得できません'}</Typography>
            </Stack>
        );
    }

    const genre = program.genre1 === undefined ? undefined : genreNames[program.genre1];
    return (
        <Stack spacing={1.5} sx={{ p: { xs: 1.75, sm: 2 } }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start', justifyContent: 'space-between' }}>
                <Stack direction="row" spacing={1.25} sx={{ minWidth: 0, alignItems: 'center' }}>
                    {logo !== null && <Box component="img" src={logo} alt="" sx={{ width: 62, height: 38, objectFit: 'contain', flex: '0 0 auto' }} />}
                    <Box sx={{ minWidth: 0 }}>
                        <Typography sx={{ fontWeight: 800 }}>{schedule.channel.name}</Typography>
                        <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                            <Typography variant="caption" color="text.secondary">
                                {channelTypeLabel(schedule.channel.channelType)}
                            </Typography>
                            <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', color: 'primary.main' }}>
                                <LocalFireDepartmentOutlined sx={{ fontSize: 16 }} />
                                <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700 }}>
                                    {force == null ? '--' : force.toLocaleString('ja-JP')} コメ/分
                                </Typography>
                            </Stack>
                        </Stack>
                    </Box>
                </Stack>
                <Tooltip title={isRecording ? 'この番組は録画中です' : 'この番組を録画予約'}>
                    <IconButton color={isRecording ? 'error' : 'inherit'} onClick={onReserve} aria-label={isRecording ? '録画中の番組を確認' : 'この番組を録画予約'}>
                        <RadioButtonCheckedOutlined />
                    </IconButton>
                </Tooltip>
            </Stack>
            <Box>
                <Typography variant="h6" sx={{ fontWeight: 850, lineHeight: 1.45 }}>
                    {program.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {formatProgramDate(program.startAt)} - {formatProgramTime(program.endAt)}（{programDuration(program)}分）
                </Typography>
            </Box>
            <LinearProgress variant="determinate" value={progress(program.startAt, program.endAt)} sx={{ height: 4, borderRadius: 2 }} />
            {program.description !== undefined && (
                <Typography variant="body2" sx={{ lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                    {program.description}
                </Typography>
            )}
            {genre !== undefined && (
                <Box sx={{ alignSelf: 'flex-start', px: 1, py: 0.35, borderRadius: 1, bgcolor: 'action.selected' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        {genre}
                    </Typography>
                </Box>
            )}
            {program.extended !== undefined && (
                <Box sx={{ pt: 0.5 }}>
                    <Typography sx={{ mb: 0.75, fontWeight: 800 }}>番組内容</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                        {program.extended}
                    </Typography>
                </Box>
            )}
            {nextProgram !== undefined && (
                <>
                    <Divider />
                    <Box>
                        <Typography sx={{ mb: 0.5, fontWeight: 850 }}>NEXT ▶▶</Typography>
                        <Typography sx={{ fontWeight: 750, lineHeight: 1.45 }}>{nextProgram.name}</Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                            {formatProgramDate(nextProgram.startAt)} - {formatProgramTime(nextProgram.endAt)}（{programDuration(nextProgram)}分）
                        </Typography>
                    </Box>
                </>
            )}
        </Stack>
    );
}

function ChannelPanel({
    schedules,
    jikkyo,
    currentChannelId,
    currentWave,
    showInformationalChannels,
    onSelect,
}: {
    schedules: Schedule[];
    jikkyo: ChannelJikkyoStatus[];
    currentChannelId: number;
    currentWave: string;
    showInformationalChannels: boolean;
    onSelect: (channel: ScheduleChannleItem) => void;
}): ReactNode {
    const visibleSchedules = useMemo(
        () => schedules.filter(schedule => showInformationalChannels || isDefaultVisibleChannel(schedule.channel)),
        [schedules, showInformationalChannels],
    );
    const waves = useMemo(() => Array.from(new Set(visibleSchedules.map(schedule => schedule.channel.channelType))).sort(waveSort), [visibleSchedules]);
    const [selectedWave, setSelectedWave] = useState(currentWave);

    useEffect(() => setSelectedWave(currentWave), [currentWave]);

    const activeWave = waves.includes(selectedWave as ChannelType) ? selectedWave : (waves[0] ?? '');
    const forceIndex = useMemo(() => new Map(jikkyo.map(status => [status.channelId, status.force])), [jikkyo]);

    return (
        <Box>
            {waves.length > 0 && (
                <Tabs
                    value={activeWave}
                    onChange={(_event, value: string) => setSelectedWave(value)}
                    variant="scrollable"
                    scrollButtons="auto"
                    sx={{ borderBottom: 1, borderColor: 'divider' }}
                >
                    {waves.map(wave => (
                        <Tab key={wave} value={wave} label={channelTypeLabel(wave)} />
                    ))}
                </Tabs>
            )}
            <Stack spacing={1} sx={{ p: 1.25 }}>
                {visibleSchedules
                    .filter(schedule => schedule.channel.channelType === activeWave)
                    .map(schedule => {
                        const item = schedule.programs[0];
                        const selected = schedule.channel.id === currentChannelId;
                        return (
                            <Box
                                component="button"
                                type="button"
                                key={schedule.channel.id}
                                onClick={() => onSelect(schedule.channel)}
                                sx={{
                                    appearance: 'none',
                                    width: '100%',
                                    p: 1.25,
                                    color: 'text.primary',
                                    bgcolor: selected ? 'action.selected' : 'background.default',
                                    border: 1,
                                    borderColor: selected ? 'primary.main' : 'divider',
                                    borderRadius: 1.5,
                                    textAlign: 'left',
                                    cursor: 'pointer',
                                    '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
                                }}
                            >
                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                    {schedule.channel.hasLogoData && (
                                        <Box
                                            component="img"
                                            src={withBasePath(`/api/channels/${schedule.channel.id}/logo`)}
                                            alt=""
                                            sx={{ width: 58, height: 36, objectFit: 'contain', flex: '0 0 auto' }}
                                        />
                                    )}
                                    <Box sx={{ minWidth: 0, flex: 1 }}>
                                        <Typography noWrap sx={{ fontWeight: 800 }}>
                                            {schedule.channel.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {channelTypeLabel(schedule.channel.channelType)}
                                        </Typography>
                                    </Box>
                                    <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', color: 'primary.main' }}>
                                        <LocalFireDepartmentOutlined sx={{ fontSize: 16 }} />
                                        <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700 }}>
                                            {forceIndex.get(schedule.channel.id)?.toLocaleString('ja-JP') ?? '--'}
                                        </Typography>
                                    </Stack>
                                </Stack>
                                {item === undefined ? (
                                    <Typography variant="body2" color="text.secondary" sx={{ mt: 0.75 }}>
                                        {isLikelyBroadcastPauseTime() ? '放送休止' : '番組情報を取得できません'}
                                    </Typography>
                                ) : (
                                    <>
                                        <Typography sx={{ mt: 0.75, fontWeight: 750, lineHeight: 1.45 }} noWrap>
                                            {item.name}
                                        </Typography>
                                        <Typography variant="caption" color="text.secondary">
                                            {formatProgramTime(item.startAt)} - {formatProgramTime(item.endAt)}（{programDuration(item)}分）
                                        </Typography>
                                    </>
                                )}
                            </Box>
                        );
                    })}
            </Stack>
        </Box>
    );
}

function CommentPanel({
    comments,
    listRef,
    canPost,
    isPremium,
    postingTarget,
    onPost,
}: {
    comments: JikkyoComment[];
    listRef: RefObject<HTMLDivElement | null>;
    canPost: boolean;
    isPremium: boolean;
    postingTarget: 'nicolive' | 'nx-jikkyo' | null;
    onPost: (text: string, color: string, position: 'top' | 'right' | 'bottom', size: 'big' | 'medium' | 'small') => Promise<void>;
}): ReactNode {
    const [text, setText] = useState('');
    const [color, setColor] = useState('white');
    const [position, setPosition] = useState<'top' | 'right' | 'bottom'>('right');
    const [size, setSize] = useState<'big' | 'medium' | 'small'>('medium');
    const [sending, setSending] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const send = async (): Promise<void> => {
        setSending(true);
        setError(null);
        try {
            await onPost(text, color, position, size);
            setText('');
        } catch (sendError) {
            setError(sendError instanceof Error ? sendError.message : String(sendError));
        } finally {
            setSending(false);
        }
    };
    return (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Box ref={listRef} sx={{ minHeight: 0, flex: 1, overflowY: 'auto', p: 1.5 }}>
                <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center' }}>
                    <ChatBubbleOutlineOutlined />
                    <Typography variant="h6" sx={{ fontWeight: 800 }}>
                        コメント
                    </Typography>
                </Stack>
                {comments.length === 0 ? (
                    <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
                        実況コメントを待っています…
                    </Typography>
                ) : (
                    <Stack spacing={0.85}>
                        {comments.map((comment, index) => (
                            <Stack key={`${comment.id}-${comment.postedAt}-${index}`} direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                                <Typography sx={{ minWidth: 0, flex: 1, lineHeight: 1.45 }}>{comment.text}</Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ pt: 0.2, flex: '0 0 auto' }}>
                                    {new Date(comment.postedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </Typography>
                            </Stack>
                        ))}
                    </Stack>
                )}
            </Box>
            {canPost && (
                <Box sx={{ flex: '0 0 auto', p: 1.25, borderTop: 1, borderColor: 'divider' }}>
                    <Stack direction="row" spacing={0.75}>
                        <Select size="small" value={color} onChange={event => setColor(event.target.value)} aria-label="コメント色" sx={{ width: 82 }}>
                            <MenuItem value="white">白</MenuItem>
                            <MenuItem value="red">赤</MenuItem>
                            <MenuItem value="orange">橙</MenuItem>
                            <MenuItem value="yellow">黄</MenuItem>
                            <MenuItem value="green">緑</MenuItem>
                            <MenuItem value="cyan">水</MenuItem>
                            <MenuItem value="blue">青</MenuItem>
                        </Select>
                        <Select
                            size="small"
                            value={position}
                            onChange={event => setPosition(event.target.value as 'top' | 'right' | 'bottom')}
                            aria-label="コメント位置"
                            sx={{ width: 88 }}
                        >
                            <MenuItem value="right">流す</MenuItem>
                            <MenuItem value="top" disabled={postingTarget === 'nicolive' && !isPremium}>
                                上
                            </MenuItem>
                            <MenuItem value="bottom" disabled={postingTarget === 'nicolive' && !isPremium}>
                                下
                            </MenuItem>
                        </Select>
                        <Select
                            size="small"
                            value={size}
                            onChange={event => setSize(event.target.value as 'big' | 'medium' | 'small')}
                            aria-label="コメントサイズ"
                            sx={{ width: 76 }}
                        >
                            <MenuItem value="small">小</MenuItem>
                            <MenuItem value="medium">中</MenuItem>
                            <MenuItem value="big" disabled={postingTarget === 'nicolive' && !isPremium}>
                                大
                            </MenuItem>
                        </Select>
                    </Stack>
                    <Stack direction="row" spacing={0.75} sx={{ mt: 0.75 }}>
                        <TextField
                            size="small"
                            value={text}
                            onChange={event => setText(event.target.value)}
                            onKeyDown={event => {
                                if (event.key === 'Enter' && !event.nativeEvent.isComposing) {
                                    event.preventDefault();
                                    if (!sending && text.trim().length > 0) void send();
                                }
                            }}
                            placeholder="ニコニコ実況へコメント"
                            slotProps={{ htmlInput: { maxLength: 75 } }}
                            fullWidth
                        />
                        <Button variant="contained" disabled={sending || text.trim().length === 0} onClick={() => void send()} aria-label="コメント送信">
                            <SendOutlined />
                        </Button>
                    </Stack>
                    {error !== null && (
                        <Typography variant="caption" color="error" sx={{ mt: 0.5, display: 'block' }}>
                            {error}
                        </Typography>
                    )}
                </Box>
            )}
        </Box>
    );
}

export function OnAirWatchPage(): ReactNode {
    const [searchParams, setSearchParams] = useSearchParams();
    const settings = useSettings();
    const activeUser = useActiveUser();
    const viewerProfile = useViewerProfile();
    const { toggleDrawer } = useAppLayout();
    const [playerKey, setPlayerKey] = useState(0);
    const [panelOpen, setPanelOpen] = useState(true);
    const [panelMounted, setPanelMounted] = useState(true);
    const [panelTab, setPanelTab] = useState<PanelTab>('program');
    const [overlayVisible, setOverlayVisible] = useState(true);
    const [reserveDialogOpen, setReserveDialogOpen] = useState(false);
    const [comments, setComments] = useState<JikkyoComment[]>([]);
    const commentBuffer = useRef<JikkyoComment[]>([]);
    const commentsVisible = useRef(false);
    const commentFlushTimer = useRef<number | null>(null);
    const commentList = useRef<HTMLDivElement | null>(null);
    const sendCommentRef = useRef<((text: string, color: string, position: 'top' | 'right' | 'bottom', size: 'big' | 'medium' | 'small') => Promise<void>) | null>(null);
    const [canPostComment, setCanPostComment] = useState(false);
    const [commentPostingTarget, setCommentPostingTarget] = useState<'nicolive' | 'nx-jikkyo' | null>(null);
    const channelId = Number(searchParams.get('channel'));
    const mode = Number(searchParams.get('mode'));
    const quality = searchParams.get('quality') ?? '';
    const wave = searchParams.get('wave') ?? '';
    const type: LiveStreamType = searchParams.get('type') === 'm2tsll' ? 'M2TS-LL' : 'M2TS';
    const valid = Number.isSafeInteger(channelId) && channelId >= 0 && Number.isSafeInteger(mode) && mode >= 0 && quality.length > 0;
    const backPath = wave.length > 0 ? `/onair?wave=${encodeURIComponent(wave)}` : '/onair';
    const goBack = useAppBack(backPath);
    const schedules = useQuery({
        queryKey: ['onair', settings.isHalfWidthDisplayed],
        queryFn: () => api.getBroadcastingSchedules({ isHalfWidth: settings.isHalfWidthDisplayed }),
        refetchInterval: 30_000,
        enabled: valid,
    });
    const jikkyo = useQuery({
        queryKey: ['onair-jikkyo'],
        queryFn: api.getChannelJikkyoStatuses,
        refetchInterval: 30_000,
        staleTime: 25_000,
        enabled: valid,
    });
    const channelSchedules = useQuery({
        queryKey: ['channel-schedules', channelId, settings.isHalfWidthDisplayed],
        queryFn: () =>
            api.getChannelSchedules({
                channelId,
                startAt: new Date().setHours(0, 0, 0, 0),
                days: 2,
                isHalfWidth: settings.isHalfWidthDisplayed,
                needsRawExtended: false,
            }),
        staleTime: 60_000,
        refetchInterval: 60_000,
        enabled: valid,
    });
    const reserveLists = useQuery({
        queryKey: ['reserve-lists', 'onair-watch'],
        queryFn: () => api.getReserveLists({ startAt: Date.now() - 6 * 3_600_000, endAt: Date.now() + 12 * 3_600_000 }),
        staleTime: 30_000,
        enabled: valid,
    });
    const recording = useQuery({
        queryKey: ['recording', 'onair-watch', channelId, settings.isHalfWidthDisplayed],
        queryFn: () => api.getRecording({ isHalfWidth: settings.isHalfWidthDisplayed, channelId, offset: 0, limit: 100 }),
        staleTime: 10_000,
        refetchInterval: 15_000,
        enabled: valid,
    });
    const niconicoStatus = useQuery({
        queryKey: ['niconico', 'status', 'onair-watch'],
        queryFn: api.getNiconicoStatus,
        staleTime: 30_000,
        enabled: valid,
    });
    const schedule = schedules.data?.find(item => item.channel.id === channelId);
    const program = schedule?.programs[0];
    const force = jikkyo.data?.find(status => status.channelId === channelId)?.force;
    const src = useMemo(() => (valid ? getLiveStreamURL(channelId, type, mode, quality, settings) : ''), [channelId, mode, quality, settings, type, valid]);
    const logo = schedule?.channel.hasLogoData === true ? withBasePath(`/api/channels/${schedule.channel.id}/logo`) : null;
    const nextProgram = useMemo(() => {
        if (program === undefined) return undefined;
        return (channelSchedules.data ?? [])
            .flatMap(item => item.programs)
            .filter(item => item.id !== program.id && item.startAt >= program.endAt)
            .sort((left, right) => left.startAt - right.startAt)[0];
    }, [channelSchedules.data, program]);
    const reserves = useMemo(() => reserveIndex(reserveLists.data), [reserveLists.data]);
    const isCurrentProgramRecording = program !== undefined && recording.data?.records.some(item => item.isRecording && item.programId === program.id) === true;

    const receiveComment = useCallback((comment: JikkyoComment): void => {
        commentBuffer.current = [...commentBuffer.current.slice(-249), comment];
        if (!commentsVisible.current || commentFlushTimer.current !== null) return;
        commentFlushTimer.current = window.setTimeout(() => {
            commentFlushTimer.current = null;
            setComments([...commentBuffer.current]);
        }, 100);
    }, []);
    const handleCommentPostAvailabilityChange = useCallback((available: boolean, _detail?: string, target?: 'nicolive' | 'nx-jikkyo' | null): void => {
        setCanPostComment(available);
        setCommentPostingTarget(target ?? null);
    }, []);
    const handleSendCommentReady = useCallback(
        (send: ((text: string, color: string, position: 'top' | 'right' | 'bottom', size: 'big' | 'medium' | 'small') => Promise<void>) | null): void => {
            sendCommentRef.current = send;
        },
        [],
    );

    useEffect(() => {
        commentBuffer.current = [];
        setComments([]);
    }, [channelId]);
    useEffect(() => {
        commentsVisible.current = panelTab === 'comments';
        if (commentsVisible.current) setComments([...commentBuffer.current]);
    }, [panelTab]);
    useEffect(
        () => () => {
            if (commentFlushTimer.current !== null) window.clearTimeout(commentFlushTimer.current);
        },
        [],
    );
    useEffect(() => {
        if (panelTab !== 'comments' || commentList.current === null) return;
        commentList.current.scrollTop = commentList.current.scrollHeight;
    }, [comments, panelTab]);
    useEffect(() => {
        if (panelOpen) {
            setPanelMounted(true);
            return;
        }

        const timer = window.setTimeout(() => setPanelMounted(false), 180);
        return () => window.clearTimeout(timer);
    }, [panelOpen]);

    const switchChannel = (channel: ScheduleChannleItem): void => {
        const next = new URLSearchParams(searchParams);
        next.set('channel', channel.id.toString(10));
        next.set('wave', channel.channelType);
        setSearchParams(next, { replace: true });
        setPlayerKey(value => value + 1);
        setPanelOpen(true);
        setOverlayVisible(true);
    };

    const panelContent = (): ReactNode => {
        if (panelTab === 'program') {
            return (
                <ProgramPanel
                    schedule={schedule}
                    program={program}
                    nextProgram={nextProgram}
                    force={force}
                    logo={logo}
                    isRecording={isCurrentProgramRecording}
                    onReserve={() => setReserveDialogOpen(true)}
                />
            );
        }
        if (panelTab === 'channels') {
            return (
                <ChannelPanel
                    schedules={schedules.data ?? []}
                    jikkyo={jikkyo.data ?? []}
                    currentChannelId={channelId}
                    currentWave={schedule?.channel.channelType ?? wave}
                    showInformationalChannels={settings.isShowInformationalChannels}
                    onSelect={switchChannel}
                />
            );
        }
        if (panelTab === 'comments') {
            return (
                <CommentPanel
                    comments={comments}
                    listRef={commentList}
                    canPost={canPostComment}
                    isPremium={niconicoStatus.data?.account?.isPremium === true}
                    postingTarget={commentPostingTarget}
                    onPost={async (text, color, position, size) => {
                        if (sendCommentRef.current === null) throw new Error('実況コメントへ接続していません');
                        await sendCommentRef.current(text, color, position, size);
                    }}
                />
            );
        }
        return <TwitterPanel programTitle={program?.name} channelName={schedule?.channel.name} videoSelector="[data-testid='onair-player'] video" />;
    };

    return (
        <Box sx={{ minHeight: '100dvh', height: { lg: '100dvh' }, overflow: { lg: 'hidden' }, bgcolor: 'background.default', color: '#fff' }}>
            {!valid ? (
                <Alert severity="error" sx={{ m: 2 }}>
                    視聴パラメーターが正しくありません。放映中画面から視聴設定を選び直してください。
                </Alert>
            ) : (
                <Box
                    sx={{
                        minHeight: '100dvh',
                        height: { lg: '100dvh' },
                        display: 'grid',
                        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: panelOpen ? 'minmax(0, 1fr) 380px' : 'minmax(0, 1fr) 0px' },
                        gridTemplateRows: { xs: 'auto auto', lg: 'minmax(0, 1fr)' },
                        overflow: { lg: 'hidden' },
                        transition: theme => theme.transitions.create('grid-template-columns', { duration: 160, easing: theme.transitions.easing.easeInOut }),
                        '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                    }}
                >
                    <Box
                        component="section"
                        sx={{
                            minWidth: 0,
                            minHeight: 0,
                            height: { lg: '100dvh' },
                            overflow: 'hidden',
                            bgcolor: 'background.default',
                        }}
                    >
                        <LivePlayer
                            key={playerKey}
                            channelId={channelId}
                            src={src}
                            lowLatency={type === 'M2TS-LL'}
                            isHevc={settings.watchUseHevc}
                            webkitPlaybackMode={settings.webkitPlaybackMode}
                            forceSubtitleStroke={settings.isForceEnableSubtitleStroke}
                            persistentBottomControls={settings.watchPersistentBottomControls}
                            showVolumePercent={settings.watchShowVolumePercent}
                            volumeBoostEnabled={settings.watchVolumeBoostEnabled}
                            volumeBoostMaxPercent={settings.watchVolumeBoostMaxPercent}
                            sessionIdentity={`${String(activeUser ?? 'none')}:${viewerProfile.profileId?.toString(10) ?? 'none'}:${viewerProfile.sessionToken ?? 'locked'}`}
                            onComment={receiveComment}
                            onControlsVisibilityChange={setOverlayVisible}
                            onCommentPostAvailabilityChange={handleCommentPostAvailabilityChange}
                            onSendCommentReady={handleSendCommentReady}
                        >
                            <Box
                                className="onair-player-overlay"
                                sx={{
                                    position: 'absolute',
                                    inset: '0 0 auto',
                                    zIndex: 7,
                                    minHeight: { xs: 54, sm: 64 },
                                    px: { xs: 0.25, sm: 0.75 },
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: { xs: 0.1, sm: 0.5 },
                                    color: '#fff',
                                    background: 'linear-gradient(to bottom, rgba(5,9,14,.68), rgba(5,9,14,.24) 66%, transparent)',
                                    opacity: overlayVisible ? 1 : 0,
                                    transform: overlayVisible ? 'translateY(0)' : 'translateY(-8px)',
                                    pointerEvents: overlayVisible ? 'auto' : 'none',
                                    transition: 'opacity 120ms ease, transform 120ms ease',
                                }}
                            >
                                <Tooltip title="メニュー">
                                    <IconButton color="inherit" onClick={toggleDrawer} aria-label="メニュー">
                                        <MenuOutlined />
                                    </IconButton>
                                </Tooltip>
                                <Tooltip title="放映中へ戻る">
                                    <IconButton color="inherit" onClick={goBack} aria-label="放映中へ戻る">
                                        <ArrowBackOutlined />
                                    </IconButton>
                                </Tooltip>
                                {logo !== null && <Box component="img" src={logo} alt="" sx={{ width: { xs: 38, sm: 50 }, height: 30, objectFit: 'contain', mx: 0.35 }} />}
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,.68)', fontWeight: 700, display: 'block' }} noWrap>
                                        {schedule?.channel.name ?? '放映中視聴'}
                                    </Typography>
                                    <Typography sx={{ fontSize: { xs: '0.82rem', sm: '1rem' }, fontWeight: 800 }} noWrap>
                                        {program?.name ?? '番組情報を取得中...'}
                                    </Typography>
                                </Box>
                                <Tooltip title={panelOpen ? '番組情報欄を閉じる' : '番組情報欄を開く'}>
                                    <IconButton color={panelOpen ? 'primary' : 'inherit'} onClick={() => setPanelOpen(value => !value)} aria-label="番組情報欄">
                                        <InfoOutlined />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </LivePlayer>
                    </Box>

                    {(panelOpen || panelMounted) && (
                        <Box
                            component="aside"
                            data-testid="onair-program-panel"
                            aria-hidden={!panelOpen}
                            sx={{
                                minHeight: 0,
                                minWidth: 0,
                                height: { xs: panelOpen ? '72dvh' : 0, lg: '100dvh' },
                                display: 'flex',
                                flexDirection: 'column',
                                color: 'text.primary',
                                bgcolor: 'background.paper',
                                borderLeft: { lg: 1 },
                                borderTop: { xs: 1, lg: 0 },
                                borderColor: 'divider',
                                overflow: 'hidden',
                                opacity: panelOpen ? 1 : 0,
                                transform: { xs: panelOpen ? 'translateY(0)' : 'translateY(-6px)', lg: panelOpen ? 'translateX(0)' : 'translateX(8px)' },
                                pointerEvents: panelOpen ? 'auto' : 'none',
                                transition: theme =>
                                    theme.transitions.create(['height', 'opacity', 'transform'], {
                                        duration: 160,
                                        easing: theme.transitions.easing.easeInOut,
                                    }),
                                '@media (prefers-reduced-motion: reduce)': { transition: 'none' },
                            }}
                        >
                            <Box sx={{ minHeight: 0, flex: 1, overflowY: panelTab === 'comments' ? 'hidden' : 'auto' }}>{panelContent()}</Box>
                            <BottomNavigation
                                showLabels
                                value={panelTab}
                                onChange={(_event, value: PanelTab) => setPanelTab(value)}
                                sx={{ flex: '0 0 auto', height: 72, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
                            >
                                <BottomNavigationAction value="program" label="番組情報" icon={<InfoOutlined />} />
                                <BottomNavigationAction value="channels" label="チャンネル" icon={<SensorsOutlined />} />
                                <BottomNavigationAction value="comments" label="コメント" icon={<ChatBubbleOutlineOutlined />} />
                                <BottomNavigationAction value="twitter" label="Twitter" icon={<Twitter />} />
                            </BottomNavigation>
                        </Box>
                    )}
                </Box>
            )}
            <GuideProgramDialog
                key={reserveDialogOpen && program !== undefined ? program.id : 'closed'}
                program={reserveDialogOpen ? (program ?? null) : null}
                channel={schedule?.channel ?? null}
                reserve={program === undefined ? undefined : reserves.get(program.id)}
                onClose={() => setReserveDialogOpen(false)}
            />
        </Box>
    );
}
