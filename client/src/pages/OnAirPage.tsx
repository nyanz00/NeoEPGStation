import LocalFireDepartmentOutlined from '@mui/icons-material/LocalFireDepartmentOutlined';
import PushPin from '@mui/icons-material/PushPin';
import PushPinOutlined from '@mui/icons-material/PushPinOutlined';
import { Alert, Box, Card, CircularProgress, IconButton, LinearProgress, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { ChannelJikkyoStatus, ChannelType, Schedule, ScheduleChannleItem, ScheduleProgramItem } from '../../../api';
import { type KeyboardEvent, type MouseEvent, type ReactNode, useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { OnAirSelectStreamDialog } from '../components/OnAirSelectStreamDialog';
import { PageHeader } from '../components/PageHeader';
import { PageSubHeader } from '../components/PageSubHeader';
import { api } from '../core/api/queries';
import { isDefaultVisibleChannel } from '../core/channels';
import { withBasePath } from '../core/path';
import { channelTypeLabel, formatProgramTime, isLikelyBroadcastPauseTime, programDuration } from '../core/program';
import { useSettings } from '../core/storage/settings';
import { loadOnAirPinnedChannelIds, saveOnAirPinnedChannelIds } from '../core/storage/onAirPins';
import { GuideProgramDialog, reserveIndex } from './GuidePage';

const waveOrder: ChannelType[] = ['GR', 'GR-ALT1', 'GR-ALT2', 'GR-ALT3', 'BS', 'CS', 'SKY'];
const pinnedWave = 'PINNED';

function waveSort(left: string, right: string): number {
    const leftIndex = waveOrder.indexOf(left as ChannelType);
    const rightIndex = waveOrder.indexOf(right as ChannelType);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right, 'ja');
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
}

function clampProgress(program: ScheduleProgramItem, now: number): number {
    const duration = program.endAt - program.startAt;
    if (duration <= 0) return 0;
    return Math.min(100, Math.max(0, ((now - program.startAt) / duration) * 100));
}

function forceColor(force: number | null): 'text.secondary' | 'primary.main' | 'warning.main' | 'error.main' {
    if (force === null || force < 100) return 'text.secondary';
    if (force < 200) return 'primary.main';
    if (force < 500) return 'warning.main';
    return 'error.main';
}

function OnAirCard({
    schedule,
    force,
    now,
    pinned,
    onOpenProgram,
    onTogglePin,
    onWatch,
}: {
    schedule: Schedule;
    force: number | null;
    now: number;
    pinned: boolean;
    onOpenProgram: (schedule: Schedule) => void;
    onTogglePin: (channelId: number) => void;
    onWatch: (channel: ScheduleChannleItem) => void;
}): ReactNode {
    const program = schedule.programs[0];
    const isLikelyPaused = program === undefined && isLikelyBroadcastPauseTime(now);
    const openWatch = (): void => onWatch(schedule.channel);
    const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>): void => {
        if (event.target === event.currentTarget && (event.key === 'Enter' || event.key === ' ')) {
            event.preventDefault();
            openWatch();
        }
    };
    const openProgram = (event: MouseEvent<HTMLButtonElement>): void => {
        if (program === undefined) return;
        event.stopPropagation();
        onOpenProgram(schedule);
    };

    return (
        <Card
            variant="outlined"
            role="button"
            data-testid="onair-card"
            tabIndex={0}
            aria-label={`${schedule.channel.name}を視聴`}
            onClick={openWatch}
            onKeyDown={handleKeyDown}
            sx={{
                minWidth: 0,
                minHeight: { xs: 188, sm: 270 },
                display: 'flex',
                flexDirection: 'column',
                cursor: 'pointer',
                position: 'relative',
                overflow: 'hidden',
                transition: theme => theme.transitions.create(['transform', 'border-color', 'box-shadow'], { duration: theme.transitions.duration.shorter }),
                '&:hover': { transform: 'translateY(-2px)', borderColor: 'primary.main', boxShadow: 4 },
                '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: 2 },
            }}
        >
            <Box
                component="button"
                type="button"
                onClick={openProgram}
                aria-label={`${schedule.channel.name}の番組詳細を開く`}
                sx={{
                    appearance: 'none',
                    width: '100%',
                    minHeight: { xs: 50, sm: 58 },
                    pl: { xs: 1.25, sm: 2 },
                    pr: { xs: 5.5, sm: 6 },
                    py: { xs: 0.75, sm: 1.25 },
                    display: 'flex',
                    alignItems: 'center',
                    gap: { xs: 1, sm: 1.25 },
                    color: 'text.primary',
                    bgcolor: 'transparent',
                    border: 0,
                    textAlign: 'left',
                    cursor: 'pointer',
                    '&:hover': { bgcolor: 'action.hover' },
                    '&:focus-visible': { outline: '2px solid', outlineColor: 'primary.main', outlineOffset: -2 },
                }}
            >
                <Box sx={{ width: { xs: 58, sm: 68 }, height: { xs: 34, sm: 38 }, flex: '0 0 auto', display: 'grid', placeItems: 'center', overflow: 'hidden' }}>
                    {schedule.channel.hasLogoData ? (
                        <Box
                            component="img"
                            src={withBasePath(`/api/channels/${schedule.channel.id}/logo`)}
                            alt=""
                            loading="lazy"
                            decoding="async"
                            sx={{ maxWidth: '100%', maxHeight: '100%', objectFit: 'contain' }}
                        />
                    ) : (
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                            {channelTypeLabel(schedule.channel.channelType)}
                        </Typography>
                    )}
                </Box>
                <Box sx={{ minWidth: 0, flex: 1 }}>
                    <Typography variant="subtitle1" noWrap sx={{ fontWeight: 800, fontSize: { xs: '0.98rem', sm: undefined } }}>
                        {schedule.channel.name}
                    </Typography>
                    <Stack direction="row" spacing={{ xs: 0.75, sm: 1.5 }} sx={{ alignItems: 'center' }}>
                        <Typography variant="caption" color="text.secondary" sx={{ fontWeight: 700 }}>
                            {channelTypeLabel(schedule.channel.channelType)}
                            {schedule.channel.remoteControlKeyId === undefined ? '' : ` ${schedule.channel.remoteControlKeyId.toString(10)}`}
                        </Typography>
                        <Stack direction="row" spacing={0.25} sx={{ alignItems: 'center', color: forceColor(force) }}>
                            <LocalFireDepartmentOutlined sx={{ fontSize: 15 }} />
                            <Typography variant="caption" sx={{ color: 'inherit', fontWeight: 700 }}>
                                {force === null ? '--' : force.toLocaleString('ja-JP')} コメ/分
                            </Typography>
                        </Stack>
                    </Stack>
                </Box>
            </Box>
            <Tooltip title={pinned ? 'ピン留めを解除' : 'ピン留め'}>
                <IconButton
                    size="small"
                    color={pinned ? 'primary' : 'default'}
                    aria-label={`${schedule.channel.name}${pinned ? 'のピン留めを解除' : 'をピン留め'}`}
                    onClick={event => {
                        event.stopPropagation();
                        onTogglePin(schedule.channel.id);
                    }}
                    sx={{ position: 'absolute', top: { xs: 9, sm: 14 }, right: { xs: 8, sm: 12 }, zIndex: 2 }}
                >
                    {pinned ? <PushPin fontSize="small" /> : <PushPinOutlined fontSize="small" />}
                </IconButton>
            </Tooltip>

            <Stack spacing={{ xs: 0.35, sm: 0.75 }} sx={{ px: { xs: 1.25, sm: 2 }, pb: { xs: 1, sm: 1.5 }, flex: 1, minHeight: 0 }}>
                {program === undefined ? (
                    <Stack spacing={0.75} sx={{ minHeight: 0, flex: 1, alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
                        <Typography variant="subtitle1" sx={{ fontWeight: 800 }}>
                            {isLikelyPaused ? '放送休止' : '番組情報を取得できません'}
                        </Typography>
                        <Typography variant="body2" color="text.secondary">
                            {isLikelyPaused ? 'この時間は放送を休止しています' : '放送局を選択して視聴できます'}
                        </Typography>
                    </Stack>
                ) : (
                    <>
                        <Typography
                            variant="subtitle1"
                            sx={{
                                fontWeight: 800,
                                lineHeight: 1.35,
                                display: '-webkit-box',
                                WebkitBoxOrient: 'vertical',
                                WebkitLineClamp: { xs: 1, sm: 2 },
                                overflow: 'hidden',
                                fontSize: { xs: '0.98rem', sm: undefined },
                            }}
                        >
                            {program.name}
                        </Typography>
                        <Typography variant="body2" color="text.secondary" sx={{ fontSize: { xs: '0.78rem', sm: undefined } }}>
                            {formatProgramTime(program.startAt)} - {formatProgramTime(program.endAt)}（{programDuration(program)}分）
                        </Typography>
                        {program.description !== undefined && (
                            <Typography
                                variant="body2"
                                color="text.secondary"
                                sx={{
                                    lineHeight: { xs: 1.4, sm: 1.55 },
                                    display: '-webkit-box',
                                    WebkitBoxOrient: 'vertical',
                                    WebkitLineClamp: { xs: 2, sm: 3 },
                                    overflow: 'hidden',
                                    fontSize: { xs: '0.8rem', sm: undefined },
                                }}
                            >
                                {program.description}
                            </Typography>
                        )}
                    </>
                )}
            </Stack>
            {program === undefined ? (
                <Box sx={{ height: 4, bgcolor: 'divider' }} />
            ) : (
                <LinearProgress variant="determinate" value={clampProgress(program, now)} sx={{ height: 4 }} />
            )}
        </Card>
    );
}

export function OnAirPage(): ReactNode {
    const settings = useSettings();
    const navigate = useNavigate();
    const [searchParams, setSearchParams] = useSearchParams();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const schedules = useQuery({
        queryKey: ['onair', settings.isHalfWidthDisplayed],
        queryFn: () => api.getBroadcastingSchedules({ isHalfWidth: settings.isHalfWidthDisplayed }),
        refetchInterval: 30_000,
    });
    const jikkyo = useQuery({
        queryKey: ['onair-jikkyo'],
        queryFn: api.getChannelJikkyoStatuses,
        refetchInterval: 30_000,
        staleTime: 25_000,
    });
    const reserveLists = useQuery({
        queryKey: ['reserve-lists', 'onair'],
        queryFn: () => api.getReserveLists({ startAt: Date.now() - 6 * 3_600_000, endAt: Date.now() + 12 * 3_600_000 }),
        staleTime: 30_000,
    });
    const [now, setNow] = useState(Date.now());
    const [selectedSchedule, setSelectedSchedule] = useState<Schedule | null>(null);
    const [watchChannel, setWatchChannel] = useState<ScheduleChannleItem | null>(null);
    const [pinnedChannelIds, setPinnedChannelIds] = useState(loadOnAirPinnedChannelIds);

    useEffect(() => {
        const timer = window.setInterval(() => setNow(Date.now()), 10_000);
        return () => window.clearInterval(timer);
    }, []);

    const visibleSchedules = useMemo(
        () =>
            (schedules.data ?? []).filter(schedule => {
                if (config.data?.broadcast[schedule.channel.channelType] === false) return false;
                return settings.isShowInformationalChannels || isDefaultVisibleChannel(schedule.channel);
            }),
        [config.data, schedules.data, settings.isShowInformationalChannels],
    );
    const pinnedSchedules = useMemo(() => visibleSchedules.filter(schedule => pinnedChannelIds.has(schedule.channel.id)), [pinnedChannelIds, visibleSchedules]);
    const waves = useMemo(
        () => [...(pinnedSchedules.length > 0 ? [pinnedWave] : []), ...Array.from(new Set(visibleSchedules.map(schedule => schedule.channel.channelType))).sort(waveSort)],
        [pinnedSchedules.length, visibleSchedules],
    );
    const requestedWave = searchParams.get('wave') ?? '';
    const activeWave = requestedWave.length > 0 && waves.some(wave => wave === requestedWave) ? requestedWave : (waves[0] ?? '');
    const displayedSchedules = settings.isOnAirTabListView
        ? activeWave === pinnedWave
            ? pinnedSchedules
            : visibleSchedules.filter(schedule => schedule.channel.channelType === activeWave)
        : visibleSchedules;
    const forceIndex = useMemo(() => new Map<number, ChannelJikkyoStatus>((jikkyo.data ?? []).map(status => [status.channelId, status])), [jikkyo.data]);
    const reserves = useMemo(() => reserveIndex(reserveLists.data), [reserveLists.data]);
    const program = selectedSchedule?.programs[0] ?? null;

    useEffect(() => {
        if (activeWave.length === 0 || requestedWave === activeWave) return;
        const next = new URLSearchParams(searchParams);
        next.set('wave', activeWave);
        setSearchParams(next, { replace: true });
    }, [activeWave, requestedWave, searchParams, setSearchParams]);

    const selectWave = (wave: string): void => {
        const next = new URLSearchParams(searchParams);
        next.set('wave', wave);
        setSearchParams(next, { replace: true });
    };
    const togglePin = useCallback((channelId: number): void => {
        setPinnedChannelIds(current => {
            const next = new Set(current);
            if (next.has(channelId)) next.delete(channelId);
            else next.add(channelId);
            saveOnAirPinnedChannelIds(next);
            return next;
        });
    }, []);
    const watch = (path: string): void => {
        const [pathname, query = ''] = path.split('?');
        const next = new URLSearchParams(query);
        if (activeWave.length > 0) next.set('wave', activeWave);
        void navigate(`${pathname}?${next.toString()}`, { flushSync: true });
    };

    return (
        <>
            <PageHeader title="放映中" />
            {settings.isOnAirTabListView && waves.length > 0 && (
                <PageSubHeader>
                    <Tabs value={activeWave} onChange={(_event, value: string) => selectWave(value)} centered variant="scrollable" scrollButtons="auto">
                        {waves.map(wave => (
                            <Tab key={wave} value={wave} label={wave === pinnedWave ? 'Pinned' : channelTypeLabel(wave as ChannelType)} />
                        ))}
                    </Tabs>
                </PageSubHeader>
            )}
            <Box sx={{ p: { xs: 1, sm: 2, lg: 2.5 } }}>
                {schedules.isPending ? (
                    <Box sx={{ minHeight: 260, display: 'grid', placeItems: 'center' }}>
                        <CircularProgress />
                    </Box>
                ) : schedules.error !== null ? (
                    <Alert severity="error">番組情報の取得に失敗しました: {schedules.error.message}</Alert>
                ) : displayedSchedules.length === 0 ? (
                    <Alert severity="info">表示できる放送局がありません。</Alert>
                ) : (
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: 'minmax(0, 1fr)', sm: 'repeat(2, minmax(0, 1fr))', lg: 'repeat(3, minmax(0, 1fr))', xl: 'repeat(4, minmax(0, 1fr))' },
                            gap: { xs: 1, sm: 1.75 },
                            maxWidth: 1920,
                            mx: 'auto',
                        }}
                    >
                        {displayedSchedules.map(schedule => (
                            <OnAirCard
                                key={schedule.channel.id}
                                schedule={schedule}
                                force={forceIndex.get(schedule.channel.id)?.force ?? null}
                                now={now}
                                pinned={pinnedChannelIds.has(schedule.channel.id)}
                                onOpenProgram={setSelectedSchedule}
                                onTogglePin={togglePin}
                                onWatch={setWatchChannel}
                            />
                        ))}
                    </Box>
                )}
            </Box>
            <GuideProgramDialog
                program={program}
                channel={selectedSchedule?.channel ?? null}
                reserve={program === null ? undefined : reserves.get(program.id)}
                onClose={() => setSelectedSchedule(null)}
            />
            <OnAirSelectStreamDialog channel={watchChannel} config={config.data} settings={settings} onClose={() => setWatchChannel(null)} onWatch={watch} />
        </>
    );
}
