import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import ArrowForwardOutlined from '@mui/icons-material/ArrowForwardOutlined';
import CloseOutlined from '@mui/icons-material/CloseOutlined';
import EditOutlined from '@mui/icons-material/EditOutlined';
import KeyboardArrowDownOutlined from '@mui/icons-material/KeyboardArrowDownOutlined';
import KeyboardArrowUpOutlined from '@mui/icons-material/KeyboardArrowUpOutlined';
import ReorderOutlined from '@mui/icons-material/ReorderOutlined';
import SaveOutlined from '@mui/icons-material/SaveOutlined';
import SubtitlesOutlined from '@mui/icons-material/SubtitlesOutlined';
import {
    Alert,
    Autocomplete,
    Box,
    Button,
    Card,
    CardContent,
    Chip,
    CircularProgress,
    FormControl,
    IconButton,
    InputLabel,
    MenuItem,
    Select,
    Stack,
    TextField,
    Tooltip,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecordedItem, SubtitleTransferTask, VideoFile, VideoSubtitle } from '../../../api';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { api } from '../core/api/queries';
import { useAppBack } from '../core/navigation';
import { useNotifications } from '../core/notifications/Notifications';
import { formatProgramDate } from '../core/program';
import { useSettings } from '../core/storage/settings';

type TransferSide = 'left' | 'right';

interface PaneSelection {
    recorded: RecordedItem | null;
    videoFileId: number | '';
}

interface PendingTransfer {
    sourceSide: TransferSide;
    sourceVideoFileId: number;
    targetVideoFileId: number;
    subtitle: VideoSubtitle;
    title: string;
}

function isMatroska(video: VideoFile): boolean {
    return video.filename.toLowerCase().endsWith('.mkv');
}

function formatBytes(size: number): string {
    if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
    if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(size / 1024))} KB`;
}

function taskErrorMessage(error: string): string {
    if (error.includes('SubtitleTransferTargetIsProtected')) return '対象の録画が保護されています。録画詳細で保護を解除してください。';
    if (error.includes('SubtitleTransferRequiresMatroska')) return '字幕の移植・名前変更はMKVファイルでのみ利用できます。';
    if (error.includes('SubtitleTransferVideoFileIsBusy')) return '選択した録画ファイルは別の字幕処理で使用中です。';
    if (error.includes('SubtitleTransferEncodeIsRunning')) return '選択した録画を使用するエンコードが実行中です。';
    if (error.includes('SubtitleTransferRecordingIsRunning')) return '録画中のファイルへ字幕を移植することはできません。';
    if (error.includes('SubtitleReorderTracksChanged')) return '字幕一覧が変更されたため並び替えを中止しました。一覧を再読み込みしてください。';
    if (error.includes('SubtitleReorderOrderIsUnchanged')) return '字幕の順序は変更されていません。';
    if (error.includes('SubtitleReorderOutputValidationFailed')) return '並び替え後の字幕を検証できなかったため、元のファイルを維持しました。';
    return error;
}

function RecordedSelector({ value, onChange }: { value: RecordedItem | null; onChange: (value: RecordedItem | null) => void }): ReactNode {
    const settings = useSettings();
    const [keyword, setKeyword] = useState('');
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 5 * 60 * 1000 });
    const channelNames = useMemo(() => new Map((channels.data ?? []).map(channel => [channel.id, channel.name])), [channels.data]);
    const search = useQuery({
        queryKey: ['subtitle-transfer-recorded-search', keyword, settings.isHalfWidthDisplayed, channels.data],
        queryFn: async () => {
            const normalizedKeyword = keyword.trim().normalize('NFKC').toLocaleLowerCase();
            const matchingChannelIds = (channels.data ?? [])
                .filter(channel => channel.name.normalize('NFKC').toLocaleLowerCase().includes(normalizedKeyword))
                .map(channel => channel.id);
            const common = {
                isHalfWidth: settings.isHalfWidthDisplayed,
                offset: 0,
                limit: 30,
                isReverse: true,
            } as const;
            const results = await Promise.all([
                api.getRecorded({ ...common, keyword: keyword.trim() }),
                ...matchingChannelIds.map(channelId => api.getRecorded({ ...common, channelId })),
            ]);
            const records = results
                .flatMap(result => result.records)
                .filter((item, index, items) => items.findIndex(candidate => candidate.id === item.id) === index)
                .sort((a, b) => b.startAt - a.startAt)
                .slice(0, 30);
            return { records, total: records.length };
        },
        enabled: keyword.trim().length > 0,
    });
    const options = useMemo(() => {
        const items = value === null ? [...(search.data?.records ?? [])] : [value, ...(search.data?.records ?? [])];
        return items.filter((item, index) => items.findIndex(candidate => candidate.id === item.id) === index);
    }, [search.data?.records, value]);

    return (
        <Autocomplete
            value={value}
            options={options}
            loading={search.isFetching}
            filterOptions={items => items}
            isOptionEqualToValue={(option, selected) => option.id === selected.id}
            getOptionLabel={option => option.name}
            onInputChange={(_event, next, reason) => {
                if (reason === 'input') setKeyword(next);
            }}
            onChange={(_event, next) => onChange(next)}
            renderOption={(props, option) => (
                <Box component="li" {...props} key={option.id}>
                    <Box sx={{ minWidth: 0 }}>
                        <Typography noWrap>{option.name}</Typography>
                        <Typography variant="caption" color="text.secondary">
                            {channelNames.get(option.channelId) ?? `チャンネル ${option.channelId}`} ・ {formatProgramDate(option.startAt)}
                        </Typography>
                    </Box>
                </Box>
            )}
            renderInput={params => <TextField {...params} label="録画を検索" placeholder="番組名を入力" />}
        />
    );
}

function SubtitlePane({
    side,
    selection,
    otherSelection,
    pending,
    onSelectionChange,
    onQueue,
    onPendingTitleChange,
    onPendingCancel,
    onRename,
    onReorder,
    processing,
}: {
    side: TransferSide;
    selection: PaneSelection;
    otherSelection: PaneSelection;
    pending: PendingTransfer | null;
    onSelectionChange: (value: PaneSelection) => void;
    onQueue: (subtitle: VideoSubtitle) => void;
    onPendingTitleChange: (value: string) => void;
    onPendingCancel: () => void;
    onRename: (videoFileId: number, subtitle: VideoSubtitle, title: string) => void;
    onReorder: (videoFileId: number, subtitleIndices: number[]) => void;
    processing: boolean;
}): ReactNode {
    const [editingSubtitleIndex, setEditingSubtitleIndex] = useState<number | null>(null);
    const [editingTitle, setEditingTitle] = useState('');
    const [reordering, setReordering] = useState(false);
    const [subtitleOrder, setSubtitleOrder] = useState<number[]>([]);
    const mkvFiles = useMemo(() => (selection.recorded?.videoFiles ?? []).filter(isMatroska), [selection.recorded?.videoFiles]);
    const subtitles = useQuery({
        queryKey: ['video-subtitles', selection.videoFileId],
        queryFn: () => api.getVideoSubtitles(selection.videoFileId as number),
        enabled: typeof selection.videoFileId === 'number',
    });
    const isPendingTarget = pending !== null && pending.sourceSide !== side;
    const canQueue =
        typeof selection.videoFileId === 'number' && typeof otherSelection.videoFileId === 'number' && selection.videoFileId !== otherSelection.videoFileId && pending === null;

    useEffect(() => {
        setReordering(false);
        setEditingSubtitleIndex(null);
        setSubtitleOrder(subtitles.data?.items.map(subtitle => subtitle.subtitleIndex) ?? []);
    }, [selection.videoFileId, subtitles.data?.items]);

    const orderedSubtitles = useMemo(() => {
        const items = subtitles.data?.items ?? [];
        if (!reordering) return items;
        const byIndex = new Map(items.map(subtitle => [subtitle.subtitleIndex, subtitle]));
        return subtitleOrder.map(index => byIndex.get(index)).filter((subtitle): subtitle is VideoSubtitle => subtitle !== undefined);
    }, [reordering, subtitleOrder, subtitles.data?.items]);
    const originalOrder = subtitles.data?.items.map(subtitle => subtitle.subtitleIndex) ?? [];
    const orderChanged = subtitleOrder.length === originalOrder.length && subtitleOrder.some((index, position) => index !== originalOrder[position]);
    const moveSubtitle = (position: number, direction: -1 | 1): void => {
        const target = position + direction;
        if (target < 0 || target >= subtitleOrder.length) return;
        setSubtitleOrder(current => {
            const next = [...current];
            [next[position], next[target]] = [next[target], next[position]];
            return next;
        });
    };

    const changeRecorded = (recorded: RecordedItem | null): void => {
        const firstMkv = recorded?.videoFiles?.find(isMatroska);
        onSelectionChange({ recorded, videoFileId: firstMkv?.id ?? '' });
    };

    return (
        <Card variant="outlined" sx={{ minWidth: 0, height: '100%' }}>
            <CardContent>
                <Stack spacing={2}>
                    <RecordedSelector value={selection.recorded} onChange={changeRecorded} />
                    <FormControl fullWidth disabled={selection.recorded === null || mkvFiles.length === 0}>
                        <InputLabel>録画ファイルタイプ</InputLabel>
                        <Select
                            label="録画ファイルタイプ"
                            value={selection.videoFileId}
                            onChange={event => onSelectionChange({ ...selection, videoFileId: Number(event.target.value) })}
                        >
                            {mkvFiles.map(video => (
                                <MenuItem key={video.id} value={video.id}>
                                    {video.name} — {video.filename} ({formatBytes(video.size)})
                                </MenuItem>
                            ))}
                        </Select>
                    </FormControl>
                    {selection.recorded !== null && mkvFiles.length === 0 && <Alert severity="info">この録画にはMKVファイルがありません。</Alert>}
                    {selection.recorded?.isProtected === true && (
                        <Alert severity="warning">この録画は保護されています。字幕の移植先、名前変更、並び替えの対象にする場合は先に保護を解除してください。</Alert>
                    )}

                    <Box>
                        <Box sx={{ mb: 1, display: 'flex', alignItems: 'center', gap: 1 }}>
                            <Typography variant="h6" sx={{ flex: 1 }}>
                                字幕一覧
                            </Typography>
                            {(subtitles.data?.items.length ?? 0) > 1 && (
                                <Button
                                    size="small"
                                    variant={reordering ? 'outlined' : 'text'}
                                    startIcon={<ReorderOutlined />}
                                    disabled={processing}
                                    onClick={() => {
                                        setEditingSubtitleIndex(null);
                                        setSubtitleOrder(subtitles.data?.items.map(subtitle => subtitle.subtitleIndex) ?? []);
                                        setReordering(value => !value);
                                    }}
                                >
                                    {reordering ? '取消' : '並び替え'}
                                </Button>
                            )}
                        </Box>
                        {subtitles.isFetching ? (
                            <Box sx={{ py: 4, textAlign: 'center' }}>
                                <CircularProgress size={28} />
                            </Box>
                        ) : subtitles.isError ? (
                            <Alert severity="error">字幕一覧を取得できません: {subtitles.error.message}</Alert>
                        ) : typeof selection.videoFileId !== 'number' ? (
                            <Typography variant="body2" color="text.secondary">
                                MKVファイルを選択してください。
                            </Typography>
                        ) : (subtitles.data?.items.length ?? 0) === 0 ? (
                            <Typography variant="body2" color="text.secondary">
                                字幕トラックはありません。
                            </Typography>
                        ) : (
                            <Stack spacing={1}>
                                {orderedSubtitles.map((subtitle, position) => (
                                    <Box
                                        key={subtitle.subtitleIndex}
                                        sx={{
                                            p: 1.25,
                                            border: 1,
                                            borderColor: 'divider',
                                            borderRadius: 1,
                                        }}
                                    >
                                        <Stack spacing={1}>
                                            <Box sx={{ display: 'flex', gap: 1, alignItems: 'center' }}>
                                                <Box sx={{ flex: 1, minWidth: 0 }}>
                                                    <Typography noWrap>{subtitle.title ?? subtitle.displayName}</Typography>
                                                    <Stack direction="row" spacing={0.5} sx={{ mt: 0.5, flexWrap: 'wrap', rowGap: 0.5 }}>
                                                        {subtitle.codecName !== undefined && <Chip size="small" label={subtitle.codecName} />}
                                                        {subtitle.language !== undefined && <Chip size="small" label={subtitle.language} />}
                                                        {subtitle.isDefault && <Chip size="small" label="default" />}
                                                        {subtitle.isForced && <Chip size="small" label="forced" />}
                                                    </Stack>
                                                </Box>
                                                {reordering && (
                                                    <Stack direction="row" spacing={0}>
                                                        <Tooltip title="一つ上へ移動">
                                                            <span>
                                                                <IconButton size="small" disabled={processing || position === 0} onClick={() => moveSubtitle(position, -1)}>
                                                                    <KeyboardArrowUpOutlined />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                        <Tooltip title="一つ下へ移動">
                                                            <span>
                                                                <IconButton
                                                                    size="small"
                                                                    disabled={processing || position === orderedSubtitles.length - 1}
                                                                    onClick={() => moveSubtitle(position, 1)}
                                                                >
                                                                    <KeyboardArrowDownOutlined />
                                                                </IconButton>
                                                            </span>
                                                        </Tooltip>
                                                    </Stack>
                                                )}
                                                {!reordering && (
                                                    <Tooltip title="字幕名を変更">
                                                        <span>
                                                            <IconButton
                                                                disabled={processing}
                                                                onClick={() => {
                                                                    setEditingSubtitleIndex(subtitle.subtitleIndex);
                                                                    setEditingTitle(subtitle.title ?? subtitle.displayName);
                                                                }}
                                                            >
                                                                <EditOutlined />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                )}
                                                {!reordering && (
                                                    <Tooltip title={side === 'left' ? '右のMKVへ移植' : '左のMKVへ移植'}>
                                                        <span>
                                                            <IconButton disabled={!canQueue || processing} onClick={() => onQueue(subtitle)}>
                                                                {side === 'left' ? <ArrowForwardOutlined /> : <ArrowBackOutlined />}
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                )}
                                            </Box>
                                            {editingSubtitleIndex === subtitle.subtitleIndex && (
                                                <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                                                    <TextField
                                                        fullWidth
                                                        size="small"
                                                        label="字幕名"
                                                        value={editingTitle}
                                                        slotProps={{ htmlInput: { maxLength: 128 } }}
                                                        onChange={event => setEditingTitle(event.target.value)}
                                                    />
                                                    <Tooltip title="字幕名を保存">
                                                        <span>
                                                            <IconButton
                                                                color="primary"
                                                                disabled={processing || editingTitle.trim().length === 0}
                                                                onClick={() => {
                                                                    if (typeof selection.videoFileId !== 'number') return;
                                                                    onRename(selection.videoFileId, subtitle, editingTitle.trim());
                                                                    setEditingSubtitleIndex(null);
                                                                }}
                                                            >
                                                                <SaveOutlined />
                                                            </IconButton>
                                                        </span>
                                                    </Tooltip>
                                                    <IconButton onClick={() => setEditingSubtitleIndex(null)} disabled={processing}>
                                                        <CloseOutlined />
                                                    </IconButton>
                                                </Stack>
                                            )}
                                        </Stack>
                                    </Box>
                                ))}
                                {reordering && (
                                    <Button
                                        variant="contained"
                                        startIcon={<SaveOutlined />}
                                        disabled={processing || !orderChanged || typeof selection.videoFileId !== 'number'}
                                        onClick={() => {
                                            if (typeof selection.videoFileId !== 'number') return;
                                            onReorder(selection.videoFileId, subtitleOrder);
                                        }}
                                    >
                                        字幕順序を保存
                                    </Button>
                                )}
                            </Stack>
                        )}
                    </Box>

                    {isPendingTarget && pending !== null && (
                        <Box sx={{ p: 1.5, border: 1, borderColor: 'primary.main', borderRadius: 1 }}>
                            <Stack direction="row" spacing={1} sx={{ alignItems: 'flex-start' }}>
                                <TextField
                                    fullWidth
                                    label="移植後の字幕名"
                                    value={pending.title}
                                    slotProps={{ htmlInput: { maxLength: 128 } }}
                                    onChange={event => onPendingTitleChange(event.target.value)}
                                />
                                <Tooltip title="移植予定から外す">
                                    <IconButton onClick={onPendingCancel}>
                                        <CloseOutlined />
                                    </IconButton>
                                </Tooltip>
                            </Stack>
                        </Box>
                    )}
                </Stack>
            </CardContent>
        </Card>
    );
}

export function RecordedSubtitleTransferPage(): ReactNode {
    const settings = useSettings();
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const recordedId = Number(useParams().id);
    const goBack = useAppBack(`/recorded/detail/${recordedId.toString(10)}`);
    const [left, setLeft] = useState<PaneSelection>({ recorded: null, videoFileId: '' });
    const [right, setRight] = useState<PaneSelection>({ recorded: null, videoFileId: '' });
    const [pending, setPending] = useState<PendingTransfer | null>(null);
    const [task, setTask] = useState<SubtitleTransferTask | null>(null);
    const [taskAction, setTaskAction] = useState<'transfer' | 'rename' | 'reorder'>('transfer');
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const initialRecorded = useQuery({
        queryKey: ['recorded-detail', recordedId, settings.isHalfWidthDisplayed],
        queryFn: () => api.getRecordedItem(recordedId, settings.isHalfWidthDisplayed),
        enabled: Number.isSafeInteger(recordedId) && config.data?.developerMode === true,
    });
    const taskStatus = useQuery({
        queryKey: ['subtitle-transfer-task', task?.targetVideoFileId, task?.id],
        queryFn: () => api.getSubtitleTransferTask(task!.targetVideoFileId, task!.id),
        enabled: task?.status === 'running',
        refetchInterval: 1000,
    });
    const startTransfer = useMutation({
        mutationFn: (value: PendingTransfer) =>
            api.startSubtitleTransfer(value.targetVideoFileId, {
                sourceVideoFileId: value.sourceVideoFileId,
                subtitleIndex: value.subtitle.subtitleIndex,
                title: value.title.trim(),
            }),
        onSuccess: started => {
            setTaskAction('transfer');
            setTask(started);
        },
        onError: error => notify(`字幕移植を開始できません: ${taskErrorMessage(error.message)}`, 'error'),
    });
    const startRename = useMutation({
        mutationFn: ({ videoFileId, subtitle, title }: { videoFileId: number; subtitle: VideoSubtitle; title: string }) =>
            api.startSubtitleRename(videoFileId, subtitle.subtitleIndex, { title }),
        onSuccess: started => {
            setTaskAction('rename');
            setTask(started);
        },
        onError: error => notify(`字幕名の変更を開始できません: ${taskErrorMessage(error.message)}`, 'error'),
    });
    const startReorder = useMutation({
        mutationFn: ({ videoFileId, subtitleIndices }: { videoFileId: number; subtitleIndices: number[] }) => api.startSubtitleReorder(videoFileId, { subtitleIndices }),
        onSuccess: started => {
            setTaskAction('reorder');
            setTask(started);
        },
        onError: error => notify(`字幕の並び替えを開始できません: ${taskErrorMessage(error.message)}`, 'error'),
    });

    useEffect(() => {
        const item = initialRecorded.data;
        if (item === undefined || left.recorded !== null) return;
        const firstMkv = item.videoFiles?.find(isMatroska);
        setLeft({ recorded: item, videoFileId: firstMkv?.id ?? '' });
    }, [initialRecorded.data, left.recorded]);
    useEffect(() => {
        const updated = taskStatus.data;
        if (updated === undefined || updated.status === 'running') return;
        setTask(updated);
        if (updated.status === 'completed') {
            notify(taskAction === 'rename' ? '字幕名を変更しました。' : taskAction === 'reorder' ? '字幕を並び替えました。' : '字幕を移植しました。', 'success');
            if (taskAction === 'transfer') setPending(null);
            void Promise.all([
                queryClient.invalidateQueries({ queryKey: ['video-subtitles', updated.targetVideoFileId] }),
                queryClient.invalidateQueries({ queryKey: ['recorded'] }),
                queryClient.invalidateQueries({ queryKey: ['recorded-detail'] }),
            ]);
        } else {
            const actionName = taskAction === 'rename' ? '字幕名の変更' : taskAction === 'reorder' ? '字幕の並び替え' : '字幕移植';
            notify(`${actionName}に失敗しました: ${taskErrorMessage(updated.error ?? '不明なエラー')}`, 'error');
        }
    }, [notify, queryClient, taskAction, taskStatus.data]);

    const updateSelection = (side: TransferSide, value: PaneSelection): void => {
        setPending(null);
        setTask(null);
        if (side === 'left') setLeft(value);
        else setRight(value);
    };
    const queue = (sourceSide: TransferSide, subtitle: VideoSubtitle): void => {
        const source = sourceSide === 'left' ? left : right;
        const target = sourceSide === 'left' ? right : left;
        if (typeof source.videoFileId !== 'number' || typeof target.videoFileId !== 'number') return;
        setPending({
            sourceSide,
            sourceVideoFileId: source.videoFileId,
            targetVideoFileId: target.videoFileId,
            subtitle,
            title: subtitle.title ?? subtitle.displayName,
        });
        setTask(null);
    };
    const running = task?.status === 'running';

    if (config.isPending) {
        return (
            <Box sx={{ py: 10, textAlign: 'center' }}>
                <CircularProgress />
            </Box>
        );
    }
    if (config.data?.developerMode !== true) {
        return <Alert severity="error">この機能はdeveloperModeでのみ利用できます。</Alert>;
    }

    return (
        <>
            <PageHeader
                title="字幕移植"
                leading={
                    <Tooltip title="録画詳細に戻る">
                        <IconButton onClick={goBack}>
                            <ArrowBackOutlined />
                        </IconButton>
                    </Tooltip>
                }
            />
            <Box sx={{ p: { xs: 1.5, md: 3 }, maxWidth: 1700, mx: 'auto' }}>
                <Stack spacing={2}>
                    <Alert severity="info" icon={<SubtitlesOutlined />}>
                        映像・音声を再エンコードせず、選択した字幕トラックを別のMKVへコピーしたり、既存の字幕名や順序を変更したりできます。処理中は対象ファイルを再生・変更しないでください。
                    </Alert>
                    <Box
                        sx={{
                            display: 'grid',
                            gridTemplateColumns: { xs: 'minmax(0, 1fr)', lg: 'minmax(0, 1fr) minmax(0, 1fr)' },
                            gap: 2,
                            alignItems: 'stretch',
                        }}
                    >
                        <SubtitlePane
                            side="left"
                            selection={left}
                            otherSelection={right}
                            pending={pending}
                            onSelectionChange={value => updateSelection('left', value)}
                            onQueue={subtitle => queue('left', subtitle)}
                            onPendingTitleChange={title => setPending(current => (current === null ? null : { ...current, title }))}
                            onPendingCancel={() => setPending(null)}
                            onRename={(videoFileId, subtitle, title) => startRename.mutate({ videoFileId, subtitle, title })}
                            onReorder={(videoFileId, subtitleIndices) => startReorder.mutate({ videoFileId, subtitleIndices })}
                            processing={running || startRename.isPending || startReorder.isPending || startTransfer.isPending}
                        />
                        <SubtitlePane
                            side="right"
                            selection={right}
                            otherSelection={left}
                            pending={pending}
                            onSelectionChange={value => updateSelection('right', value)}
                            onQueue={subtitle => queue('right', subtitle)}
                            onPendingTitleChange={title => setPending(current => (current === null ? null : { ...current, title }))}
                            onPendingCancel={() => setPending(null)}
                            onRename={(videoFileId, subtitle, title) => startRename.mutate({ videoFileId, subtitle, title })}
                            onReorder={(videoFileId, subtitleIndices) => startReorder.mutate({ videoFileId, subtitleIndices })}
                            processing={running || startRename.isPending || startReorder.isPending || startTransfer.isPending}
                        />
                    </Box>
                    {running && (
                        <Alert severity="info" icon={<CircularProgress size={20} />}>
                            {taskAction === 'rename' ? '字幕名を変更' : taskAction === 'reorder' ? '字幕を並び替え' : '字幕を移植'}
                            するためMKVを再多重化しています。ファイルサイズによっては時間がかかります。 この画面を閉じてもサーバー側の処理は継続します。
                        </Alert>
                    )}
                    {task?.status === 'failed' && (
                        <Alert severity="error">
                            {taskErrorMessage(
                                task.error ?? `${taskAction === 'rename' ? '字幕名の変更' : taskAction === 'reorder' ? '字幕の並び替え' : '字幕移植'}に失敗しました。`,
                            )}
                        </Alert>
                    )}
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button onClick={goBack}>戻る</Button>
                        <Button
                            variant="contained"
                            startIcon={running ? <CircularProgress size={18} color="inherit" /> : <SubtitlesOutlined />}
                            disabled={pending === null || pending.title.trim().length === 0 || running || startTransfer.isPending}
                            onClick={() => pending !== null && startTransfer.mutate(pending)}
                        >
                            移植を実行
                        </Button>
                    </Stack>
                </Stack>
            </Box>
        </>
    );
}
