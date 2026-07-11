import CloudOffOutlined from '@mui/icons-material/CloudOffOutlined';
import { Box, CircularProgress, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { lazy, Suspense, type ReactNode, useCallback, useEffect, useState } from 'react';
import { createHashRouter, RouterProvider } from 'react-router-dom';
import { AppLayout } from './components/AppLayout';
import { api } from './core/api/queries';
import { SocketBridge } from './core/socket/SocketBridge';
import { useSettings } from './core/storage/settings';
import { withBasePath } from './core/path';
import { MigrationPlaceholderPage } from './pages/MigrationPlaceholderPage';

const DashboardPage = lazy(() => import('./pages/DashboardPage').then(module => ({ default: module.DashboardPage })));
const SettingsPage = lazy(() => import('./pages/SettingsPage').then(module => ({ default: module.SettingsPage })));

function Bootstrap(): ReactNode {
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const version = useQuery({ queryKey: ['version'], queryFn: api.getVersion, staleTime: 60_000 });
    const settings = useSettings();
    const [connected, setConnected] = useState(true);
    const onConnectionChange = useCallback((value: boolean) => setConnected(value), []);

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

    if (config.isPending || version.isPending) {
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
                        EPGStationへ接続できません
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
            <AppLayout version={version.data.version} />
        </>
    );
}

const router = createHashRouter([
    {
        element: <Bootstrap />,
        children: [
            { index: true, element: <DashboardPage /> },
            { path: 'settings', element: <SettingsPage /> },
            { path: 'onair', element: <MigrationPlaceholderPage title="放映中" /> },
            { path: 'guide', element: <MigrationPlaceholderPage title="番組表" /> },
            { path: 'recording', element: <MigrationPlaceholderPage title="録画中" /> },
            { path: 'recorded', element: <MigrationPlaceholderPage title="録画済み" /> },
            { path: 'recorded/detail/:id', element: <MigrationPlaceholderPage title="録画詳細" /> },
            { path: 'encode', element: <MigrationPlaceholderPage title="エンコード" /> },
            { path: 'reserves', element: <MigrationPlaceholderPage title="予約" /> },
            { path: 'search', element: <MigrationPlaceholderPage title="検索" /> },
            { path: 'rule', element: <MigrationPlaceholderPage title="ルール" /> },
            { path: 'storages', element: <MigrationPlaceholderPage title="ストレージ" /> },
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
