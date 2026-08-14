import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode, useCallback, useEffect, useState } from 'react';
import { createHashRouter, Navigate, RouterProvider, useLocation, useParams } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { ViewerProfileUnlockDialog } from './components/ViewerProfileUnlockDialog';
import { api } from './core/api/queries';
import { applyAppIconSet } from './core/icons/appIcons';
import { SocketBridge } from './core/socket/SocketBridge';
import { activeUserStore, useActiveUser } from './core/storage/activeUser';
import { useSettings } from './core/storage/settings';
import { useViewerProfile, viewerProfileStore } from './core/storage/viewerProfile';
import { withBasePath } from './core/path';
import { MigrationPlaceholderPage } from './pages/MigrationPlaceholderPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));
const SearchPage = lazy(() => import('./pages/SearchPage').then(module => ({ default: module.SearchPage })));
const ReservesPage = lazy(() => import('./pages/ReservesPage').then(module => ({ default: module.ReservesPage })));
const ManualReservePage = lazy(() => import('./pages/ManualReservePage').then(module => ({ default: module.ManualReservePage })));
const RulesPage = lazy(() => import('./pages/RulesPage').then(module => ({ default: module.RulesPage })));
const WatchHistoryPage = lazy(() => import('./pages/WatchHistoryPage').then(module => ({ default: module.WatchHistoryPage })));
const RecordingPage = lazy(() => import('./pages/RecordingPage').then(module => ({ default: module.RecordingPage })));
const EncodePage = lazy(() => import('./pages/EncodePage').then(module => ({ default: module.EncodePage })));
const StoragesPage = lazy(() => import('./pages/StoragesPage').then(module => ({ default: module.StoragesPage })));
const GuidePage = lazy(() => import('./pages/GuidePage').then(module => ({ default: module.GuidePage })));
const AnimePage = lazy(() => import('./pages/AnimePage').then(module => ({ default: module.AnimePage })));
const AnimeDetailPage = lazy(() => import('./pages/AnimePage').then(module => ({ default: module.AnimeDetailPage })));
const GuideSizeSettingPage = lazy(() => import('./pages/GuideSizeSettingPage').then(module => ({ default: module.GuideSizeSettingPage })));
const RecordedPage = lazy(() => import('./pages/RecordedPage').then(module => ({ default: module.RecordedPage })));
const RecordedDetailPage = lazy(() => import('./pages/RecordedDetailPage').then(module => ({ default: module.RecordedDetailPage })));
const RecordedSubtitleTransferPage = lazy(() => import('./pages/RecordedSubtitleTransferPage').then(module => ({ default: module.RecordedSubtitleTransferPage })));
const RecordedUploadPage = lazy(() => import('./pages/RecordedUploadPage').then(module => ({ default: module.RecordedUploadPage })));
const RecordedWatchPage = lazy(() => import('./pages/RecordedWatchPage').then(module => ({ default: module.RecordedWatchPage })));
const OnAirPage = lazy(() => import('./pages/OnAirPage').then(module => ({ default: module.OnAirPage })));
const OnAirWatchPage = lazy(() => import('./pages/OnAirWatchPage').then(module => ({ default: module.OnAirWatchPage })));

function LegacyRecordedStreamingRedirect(): ReactNode {
    const { id } = useParams();
    const location = useLocation();
    const params = new URLSearchParams(location.search);
    const legacyStreamingType = params.get('streamingType');

    if (id !== undefined) params.set('videoId', id);
    if (legacyStreamingType !== null) params.set('type', legacyStreamingType);
    params.delete('streamingType');
    params.delete('videoFileType');

    return <Navigate to={`/recorded/streaming?${params.toString()}`} replace />;
}

function Bootstrap(): ReactNode {
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const version = useQuery({ queryKey: ['version'], queryFn: api.getVersion, staleTime: 60_000 });
    const viewerProfiles = useQuery({ queryKey: ['viewer-profiles'], queryFn: api.getViewerProfiles, staleTime: 60_000 });
    const activeUser = useActiveUser();
    const activeViewerProfile = useViewerProfile();
    const shouldValidateViewerSession = typeof activeUser === 'number' && activeViewerProfile.profileId !== null;
    const viewerSession = useQuery({
        queryKey: ['viewer-profile-session', activeViewerProfile.profileId, activeViewerProfile.sessionToken],
        queryFn: () => api.validateViewerProfileSession(activeViewerProfile.profileId as number),
        enabled: shouldValidateViewerSession,
        retry: false,
        staleTime: 30_000,
    });
    const settings = useSettings();
    const [connected, setConnected] = useState(false);
    const onConnectionChange = useCallback((value: boolean) => setConnected(value), []);

    useEffect(() => {
        if (viewerProfiles.data !== undefined) viewerProfileStore.syncProfiles(viewerProfiles.data.profiles);
    }, [viewerProfiles.data]);

    useEffect(() => {
        if (shouldValidateViewerSession && viewerSession.data === false) {
            viewerProfileStore.lock(activeViewerProfile.profileId as number);
            activeUserStore.save('master');
        }
    }, [activeViewerProfile.profileId, shouldValidateViewerSession, viewerSession.data]);

    useEffect(() => {
        applyAppIconSet(settings.appIconSet);
    }, [settings.appIconSet]);

    useEffect(() => {
        if (!('serviceWorker' in navigator)) {
            return;
        }
        if (settings.isEnablePWA) {
            void navigator.serviceWorker.register(withBasePath('/serviceWorker.js'));
        } else {
            void navigator.serviceWorker.getRegistrations().then(registrations => {
                registrations.forEach(registration => void registration.unregister());
            });
        }
    }, [settings.isEnablePWA]);

    if (config.isPending || version.isPending || (shouldValidateViewerSession && (viewerSession.isPending || viewerSession.data === false))) {
        return (
            <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }
    if (config.error !== null || version.error !== null) {
        const error = config.error ?? version.error;
        return (
            <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center', p: 3, textAlign: 'center' }}>
                <Box>
                    <Typography variant="h5" gutterBottom>
                        NeoEPGStationへ接続できません
                    </Typography>
                    <Typography color="error">{error?.message}</Typography>
                </Box>
            </Box>
        );
    }

    return (
        <>
            <SocketBridge socketIOPort={config.data.socketIOPort} onConnectionChange={onConnectionChange} />
            {!connected && (
                <Box
                    sx={{
                        position: 'fixed',
                        inset: 0,
                        zIndex: theme => theme.zIndex.modal + 10,
                        bgcolor: 'rgba(0, 0, 0, 0.68)',
                        display: 'grid',
                        placeItems: 'center',
                        color: '#fff',
                    }}
                >
                    <Box sx={{ textAlign: 'center' }}>
                        <CloudOffOutlined sx={{ fontSize: 52 }} />
                        <Typography variant="h6">サーバーとの接続が切断されました</Typography>
                        <Typography variant="body2">再接続を待っています</Typography>
                    </Box>
                </Box>
            )}
            <ViewerProfileUnlockDialog loaded={viewerProfiles.isSuccess} profiles={viewerProfiles.data?.profiles ?? []} />
            <AppLayout />
        </>
    );
}

const router = createHashRouter([
    {
        element: <Bootstrap />,
        children: [
            { index: true, element: <DashboardPage /> },
            { path: 'settings', element: <SettingsPage /> },
            { path: 'onair', element: <OnAirPage /> },
            { path: 'onair/watch', element: <OnAirWatchPage /> },
            { path: 'guide', element: <GuidePage /> },
            { path: 'guide/setting', element: <GuideSizeSettingPage /> },
            { path: 'anime', element: <AnimePage /> },
            { path: 'anime/:annictId', element: <AnimeDetailPage /> },
            { path: 'recording', element: <RecordingPage /> },
            { path: 'recorded', element: <RecordedPage /> },
            { path: 'recorded/detail/:id', element: <RecordedDetailPage /> },
            { path: 'recorded/subtitle/:id', element: <RecordedSubtitleTransferPage /> },
            { path: 'recorded/upload', element: <RecordedUploadPage /> },
            { path: 'recorded/watch', element: <RecordedWatchPage /> },
            { path: 'recorded/streaming', element: <RecordedWatchPage /> },
            { path: 'recorded/streaming/:id', element: <LegacyRecordedStreamingRedirect /> },
            { path: 'encode', element: <EncodePage /> },
            { path: 'reserves', element: <ReservesPage /> },
            { path: 'reserves/manual', element: <ManualReservePage /> },
            { path: 'search', element: <SearchPage /> },
            { path: 'rule', element: <RulesPage /> },
            { path: 'history', element: <WatchHistoryPage /> },
            { path: 'system', element: <StoragesPage /> },
            { path: 'storages', element: <Navigate to="/system" replace /> },
            { path: '*', element: <MigrationPlaceholderPage title="未実装" /> },
        ],
    },
]);

export function App(): ReactNode {
    return (
        <Suspense
            fallback={
                <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            }
        >
            <RouterProvider router={router} />
        </Suspense>
    );
}
