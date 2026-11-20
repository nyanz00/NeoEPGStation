import CloseOutlined from '@mui/icons-material/CloseOutlined';
import {
    Alert,
    Box,
    Button,
    Checkbox,
    Dialog,
    DialogActions,
    DialogContent,
    DialogTitle,
    FormControl,
    FormControlLabel,
    IconButton,
    InputLabel,
    LinearProgress,
    MenuItem,
    Select,
    Stack,
    TextField,
    Typography,
} from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import { type ReactNode, useEffect, useMemo, useRef, useState } from 'react';
import type { RecordedItem } from '../../../api';
import { api } from '../core/api/queries';
import { createBulkEncodeJobs, getCommonEncodeSourceNames, submitBulkEncodeJobs, type BulkEncodeResult } from '../core/media/recordedBulkEncode';
import { useNotifications } from '../core/notifications/Notifications';
import { loadAddEncodeSettings, saveAddEncodeSettings } from '../core/storage/encode';
import { programDialogClose, programDialogFields, programDialogPaper } from './programDialogStyles';

export function RecordedBulkEncodeDialog({
    items,
    onClose,
    onCompleted,
}: {
    items: RecordedItem[];
    onClose: () => void;
    onCompleted: (result: BulkEncodeResult) => void;
}): ReactNode {
    const { notify } = useNotifications();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const [initialSettings] = useState(loadAddEncodeSettings);
    const sourceNames = useMemo(() => getCommonEncodeSourceNames(items), [items]);
    const [sourceName, setSourceName] = useState(sourceNames[0] ?? '');
    const [mode, setMode] = useState(initialSettings.encodeMode ?? '');
    const [sameDirectory, setSameDirectory] = useState(initialSettings.isSaveSameDirectory);
    const [parentDir, setParentDir] = useState(initialSettings.parentDirectory ?? '');
    const [directory, setDirectory] = useState('');
    const [removeOriginal, setRemoveOriginal] = useState(initialSettings.removeOriginal);
    const [updateThumbnail, setUpdateThumbnail] = useState(initialSettings.updateThumbnail);
    const [result, setResult] = useState<BulkEncodeResult | null>(null);
    const [successCount, setSuccessCount] = useState(0);
    const [pending, setPending] = useState(false);
    const [progress, setProgress] = useState(0);
    const [attemptCount, setAttemptCount] = useState(0);
    const busy = useRef(false);
    const mounted = useRef(false);
    const hasRecording = items.some(item => item.isRecording);
    const settingsLocked = pending || result !== null;
    const canAdd =
        !pending &&
        !hasRecording &&
        sourceNames.includes(sourceName) &&
        (config.data?.encode.includes(mode) ?? false) &&
        (sameDirectory || (config.data?.recorded.includes(parentDir) ?? false));

    useEffect(() => {
        mounted.current = true;
        return () => {
            mounted.current = false;
        };
    }, []);
    useEffect(() => {
        if (result !== null || busy.current || config.data === undefined) return;
        const data = config.data;
        setMode(current => (data.encode.includes(current) ? current : (data.encode[0] ?? '')));
        setParentDir(current => (data.recorded.includes(current) ? current : (data.recorded[0] ?? '')));
    }, [config.data, result]);

    const persistSettings = (): void => {
        saveAddEncodeSettings({
            encodeMode: mode.length > 0 ? mode : null,
            parentDirectory: parentDir.length > 0 ? parentDir : null,
            isSaveSameDirectory: sameDirectory,
            removeOriginal,
            updateThumbnail,
        });
    };
    const close = (): void => {
        if (busy.current) return;
        persistSettings();
        onClose();
    };
    const submit = async (): Promise<void> => {
        if (busy.current || !canAdd) return;
        busy.current = true;
        setPending(true);
        setProgress(0);
        try {
            const jobs =
                result === null
                    ? createBulkEncodeJobs(items, sourceName, {
                          mode,
                          removeOriginal,
                          updateThumbnail,
                          isSaveSameDirectory: sameDirectory,
                          parentDir,
                          directory,
                      })
                    : result.failed.map(failure => failure.job);
            setAttemptCount(jobs.length);
            persistSettings();
            const next = await submitBulkEncodeJobs(jobs, api.addManualEncode, setProgress, () => mounted.current);
            if (!mounted.current) return;
            setResult(next);
            setSuccessCount(count => count + next.succeeded.length);
            onCompleted(next);
            if (next.failed.length === 0) {
                notify(`${items.length} 件をエンコードキューに追加しました。`, 'success');
                onClose();
            } else {
                notify(`${next.succeeded.length} 件を追加し、${next.failed.length} 件の追加に失敗しました。`, 'warning');
            }
        } catch (error) {
            if (mounted.current) notify(`エンコードを追加できません: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            busy.current = false;
            if (mounted.current) setPending(false);
        }
    };

    return (
        <Dialog open onClose={close} fullWidth maxWidth="sm" aria-labelledby="recorded-bulk-encode-title" slotProps={{ paper: { sx: programDialogPaper } }}>
            <DialogTitle id="recorded-bulk-encode-title">エンコードを一括追加</DialogTitle>
            <IconButton aria-label="閉じる" disabled={pending} onClick={close} sx={programDialogClose}>
                <CloseOutlined />
            </IconButton>
            <DialogContent dividers sx={{ px: { xs: 2, sm: 3 }, py: 2, bgcolor: 'action.hover' }}>
                <Stack spacing={2}>
                    <Typography variant="body2">選択した {items.length} 件の録画を同じ設定でエンコードキューに追加します。</Typography>
                    {sourceNames.length === 0 && <Alert severity="warning">選択した録画すべてに共通する元ファイルがありません。</Alert>}
                    {hasRecording && <Alert severity="warning">録画中の番組が含まれています。録画終了後に追加してください。</Alert>}
                    {config.isError && (
                        <Alert severity="error">
                            設定を取得できませんでした。<Button onClick={() => void config.refetch()}>再試行</Button>
                        </Alert>
                    )}
                    {config.data !== undefined && config.data.encode.length === 0 && <Alert severity="warning">エンコードプリセットが設定されていません。</Alert>}
                    <Box sx={programDialogFields}>
                        <FormControl fullWidth size="small" disabled={settingsLocked || sourceNames.length === 0}>
                            <InputLabel>元ファイル</InputLabel>
                            <Select label="元ファイル" value={sourceName} onChange={event => setSourceName(event.target.value)}>
                                {sourceNames.map(name => (
                                    <MenuItem key={name} value={name}>
                                        {name}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <FormControl fullWidth size="small" disabled={settingsLocked || config.data === undefined}>
                            <InputLabel>エンコードプリセット</InputLabel>
                            <Select label="エンコードプリセット" value={config.data?.encode.includes(mode) ? mode : ''} onChange={event => setMode(event.target.value)}>
                                {config.data?.encode.map(value => (
                                    <MenuItem key={value} value={value}>
                                        {value}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                    <Box sx={programDialogFields}>
                        <FormControl fullWidth size="small" disabled={settingsLocked || sameDirectory || config.data === undefined}>
                            <InputLabel>保存先</InputLabel>
                            <Select label="保存先" value={config.data?.recorded.includes(parentDir) ? parentDir : ''} onChange={event => setParentDir(event.target.value)}>
                                {config.data?.recorded.map(value => (
                                    <MenuItem key={value} value={value}>
                                        {value}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                        <TextField
                            disabled={settingsLocked || sameDirectory}
                            size="small"
                            label="サブディレクトリ"
                            value={directory}
                            onChange={event => setDirectory(event.target.value)}
                        />
                    </Box>
                    <Stack>
                        <FormControlLabel
                            disabled={settingsLocked}
                            control={<Checkbox checked={sameDirectory} onChange={event => setSameDirectory(event.target.checked)} />}
                            label="元ファイルと同じ場所に保存"
                        />
                        {sameDirectory && (
                            <Typography variant="caption" color="text.secondary" sx={{ mb: 1 }}>
                                各録画で選んだ元ファイルと同じディレクトリへ、それぞれ保存します。
                            </Typography>
                        )}
                        <FormControlLabel
                            disabled={settingsLocked}
                            control={<Checkbox checked={removeOriginal} onChange={event => setRemoveOriginal(event.target.checked)} />}
                            label="元ファイル削除"
                        />
                        <FormControlLabel
                            disabled={settingsLocked}
                            control={<Checkbox checked={updateThumbnail} onChange={event => setUpdateThumbnail(event.target.checked)} />}
                            label="サムネイル再生成"
                        />
                    </Stack>
                    {pending && (
                        <Box role="status">
                            <Typography variant="body2" sx={{ mb: 1 }}>
                                追加中: {progress} / {attemptCount} 件
                            </Typography>
                            <LinearProgress variant="determinate" value={attemptCount === 0 ? 0 : (progress / attemptCount) * 100} />
                        </Box>
                    )}
                    {result !== null && result.failed.length > 0 && (
                        <Alert severity="warning">
                            <Typography variant="body2">
                                追加済み: {successCount} 件 / 失敗: {result.failed.length} 件。再試行では失敗した録画だけを同じ設定で追加します。
                            </Typography>
                            <Box component="ul" sx={{ pl: 2, mb: 0, overflowWrap: 'anywhere' }}>
                                {result.failed.map(failure => (
                                    <li key={failure.job.recordedId}>
                                        {failure.job.recordedName}: {failure.error}
                                    </li>
                                ))}
                            </Box>
                        </Alert>
                    )}
                </Stack>
            </DialogContent>
            <DialogActions>
                <Button color="inherit" variant="outlined" disabled={pending} onClick={close}>
                    {result === null ? 'キャンセル' : '閉じる'}
                </Button>
                <Button variant="contained" disabled={!canAdd} onClick={() => void submit()}>
                    {result === null ? '追加' : '失敗した録画を再試行'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
