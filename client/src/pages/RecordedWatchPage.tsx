import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import ChatBubbleOutlineOutlined from '@mui/icons-material/ChatBubbleOutlineOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import MenuOutlined from '@mui/icons-material/MenuOutlined';
import Pause from '@mui/icons-material/Pause';
import PlayArrow from '@mui/icons-material/PlayArrow';
import RuleOutlined from '@mui/icons-material/RuleOutlined';
import SubtitlesOutlined from '@mui/icons-material/SubtitlesOutlined';
import Twitter from '@mui/icons-material/Twitter';
import {
    Alert,
    BottomNavigation,
    BottomNavigationAction,
    Box,
    CircularProgress,
    Divider,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    SvgIcon,
    Tooltip,
    Typography,
    useTheme,
} from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { ChannelItem, RecordedItem, Rule, VideoSubtitle } from '../../../api';
import { type ReactNode, type RefObject, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAppLayout } from '../components/AppLayout';
import { TwitterPanel } from '../components/TwitterPanel';
import { api } from '../core/api/queries';
import { createRecordedRelatedSearchOption, getRecordedStreamURL, getRecordedVideoPlayURL, type RecordedStreamType } from '../core/media/recorded';
import { isDanmakuSubtitle, preferredSubtitleIndex } from '../core/media/subtitles';
import { useAppBack } from '../core/navigation';
import { useNotifications } from '../core/notifications/Notifications';
import { withBasePath } from '../core/path';
import { AssCommentCore } from '../core/player/AssCommentCore';
import { JassubSubtitleRenderer } from '../core/player/JassubSubtitleRenderer';
import { RecordedPlayerCore, type RecordedPlayerSourceType, type RecordedPlayerState } from '../core/player/RecordedPlayerCore';
import { useTouchPlayerControls } from '../core/player/useTouchPlayerControls';
import { RecordedPlaybackTracker, type RecordedPlaybackSample } from '../core/player/RecordedPlaybackTracker';
import type { JikkyoComment } from '../core/player/jikkyoComment';
import { formatProgramDate, formatProgramTime, genreNames, programDuration } from '../core/program';
import { useActiveUser } from '../core/storage/activeUser';
import { useSettings, type WatchDanmakuFrameRateLimit, type WebKitPlaybackMode } from '../core/storage/settings';
import { useViewerProfile } from '../core/storage/viewerProfile';

type PanelTab = 'program' | 'rules' | 'comments' | 'twitter';

const RECORDED_PLAYER_PANEL_OPEN_STORAGE_KEY = 'neoepgstation-recorded-player-panel-open';
const PLAY_SUBTITLE_PREVIEW_LOOK_BEHIND = 30;
const PLAY_SUBTITLE_PREVIEW_DURATION = 3 * 60 + PLAY_SUBTITLE_PREVIEW_LOOK_BEHIND;

function loadRecordedPlayerPanelOpen(): boolean {
    try {
        return localStorage.getItem(RECORDED_PLAYER_PANEL_OPEN_STORAGE_KEY) !== 'false';
    } catch {
        return true;
    }
}

interface PlayerSource {
    src: string;
    type: RecordedPlayerSourceType;
    enableAribSubtitle: boolean;
    commentsUrl?: string;
    vodSessionId?: string;
}

function createVodSessionId(): string {
    if (typeof crypto.randomUUID === 'function') return crypto.randomUUID();
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

const mdiSeekPaths = {
    rewind30:
        'M19,14V20C19,21.11 18.11,22 17,22H15A2,2 0 0,1 13,20V14A2,2 0 0,1 15,12H17C18.11,12 19,12.9 19,14M15,14V20H17V14H15M11,20C11,21.11 10.1,22 9,22H5V20H9V18H7V16H9V14H5V12H9A2,2 0 0,1 11,14V15.5A1.5,1.5 0 0,1 9.5,17A1.5,1.5 0 0,1 11,18.5V20M12.5,3C17.15,3 21.08,6.03 22.47,10.22L20.1,11C19.05,7.81 16.04,5.5 12.5,5.5C10.54,5.5 8.77,6.22 7.38,7.38L10,10H3V3L5.6,5.6C7.45,4 9.85,3 12.5,3Z',
    rewind10:
        'M12.5,3C17.15,3 21.08,6.03 22.47,10.22L20.1,11C19.05,7.81 16.04,5.5 12.5,5.5C10.54,5.5 8.77,6.22 7.38,7.38L10,10H3V3L5.6,5.6C7.45,4 9.85,3 12.5,3M10,12V22H8V14H6V12H10M18,14V20C18,21.11 17.11,22 16,22H14A2,2 0 0,1 12,20V14A2,2 0 0,1 14,12H16C17.11,12 18,12.9 18,14M14,14V20H16V14H14Z',
    forward10:
        'M10,12V22H8V14H6V12H10M18,14V20C18,21.11 17.11,22 16,22H14A2,2 0 0,1 12,20V14A2,2 0 0,1 14,12H16C17.11,12 18,12.9 18,14M14,14V20H16V14H14M11.5,3C14.15,3 16.55,4 18.4,5.6L21,3V10H14L16.62,7.38C15.23,6.22 13.46,5.5 11.5,5.5C7.96,5.5 4.95,7.81 3.9,11L1.53,10.22C2.92,6.03 6.85,3 11.5,3Z',
    forward30:
        'M11.5,3C6.85,3 2.92,6.03 1.53,10.22L3.9,11C4.95,7.81 7.96,5.5 11.5,5.5C13.46,5.5 15.23,6.22 16.62,7.38L14,10H21V3L18.4,5.6C16.55,4 14.15,3 11.5,3M19,14V20C19,21.11 18.11,22 17,22H15A2,2 0 0,1 13,20V14A2,2 0 0,1 15,12H17C18.11,12 19,12.9 19,14M15,14V20H17V14H15M11,20C11,21.11 10.1,22 9,22H5V20H9V18H7V16H9V14H5V12H9A2,2 0 0,1 11,14V15.5A1.5,1.5 0 0,1 9.5,17A1.5,1.5 0 0,1 11,18.5V20Z',
} as const;

function MdiSeekIcon({ path }: { path: string }): ReactNode {
    return (
        <SvgIcon viewBox="0 0 24 24">
            <path d={path} />
        </SvgIcon>
    );
}

function isNicoJkSubtitle(subtitle: VideoSubtitle | undefined): boolean {
    if (subtitle === undefined) return false;
    return isDanmakuSubtitle(subtitle);
}

function RecordedPlayer({
    source,
    subtitleText,
    subtitleIsNicoJk,
    danmakuSubtitleText,
    subtitleDanmaku,
    forceSubtitleStroke,
    danmakuHighRefreshRate,
    danmakuFrameRateLimit,
    webkitPlaybackMode,
    persistentBottomControls,
    showVolumePercent,
    volumeBoostEnabled,
    volumeBoostMaxPercent,
    onComment,
    onCommentsReset,
    onCommentStatus,
    onControlsVisibilityChange,
    onVideoReady,
    startPosition,
    resumePlaying,
    sessionIdentity,
    children,
}: {
    source: PlayerSource;
    subtitleText: string | null;
    subtitleIsNicoJk: boolean;
    danmakuSubtitleText: string | null;
    subtitleDanmaku: boolean;
    forceSubtitleStroke: boolean;
    danmakuHighRefreshRate: boolean;
    danmakuFrameRateLimit: WatchDanmakuFrameRateLimit;
    webkitPlaybackMode: WebKitPlaybackMode;
    persistentBottomControls: boolean;
    showVolumePercent: boolean;
    volumeBoostEnabled: boolean;
    volumeBoostMaxPercent: number;
    onComment: (comment: JikkyoComment) => void;
    onCommentsReset: () => void;
    onCommentStatus: (detail: string) => void;
    onControlsVisibilityChange: (visible: boolean) => void;
    onVideoReady: (video: HTMLVideoElement | null) => void;
    startPosition: number | null;
    resumePlaying: boolean;
    sessionIdentity: string;
    children: ReactNode;
}): ReactNode {
    const theme = useTheme();
    const container = useRef<HTMLDivElement | null>(null);
    const coreRef = useRef<RecordedPlayerCore | null>(null);
    const rendererRef = useRef(new JassubSubtitleRenderer());
    const assCommentRef = useRef<AssCommentCore | null>(null);
    const assCommentModeRef = useRef<'danmaku' | 'subtitle' | null>(null);
    const assCommentVideoRef = useRef<HTMLVideoElement | null>(null);
    const [video, setVideo] = useState<HTMLVideoElement | null>(null);
    const [controlsVisible, setControlsVisible] = useState(true);
    const [controlsPortal, setControlsPortal] = useState<HTMLElement | null>(null);
    const [paused, setPaused] = useState(true);
    const [state, setState] = useState<RecordedPlayerState>({ isLoading: true, isBuffering: false, loadingText: 'プレイヤーを初期化中...' });
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
        const sessionUrl = source.vodSessionId === undefined ? null : withBasePath(`/api/streams/recorded/vodhls/sessions/${encodeURIComponent(source.vodSessionId)}`);
        let released = false;
        const keepSession = (): void => {
            if (sessionUrl === null || released) return;
            void fetch(sessionUrl, { method: 'PUT', keepalive: true }).catch(() => {});
        };
        const releaseSession = (): void => {
            if (sessionUrl === null || released) return;
            released = true;
            void fetch(sessionUrl, { method: 'DELETE', keepalive: true }).catch(() => {});
        };
        const handlePageHide = (event: PageTransitionEvent): void => {
            if (!event.persisted) releaseSession();
        };
        const keepTimer = sessionUrl === null ? null : window.setInterval(keepSession, 10_000);
        window.addEventListener('pagehide', handlePageHide);
        setVideo(null);
        rendererRef.current.clear();
        assCommentRef.current?.destroy();
        assCommentRef.current = null;
        assCommentModeRef.current = null;
        assCommentVideoRef.current = null;
        const core = new RecordedPlayerCore({
            container: container.current,
            src: source.src,
            type: source.type,
            enableAribSubtitle: source.enableAribSubtitle,
            enableDanmaku: subtitleDanmaku,
            forceSubtitleStroke,
            danmakuHighRefreshRate,
            danmakuFrameRateLimit,
            volumeBoostEnabled,
            volumeBoostMaxPercent,
            webkitPlaybackMode,
            themeColor: theme.palette.primary.main,
            commentsUrl: source.commentsUrl,
            autoplay: resumePlaying,
            onReady: nextVideo => {
                setVideo(nextVideo);
                setPaused(nextVideo.paused);
                onVideoReady(nextVideo);
                const restorePlayback = (): void => {
                    if (startPosition === null) return;
                    if (Number.isFinite(nextVideo.duration)) nextVideo.currentTime = Math.min(startPosition, nextVideo.duration);
                    if (!resumePlaying) nextVideo.pause();
                };
                if (nextVideo.readyState >= HTMLMediaElement.HAVE_METADATA) restorePlayback();
                else nextVideo.addEventListener('loadedmetadata', restorePlayback, { once: true });
            },
            onStateChange: setState,
            onComment,
            onCommentsReset,
            onCommentStatus,
            onControlsVisibilityChange: visible => {
                setControlsVisible(visible);
                onControlsVisibilityChange(visible);
            },
            onControlsPortalReady: setControlsPortal,
            onError: error => console.error('[RecordedWatch]', error),
        });
        coreRef.current = core;
        void core.init();
        return () => {
            onVideoReady(null);
            coreRef.current = null;
            rendererRef.current.clear();
            assCommentRef.current?.destroy();
            assCommentRef.current = null;
            assCommentModeRef.current = null;
            assCommentVideoRef.current = null;
            core.destroy();
            if (keepTimer !== null) window.clearInterval(keepTimer);
            window.removeEventListener('pagehide', handlePageHide);
            releaseSession();
        };
    }, [
        forceSubtitleStroke,
        danmakuHighRefreshRate,
        danmakuFrameRateLimit,
        webkitPlaybackMode,
        onComment,
        onCommentStatus,
        onCommentsReset,
        onControlsVisibilityChange,
        onVideoReady,
        resumePlaying,
        sessionIdentity,
        source,
        startPosition,
        subtitleDanmaku,
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

    useEffect(() => {
        if (video === null || subtitleText === null) {
            rendererRef.current.clear();

            return;
        }

        // In danmaku mode the ordinary subtitle selector must still render
        // through libass/JASSUB.  The danmaku selector is an additional track,
        // not a replacement for the ordinary subtitle track.
        void rendererRef.current.setSubtitle(video, subtitleText, subtitleIsNicoJk).catch(error => console.error('[RecordedWatch:JASSUB]', error));
    }, [subtitleIsNicoJk, subtitleText, video]);

    useEffect(() => {
        const mode = subtitleDanmaku ? 'danmaku' : subtitleIsNicoJk ? 'subtitle' : null;
        const ass = mode === 'danmaku' ? danmakuSubtitleText : mode === 'subtitle' ? subtitleText : null;
        if (video === null || mode === null || ass === null) {
            assCommentRef.current?.destroy();
            assCommentRef.current = null;
            assCommentModeRef.current = null;
            assCommentVideoRef.current = null;
            coreRef.current?.clearDanmaku();
            onCommentsReset();

            return;
        }

        if (assCommentRef.current !== null && assCommentModeRef.current === mode && assCommentVideoRef.current === video) {
            assCommentRef.current.updateAss(ass);

            return;
        }

        assCommentRef.current?.destroy();
        coreRef.current?.clearDanmaku();
        onCommentsReset();
        const comments = new AssCommentCore({
            ass,
            video,
            onComment: mode === 'danmaku' ? comment => coreRef.current?.drawDanmaku(comment) : onComment,
            onReset:
                mode === 'danmaku'
                    ? () => {
                          coreRef.current?.clearDanmaku();
                          onCommentsReset();
                      }
                    : onCommentsReset,
        });
        assCommentRef.current = comments;
        assCommentModeRef.current = mode;
        assCommentVideoRef.current = video;
        comments.start();
    }, [danmakuSubtitleText, onComment, onCommentsReset, subtitleDanmaku, subtitleIsNicoJk, subtitleText, video]);

    const seekBy = (seconds: number): void => {
        if (video === null) return;
        const duration = Number.isFinite(video.duration) ? video.duration : Number.POSITIVE_INFINITY;
        video.currentTime = Math.min(Math.max(video.currentTime + seconds, 0), duration);
        showPlayerControls();
    };
    const togglePlay = (): void => {
        if (video === null) return;
        if (video.paused) void video.play().catch(error => console.error('[RecordedWatch:play]', error));
        else video.pause();
        showPlayerControls();
    };

    return (
        <Box
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
                '& .recorded-dplayer': { position: 'absolute', inset: 0, width: '100%', height: '100%', zIndex: 1 },
                '& .recorded-dplayer.dplayer': { width: '100%', height: '100%', bgcolor: 'transparent' },
                '& .recorded-dplayer .dplayer-video-wrap': { bgcolor: '#000 !important' },
                '& .recorded-dplayer .dplayer-video-wrap-aspect, & .recorded-dplayer video': { width: '100%', height: '100%' },
                '& .recorded-dplayer video': { objectFit: 'contain', opacity: '1 !important' },
                // DPlayer's WebGL danmaku renderer composites the video into
                // its own canvas and makes the native video transparent.  A
                // JASSUB canvas inserted immediately after the video would
                // otherwise remain behind that opaque composite canvas, so
                // keep subtitle layers above danmaku while leaving controls
                // above them. The native video remains visible underneath as a
                // fallback while the WebGL canvas is resized.
                '& .recorded-dplayer .dplayer-danmaku': { zIndex: 2 },
                '& .recorded-dplayer .neo-player-arib-canvas': { zIndex: 3 },
                '& .recorded-dplayer .JASSUB': {
                    position: 'absolute !important',
                    inset: '0 !important',
                    width: '100% !important',
                    height: '100% !important',
                    zIndex: 3,
                    pointerEvents: 'none',
                },
                '& .recorded-dplayer .dplayer-controller-mask, & .recorded-dplayer .dplayer-controller, & .recorded-dplayer .dplayer-bezel, & .recorded-dplayer .dplayer-setting-box, & .recorded-dplayer .dplayer-comment-setting-box, & .recorded-dplayer .dplayer-notice':
                    {
                        zIndex: 4,
                    },
                '& .recorded-dplayer .dplayer-controller-mask': {
                    height: '82px !important',
                    background: 'linear-gradient(to top, rgba(0,0,0,.86), transparent) !important',
                },
                '& .recorded-dplayer .dplayer-controller': { bottom: '0 !important', px: { xs: '8px !important', sm: '16px !important' }, pb: '10px !important' },
                '& .recorded-dplayer .dplayer-comment-box, & .recorded-dplayer .dplayer-comment': { display: 'none !important' },
                '& .recorded-dplayer.dplayer-mobile .dplayer-mobile-icon-wrap': { display: 'none !important' },
                '& .recorded-dplayer [data-dplayer-custom-control="mobile-volume"]': { display: 'none' },
                '& .recorded-dplayer.dplayer-mobile [data-dplayer-custom-control="mobile-volume"]': { display: 'inline-block' },
                '& .recorded-dplayer .neo-player-central-controls-host': {
                    position: 'absolute',
                    inset: persistentBottomControls ? '0 0 56px' : 0,
                    zIndex: 6,
                    pointerEvents: 'none',
                },
                ...(persistentBottomControls
                    ? {
                          '& .recorded-dplayer .dplayer-video-wrap': {
                              height: 'calc(100% - 56px) !important',
                          },
                          '& .recorded-dplayer .dplayer-video-wrap-aspect': {
                              height: '100% !important',
                          },
                          '& .recorded-dplayer .dplayer-controller-mask': {
                              height: '56px !important',
                              bottom: '0 !important',
                              opacity: '1 !important',
                              background: '#10151b !important',
                          },
                          '& .recorded-dplayer .dplayer-controller': {
                              bottom: '0 !important',
                              height: '56px !important',
                              opacity: '1 !important',
                              visibility: 'visible !important',
                              transform: 'none !important',
                              background: '#10151b !important',
                          },
                          '& .recorded-dplayer.dplayer-hide-controller .dplayer-controller, & .recorded-dplayer.dplayer-hide-controller .dplayer-controller-mask': {
                              opacity: '1 !important',
                              visibility: 'visible !important',
                              transform: 'none !important',
                          },
                      }
                    : {}),
                '& .recorded-dplayer .neo-player-volume-percent': {
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
                '& .recorded-dplayer .dplayer-volume': {
                    marginLeft: showVolumePercent ? '-13px' : 0,
                },
            }}
        >
            {(state.isLoading || state.isBuffering) && (
                <Box
                    sx={{
                        position: 'absolute',
                        inset: persistentBottomControls ? '0 0 56px' : 0,
                        zIndex: 5,
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
            <Box ref={container} className={`recorded-dplayer${persistentBottomControls ? ' neo-player-persistent-bottom-controls' : ''}`} />
            {controlsPortal !== null &&
                createPortal(
                    <Stack
                        data-player-control-ui
                        direction="row"
                        spacing={0}
                        onPointerDown={event => event.stopPropagation()}
                        onClick={event => event.stopPropagation()}
                        sx={{
                            position: 'absolute',
                            top: '50%',
                            left: '50%',
                            zIndex: 6,
                            alignItems: 'center',
                            transform: 'translate(-50%, -50%)',
                            opacity: !state.isLoading && !state.isBuffering && controlsVisible ? 1 : 0,
                            pointerEvents: !state.isLoading && !state.isBuffering && controlsVisible ? 'auto' : 'none',
                            transition: 'opacity 120ms ease',
                            color: '#fff',
                            '& .MuiIconButton-root': {
                                color: 'inherit',
                                filter: 'drop-shadow(0 2px 4px rgba(0,0,0,.95))',
                            },
                            '& .seek-button': {
                                width: { xs: 50, sm: 62 },
                                height: { xs: 50, sm: 62 },
                                mx: { xs: 1, sm: 3 },
                                '& .MuiSvgIcon-root': { fontSize: { xs: 40, sm: 50 } },
                            },
                        }}
                    >
                        <IconButton className="seek-button" title="30秒戻す" aria-label="30秒戻す" onClick={() => seekBy(-30)}>
                            <MdiSeekIcon path={mdiSeekPaths.rewind30} />
                        </IconButton>
                        <IconButton className="seek-button" title="10秒戻す" aria-label="10秒戻す" onClick={() => seekBy(-10)}>
                            <MdiSeekIcon path={mdiSeekPaths.rewind10} />
                        </IconButton>
                        <IconButton
                            title={paused ? '再生' : '一時停止'}
                            aria-label={paused ? '再生' : '一時停止'}
                            onClick={togglePlay}
                            disabled={state.isLoading || state.isBuffering}
                            sx={{ width: { xs: 58, sm: 68 }, height: { xs: 58, sm: 68 }, mx: { xs: 0.75, sm: 2.5 } }}
                        >
                            {paused ? <PlayArrow sx={{ fontSize: { xs: 46, sm: 60 } }} /> : <Pause sx={{ fontSize: { xs: 46, sm: 60 } }} />}
                        </IconButton>
                        <IconButton className="seek-button" title="10秒送る" aria-label="10秒送る" onClick={() => seekBy(10)}>
                            <MdiSeekIcon path={mdiSeekPaths.forward10} />
                        </IconButton>
                        <IconButton className="seek-button" title="30秒送る" aria-label="30秒送る" onClick={() => seekBy(30)}>
                            <MdiSeekIcon path={mdiSeekPaths.forward30} />
                        </IconButton>
                    </Stack>,
                    controlsPortal,
                )}
            {children}
        </Box>
    );
}

function ProgramPanel({ item, channel }: { item: RecordedItem; channel: ChannelItem | undefined }): ReactNode {
    const genre = item.genre1 === undefined ? undefined : genreNames[item.genre1];
    return (
        <Stack spacing={1.5} sx={{ p: { xs: 1.75, sm: 2 } }}>
            <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center' }}>
                {channel?.hasLogoData === true && (
                    <Box component="img" src={withBasePath(`/api/channels/${channel.id}/logo`)} alt="" sx={{ width: 62, height: 38, objectFit: 'contain', flex: '0 0 auto' }} />
                )}
                <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800 }}>{channel?.name ?? item.channelId.toString(10)}</Typography>
                    <Typography variant="caption" color="text.secondary">
                        録画済み
                    </Typography>
                </Box>
            </Stack>
            <Box>
                <Typography variant="h6" sx={{ fontWeight: 850, lineHeight: 1.45 }}>
                    {item.name}
                </Typography>
                <Typography variant="body2" color="text.secondary" sx={{ mt: 0.5 }}>
                    {formatProgramDate(item.startAt)} - {formatProgramTime(item.endAt)}（{programDuration(item)}分）
                </Typography>
            </Box>
            {item.description !== undefined && (
                <Typography variant="body2" sx={{ lineHeight: 1.75, whiteSpace: 'pre-wrap' }}>
                    {item.description}
                </Typography>
            )}
            {genre !== undefined && (
                <Box sx={{ alignSelf: 'flex-start', px: 1, py: 0.35, borderRadius: 1, bgcolor: 'action.selected' }}>
                    <Typography variant="caption" sx={{ fontWeight: 700 }}>
                        {genre}
                    </Typography>
                </Box>
            )}
            {item.extended !== undefined && (
                <Box sx={{ pt: 0.5 }}>
                    <Typography sx={{ mb: 0.75, fontWeight: 800 }}>番組内容</Typography>
                    <Typography variant="body2" color="text.secondary" sx={{ lineHeight: 1.75, whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
                        {item.extended}
                    </Typography>
                </Box>
            )}
        </Stack>
    );
}

function RulePanel({
    rule,
    searchKeyword,
    records,
    currentId,
    onSelect,
}: {
    rule: Rule | undefined;
    searchKeyword: string | undefined;
    records: RecordedItem[];
    currentId: number;
    onSelect: (recordedId: number) => void;
}): ReactNode {
    const conditionLabel =
        rule !== undefined
            ? `ルール「${rule.searchOption.keyword?.trim() || `#${rule.id.toString(10)}`}」`
            : searchKeyword !== undefined && searchKeyword.trim().length > 0
              ? `検索ワード「${searchKeyword.trim()}」`
              : '関連する録画';
    return (
        <Stack spacing={1.25} sx={{ p: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                <RuleOutlined />
                <Box sx={{ minWidth: 0 }}>
                    <Typography sx={{ fontWeight: 800 }}>
                        {rule?.searchOption.keyword?.trim() || searchKeyword || (rule === undefined ? '関連する録画' : `ルール #${rule.id.toString(10)}`)}
                    </Typography>
                    <Typography variant="caption" color="text.secondary">
                        {conditionLabel}・{records.length.toLocaleString('ja-JP')} 件
                    </Typography>
                </Box>
            </Stack>
            <Divider />
            {records.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center' }}>
                    searchと同じ条件に一致する録画は見つかりませんでした。
                </Typography>
            ) : (
                <Stack spacing={0.75}>
                    {records.map(record => (
                        <Box
                            component="button"
                            type="button"
                            key={record.id}
                            onClick={() => onSelect(record.id)}
                            sx={{
                                width: '100%',
                                minHeight: 72,
                                display: 'flex',
                                alignItems: 'stretch',
                                appearance: 'none',
                                p: 0,
                                color: 'text.primary',
                                bgcolor: record.id === currentId ? 'action.selected' : 'background.default',
                                border: 1,
                                borderColor: record.id === currentId ? 'primary.main' : 'divider',
                                borderRadius: 1,
                                overflow: 'hidden',
                                textAlign: 'left',
                                cursor: 'pointer',
                                '&:hover': { borderColor: 'primary.main', bgcolor: 'action.hover' },
                            }}
                        >
                            {record.thumbnails?.[0] !== undefined && (
                                <Box
                                    component="img"
                                    src={withBasePath(`/api/thumbnails/${record.thumbnails[0]}`)}
                                    alt=""
                                    sx={{ width: 112, objectFit: 'cover', flex: '0 0 auto' }}
                                />
                            )}
                            <Box sx={{ minWidth: 0, flex: 1, px: 1.25, py: 0.9 }}>
                                <Typography noWrap sx={{ fontWeight: 750 }}>
                                    {record.name}
                                </Typography>
                                <Typography variant="caption" color="text.secondary" sx={{ display: 'block' }}>
                                    {formatProgramDate(record.startAt)} - {formatProgramTime(record.endAt)}（{programDuration(record)}分）
                                </Typography>
                                {record.description !== undefined && (
                                    <Typography variant="caption" color="text.secondary" noWrap sx={{ display: 'block', mt: 0.2 }}>
                                        {record.description}
                                    </Typography>
                                )}
                            </Box>
                        </Box>
                    ))}
                </Stack>
            )}
        </Stack>
    );
}

function commentTime(comment: JikkyoComment): string {
    if (comment.postedAt > 0) return new Date(comment.postedAt).toLocaleTimeString('ja-JP', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const seconds = Math.max(0, Math.round((comment.vpos ?? 0) / 100));
    const minutes = Math.floor(seconds / 60);
    return `${minutes.toString(10).padStart(2, '0')}:${(seconds % 60).toString(10).padStart(2, '0')}`;
}

function CommentPanel({ comments, status, listRef }: { comments: JikkyoComment[]; status: string; listRef: RefObject<HTMLDivElement | null> }): ReactNode {
    return (
        <Box ref={listRef} sx={{ height: '100%', overflowY: 'auto', p: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center' }}>
                <ChatBubbleOutlineOutlined />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    コメント
                </Typography>
            </Stack>
            {comments.length === 0 ? (
                <Typography color="text.secondary" sx={{ py: 5, textAlign: 'center', whiteSpace: 'pre-wrap' }}>
                    {status}
                </Typography>
            ) : (
                <Stack spacing={0.85}>
                    {comments.map((comment, index) => (
                        <Stack
                            key={`${comment.id.toString(10)}-${comment.postedAt.toString(10)}-${index.toString(10)}`}
                            direction="row"
                            spacing={1}
                            sx={{ alignItems: 'flex-start' }}
                        >
                            <Typography sx={{ minWidth: 0, flex: 1, lineHeight: 1.45, whiteSpace: 'pre-wrap' }}>{comment.text}</Typography>
                            <Typography variant="caption" color="text.secondary" sx={{ pt: 0.2, flex: '0 0 auto' }}>
                                {commentTime(comment)}
                            </Typography>
                        </Stack>
                    ))}
                </Stack>
            )}
        </Box>
    );
}

function SubtitlePanel({
    subtitles,
    selectedIndex,
    preparingIndex,
    enabled,
    onSelect,
}: {
    subtitles: VideoSubtitle[];
    selectedIndex: number | null;
    preparingIndex: number | 'none' | null;
    enabled: boolean;
    onSelect: (index: number | null) => void;
}): ReactNode {
    const entries: Array<{ key: string; index: number | null; title: string; detail: string }> = [
        { key: 'none', index: null, title: '字幕なし', detail: '字幕を焼き込まずに再生します' },
        ...subtitles.map(subtitle => ({
            key: subtitle.subtitleIndex.toString(10),
            index: subtitle.subtitleIndex,
            title: subtitle.displayName,
            detail: [subtitle.language, subtitle.codecName, subtitle.isDefault ? 'デフォルト' : undefined, subtitle.isForced ? '強制字幕' : undefined]
                .filter((value): value is string => value !== undefined && value.length > 0)
                .join(' / '),
        })),
    ];
    return (
        <Box sx={{ height: '100%', overflowY: 'auto', p: 1.5 }}>
            <Stack direction="row" spacing={1} sx={{ mb: 1.5, alignItems: 'center' }}>
                <SubtitlesOutlined />
                <Typography variant="h6" sx={{ fontWeight: 800 }}>
                    字幕
                </Typography>
            </Stack>
            {!enabled && (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    TS STREAMINGの字幕は映像内字幕として再生されます。
                </Typography>
            )}
            {enabled && subtitles.length === 0 && (
                <Typography color="text.secondary" sx={{ py: 3, textAlign: 'center' }}>
                    この録画ファイルには切り替え可能な字幕がありません。
                </Typography>
            )}
            {enabled && (
                <Stack spacing={0.75}>
                    {entries.map(entry => {
                        const selected = selectedIndex === entry.index;
                        const preparing = preparingIndex === (entry.index ?? 'none');
                        return (
                            <Box
                                component="button"
                                type="button"
                                key={entry.key}
                                disabled={preparingIndex !== null}
                                onClick={() => onSelect(entry.index)}
                                sx={{
                                    width: '100%',
                                    minHeight: 54,
                                    px: 1.25,
                                    py: 0.75,
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: 1,
                                    color: 'text.primary',
                                    bgcolor: selected ? 'action.selected' : 'background.default',
                                    border: 1,
                                    borderColor: selected ? 'primary.main' : 'divider',
                                    borderRadius: 1.5,
                                    cursor: preparingIndex === null ? 'pointer' : 'default',
                                    textAlign: 'left',
                                    font: 'inherit',
                                    '&:hover': { bgcolor: preparingIndex === null ? 'action.hover' : undefined },
                                    '&:disabled': { opacity: 0.72 },
                                }}
                            >
                                <SubtitlesOutlined color={selected ? 'primary' : 'inherit'} />
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography sx={{ fontWeight: 750 }} noWrap>
                                        {entry.title}
                                    </Typography>
                                    {entry.detail.length > 0 && (
                                        <Typography variant="caption" color="text.secondary" noWrap>
                                            {entry.detail}
                                        </Typography>
                                    )}
                                </Box>
                                {preparing && <CircularProgress size={22} />}
                            </Box>
                        );
                    })}
                </Stack>
            )}
        </Box>
    );
}

export function RecordedWatchPage(): ReactNode {
    const navigate = useNavigate();
    const location = useLocation();
    const [params, setParams] = useSearchParams();
    const settings = useSettings();
    const activeUser = useActiveUser();
    const viewerProfile = useViewerProfile();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const { toggleDrawer } = useAppLayout();
    const streaming = location.pathname.endsWith('/streaming');
    const videoFileId = Number(params.get('videoId'));
    const recordedId = Number(params.get('recordedId'));
    const goBack = useAppBack(`/recorded/detail/${recordedId.toString(10)}`);
    const mode = Number(params.get('mode'));
    const quality = params.get('quality') ?? '';
    const streamType: RecordedStreamType = params.get('type') === 'hls-ts' ? 'HLS-TS' : 'HLS';
    const subtitleIndexParam = params.get('subtitleIndex');
    const streamSubtitleIndex = subtitleIndexParam === null || subtitleIndexParam === '-1' ? null : Number(subtitleIndexParam);
    const streamSubtitleFileKey = params.get('subtitleFileKey') ?? undefined;
    const validIds = Number.isSafeInteger(videoFileId) && videoFileId >= 0 && Number.isSafeInteger(recordedId) && recordedId >= 0;
    const valid = validIds && (!streaming || (Number.isSafeInteger(mode) && mode >= 0 && quality.length > 0));
    const [panelOpen, setPanelOpen] = useState(loadRecordedPlayerPanelOpen);
    const [panelMounted, setPanelMounted] = useState(panelOpen);
    const [panelTab, setPanelTab] = useState<PanelTab>('program');
    const [overlayVisible, setOverlayVisible] = useState(true);
    const [selectedSubtitleIndex, setSelectedSubtitleIndex] = useState<number | null>(null);
    const [selectedDanmakuSubtitleIndex, setSelectedDanmakuSubtitleIndex] = useState<number | null>(null);
    const [preparingSubtitleIndex, setPreparingSubtitleIndex] = useState<number | 'none' | null>(null);
    const [resumePosition, setResumePosition] = useState<number | null>(null);
    const [resumePlaying, setResumePlaying] = useState(true);

    useEffect(() => {
        try {
            localStorage.setItem(RECORDED_PLAYER_PANEL_OPEN_STORAGE_KEY, panelOpen.toString());
        } catch {
            // Playback remains available even when browser storage is unavailable.
        }
    }, [panelOpen]);

    useEffect(() => {
        if (panelOpen) {
            setPanelMounted(true);
            return;
        }

        const timer = window.setTimeout(() => setPanelMounted(false), 180);
        return () => window.clearTimeout(timer);
    }, [panelOpen]);
    const playerVideo = useRef<HTMLVideoElement | null>(null);
    const [progressVideo, setProgressVideo] = useState<HTMLVideoElement | null>(null);
    const autoWatchLastAttemptAt = useRef(0);
    const autoWatchInFlight = useRef(false);
    const autoWatchFailureNotified = useRef(false);
    const autoWatchRetryTimer = useRef<number | null>(null);
    const attemptAutoWatchRef = useRef<() => Promise<void>>(async () => {});
    const playbackStarted = useRef(false);
    const [comments, setComments] = useState<JikkyoComment[]>([]);
    const [commentStatus, setCommentStatus] = useState(streaming ? '実況過去ログを取得しています…' : 'ASS実況字幕を選択すると、再生中のコメントをここにも表示します。');
    const commentList = useRef<HTMLDivElement | null>(null);
    const commentBuffer = useRef<JikkyoComment[]>([]);
    const commentsVisible = useRef(false);
    const commentFlushTimer = useRef<number | null>(null);
    const recorded = useQuery({
        queryKey: ['recorded-detail', recordedId, settings.isHalfWidthDisplayed],
        queryFn: () => api.getRecordedItem(recordedId, settings.isHalfWidthDisplayed),
        enabled: validIds,
    });
    const playbackUserId = typeof activeUser === 'number' ? activeUser : null;
    const playbackKey = ['recorded-playback', recordedId, playbackUserId] as const;
    const playback = useQuery({
        queryKey: playbackKey,
        queryFn: () => api.getRecordedPlayback(recordedId, playbackUserId!),
        enabled: validIds && playbackUserId !== null,
        retry: false,
    });
    const storedResumePosition =
        playbackUserId !== null &&
        settings.watchResumePlayback &&
        playback.data !== undefined &&
        playback.data.position >= 5 &&
        (playback.data.duration <= 0 || playback.data.position < playback.data.duration - 10)
            ? playback.data.position
            : null;
    const annictEpisodeKey = ['recorded-annict-episode', recordedId, viewerProfile.profileId] as const;
    const annictEpisode = useQuery({
        queryKey: annictEpisodeKey,
        queryFn: () => api.getRecordedAnnictEpisode(recordedId),
        enabled: validIds,
        retry: 2,
        retryDelay: 10_000,
        refetchInterval: query => (settings.annictAutoWatchMode !== 'disabled' && query.state.status === 'error' ? 60_000 : false),
    });
    const annictEpisodeRef = useRef(annictEpisode.data);
    const settingsRef = useRef(settings);
    annictEpisodeRef.current = annictEpisode.data;
    settingsRef.current = settings;
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000, enabled: validIds });
    const subtitles = useQuery({
        queryKey: ['video-subtitles', videoFileId],
        queryFn: () => api.getVideoSubtitles(videoFileId),
        enabled: validIds && (!streaming || recorded.data?.videoFiles?.some(video => video.id === videoFileId && video.type === 'encoded') === true),
        staleTime: Number.POSITIVE_INFINITY,
    });
    const subtitleItems = subtitles.data?.items ?? [];
    const danmakuSubtitleItems = useMemo(() => subtitleItems.filter(subtitle => isDanmakuSubtitle(subtitle)), [subtitleItems]);
    const selectableSubtitleItems = useMemo(
        () => (settings.watchPlaySubtitleDanmaku && !streaming ? subtitleItems.filter(subtitle => !isDanmakuSubtitle(subtitle)) : subtitleItems),
        [settings.watchPlaySubtitleDanmaku, streaming, subtitleItems],
    );
    const selectedSubtitle = subtitles.data?.items.find(item => item.subtitleIndex === selectedSubtitleIndex);
    const subtitlePreviewStartAt = Math.max(0, (resumePosition ?? storedResumePosition ?? 0) - PLAY_SUBTITLE_PREVIEW_LOOK_BEHIND);
    const normalSubtitleEnabled = validIds && !streaming && selectedSubtitleIndex !== null;
    const subtitleTextPreview = useQuery({
        queryKey: ['video-subtitle-text-preview', videoFileId, 'normal', selectedSubtitleIndex, subtitlePreviewStartAt],
        queryFn: () =>
            api.getVideoSubtitleText(videoFileId, selectedSubtitleIndex!, {
                startAt: subtitlePreviewStartAt,
                duration: PLAY_SUBTITLE_PREVIEW_DURATION,
            }),
        enabled: normalSubtitleEnabled,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
    });
    const subtitleText = useQuery({
        // Keep the ordinary and danmaku tracks in separate query namespaces.
        // Their numeric subtitleIndex values come from the same file and can
        // otherwise share a cache entry while the two selectors are changing.
        queryKey: ['video-subtitle-text', videoFileId, 'normal', selectedSubtitleIndex],
        queryFn: () => api.getVideoSubtitleText(videoFileId, selectedSubtitleIndex!),
        enabled: normalSubtitleEnabled && (subtitleTextPreview.isSuccess || subtitleTextPreview.isError),
        staleTime: Number.POSITIVE_INFINITY,
    });
    const danmakuSubtitleEnabled = validIds && !streaming && settings.watchPlaySubtitleDanmaku && selectedDanmakuSubtitleIndex !== null;
    const danmakuSubtitleTextPreview = useQuery({
        queryKey: ['video-subtitle-text-preview', videoFileId, 'danmaku', selectedDanmakuSubtitleIndex, subtitlePreviewStartAt],
        queryFn: () =>
            api.getVideoSubtitleText(videoFileId, selectedDanmakuSubtitleIndex!, {
                startAt: subtitlePreviewStartAt,
                duration: PLAY_SUBTITLE_PREVIEW_DURATION,
            }),
        enabled: danmakuSubtitleEnabled,
        retry: false,
        staleTime: Number.POSITIVE_INFINITY,
    });
    const danmakuSubtitleText = useQuery({
        queryKey: ['video-subtitle-text', videoFileId, 'danmaku', selectedDanmakuSubtitleIndex],
        queryFn: () => api.getVideoSubtitleText(videoFileId, selectedDanmakuSubtitleIndex!),
        enabled: danmakuSubtitleEnabled && (danmakuSubtitleTextPreview.isSuccess || danmakuSubtitleTextPreview.isError),
        staleTime: Number.POSITIVE_INFINITY,
    });
    const ruleId = recorded.data?.ruleId;
    const relatedSearch = recorded.data === undefined ? undefined : createRecordedRelatedSearchOption(recorded.data);
    const rule = useQuery({ queryKey: ['rule', ruleId], queryFn: () => api.getRule(ruleId!), enabled: ruleId !== undefined });
    const ruleRecords = useQuery({
        queryKey: ['recorded-related-search', relatedSearch?.ruleId, relatedSearch?.keyword, settings.isHalfWidthDisplayed],
        queryFn: () => api.getRecorded({ isHalfWidth: settings.isHalfWidthDisplayed, ...relatedSearch, offset: 0, limit: 100, isReverse: true }),
        enabled: relatedSearch !== undefined,
    });
    const item = recorded.data;
    const selectedVideo = item?.videoFiles?.find(video => video.id === videoFileId);
    const streamingUsesJikkyo = streaming && selectedVideo?.type === 'ts';

    const receiveComment = useCallback((comment: JikkyoComment): void => {
        commentBuffer.current = [...commentBuffer.current.slice(-499), comment];
        if (!commentsVisible.current || commentFlushTimer.current !== null) return;
        commentFlushTimer.current = window.setTimeout(() => {
            commentFlushTimer.current = null;
            setComments([...commentBuffer.current]);
        }, 100);
    }, []);
    const resetComments = useCallback((): void => {
        commentBuffer.current = [];
        if (commentFlushTimer.current !== null) window.clearTimeout(commentFlushTimer.current);
        commentFlushTimer.current = null;
        setComments([]);
    }, []);
    const updateCommentStatus = useCallback((detail: string): void => setCommentStatus(detail), []);
    const updateControlsVisibility = useCallback((visible: boolean): void => setOverlayVisible(visible), []);
    const updatePlayerVideo = useCallback((video: HTMLVideoElement | null): void => {
        playerVideo.current = video;
        setProgressVideo(video);
    }, []);

    const attemptAutoWatch = useCallback(async (): Promise<void> => {
        const info = annictEpisodeRef.current;
        if (
            settingsRef.current.annictAutoWatchMode === 'disabled' ||
            info?.state !== 'matched' ||
            info.watched ||
            !info.writeConfigured ||
            autoWatchInFlight.current ||
            Date.now() - autoWatchLastAttemptAt.current < 60_000
        ) {
            return;
        }
        autoWatchInFlight.current = true;
        autoWatchLastAttemptAt.current = Date.now();
        try {
            const result = await api.markRecordedAnnictEpisodeWatched(recordedId, {
                markWorkWatchedOnFinalEpisode: settingsRef.current.annictMarkWatchedOnFinalEpisode,
                disableRulesOnFinalEpisode: settingsRef.current.annictMarkWatchedOnFinalEpisode && settingsRef.current.annictDisableRulesOnFinalEpisode,
            });
            annictEpisodeRef.current = result;
            queryClient.setQueryData(['recorded-annict-episode', recordedId, viewerProfile.profileId], result);
            autoWatchFailureNotified.current = false;
            if (autoWatchRetryTimer.current !== null) {
                window.clearTimeout(autoWatchRetryTimer.current);
                autoWatchRetryTimer.current = null;
            }
            notify('Annictへ「見た」を自動記録しました。', 'success');
        } catch (error) {
            if (!autoWatchFailureNotified.current) {
                autoWatchFailureNotified.current = true;
                notify(`Annictへ自動記録できませんでした。再生は継続します: ${error instanceof Error ? error.message : String(error)}`, 'warning');
            }
            if (autoWatchRetryTimer.current === null) {
                autoWatchRetryTimer.current = window.setTimeout(() => {
                    autoWatchRetryTimer.current = null;
                    autoWatchLastAttemptAt.current = 0;
                    void attemptAutoWatchRef.current();
                }, 60_000);
            }
        } finally {
            autoWatchInFlight.current = false;
        }
    }, [notify, queryClient, recordedId, viewerProfile.profileId]);
    attemptAutoWatchRef.current = attemptAutoWatch;

    useEffect(() => {
        autoWatchLastAttemptAt.current = 0;
        autoWatchInFlight.current = false;
        autoWatchFailureNotified.current = false;
        playbackStarted.current = false;
        if (autoWatchRetryTimer.current !== null) {
            window.clearTimeout(autoWatchRetryTimer.current);
            autoWatchRetryTimer.current = null;
        }
    }, [recordedId, viewerProfile.profileId]);
    useEffect(
        () => () => {
            if (autoWatchRetryTimer.current !== null) window.clearTimeout(autoWatchRetryTimer.current);
        },
        [],
    );

    useEffect(() => {
        if (playbackStarted.current && settings.annictAutoWatchMode === 'start' && annictEpisode.data?.state === 'matched') {
            void attemptAutoWatch();
        }
    }, [annictEpisode.data, attemptAutoWatch, settings.annictAutoWatchMode]);

    useEffect(() => {
        if (progressVideo === null || playbackUserId === null) return;
        let pending: RecordedPlaybackSample | null = null;
        let sending = false;
        let retryTimer: number | null = null;
        let disposed = false;

        const drain = async (): Promise<void> => {
            if (sending || pending === null) return;
            sending = true;
            while (pending !== null) {
                const latest: RecordedPlaybackSample = pending;
                const delta = Math.min(latest.watchedSecondsDelta, 30);
                pending = latest.watchedSecondsDelta > delta ? { ...latest, watchedSecondsDelta: latest.watchedSecondsDelta - delta } : null;
                try {
                    const result = await api.updateRecordedPlayback(
                        recordedId,
                        {
                            position: latest.position,
                            duration: latest.duration,
                            watchedSecondsDelta: delta,
                            observedAt: latest.observedAt,
                            historyLimit: settingsRef.current.watchHistoryLength,
                        },
                        playbackUserId,
                    );
                    if (
                        settingsRef.current.annictAutoWatchMode === 'progress' &&
                        result.duration > 0 &&
                        (result.watchedSeconds / result.duration) * 100 >= settingsRef.current.annictAutoWatchThresholdPercent
                    ) {
                        void attemptAutoWatch();
                    }
                } catch (error) {
                    const newer = pending;
                    pending =
                        newer === null
                            ? { ...latest, watchedSecondsDelta: delta }
                            : {
                                  ...newer,
                                  watchedSecondsDelta: newer.watchedSecondsDelta + delta,
                              };
                    console.warn('[RecordedWatch:playback-progress]', error);
                    if (!disposed && retryTimer === null) {
                        retryTimer = window.setTimeout(() => {
                            retryTimer = null;
                            void drain();
                        }, 15_000);
                    }
                    break;
                }
            }
            sending = false;
        };
        const queue = (sample: RecordedPlaybackSample): void => {
            pending =
                pending === null
                    ? sample
                    : {
                          ...sample,
                          watchedSecondsDelta: pending.watchedSecondsDelta + sample.watchedSecondsDelta,
                      };
            void drain();
        };
        const tracker = new RecordedPlaybackTracker({
            video: progressVideo,
            onStart: () => {
                playbackStarted.current = true;
                if (settingsRef.current.annictAutoWatchMode === 'start') void attemptAutoWatch();
            },
            onProgress: queue,
        });
        return () => {
            tracker.destroy();
            disposed = true;
            if (retryTimer !== null) window.clearTimeout(retryTimer);
        };
    }, [attemptAutoWatch, playbackUserId, progressVideo, recordedId]);

    useEffect(() => {
        setSelectedSubtitleIndex(null);
        setSelectedDanmakuSubtitleIndex(null);
    }, [videoFileId]);
    useEffect(() => {
        setResumePosition(null);
        setResumePlaying(true);
    }, [activeUser, recordedId, streaming, videoFileId]);
    useEffect(() => {
        if (streaming || subtitles.data === undefined) return;
        if (!settings.watchPlaySubtitleDanmaku) {
            setSelectedSubtitleIndex(preferredSubtitleIndex(subtitles.data.items, settings.watchSubtitlePreferredKeywords));
            setSelectedDanmakuSubtitleIndex(null);
            return;
        }

        const normalSubtitles = subtitles.data.items.filter(subtitle => !isDanmakuSubtitle(subtitle));
        const danmakuSubtitles = subtitles.data.items.filter(subtitle => isDanmakuSubtitle(subtitle));
        const preferredDanmaku = preferredSubtitleIndex(danmakuSubtitles, settings.watchSubtitlePreferredKeywords);
        const preferredNormal = preferredSubtitleIndex(normalSubtitles, settings.watchSubtitlePreferredKeywords);
        setSelectedDanmakuSubtitleIndex(preferredDanmaku ?? danmakuSubtitles[0]?.subtitleIndex ?? null);
        // When the priority keyword only matches the danmaku track, do not
        // accidentally reuse that track as an ordinary subtitle.
        setSelectedSubtitleIndex(preferredNormal);
    }, [settings.watchPlaySubtitleDanmaku, settings.watchSubtitlePreferredKeywords, streaming, subtitles.data]);
    useEffect(() => {
        resetComments();
        setCommentStatus(
            !streaming
                ? settings.watchPlaySubtitleDanmaku
                    ? 'PLAY字幕を選択すると、danmakuで表示した内容をここにも表示します。'
                    : 'ASS実況字幕を選択すると、再生中のコメントをここにも表示します。'
                : streamingUsesJikkyo
                  ? 'TS録画の実況過去ログを取得しています…'
                  : selectedVideo?.type === 'encoded'
                    ? 'エンコード済みSTREAMINGでは、選択した字幕を映像へ焼き込んで再生します。'
                    : '録画ファイル情報を確認しています…',
        );
    }, [recordedId, resetComments, selectedVideo?.type, settings.watchPlaySubtitleDanmaku, streaming, streamingUsesJikkyo, videoFileId]);
    useEffect(() => {
        if (!streaming) {
            resetComments();
            setCommentStatus(
                settings.watchPlaySubtitleDanmaku
                    ? selectedDanmakuSubtitleIndex === null
                        ? '弾幕字幕を選択すると、danmakuで表示します。'
                        : '選択中の字幕をdanmakuで再生しています…'
                    : selectedSubtitleIndex === null
                      ? 'ASS字幕を選択すると、再生中のコメントをここにも表示します。'
                      : isNicoJkSubtitle(selectedSubtitle)
                        ? 'ASS実況コメントを再生しています…'
                        : '選択中のASS字幕は実況コメントではありません。',
            );
        }
    }, [resetComments, selectedDanmakuSubtitleIndex, selectedSubtitle, selectedSubtitleIndex, settings.watchPlaySubtitleDanmaku, streaming]);
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
        if (panelTab === 'comments' && commentList.current !== null) commentList.current.scrollTop = commentList.current.scrollHeight;
    }, [comments, panelTab]);
    const channel = channels.data?.find(value => value.id === item?.channelId);
    const source = useMemo<PlayerSource | null>(() => {
        if (!valid) return null;
        if (!streaming) return { src: getRecordedVideoPlayURL(videoFileId), type: 'normal', enableAribSubtitle: false };
        if (selectedVideo === undefined) return null;
        const vodSessionId = createVodSessionId();
        return {
            src: getRecordedStreamURL(
                videoFileId,
                streamType,
                mode,
                quality,
                settings,
                streamSubtitleIndex,
                streamSubtitleFileKey,
                resumePosition ?? storedResumePosition ?? 0,
                vodSessionId,
            ),
            type: 'hls',
            enableAribSubtitle: selectedVideo.type === 'ts' && streamType === 'HLS-TS',
            commentsUrl: selectedVideo.type === 'ts' ? withBasePath(`/api/recorded/${recordedId.toString(10)}/jikkyo?videoFileId=${selectedVideo.id.toString(10)}`) : undefined,
            vodSessionId,
        };
    }, [
        mode,
        quality,
        recordedId,
        resumePosition,
        selectedVideo,
        settings,
        storedResumePosition,
        streamSubtitleFileKey,
        streamSubtitleIndex,
        streamType,
        streaming,
        valid,
        videoFileId,
    ]);

    const changeStreamingSubtitle = async (index: number | null): Promise<void> => {
        if (!streaming || selectedVideo?.type !== 'encoded' || preparingSubtitleIndex !== null || streamSubtitleIndex === index) return;
        const video = playerVideo.current;
        const nextPosition = video?.currentTime ?? 0;
        const shouldResume = video !== null && !video.paused;
        setPreparingSubtitleIndex(index ?? 'none');
        try {
            const prepared = index === null ? undefined : await api.prepareVideoSubtitle(videoFileId, index);
            const next = new URLSearchParams(params);
            next.set('subtitleIndex', index === null ? '-1' : index.toString(10));
            if (prepared === undefined) next.delete('subtitleFileKey');
            else next.set('subtitleFileKey', prepared.subtitleFileKey);
            setResumePosition(nextPosition);
            setResumePlaying(shouldResume);
            setParams(next, { replace: true });
        } catch (error) {
            notify(`字幕の切り替えに失敗しました: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            setPreparingSubtitleIndex(null);
        }
    };

    const panelContent = (): ReactNode => {
        if (item === undefined) return <CircularProgress sx={{ m: 3 }} />;
        if (panelTab === 'program') return <ProgramPanel item={item} channel={channel} />;
        if (panelTab === 'rules') {
            return (
                <RulePanel
                    rule={rule.data}
                    searchKeyword={relatedSearch?.keyword}
                    records={ruleRecords.data?.records ?? []}
                    currentId={item.id}
                    onSelect={id => void navigate(`/recorded/detail/${id.toString(10)}`)}
                />
            );
        }
        if (panelTab === 'comments') {
            return streaming && !streamingUsesJikkyo ? (
                <SubtitlePanel
                    subtitles={subtitles.data?.items ?? []}
                    selectedIndex={streamSubtitleIndex}
                    preparingIndex={preparingSubtitleIndex}
                    enabled={selectedVideo?.type === 'encoded'}
                    onSelect={index => void changeStreamingSubtitle(index)}
                />
            ) : (
                <CommentPanel comments={comments} status={commentStatus} listRef={commentList} />
            );
        }
        return <TwitterPanel programTitle={item.name} channelName={channel?.name} videoSelector=".recorded-dplayer video" />;
    };

    return (
        <Box sx={{ minHeight: '100dvh', height: { lg: '100dvh' }, overflow: { lg: 'hidden' }, bgcolor: 'background.default', color: '#fff' }}>
            {!valid ? (
                <Alert severity="error" sx={{ m: 2 }}>
                    再生パラメーターが正しくありません。録画詳細から再生方法を選び直してください。
                </Alert>
            ) : recorded.isPending || (playbackUserId !== null && playback.isPending) ? (
                <Stack spacing={1.5} sx={{ minHeight: '100dvh', alignItems: 'center', justifyContent: 'center' }}>
                    <CircularProgress />
                    <Typography color="text.secondary">録画ファイル情報を取得しています…</Typography>
                </Stack>
            ) : recorded.error !== null ? (
                <Alert severity="error" sx={{ m: 2 }}>
                    録画情報を取得できません: {recorded.error.message}
                </Alert>
            ) : source === null ? (
                <Alert severity="error" sx={{ m: 2 }}>
                    指定された録画ファイルが見つかりません。録画詳細から再生方法を選び直してください。
                </Alert>
            ) : (
                <Box
                    sx={{
                        minHeight: '100dvh',
                        height: { lg: '100dvh' },
                        display: 'grid',
                        gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: panelOpen || panelMounted ? 'minmax(0, 1fr) 380px' : 'minmax(0, 1fr) 0px' },
                        gridTemplateRows: { xs: 'auto auto', lg: 'minmax(0, 1fr)' },
                        overflow: { lg: 'hidden' },
                    }}
                >
                    <Box component="section" sx={{ minWidth: 0, minHeight: 0, height: { lg: '100dvh' }, overflow: 'hidden', bgcolor: 'background.default' }}>
                        <RecordedPlayer
                            source={source}
                            subtitleText={!streaming ? (subtitleText.data?.subtitleText ?? subtitleTextPreview.data?.subtitleText ?? null) : null}
                            subtitleIsNicoJk={!streaming && !settings.watchPlaySubtitleDanmaku && isNicoJkSubtitle(selectedSubtitle)}
                            danmakuSubtitleText={!streaming ? (danmakuSubtitleText.data?.subtitleText ?? danmakuSubtitleTextPreview.data?.subtitleText ?? null) : null}
                            subtitleDanmaku={!streaming && settings.watchPlaySubtitleDanmaku}
                            forceSubtitleStroke={settings.isForceEnableSubtitleStroke}
                            danmakuHighRefreshRate={settings.watchDanmakuHighRefreshRate}
                            danmakuFrameRateLimit={settings.watchDanmakuFrameRateLimit}
                            webkitPlaybackMode={settings.webkitPlaybackMode}
                            persistentBottomControls={settings.watchPersistentBottomControls}
                            showVolumePercent={settings.watchShowVolumePercent}
                            volumeBoostEnabled={settings.watchVolumeBoostEnabled}
                            volumeBoostMaxPercent={settings.watchVolumeBoostMaxPercent}
                            onComment={receiveComment}
                            onCommentsReset={resetComments}
                            onCommentStatus={updateCommentStatus}
                            onControlsVisibilityChange={updateControlsVisibility}
                            onVideoReady={updatePlayerVideo}
                            startPosition={resumePosition ?? storedResumePosition}
                            resumePlaying={resumePlaying}
                            sessionIdentity={`${String(activeUser ?? 'none')}:${viewerProfile.profileId?.toString(10) ?? 'none'}:${viewerProfile.sessionToken ?? 'locked'}`}
                        >
                            <Box
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
                                <Tooltip title="録画詳細へ戻る">
                                    <IconButton color="inherit" onClick={goBack} aria-label="録画詳細へ戻る">
                                        <ArrowBackOutlined />
                                    </IconButton>
                                </Tooltip>
                                {channel?.hasLogoData === true && (
                                    <Box
                                        component="img"
                                        src={withBasePath(`/api/channels/${channel.id}/logo`)}
                                        alt=""
                                        sx={{ width: { xs: 38, sm: 50 }, height: 30, objectFit: 'contain', mx: 0.35 }}
                                    />
                                )}
                                <Box sx={{ minWidth: 0, flex: 1 }}>
                                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,.68)', fontWeight: 700, display: 'block' }} noWrap>
                                        {channel?.name ?? '録画再生'}
                                    </Typography>
                                    <Typography sx={{ fontSize: { xs: '0.82rem', sm: '1rem' }, fontWeight: 800 }} noWrap>
                                        {item?.name ?? '録画情報を取得中...'}
                                    </Typography>
                                </Box>
                                {!streaming && (selectableSubtitleItems.length > 0 || (settings.watchPlaySubtitleDanmaku && danmakuSubtitleItems.length > 0)) && (
                                    <Stack direction="column" spacing={0.15} sx={{ width: { xs: 112, sm: 170 }, flex: '0 0 auto' }}>
                                        {settings.watchPlaySubtitleDanmaku && danmakuSubtitleItems.length > 0 && (
                                            <FormControl variant="filled" size="small" sx={{ bgcolor: 'rgba(0,0,0,.38)', borderRadius: 1 }}>
                                                <InputLabel sx={{ color: 'rgba(255,255,255,.72)' }}>弾幕</InputLabel>
                                                <Select
                                                    value={
                                                        selectedDanmakuSubtitleIndex !== null &&
                                                        danmakuSubtitleItems.some(subtitle => subtitle.subtitleIndex === selectedDanmakuSubtitleIndex)
                                                            ? selectedDanmakuSubtitleIndex
                                                            : 'none'
                                                    }
                                                    onChange={event => setSelectedDanmakuSubtitleIndex(event.target.value === 'none' ? null : Number(event.target.value))}
                                                    sx={{ color: '#fff' }}
                                                >
                                                    <MenuItem value="none">弾幕なし</MenuItem>
                                                    {danmakuSubtitleItems.map(subtitle => (
                                                        <MenuItem key={subtitle.subtitleIndex} value={subtitle.subtitleIndex}>
                                                            {subtitle.displayName}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        )}
                                        {selectableSubtitleItems.length > 0 && (
                                            <FormControl variant="filled" size="small" sx={{ bgcolor: 'rgba(0,0,0,.38)', borderRadius: 1 }}>
                                                <InputLabel sx={{ color: 'rgba(255,255,255,.72)' }}>字幕</InputLabel>
                                                <Select
                                                    value={
                                                        selectedSubtitleIndex !== null && selectableSubtitleItems.some(subtitle => subtitle.subtitleIndex === selectedSubtitleIndex)
                                                            ? selectedSubtitleIndex
                                                            : 'none'
                                                    }
                                                    onChange={event => setSelectedSubtitleIndex(event.target.value === 'none' ? null : Number(event.target.value))}
                                                    sx={{ color: '#fff' }}
                                                >
                                                    <MenuItem value="none">字幕なし</MenuItem>
                                                    {selectableSubtitleItems.map(subtitle => (
                                                        <MenuItem key={subtitle.subtitleIndex} value={subtitle.subtitleIndex}>
                                                            {subtitle.displayName}
                                                        </MenuItem>
                                                    ))}
                                                </Select>
                                            </FormControl>
                                        )}
                                    </Stack>
                                )}
                                <Tooltip title={panelOpen ? '情報欄を閉じる' : '情報欄を開く'}>
                                    <IconButton color={panelOpen ? 'primary' : 'inherit'} onClick={() => setPanelOpen(value => !value)} aria-label="情報欄">
                                        <InfoOutlined />
                                    </IconButton>
                                </Tooltip>
                            </Box>
                        </RecordedPlayer>
                    </Box>
                    <Box
                        component="aside"
                        aria-hidden={!panelOpen}
                        sx={{
                            minHeight: 0,
                            minWidth: 0,
                            height: { xs: panelOpen ? '72dvh' : 0, lg: '100dvh' },
                            display: 'flex',
                            flexDirection: 'column',
                            color: 'text.primary',
                            bgcolor: 'background.paper',
                            borderLeft: { lg: panelOpen || panelMounted ? 1 : 0 },
                            borderTop: { xs: panelOpen || panelMounted ? 1 : 0, lg: 0 },
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
                        {(panelOpen || panelMounted) && (
                            <>
                                <Box sx={{ minHeight: 0, flex: 1, overflowY: panelTab === 'comments' ? 'hidden' : 'auto' }}>{panelContent()}</Box>
                                <BottomNavigation
                                    showLabels
                                    value={panelTab}
                                    onChange={(_event, value: PanelTab) => setPanelTab(value)}
                                    sx={{ flex: '0 0 auto', height: 72, borderTop: 1, borderColor: 'divider', bgcolor: 'background.paper' }}
                                >
                                    <BottomNavigationAction value="program" label="番組情報" icon={<InfoOutlined />} />
                                    <BottomNavigationAction value="rules" label="ルール" icon={<RuleOutlined />} />
                                    <BottomNavigationAction
                                        value="comments"
                                        label={streaming && !streamingUsesJikkyo ? '字幕' : 'コメント'}
                                        icon={streaming && !streamingUsesJikkyo ? <SubtitlesOutlined /> : <ChatBubbleOutlineOutlined />}
                                    />
                                    <BottomNavigationAction value="twitter" label="Twitter" icon={<Twitter />} />
                                </BottomNavigation>
                            </>
                        )}
                    </Box>
                </Box>
            )}
        </Box>
    );
}
