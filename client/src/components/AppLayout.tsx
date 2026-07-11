import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DashboardOutlined from '@mui/icons-material/DashboardOutlined';
import FiberManualRecordOutlined from '@mui/icons-material/FiberManualRecordOutlined';
import LiveTvOutlined from '@mui/icons-material/LiveTvOutlined';
import MenuIcon from '@mui/icons-material/Menu';
import MovieOutlined from '@mui/icons-material/MovieOutlined';
import PendingActionsOutlined from '@mui/icons-material/PendingActionsOutlined';
import ScheduleOutlined from '@mui/icons-material/ScheduleOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import SettingsOutlined from '@mui/icons-material/SettingsOutlined';
import StorageOutlined from '@mui/icons-material/StorageOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import TvOutlined from '@mui/icons-material/TvOutlined';
import { AppBar, Box, Divider, Drawer, IconButton, List, ListItemButton, ListItemIcon, ListItemText, Toolbar, Typography, useMediaQuery, useTheme } from '@mui/material';
import { type ReactNode, useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';

const drawerWidth = 240;
const navigation = [
    { label: 'ダッシュボード', path: '/', icon: <DashboardOutlined /> },
    { label: '放映中', path: '/onair', icon: <LiveTvOutlined /> },
    { label: '番組表', path: '/guide', icon: <TvOutlined /> },
    { label: '録画中', path: '/recording', icon: <FiberManualRecordOutlined /> },
    { label: '録画済み', path: '/recorded', icon: <MovieOutlined /> },
    { label: 'エンコード', path: '/encode', icon: <SyncOutlined /> },
    { label: '予約', path: '/reserves?type=normal', icon: <ScheduleOutlined /> },
    { label: '競合', path: '/reserves?type=conflict', icon: <PendingActionsOutlined /> },
    { label: '重複', path: '/reserves?type=overlap', icon: <PendingActionsOutlined /> },
    { label: '検索', path: '/search', icon: <SearchOutlined /> },
    { label: 'ルール', path: '/rule', icon: <CalendarMonthOutlined /> },
    { label: 'ストレージ', path: '/storages', icon: <StorageOutlined /> },
    { label: '設定', path: '/settings', icon: <SettingsOutlined /> },
];

export function AppLayout({ version }: { version: string }): ReactNode {
    const theme = useTheme();
    const desktop = useMediaQuery(theme.breakpoints.up('lg'));
    const [mobileOpen, setMobileOpen] = useState(false);
    const location = useLocation();
    const navigate = useNavigate();

    useEffect(() => setMobileOpen(false), [location]);

    const drawer = (
        <Box sx={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
            <Toolbar sx={{ gap: 1, minHeight: 58 }}>
                <Typography variant="subtitle1" noWrap sx={{ fontWeight: 700 }}>
                    EPGStation v{version}
                </Typography>
                <Box component="img" src="./icon/nyanz-smile.png" alt="" sx={{ height: 25, width: 'auto' }} />
            </Toolbar>
            <Divider />
            <List dense sx={{ overflowY: 'auto', py: 1 }}>
                {navigation.map(item => {
                    const targetPath = item.path.split('?')[0];
                    const selected = targetPath === '/' ? location.pathname === '/' : location.pathname.startsWith(targetPath);
                    return (
                        <ListItemButton key={item.label} selected={selected} onClick={() => void navigate(item.path)}>
                            <ListItemIcon sx={{ minWidth: 40 }}>{item.icon}</ListItemIcon>
                            <ListItemText primary={item.label} />
                        </ListItemButton>
                    );
                })}
            </List>
        </Box>
    );

    return (
        <Box sx={{ minHeight: '100dvh', display: 'flex' }}>
            {!desktop && (
                <AppBar position="fixed" color="default" elevation={0} sx={{ borderBottom: 1, borderColor: 'divider' }}>
                    <Toolbar sx={{ minHeight: 56 }}>
                        <IconButton edge="start" onClick={() => setMobileOpen(true)} aria-label="メニューを開く">
                            <MenuIcon />
                        </IconButton>
                        <Typography variant="subtitle1" sx={{ ml: 1 }}>
                            EPGStation
                        </Typography>
                    </Toolbar>
                </AppBar>
            )}
            <Drawer
                variant={desktop ? 'permanent' : 'temporary'}
                open={desktop || mobileOpen}
                onClose={() => setMobileOpen(false)}
                ModalProps={{ keepMounted: true }}
                sx={{
                    width: desktop ? drawerWidth : 0,
                    flexShrink: 0,
                    '& .MuiDrawer-paper': { width: drawerWidth, boxSizing: 'border-box' },
                }}
            >
                {drawer}
            </Drawer>
            <Box
                component="main"
                sx={{
                    flex: 1,
                    minWidth: 0,
                    pt: desktop ? 0 : '56px',
                }}
            >
                <Outlet />
            </Box>
        </Box>
    );
}
