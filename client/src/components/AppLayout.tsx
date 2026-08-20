import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import DnsOutlined from '@mui/icons-material/DnsOutlined';
import HistoryOutlined from '@mui/icons-material/HistoryOutlined';
import LiveTvOutlined from '@mui/icons-material/LiveTvOutlined';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import PendingActionsOutlined from '@mui/icons-material/PendingActionsOutlined';
import RadioButtonCheckedOutlined from '@mui/icons-material/RadioButtonCheckedOutlined';
import RadioButtonUncheckedOutlined from '@mui/icons-material/RadioButtonUncheckedOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import TvOutlined from '@mui/icons-material/TvOutlined';
import { Box, CircularProgress, Divider, Drawer, Fade, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ChannelType } from '../../../api';
import { createContext, Suspense, type ReactNode, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { Outlet, useLocation, useNavigate, useNavigationType } from 'react-router-dom';
import { api } from '../core/api/queries';
import { appIconAssetUrl, getAppIconSet } from '../core/icons/appIcons';
import { sideNavigationLabels, type SideNavigationItemId } from '../core/navigation';
import { channelTypeLabel } from '../core/program';
import { loadAppScrollPosition, rememberAppScrollPosition } from '../core/scrollRestoration';
import { loadAnimeReturnPosition } from '../core/storage/anime';
import { useSettings } from '../core/storage/settings';
import { AlphaAIcon } from './icons/AlphaAIcon';

const drawerWidth = 240;
const SCROLL_RESTORE_TIMEOUT_MS = 10_000;
interface NavigationItem {
    label: string;
    path: string;
    icon: ReactNode;
    count?: number;
}

interface SideNavigationState {
    resetPage: 'search';
}

interface AppLayoutContextValue {
    toggleDrawer: () => void;
}

const AppLayoutContext = createContext<AppLayoutContextValue | null>(null);

export function useAppLayout(): AppLayoutContextValue {
    const value = useContext(AppLayoutContext);
    if (value === null) throw new Error('AppLayoutContext is missing');
    return value;
}

export function AppLayout(): ReactNode {
    const settings = useSettings();
    const appIcon = getAppIconSet(settings.appIconSet);
    const logoIcon = settings.isAppLogoLinkedToIcon ? appIcon.original : 'nyanz-smile.png';
    const theme = useTheme();
    const desktop = useMediaQuery(theme.breakpoints.up('lg'));
    const [desktopOpen, setDesktopOpen] = useState(true);
    const [mobileOpen, setMobileOpen] = useState(false);
    const theaterSavedDesktopOpen = useRef<boolean | null>(null);
    const location = useLocation();
    const navigationType = useNavigationType();
    const navigate = useNavigate();
    const theaterMode = location.pathname.startsWith('/onair/watch') || location.pathname.startsWith('/recorded/watch') || location.pathname.startsWith('/recorded/streaming');
    const recordingStatus = useQuery({
        queryKey: ['recording', 'navigation-status'],
        queryFn: () => api.getRecording({ isHalfWidth: false, offset: 0, limit: 1 }),
        staleTime: 30_000,
    });
    const reserveCounts = useQuery({
        queryKey: ['reserve-counts'],
        queryFn: api.getReserveCounts,
        staleTime: 30_000,
    });
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const hasRecording = (recordingStatus.data?.total ?? 0) > 0;
    const conflictCount = reserveCounts.data?.conflicts ?? 0;
    const overlapCount = reserveCounts.data?.overlaps ?? 0;
    const navigation = useMemo<NavigationItem[]>(() => {
        const reserveNavigation: NavigationItem[] = [{ label: '予約', path: '/reserves?type=normal', icon: <ScheduleOutlined /> }];
        const guideNavigation: NavigationItem[] =
            settings.isEnableDisplayForEachBroadcastWave && config.data !== undefined
                ? Object.entries(config.data.broadcast)
                      .filter(([, enabled]) => enabled)
                      .map(([type]) => ({
                          label: `番組表${channelTypeLabel(type as ChannelType)}`,
                          path: `/guide?type=${encodeURIComponent(type)}`,
                          icon: <TvOutlined />,
                      }))
                : [{ label: '番組表', path: '/guide', icon: <TvOutlined /> }];
        if (conflictCount > 0) reserveNavigation.push({ label: '競合', path: '/reserves?type=conflict', icon: <PendingActionsOutlined />, count: conflictCount });
        if (overlapCount > 0) reserveNavigation.push({ label: '重複', path: '/reserves?type=overlap', icon: <PendingActionsOutlined />, count: overlapCount });

        const groups: Record<SideNavigationItemId, NavigationItem[]> = {
            dashboard: [{ label: sideNavigationLabels.dashboard, path: '/', icon: <DashboardOutlined /> }],
            onair: [{ label: sideNavigationLabels.onair, path: '/onair', icon: <LiveTvOutlined /> }],
            guide: guideNavigation,
            anime: [{ label: sideNavigationLabels.anime, path: '/anime', icon: <AlphaAIcon /> }],
            recording: [
                {
                    label: sideNavigationLabels.recording,
                    path: '/recording',
                    icon: hasRecording ? <RadioButtonCheckedOutlined /> : <RadioButtonUncheckedOutlined />,
                },
            ],
            recorded: [{ label: sideNavigationLabels.recorded, path: '/recorded', icon: <MovieOutlined /> }],
            encode: [{ label: sideNavigationLabels.encode, path: '/encode', icon: <SyncOutlined /> }],
            reserves: reserveNavigation,
            search: [{ label: sideNavigationLabels.search, path: '/search', icon: <SearchOutlined /> }],
            rule: [{ label: sideNavigationLabels.rule, path: '/rule', icon: <CalendarMonthOutlined /> }],
            history: [{ label: sideNavigationLabels.history, path: '/history', icon: <HistoryOutlined /> }],
            system: [{ label: sideNavigationLabels.system, path: '/system', icon: <DnsOutlined /> }],
            settings: [{ label: sideNavigationLabels.settings, path: '/settings', icon: <SettingsOutlined /> }],
        };

        return settings.sideNavigationOrder.flatMap(item => (item !== 'settings' && settings.hiddenSideNavigationItems.includes(item) ? [] : groups[item]));
    }, [config.data, conflictCount, hasRecording, overlapCount, settings.hiddenSideNavigationItems, settings.isEnableDisplayForEachBroadcastWave, settings.sideNavigationOrder]);

    useEffect(() => setMobileOpen(false), [location]);
    useEffect(() => {
        const previous = window.history.scrollRestoration;
        window.history.scrollRestoration = 'manual';
        return () => {
            window.history.scrollRestoration = previous;
        };
    }, []);

    useEffect(() => {
        let cancelled = false;
        let frame = 0;
        const restoreStartedAt = performance.now();
        const animeReturnPosition = location.pathname === '/anime' ? loadAnimeReturnPosition() : null;
        const focusAnnictId = Number(new URLSearchParams(location.search).get('focus'));
        const animeRestoresItself =
            navigationType === 'POP' &&
            animeReturnPosition !== null &&
            (animeReturnPosition.listLocationKey === location.key || (Number.isInteger(focusAnnictId) && focusAnnictId === animeReturnPosition.annictId));
        const target = animeRestoresItself ? null : navigationType === 'POP' ? (loadAppScrollPosition(location.key) ?? 0) : navigationType === 'PUSH' ? 0 : null;

        const restore = (): void => {
            if (cancelled || target === null) return;
            window.scrollTo({ top: target, behavior: 'auto' });
            if (performance.now() - restoreStartedAt < SCROLL_RESTORE_TIMEOUT_MS && Math.abs(window.scrollY - target) > 1) frame = window.requestAnimationFrame(restore);
        };
        frame = window.requestAnimationFrame(restore);
        return () => {
            cancelled = true;
            window.cancelAnimationFrame(frame);
            rememberAppScrollPosition(location.key, window.scrollY);
        };
    }, [location.key, navigationType]);
    useEffect(() => {
        if (theaterMode) {
            setDesktopOpen(current => {
                if (theaterSavedDesktopOpen.current === null) theaterSavedDesktopOpen.current = current;
                return false;
            });
        } else if (theaterSavedDesktopOpen.current !== null) {
            const restore = theaterSavedDesktopOpen.current;
            theaterSavedDesktopOpen.current = null;
            setDesktopOpen(restore);
        }
    }, [theaterMode]);

    const drawer = (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Toolbar sx={{ gap: 0.875, minHeight: 60, justifyContent: 'flex-start', px: 2 }}>
                <Typography variant="h6" noWrap sx={{ fontWeight: 700, fontSize: '1.125rem', lineHeight: 1.2 }}>
                    NeoEPGStation
                </Typography>
                {!settings.isAppLogoHidden && <Box component="img" src={appIconAssetUrl(logoIcon)} alt="" sx={{ height: 28, width: 'auto', flex: '0 0 auto' }} />}
            </Toolbar>
            <Divider />
            <List dense sx={{ overflowY: 'auto', py: 1 }}>
                {navigation.map(item => {
                    const [targetPath, targetSearch = ''] = item.path.split('?');
                    const pathSelected = targetPath === '/' ? location.pathname === '/' : location.pathname.startsWith(targetPath);
                    const targetType = new URLSearchParams(targetSearch).get('type');
                    const selected = pathSelected && (targetType === null || new URLSearchParams(location.search).get('type') === targetType);
                    return (
                        <ListItemButton
                            key={item.label}
                            selected={selected}
                            onClick={() => {
                                const options =
                                    targetPath === '/search'
                                        ? {
                                              replace: location.pathname === '/search' && location.search.length === 0,
                                              state: { resetPage: 'search' } satisfies SideNavigationState,
                                          }
                                        : undefined;
                                void navigate(item.path, options);
                            }}
                        >
                            <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                            <ListItemText
                                primary={
                                    <Box component="span" sx={{ display: 'flex', alignItems: 'center', gap: 0.75 }}>
                                        <Box component="span">{item.label}</Box>
                                        {item.count !== undefined && (
                                            <Box
                                                component="span"
                                                aria-label={`${item.count}件`}
                                                sx={{
                                                    minWidth: 20,
                                                    height: 20,
                                                    px: item.count > 9 ? 0.6 : 0,
                                                    borderRadius: 999,
                                                    display: 'inline-flex',
                                                    alignItems: 'center',
                                                    justifyContent: 'center',
                                                    bgcolor: 'primary.main',
                                                    color: 'primary.contrastText',
                                                    fontSize: '0.75rem',
                                                    fontWeight: 700,
                                                    lineHeight: 1,
                                                }}
                                            >
                                                {item.count}
                                            </Box>
                                        )}
                                    </Box>
                                }
                            />
                        </ListItemButton>
                    );
                })}
            </List>
        </Box>
    );

    const contextValue = useMemo(() => ({ toggleDrawer: () => (desktop ? setDesktopOpen(value => !value) : setMobileOpen(value => !value)) }), [desktop]);
    const drawerOpen = desktop ? desktopOpen : mobileOpen;
    const overlayDrawer = theaterMode || !desktop;

    return (
        <AppLayoutContext.Provider value={contextValue}>
            <Box
                sx={{
                    minHeight: '100dvh',
                    display: 'flex',
                    bgcolor: 'background.default',
                    transition: theme.transitions.create('background-color', { duration: theme.transitions.duration.shorter }),
                }}
            >
                <Drawer
                    variant={overlayDrawer ? 'temporary' : 'permanent'}
                    open={drawerOpen}
                    onClose={() => (desktop ? setDesktopOpen(false) : setMobileOpen(false))}
                    ModalProps={{ keepMounted: true }}
                    sx={{
                        width: desktop && !theaterMode && desktopOpen ? drawerWidth : 0,
                        flexShrink: 0,
                        '& .MuiDrawer-paper': {
                            width: drawerWidth,
                            boxSizing: 'border-box',
                            display: desktop && !theaterMode && !desktopOpen ? 'none' : 'block',
                        },
                    }}
                >
                    {drawer}
                </Drawer>
                <Box
                    component="main"
                    sx={{
                        flex: 1,
                        minWidth: 0,
                        bgcolor: 'background.default',
                        transition: theme.transitions.create('background-color', { duration: theme.transitions.duration.shorter }),
                    }}
                >
                    <Suspense
                        fallback={
                            <Box sx={{ minHeight: '100dvh', display: 'grid', placeItems: 'center' }}>
                                <CircularProgress />
                            </Box>
                        }
                    >
                        <Fade key={location.pathname} in appear timeout={500}>
                            <Box>
                                <Outlet />
                            </Box>
                        </Fade>
                    </Suspense>
                </Box>
            </Box>
        </AppLayoutContext.Provider>
    );
}
