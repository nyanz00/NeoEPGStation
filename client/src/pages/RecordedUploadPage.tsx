import AddOutlined from '@mui/icons-material/AddOutlined';
import ArrowBackOutlined from '@mui/icons-material/ArrowBackOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import UploadOutlined from '@mui/icons-material/UploadOutlined';
import { Box, Button, Card, CardContent, CircularProgress, FormControl, IconButton, InputLabel, MenuItem, Select, Stack, TextField, Typography } from '@mui/material';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateNewRecordedOption, UploadVideoFileOption, VideoFileType } from '../../../api';
import { type ChangeEvent, type ReactNode, useCallback, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { PageHeader } from '../components/PageHeader';
import { ChannelSelector } from '../components/ChannelSelector';
import { DateTextInput, TimeTextInput } from '../components/DateTimeInput';
import { UserSelector } from '../components/UserSelector';
import { api } from '../core/api/queries';
import { inferUploadFilename } from '../core/media/uploadFilename';
import { useAppBack } from '../core/navigation';
import { useNotifications } from '../core/notifications/Notifications';
import type { ActiveUserId } from '../core/storage/activeUser';

interface UploadFileState {
    key: number;
    file: File;
    viewName: string;
    fileType: VideoFileType;
    parentDirectoryName: string;
    subDirectory: string;
}

export function RecordedUploadPage(): ReactNode {
    const navigate = useNavigate();
    const goBack = useAppBack('/recorded');
    const queryClient = useQueryClient();
    const { notify } = useNotifications();
    const nextKey = useRef(1);
    const [userId, setUserId] = useState<ActiveUserId>(null);
    const [channelId, setChannelId] = useState<number | ''>('');
    const [date, setDate] = useState('');
    const [time, setTime] = useState('');
    const [duration, setDuration] = useState('');
    const [name, setName] = useState('');
    const [description, setDescription] = useState('');
    const [extended, setExtended] = useState('');
    const [files, setFiles] = useState<UploadFileState[]>([]);
    const [uploading, setUploading] = useState(false);
    const channels = useQuery({ queryKey: ['channels'], queryFn: api.getChannels, staleTime: 60_000 });
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const onUserChange = useCallback((value: ActiveUserId) => setUserId(value), []);
    const channelOptions = useMemo(
        () => (channels.data ?? []).map(channel => ({ id: channel.id, label: channel.name, searchText: `${channel.name} ${channel.halfWidthName}` })),
        [channels.data],
    );

    const addFiles = (event: ChangeEvent<HTMLInputElement>): void => {
        const selected = Array.from(event.target.files ?? []);
        const parent = config.data?.recorded[0] ?? '';
        const inferred = selected.map(file => ({ file, inference: inferUploadFilename(file.name) }));
        const primary = inferred[0]?.inference;
        if (primary !== undefined) {
            const inferredDate = primary.date;
            const inferredTime = primary.time;
            const inferredName = primary.programName;
            if (inferredDate !== undefined) setDate(current => current || inferredDate);
            if (inferredTime !== undefined) setTime(current => current || inferredTime);
            if (inferredName !== undefined) setName(current => current || inferredName);
        }
        setFiles(current => [
            ...current,
            ...inferred.map(({ file, inference }) => ({
                key: nextKey.current++,
                file,
                viewName: inference.viewName,
                fileType: inference.fileType,
                parentDirectoryName: parent,
                subDirectory: '',
            })),
        ]);
        event.target.value = '';
    };
    const updateFile = (key: number, update: Partial<UploadFileState>): void => {
        setFiles(current => current.map(item => (item.key === key ? { ...item, ...update } : item)));
    };
    const canUpload =
        typeof userId === 'number' &&
        typeof channelId === 'number' &&
        date.length > 0 &&
        time.length > 0 &&
        Number(duration) > 0 &&
        name.trim().length > 0 &&
        files.length > 0 &&
        files.every(file => file.viewName.trim().length > 0 && file.parentDirectoryName.length > 0);

    const upload = async (): Promise<void> => {
        if (!canUpload || typeof userId !== 'number' || typeof channelId !== 'number') return;
        const startAt = new Date(`${date}T${time}:00`).getTime();
        if (!Number.isFinite(startAt)) {
            notify('日付または時刻が不正です。', 'error');
            return;
        }
        const option: CreateNewRecordedOption = {
            userId,
            channelId,
            startAt,
            endAt: startAt + Number(duration) * 60_000,
            name: name.trim(),
        };
        if (description.trim().length > 0) option.description = description.trim();
        if (extended.trim().length > 0) option.extended = extended.trim();
        setUploading(true);
        let recordedId: number | undefined;
        try {
            recordedId = await api.createRecorded(option);
            for (const item of files) {
                const uploadOption: UploadVideoFileOption = {
                    recordedId,
                    parentDirectoryName: item.parentDirectoryName,
                    viewName: item.viewName.trim(),
                    fileType: item.fileType,
                    file: item.file,
                };
                if (item.subDirectory.trim().length > 0) uploadOption.subDirectory = item.subDirectory.trim();
                await api.uploadVideo(uploadOption);
            }
            await queryClient.invalidateQueries({ queryKey: ['recorded'] });
            notify('アップロードが完了しました。', 'success');
            void navigate(`/recorded/detail/${recordedId}`);
        } catch (error) {
            if (recordedId !== undefined) await api.deleteRecorded(recordedId).catch(() => undefined);
            notify(`アップロードに失敗しました: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            setUploading(false);
        }
    };

    return (
        <>
            <PageHeader
                title="アップロード"
                actions={
                    <Button startIcon={<ArrowBackOutlined />} onClick={goBack}>
                        戻る
                    </Button>
                }
            />
            <Box sx={{ p: { xs: 2, md: 3 }, maxWidth: 900, mx: 'auto' }}>
                <Stack spacing={2}>
                    <Card variant="outlined">
                        <CardContent>
                            <Typography variant="h6" sx={{ mb: 2 }}>
                                番組情報
                            </Typography>
                            <Stack spacing={2}>
                                <UserSelector value={userId} onChange={onUserChange} includeMaster={false} />
                                <ChannelSelector
                                    required
                                    options={channelOptions}
                                    value={channelId}
                                    loading={channels.isLoading}
                                    placeholder="局名を入力して選択"
                                    onChange={setChannelId}
                                />
                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
                                    <DateTextInput label="開始日" value={date} onChange={setDate} />
                                    <TimeTextInput label="開始時刻" value={time} onChange={setTime} />
                                    <TextField
                                        fullWidth
                                        label="長さ（分）"
                                        type="number"
                                        value={duration}
                                        onChange={event => setDuration(event.target.value)}
                                        slotProps={{ htmlInput: { min: 1 } }}
                                    />
                                </Stack>
                                <TextField required label="番組名" value={name} onChange={event => setName(event.target.value)} />
                                <TextField label="概要" value={description} onChange={event => setDescription(event.target.value)} multiline minRows={2} />
                                <TextField label="詳細" value={extended} onChange={event => setExtended(event.target.value)} multiline minRows={3} />
                            </Stack>
                        </CardContent>
                    </Card>
                    <Card variant="outlined">
                        <CardContent>
                            <Stack direction="row" sx={{ alignItems: 'center', justifyContent: 'space-between', mb: 2 }}>
                                <Typography variant="h6">ビデオファイル</Typography>
                                <Button component="label" variant="outlined" startIcon={<AddOutlined />}>
                                    ファイル追加
                                    <input hidden type="file" multiple onChange={addFiles} />
                                </Button>
                            </Stack>
                            {files.length === 0 ? (
                                <Typography color="text.secondary">アップロードするファイルを追加してください。</Typography>
                            ) : (
                                <Stack spacing={2}>
                                    {files.map(item => (
                                        <Box key={item.key} sx={{ borderTop: 1, borderColor: 'divider', pt: 2 }}>
                                            <Stack direction="row" sx={{ alignItems: 'center', mb: 1 }}>
                                                <Typography sx={{ flex: 1, wordBreak: 'break-all' }}>{item.file.name}</Typography>
                                                <IconButton aria-label="ファイルを削除" onClick={() => setFiles(current => current.filter(value => value.key !== item.key))}>
                                                    <DeleteOutlineOutlined />
                                                </IconButton>
                                            </Stack>
                                            <Stack spacing={1.5}>
                                                <TextField
                                                    label="ファイルタイプ名"
                                                    value={item.viewName}
                                                    onChange={event => updateFile(item.key, { viewName: event.target.value })}
                                                />
                                                <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1.5}>
                                                    <FormControl fullWidth>
                                                        <InputLabel>ファイルタイプ</InputLabel>
                                                        <Select
                                                            label="ファイルタイプ"
                                                            value={item.fileType}
                                                            onChange={event => updateFile(item.key, { fileType: event.target.value as VideoFileType })}
                                                        >
                                                            <MenuItem value="ts">TS</MenuItem>
                                                            <MenuItem value="encoded">エンコード済み</MenuItem>
                                                        </Select>
                                                    </FormControl>
                                                    <FormControl fullWidth>
                                                        <InputLabel>保存先</InputLabel>
                                                        <Select
                                                            label="保存先"
                                                            value={item.parentDirectoryName}
                                                            onChange={event => updateFile(item.key, { parentDirectoryName: event.target.value })}
                                                        >
                                                            {config.data?.recorded.map(value => (
                                                                <MenuItem key={value} value={value}>
                                                                    {value}
                                                                </MenuItem>
                                                            ))}
                                                        </Select>
                                                    </FormControl>
                                                </Stack>
                                                <TextField
                                                    label="サブディレクトリ"
                                                    value={item.subDirectory}
                                                    onChange={event => updateFile(item.key, { subDirectory: event.target.value })}
                                                />
                                            </Stack>
                                        </Box>
                                    ))}
                                </Stack>
                            )}
                        </CardContent>
                    </Card>
                    <Box sx={{ display: 'flex', justifyContent: 'flex-end' }}>
                        <Button
                            variant="contained"
                            size="large"
                            startIcon={uploading ? <CircularProgress size={18} /> : <UploadOutlined />}
                            disabled={!canUpload || uploading}
                            onClick={() => void upload()}
                        >
                            {uploading ? 'アップロード中' : 'アップロード'}
                        </Button>
                    </Box>
                </Stack>
            </Box>
        </>
    );
}
