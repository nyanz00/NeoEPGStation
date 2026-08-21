import PauseOutlined from '@mui/icons-material/PauseOutlined';
import PlayArrowOutlined from '@mui/icons-material/PlayArrowOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import {
    Alert,
    Box,
    Card,
    CardContent,
    CircularProgress,
    FormControlLabel,
    InputAdornment,
    MenuItem,
    Stack,
    Switch,
    TextField,
    ToggleButton,
    ToggleButtonGroup,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { SystemLogCategory, SystemLogLevel, SystemLogSource } from '../../../api';
import { api } from '../core/api/queries';

const sourceLabels: Record<SystemLogSource, string> = {
    Operator: 'メイン処理',
    Service: 'Web・API',
    EPGUpdater: 'EPG更新',
};

const categoryLabels: Record<SystemLogCategory, string> = {
    system: 'システム',
    access: 'アクセス',
    stream: 'ストリーム',
    encode: 'エンコード',
};

const logLineLimitStorageKey = 'systemLogLineLimit';
const logLineLimitOptions = [100, 250, 500, 1000, 2000] as const;
const logLevelOptions: { value: SystemLogLevel; label: string }[] = [
    { value: 'trace', label: 'TRACE' },
    { value: 'debug', label: 'DEBUG' },
    { value: 'info', label: 'INFO' },
    { value: 'warn', label: 'WARN' },
    { value: 'error', label: 'ERROR' },
    { value: 'fatal', label: 'FATAL' },
    { value: 'off', label: 'OFF' },
];

function loadLogLineLimit(): number {
    try {
        const saved = Number(localStorage.getItem(logLineLimitStorageKey));
        if (logLineLimitOptions.some(value => value === saved)) return saved;
    } catch {
        // Use the default when browser storage is unavailable.
    }
    return 500;
}

function fileSize(value: number): string {
    if (value <= 0) return '0 B';
    const units = ['B', 'KiB', 'MiB', 'GiB'];
    const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
    return `${(value / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`;
}

function logColor(line: string): string {
    if (/\[(FATAL|ERROR)\]/i.test(line)) return '#ff7b72';
    if (/\[WARN\]/i.test(line)) return '#e3b341';
    if (/\[(TRACE|DEBUG)\]/i.test(line)) return '#8b949e';
    if (/\[INFO\]/i.test(line)) return '#e6edf3';
    return '#c9d1d9';
}

export function SystemLogsPanel(): ReactNode {
    const queryClient = useQueryClient();
    const [source, setSource] = useState<SystemLogSource>('Operator');
    const [category, setCategory] = useState<SystemLogCategory>('system');
    const [filter, setFilter] = useState('');
    const [autoRefresh, setAutoRefresh] = useState(true);
    const [followTail, setFollowTail] = useState(true);
    const [lineLimit, setLineLimit] = useState(loadLogLineLimit);
    const logContainerRef = useRef<HTMLDivElement | null>(null);
    const availableCategories = useMemo<SystemLogCategory[]>(() => (source === 'Service' ? ['system', 'access', 'stream', 'encode'] : ['system', 'access', 'stream']), [source]);
    const logs = useQuery({
        queryKey: ['system-logs', source, category, lineLimit],
        queryFn: () => api.getSystemLog(source, category, lineLimit),
        refetchInterval: autoRefresh ? 2_000 : false,
        refetchIntervalInBackground: false,
    });
    const updateLogLevel = useMutation({
        mutationFn: (level: SystemLogLevel) => api.setSystemLogLevel(source, category, level),
        onSuccess: async () => {
            await queryClient.invalidateQueries({ queryKey: ['system-logs', source, category] });
        },
    });
    const visibleLines = useMemo(() => {
        const normalizedFilter = filter.trim().toLocaleLowerCase();
        if (normalizedFilter.length === 0) return logs.data?.lines ?? [];
        return (logs.data?.lines ?? []).filter(line => line.toLocaleLowerCase().includes(normalizedFilter));
    }, [filter, logs.data?.lines]);

    useEffect(() => {
        if (!followTail || logContainerRef.current === null) return;
        logContainerRef.current.scrollTop = logContainerRef.current.scrollHeight;
    }, [followTail, visibleLines]);

    useEffect(() => {
        if (source !== 'Service' && category === 'encode') setCategory('system');
    }, [category, source]);

    useEffect(() => {
        try {
            localStorage.setItem(logLineLimitStorageKey, lineLimit.toString(10));
        } catch {
            // The current selection remains usable when browser storage is unavailable.
        }
    }, [lineLimit]);

    return (
        <Stack spacing={2}>
            <Card variant="outlined">
                <CardContent>
                    <Stack spacing={2}>
                        <Box>
                            <Typography variant="h5">EPGStationログ</Typography>
                            <Typography variant="body2" color="text.secondary">
                                最新ログを表示します。ログレベルは、選択中のプロセス・種類が実際に出力する閾値を変更します。
                            </Typography>
                        </Box>
                        <Stack direction="row" spacing={1} sx={{ alignItems: 'center', justifyContent: { xs: 'flex-start', lg: 'flex-end' }, flexWrap: 'wrap' }}>
                            <FormControlLabel
                                control={<Switch checked={autoRefresh} onChange={event => setAutoRefresh(event.target.checked)} />}
                                label={
                                    <Stack direction="row" spacing={0.5} sx={{ alignItems: 'center' }}>
                                        {autoRefresh ? <PlayArrowOutlined fontSize="small" /> : <PauseOutlined fontSize="small" />}
                                        <span>自動更新</span>
                                    </Stack>
                                }
                            />
                            <FormControlLabel control={<Switch checked={followTail} onChange={event => setFollowTail(event.target.checked)} />} label="末尾を追従" />
                            <TextField select label="表示件数" size="small" value={lineLimit} onChange={event => setLineLimit(Number(event.target.value))} sx={{ width: 120 }}>
                                {logLineLimitOptions.map(value => (
                                    <MenuItem key={value} value={value}>
                                        {value}行
                                    </MenuItem>
                                ))}
                            </TextField>
                            <TextField
                                select
                                label="ログレベル"
                                size="small"
                                value={logs.data?.level ?? 'info'}
                                disabled={logs.isPending || updateLogLevel.isPending}
                                onChange={event => updateLogLevel.mutate(event.target.value as SystemLogLevel)}
                                sx={{ width: 120 }}
                            >
                                {logLevelOptions.map(option => (
                                    <MenuItem key={option.value} value={option.value}>
                                        {option.label}
                                    </MenuItem>
                                ))}
                            </TextField>
                        </Stack>

                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                プロセス
                            </Typography>
                            <ToggleButtonGroup
                                exclusive
                                value={source}
                                onChange={(_event, value: SystemLogSource | null) => value !== null && setSource(value)}
                                size="small"
                                sx={{ display: 'flex', mt: 0.5, overflowX: 'auto' }}
                            >
                                {(Object.keys(sourceLabels) as SystemLogSource[]).map(value => (
                                    <ToggleButton key={value} value={value} sx={{ flex: { xs: 1, sm: '0 0 auto' }, whiteSpace: 'nowrap' }}>
                                        {sourceLabels[value]}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                        </Box>

                        <Box>
                            <Typography variant="caption" color="text.secondary">
                                種類
                            </Typography>
                            <ToggleButtonGroup
                                exclusive
                                value={category}
                                onChange={(_event, value: SystemLogCategory | null) => value !== null && setCategory(value)}
                                size="small"
                                sx={{ display: 'flex', mt: 0.5, overflowX: 'auto' }}
                            >
                                {availableCategories.map(value => (
                                    <ToggleButton key={value} value={value} sx={{ flex: { xs: 1, sm: '0 0 auto' }, whiteSpace: 'nowrap' }}>
                                        {categoryLabels[value]}
                                    </ToggleButton>
                                ))}
                            </ToggleButtonGroup>
                        </Box>

                        <TextField
                            value={filter}
                            onChange={event => setFilter(event.target.value)}
                            placeholder="表示中のログを検索"
                            size="small"
                            slotProps={{
                                input: {
                                    startAdornment: (
                                        <InputAdornment position="start">
                                            <SearchOutlined />
                                        </InputAdornment>
                                    ),
                                },
                            }}
                        />
                    </Stack>
                </CardContent>
            </Card>

            {updateLogLevel.isError && <Alert severity="error">ログレベルを変更できませんでした: {updateLogLevel.error.message}</Alert>}

            {logs.isError ? (
                <Alert severity="error">ログを取得できませんでした: {logs.error.message}</Alert>
            ) : (
                <Card variant="outlined">
                    <Stack direction={{ xs: 'column', sm: 'row' }} spacing={0.5} sx={{ px: 2, py: 1.25, justifyContent: 'space-between', borderBottom: 1, borderColor: 'divider' }}>
                        <Typography variant="subtitle2">
                            {sourceLabels[source]} / {categoryLabels[category]}
                        </Typography>
                        {logs.data !== undefined && (
                            <Typography variant="caption" color="text.secondary">
                                {logs.data.fileName}・{fileSize(logs.data.size)}
                                {logs.data.updatedAt !== undefined ? `・${new Date(logs.data.updatedAt).toLocaleString()}` : ''}
                                {logs.data.truncated ? '・末尾のみ表示' : ''}
                            </Typography>
                        )}
                    </Stack>
                    <Box
                        ref={logContainerRef}
                        sx={{
                            minHeight: 360,
                            height: 'min(62dvh, 720px)',
                            overflow: 'auto',
                            bgcolor: '#090d10',
                            color: '#e6edf3',
                            p: 1.5,
                            fontFamily: '"Cascadia Mono", "Consolas", monospace',
                            fontSize: { xs: '0.72rem', sm: '0.8rem' },
                            lineHeight: 1.55,
                        }}
                    >
                        {logs.isPending ? (
                            <Box sx={{ height: '100%', display: 'grid', placeItems: 'center' }}>
                                <CircularProgress size={32} />
                            </Box>
                        ) : logs.data?.exists === false ? (
                            <Typography sx={{ color: '#8b949e' }}>このログファイルはまだ作成されていません。</Typography>
                        ) : visibleLines.length === 0 ? (
                            <Typography sx={{ color: '#8b949e' }}>{filter.length > 0 ? '条件に一致するログはありません。' : 'ログは空です。'}</Typography>
                        ) : (
                            visibleLines.map((line, index) => (
                                <Box
                                    component="div"
                                    key={`${index}-${line}`}
                                    sx={{
                                        color: logColor(line),
                                        whiteSpace: 'pre-wrap',
                                        overflowWrap: 'anywhere',
                                        borderRadius: 0.5,
                                        '&:hover': { bgcolor: 'rgba(255,255,255,0.045)' },
                                    }}
                                >
                                    {line || ' '}
                                </Box>
                            ))
                        )}
                    </Box>
                </Card>
            )}
        </Stack>
    );
}
