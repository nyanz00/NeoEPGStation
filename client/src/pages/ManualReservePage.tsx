import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import ExpandMoreOutlined from '@mui/icons-material/ExpandMoreOutlined';
import {
    Accordion,
    AccordionDetails,
    AccordionSummary,
    Box,
    Button,
    Card,
    CardContent,
    Checkbox,
    CircularProgress,
    FormControlLabel,
    MenuItem,
    Stack,
    Switch,
    TextField,
    Typography,
} from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { EditManualReserveOption, ManualReserveOption, ReserveEncodedOption, ReserveItem, ReserveSaveOption, ScheduleProgramItem } from '../../../api';
import { type ReactNode, useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { UserSelector } from '../components/UserSelector';
import { api } from '../core/api/queries';
import { useAppBack } from '../core/navigation';
import { useNotifications } from '../core/notifications/Notifications';
import { channelName, formatProgramDate, formatProgramTime, programDuration } from '../core/program';
import { type ActiveUserId, useActiveUser } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';

interface EncodeSetting {
    mode: string;
    parentDirectoryName: string;
    directory: string;
}

interface EditorState {
    userId: ActiveUserId;
    allowEndLack: boolean;
    parentDirectoryName: string;
    directory: string;
    recordedFormat: string;
    encodes: [EncodeSetting, EncodeSetting, EncodeSetting];
    deleteOriginal: boolean;
    updateThumbnail: boolean;
}

interface TimeSpecifiedState {
    enabled: boolean;
    name: string;
    channelId: number | '';
    startAt: string;
    endAt: string;
}

function localDateTime(value: number): string {
    const date = new Date(value - new Date(value).getTimezoneOffset() * 60_000);
    return date.toISOString().slice(0, 16);
}

function initialEditorState(userId: ActiveUserId): EditorState {
    return {
        userId: typeof userId === 'number' ? userId : null,
        allowEndLack: true,
        parentDirectoryName: '',
        directory: '',
        recordedFormat: '',
        encodes: [
            { mode: '', parentDirectoryName: '', directory: '' },
            { mode: '', parentDirectoryName: '', directory: '' },
            { mode: '', parentDirectoryName: '', directory: '' },
        ],
        deleteOriginal: false,
        updateThumbnail: false,
    };
}

function initialTimeSpecifiedState(program: ScheduleProgramItem): TimeSpecifiedState {
    return {
        enabled: false,
        name: program.name,
        channelId: program.channelId,
        startAt: localDateTime(program.startAt),
        endAt: localDateTime(program.endAt),
    };
}

function encodeSetting(item: ReserveItem, index: 1 | 2 | 3): EncodeSetting {
    return {
        mode: item[`encodeMode${index}`] ?? '',
        parentDirectoryName: item[`encodeParentDirectoryName${index}`] ?? '',
        directory: item[`encodeDirectory${index}`] ?? '',
    };
}

function editorState(item: ReserveItem): EditorState {
    return {
        userId: item.userId ?? null,
        allowEndLack: item.allowEndLack,
        parentDirectoryName: item.parentDirectoryName ?? '',
        directory: item.directory ?? '',
        recordedFormat: item.recordedFormat ?? '',
        encodes: [encodeSetting(item, 1), encodeSetting(item, 2), encodeSetting(item, 3)],
        deleteOriginal: item.isDeleteOriginalAfterEncode,
        updateThumbnail: item.updateThumbnail === true,
    };
}

function buildOption(state: EditorState): EditManualReserveOption {
    const saveOption: ReserveSaveOption = {};
    if (state.parentDirectoryName.length > 0) saveOption.parentDirectoryName = state.parentDirectoryName;
    if (state.directory.trim().length > 0) saveOption.directory = state.directory.trim();
    if (state.recordedFormat.trim().length > 0) saveOption.recordedFormat = state.recordedFormat.trim();

    let encodeOption: ReserveEncodedOption | undefined;
    if (state.encodes.some(encode => encode.mode.length > 0)) {
        encodeOption = { isDeleteOriginalAfterEncode: state.deleteOriginal, updateThumbnail: state.updateThumbnail };
        state.encodes.forEach((encode, offset) => {
            if (encode.mode.length === 0) return;
            const index = (offset + 1) as 1 | 2 | 3;
            encodeOption![`mode${index}`] = encode.mode;
            if (encode.parentDirectoryName.length > 0) encodeOption![`encodeParentDirectoryName${index}`] = encode.parentDirectoryName;
            if (encode.directory.trim().length > 0) encodeOption![`directory${index}`] = encode.directory.trim();
        });
    }
    return {
        allowEndLack: state.allowEndLack,
        userId: typeof state.userId === 'number' ? state.userId : undefined,
        saveOption: Object.keys(saveOption).length === 0 ? undefined : saveOption,
        encodeOption,
    };
}

export function ManualReservePage(): ReactNode {
    const settings = useSettings();
    const activeUser = useActiveUser();
    const [params] = useSearchParams();
    const reserveId = Number(params.get('reserveId'));
    const programId = Number(params.get('programId'));
    const validReserveId = params.has('reserveId') && Number.isSafeInteger(reserveId) && reserveId >= 0;
    const validProgramId = params.has('programId') && Number.isSafeInteger(programId) && programId >= 0;
    const validId = validReserveId || validProgramId;
    const goBack = useAppBack('/reserves');
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig });
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const reserve = useQuery({
        queryKey: ['reserve', reserveId, settings.isHalfWidthDisplayed],
        queryFn: () => api.getReserve(reserveId, settings.isHalfWidthDisplayed),
        enabled: validReserveId,
    });
    const program = useQuery({
        queryKey: ['schedule', programId, settings.isHalfWidthDisplayed],
        queryFn: () => api.getSchedule(programId, settings.isHalfWidthDisplayed),
        enabled: validProgramId,
    });
    const [state, setState] = useState<EditorState | null>(null);
    const [timeSpecified, setTimeSpecified] = useState<TimeSpecifiedState | null>(null);

    useEffect(() => {
        if (reserve.data !== undefined) setState(editorState(reserve.data));
        else if (program.data !== undefined) setState(initialEditorState(activeUser));
    }, [activeUser, program.data, reserve.data]);

    useEffect(() => {
        if (program.data !== undefined) setTimeSpecified(initialTimeSpecifiedState(program.data));
    }, [program.data]);

    const save = useMutation({
        mutationFn: async () => {
            if (state === null) throw new Error('予約情報を読み込めませんでした');
            if (typeof state.userId !== 'number') throw new Error('ユーザーを選択してください');
            if (validReserveId) {
                await api.updateReserve(reserveId, buildOption(state));
                return '更新';
            }
            if (program.data === undefined || timeSpecified === null) throw new Error('番組情報を読み込めませんでした');
            const option: ManualReserveOption = { ...buildOption(state), userId: state.userId };
            if (timeSpecified.enabled) {
                const startAt = new Date(timeSpecified.startAt).getTime();
                const endAt = new Date(timeSpecified.endAt).getTime();
                if (timeSpecified.name.trim().length === 0 || typeof timeSpecified.channelId !== 'number') {
                    throw new Error('番組名と放送局を入力してください');
                }
                if (!Number.isFinite(startAt) || !Number.isFinite(endAt) || startAt >= endAt) {
                    throw new Error('開始・終了日時が正しくありません');
                }
                option.timeSpecifiedOption = {
                    name: timeSpecified.name.trim(),
                    channelId: timeSpecified.channelId,
                    startAt,
                    endAt,
                };
            } else {
                option.programId = program.data.id;
            }
            await api.addReserve(option);
            return '追加';
        },
        onSuccess: async action => {
            await Promise.all([
                queryClient.invalidateQueries({ queryKey: ['reserve', reserveId] }),
                queryClient.invalidateQueries({ queryKey: ['reserves'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-lists'] }),
                queryClient.invalidateQueries({ queryKey: ['reserve-counts'] }),
            ]);
            notify(`予約を${action}しました`, 'success');
            goBack();
        },
        onError: error => notify(`予約の保存に失敗しました: ${error.message}`, 'error'),
    });

    const patchEncode = (index: number, value: EncodeSetting): void =>
        setState(current => {
            if (current === null) return current;
            const encodes = [...current.encodes] as EditorState['encodes'];
            encodes[index] = value;
            return { ...current, encodes };
        });

    return (
        <>
            <PageHeader
                title="番組詳細予約"
                actions={
                    <Button startIcon={<ArrowBackOutlined />} onClick={goBack}>
                        戻る
                    </Button>
                }
            />
            {!validId ? (
                <Typography color="error" sx={{ p: 3 }}>
                    予約IDが正しくありません
                </Typography>
            ) : (validReserveId ? reserve.isPending : program.isPending) ? (
                <Box sx={{ minHeight: 360, display: 'grid', placeItems: 'center' }}>
                    <CircularProgress />
                </Box>
            ) : (validReserveId ? reserve.error : program.error) !== null ? (
                <Typography color="error" sx={{ p: 3 }}>
                    予約情報を取得できません: {(validReserveId ? reserve.error : program.error)?.message}
                </Typography>
            ) : state === null ? (
                <Typography color="error" sx={{ p: 3 }}>
                    予約情報を読み込めませんでした
                </Typography>
            ) : (
                <Stack spacing={1.5} sx={{ width: 'min(800px, 100%)', mx: 'auto', p: { xs: 1.5, md: 3 } }}>
                    <Card variant="outlined">
                        <CardContent>
                            <Typography variant="h6" sx={{ fontWeight: 700 }}>
                                {(validReserveId ? reserve.data : program.data)?.name}
                            </Typography>
                            <Typography color="text.secondary">{channelName(channels.data, (validReserveId ? reserve.data : program.data)!.channelId)}</Typography>
                            <Typography color="text.secondary">
                                {formatProgramDate((validReserveId ? reserve.data : program.data)!.startAt)} -{' '}
                                {formatProgramTime((validReserveId ? reserve.data : program.data)!.endAt)}（{programDuration((validReserveId ? reserve.data : program.data)!)}分）
                            </Typography>
                            {(validReserveId ? reserve.data : program.data)!.description !== undefined && (
                                <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{(validReserveId ? reserve.data : program.data)!.description}</Typography>
                            )}
                            {(validReserveId ? reserve.data : program.data)!.extended !== undefined && (
                                <Typography sx={{ mt: 1, whiteSpace: 'pre-wrap' }}>{(validReserveId ? reserve.data : program.data)!.extended}</Typography>
                            )}
                        </CardContent>
                    </Card>
                    {validProgramId && timeSpecified !== null && (
                        <Card variant="outlined">
                            <CardContent>
                                <FormControlLabel
                                    control={
                                        <Switch
                                            checked={timeSpecified.enabled}
                                            onChange={event => setTimeSpecified(current => (current === null ? current : { ...current, enabled: event.target.checked }))}
                                        />
                                    }
                                    label="時刻指定"
                                />
                                {timeSpecified.enabled && (
                                    <Stack spacing={1.5} sx={{ mt: 1.5 }}>
                                        <TextField
                                            label="番組名"
                                            value={timeSpecified.name}
                                            onChange={event => setTimeSpecified(current => (current === null ? current : { ...current, name: event.target.value }))}
                                        />
                                        <TextField
                                            select
                                            label="放送局"
                                            value={timeSpecified.channelId}
                                            onChange={event => setTimeSpecified(current => (current === null ? current : { ...current, channelId: Number(event.target.value) }))}
                                        >
                                            {channels.data?.map(channel => (
                                                <MenuItem key={channel.id} value={channel.id}>
                                                    {channel.name}
                                                </MenuItem>
                                            ))}
                                        </TextField>
                                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                            <TextField
                                                fullWidth
                                                type="datetime-local"
                                                label="開始"
                                                value={timeSpecified.startAt}
                                                onChange={event => setTimeSpecified(current => (current === null ? current : { ...current, startAt: event.target.value }))}
                                                slotProps={{ inputLabel: { shrink: true } }}
                                            />
                                            <TextField
                                                fullWidth
                                                type="datetime-local"
                                                label="終了"
                                                value={timeSpecified.endAt}
                                                onChange={event => setTimeSpecified(current => (current === null ? current : { ...current, endAt: event.target.value }))}
                                                slotProps={{ inputLabel: { shrink: true } }}
                                            />
                                        </Stack>
                                    </Stack>
                                )}
                            </CardContent>
                        </Card>
                    )}
                    <Accordion variant="outlined" defaultExpanded>
                        <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                            <Typography>ユーザー・オプション</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Stack spacing={1.5}>
                                <UserSelector
                                    value={state.userId}
                                    onChange={userId => setState(current => (current === null ? current : { ...current, userId }))}
                                    includeMaster={false}
                                />
                                <FormControlLabel
                                    control={
                                        <Checkbox
                                            checked={state.allowEndLack}
                                            onChange={event => setState(current => (current === null ? current : { ...current, allowEndLack: event.target.checked }))}
                                        />
                                    }
                                    label="状況に応じて末尾切れを許可"
                                />
                            </Stack>
                        </AccordionDetails>
                    </Accordion>
                    <Accordion variant="outlined" defaultExpanded>
                        <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                            <Typography>録画ファイル</Typography>
                        </AccordionSummary>
                        <AccordionDetails>
                            <Stack spacing={1.5}>
                                <TextField
                                    select
                                    label="保存先"
                                    value={state.parentDirectoryName}
                                    onChange={event => setState(current => (current === null ? current : { ...current, parentDirectoryName: event.target.value }))}
                                >
                                    <MenuItem value="">既定</MenuItem>
                                    {config.data?.recorded.map(directory => (
                                        <MenuItem key={directory} value={directory}>
                                            {directory}
                                        </MenuItem>
                                    ))}
                                </TextField>
                                <TextField
                                    label="サブディレクトリ"
                                    value={state.directory}
                                    onChange={event => setState(current => (current === null ? current : { ...current, directory: event.target.value }))}
                                />
                                <TextField
                                    label="ファイル名形式"
                                    value={state.recordedFormat}
                                    onChange={event => setState(current => (current === null ? current : { ...current, recordedFormat: event.target.value }))}
                                />
                            </Stack>
                        </AccordionDetails>
                    </Accordion>
                    {state.encodes.map((encode, index) => (
                        <Accordion key={index} variant="outlined">
                            <AccordionSummary expandIcon={<ExpandMoreOutlined />}>
                                <Typography>エンコード{index + 1}</Typography>
                            </AccordionSummary>
                            <AccordionDetails>
                                <Stack spacing={1.5}>
                                    <TextField select label="モード" value={encode.mode} onChange={event => patchEncode(index, { ...encode, mode: event.target.value })}>
                                        <MenuItem value="">なし</MenuItem>
                                        {config.data?.encode
                                            .filter(mode => mode.trim().length > 0)
                                            .map(mode => (
                                                <MenuItem key={mode} value={mode}>
                                                    {mode}
                                                </MenuItem>
                                            ))}
                                    </TextField>
                                    <TextField
                                        select
                                        label="保存先"
                                        value={encode.parentDirectoryName}
                                        disabled={encode.mode.length === 0}
                                        onChange={event => patchEncode(index, { ...encode, parentDirectoryName: event.target.value })}
                                    >
                                        <MenuItem value="">既定</MenuItem>
                                        {config.data?.recorded.map(directory => (
                                            <MenuItem key={directory} value={directory}>
                                                {directory}
                                            </MenuItem>
                                        ))}
                                    </TextField>
                                    <TextField
                                        label="サブディレクトリ"
                                        value={encode.directory}
                                        disabled={encode.mode.length === 0}
                                        onChange={event => patchEncode(index, { ...encode, directory: event.target.value })}
                                    />
                                </Stack>
                            </AccordionDetails>
                        </Accordion>
                    ))}
                    <Stack direction={{ xs: 'column', sm: 'row' }}>
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={state.deleteOriginal}
                                    onChange={event => setState(current => (current === null ? current : { ...current, deleteOriginal: event.target.checked }))}
                                />
                            }
                            label="エンコード後に元ファイルを削除"
                        />
                        <FormControlLabel
                            control={
                                <Checkbox
                                    checked={state.updateThumbnail}
                                    onChange={event => setState(current => (current === null ? current : { ...current, updateThumbnail: event.target.checked }))}
                                />
                            }
                            label="サムネイル再生成"
                        />
                    </Stack>
                    <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end' }}>
                        <Button onClick={goBack}>キャンセル</Button>
                        <Button variant="contained" disabled={save.isPending || typeof state.userId !== 'number'} onClick={() => save.mutate()}>
                            {validReserveId ? '更新' : '追加'}
                        </Button>
                    </Stack>
                </Stack>
            )}
        </>
    );
}
