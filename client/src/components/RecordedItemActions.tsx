import AccountCircleOutlined from '@mui/icons-material/AccountCircleOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import DeleteOutlineOutlined from '@mui/icons-material/DeleteOutlineOutlined';
import DownloadOutlined from '@mui/icons-material/DownloadOutlined';
import LockOpenOutlined from '@mui/icons-material/LockOpenOutlined';
import LockOutlined from '@mui/icons-material/LockOutlined';
import SearchOutlined from '@mui/icons-material/SearchOutlined';
import StopCircleOutlined from '@mui/icons-material/StopCircleOutlined';
import SubtitlesOutlined from '@mui/icons-material/SubtitlesOutlined';
import SyncOutlined from '@mui/icons-material/SyncOutlined';
import InfoOutlined from '@mui/icons-material/InfoOutlined';
import { Box, Button, Checkbox, Dialog, DialogActions, DialogContent, DialogTitle, Menu, MenuItem, Stack, Typography } from '@mui/material';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { RecordedItem, VideoFile } from '../../../api';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, type VideoAnalysisInfo } from '../core/api/queries';
import { markRecordedAnnictEpisodeWatchedKeepalive } from '../core/api/annictEpisode';
import { useNotifications } from '../core/notifications/Notifications';
import { withBasePath } from '../core/path';
import { getRecordedVideoDownloadRawURL, getRecordedVideoSchemeURL } from '../core/media/recorded';
import type { ActiveUserId } from '../core/storage/activeUser';
import { useSettings } from '../core/storage/settings';
import { useViewerProfile } from '../core/storage/viewerProfile';
import { UserSelector } from './UserSelector';

function formatBytes(size: number): string {
    if (size >= 1024 ** 3) return `${(size / 1024 ** 3).toFixed(2)} GB`;
    if (size >= 1024 ** 2) return `${(size / 1024 ** 2).toFixed(1)} MB`;
    return `${Math.max(0, Math.round(size / 1024))} KB`;
}

export function RecordedItemActions({
    item,
    anchorEl,
    onClose,
    onSearch,
    onEncode,
    onStop,
    onSubtitle,
    onChanged,
    onDeleted,
    includeDownload = false,
}: {
    item: RecordedItem;
    anchorEl: HTMLElement | null;
    onClose: () => void;
    onSearch: () => void;
    onEncode: () => void;
    onStop?: () => void;
    onSubtitle?: () => void;
    onChanged: () => void;
    onDeleted: () => void;
    includeDownload?: boolean;
}): ReactNode {
    const navigate = useNavigate();
    const queryClient = useQueryClient();
    const settings = useSettings();
    const viewerProfile = useViewerProfile();
    const config = useQuery({ queryKey: ['config'], queryFn: api.getConfig, staleTime: Number.POSITIVE_INFINITY });
    const { notify } = useNotifications();
    const [userOpen, setUserOpen] = useState(false);
    const [deleteOpen, setDeleteOpen] = useState(false);
    const [downloadOpen, setDownloadOpen] = useState(false);
    const [infoOpen, setInfoOpen] = useState(false);
    const [infoVideoId, setInfoVideoId] = useState<number | null>(null);
    const [selectedUserId, setSelectedUserId] = useState<ActiveUserId>(item.userId ?? null);
    const [deleteIds, setDeleteIds] = useState<Set<number>>(new Set());
    const files = useMemo(() => item.videoFiles ?? [], [item.videoFiles]);
    const info = useQuery({
        queryKey: ['video-info', infoVideoId],
        queryFn: () => api.getVideoInfo(infoVideoId!),
        enabled: infoOpen && infoVideoId !== null,
    });
    const reanalyze = useMutation({
        mutationFn: () => api.getVideoInfo(infoVideoId!, true),
        onSuccess: data => queryClient.setQueryData(['video-info', infoVideoId], data),
        onError: error => notify(`再解析に失敗しました: ${error.message}`, 'error'),
    });
    const annictEpisodeKey = ['recorded-annict-episode', item.id, viewerProfile.profileId] as const;
    const annictEpisode = useQuery({
        queryKey: annictEpisodeKey,
        queryFn: () => api.getRecordedAnnictEpisode(item.id),
        enabled: includeDownload && settings.annictAutoWatchOnDownload,
        retry: false,
    });

    useEffect(() => setSelectedUserId(item.userId ?? null), [item.userId]);
    useEffect(() => {
        if (!deleteOpen) return;
        setDeleteIds(new Set(settings.deleteRecordedDefaultValue ? files.map(file => file.id) : []));
    }, [deleteOpen, files, settings.deleteRecordedDefaultValue]);

    const protect = useMutation({
        mutationFn: () => (item.isProtected ? api.unprotectRecorded(item.id) : api.protectRecorded(item.id)),
        onSuccess: async () => {
            notify(item.isProtected ? '保護を解除しました。' : '録画を保護しました。', 'success');
            onChanged();
            await queryClient.invalidateQueries({ queryKey: ['recorded'] });
        },
        onError: error => notify(`保護状態を変更できません: ${error.message}`, 'error'),
    });
    const updateUser = useMutation({
        mutationFn: (userId: number) => api.updateRecordedUser(item.id, userId),
        onSuccess: async () => {
            setUserOpen(false);
            notify('ユーザーを変更しました。', 'success');
            onChanged();
            await queryClient.invalidateQueries({ queryKey: ['recorded'] });
        },
        onError: error => notify(`ユーザーを変更できません: ${error.message}`, 'error'),
    });
    const deleteFiles = useMutation({
        mutationFn: async () => {
            if (deleteIds.size === files.length && files.length > 0) {
                await api.deleteRecorded(item.id);
                return true;
            }
            for (const id of deleteIds) await api.deleteVideo(id);
            return false;
        },
        onSuccess: async allDeleted => {
            setDeleteOpen(false);
            notify(`${item.name} を削除しました。`, 'success');
            if (allDeleted) onDeleted();
            else onChanged();
            await queryClient.invalidateQueries({ queryKey: ['recorded'] });
        },
        onError: error => notify(`削除に失敗しました: ${error.message}`, 'error'),
    });
    const closeThen = (action: () => void): void => {
        onClose();
        action();
    };
    const download = (video: VideoFile, playlist: boolean): void => {
        if (settings.annictAutoWatchOnDownload && annictEpisode.data?.state === 'matched' && annictEpisode.data.writeConfigured && !annictEpisode.data.watched) {
            void markRecordedAnnictEpisodeWatchedKeepalive(item.id)
                .then(result => {
                    queryClient.setQueryData(annictEpisodeKey, result);
                    notify('download開始時にAnnictへ「見た」を記録しました。', 'success');
                })
                .catch(error => {
                    notify(`Annictへ自動記録できませんでした。downloadは継続します: ${error instanceof Error ? error.message : String(error)}`, 'warning');
                });
        }
        if (playlist) {
            window.location.href = withBasePath(`/api/videos/${video.id}/playlist`);
            return;
        }
        const schemeURL = config.data === undefined ? null : getRecordedVideoSchemeURL(video, config.data, settings, 'download');
        window.location.href = schemeURL ?? getRecordedVideoDownloadRawURL(video.id);
    };

    return (
        <>
            <Menu anchorEl={anchorEl} open={anchorEl !== null} onClose={onClose} disableScrollLock>
                {includeDownload && (
                    <MenuItem onClick={() => closeThen(() => setDownloadOpen(true))}>
                        <DownloadOutlined fontSize="small" sx={{ mr: 1.5 }} />
                        download
                    </MenuItem>
                )}
                {item.ruleId !== undefined && (
                    <MenuItem onClick={() => closeThen(() => void navigate(`/search?ruleId=${item.ruleId}`))}>
                        <CalendarMonthOutlined fontSize="small" sx={{ mr: 1.5 }} />
                        rule
                    </MenuItem>
                )}
                <MenuItem onClick={() => closeThen(onSearch)}>
                    <SearchOutlined fontSize="small" sx={{ mr: 1.5 }} />
                    search
                </MenuItem>
                <MenuItem onClick={() => closeThen(() => setUserOpen(true))}>
                    <AccountCircleOutlined fontSize="small" sx={{ mr: 1.5 }} />
                    user
                </MenuItem>
                {!item.isRecording && (
                    <MenuItem onClick={() => closeThen(onEncode)}>
                        <SyncOutlined fontSize="small" sx={{ mr: 1.5 }} />
                        encode
                    </MenuItem>
                )}
                {!item.isRecording && files.length > 0 && (
                    <MenuItem
                        onClick={() =>
                            closeThen(() => {
                                setInfoVideoId(files[0].id);
                                setInfoOpen(true);
                            })
                        }
                    >
                        <InfoOutlined fontSize="small" sx={{ mr: 1.5 }} />
                        Info
                    </MenuItem>
                )}
                {item.isRecording && onStop !== undefined && (
                    <MenuItem onClick={() => closeThen(onStop)}>
                        <StopCircleOutlined fontSize="small" sx={{ mr: 1.5 }} />
                        stop
                    </MenuItem>
                )}
                <MenuItem onClick={() => closeThen(() => protect.mutate())}>
                    {item.isProtected ? <LockOpenOutlined fontSize="small" sx={{ mr: 1.5 }} /> : <LockOutlined fontSize="small" sx={{ mr: 1.5 }} />}
                    {item.isProtected ? 'unprotect' : 'protect'}
                </MenuItem>
                {config.data?.developerMode === true && onSubtitle !== undefined && (
                    <MenuItem onClick={() => closeThen(onSubtitle)}>
                        <SubtitlesOutlined fontSize="small" sx={{ mr: 1.5 }} />
                        subtitle
                    </MenuItem>
                )}
                <MenuItem onClick={() => closeThen(() => setDeleteOpen(true))}>
                    <DeleteOutlineOutlined fontSize="small" sx={{ mr: 1.5 }} />
                    delete
                </MenuItem>
            </Menu>

            <Dialog open={userOpen} onClose={() => setUserOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>ユーザー変更</DialogTitle>
                <DialogContent>
                    <Typography variant="body2" sx={{ mb: 2 }}>
                        {item.name} のユーザーを変更
                    </Typography>
                    <UserSelector value={selectedUserId} onChange={setSelectedUserId} includeMaster={false} />
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setUserOpen(false)}>キャンセル</Button>
                    <Button
                        disabled={typeof selectedUserId !== 'number' || updateUser.isPending}
                        onClick={() => typeof selectedUserId === 'number' && updateUser.mutate(selectedUserId)}
                    >
                        変更
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={deleteOpen} onClose={() => setDeleteOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>録画を削除</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>{item.name} から削除するファイルを選択してください。</Typography>
                    <Stack>
                        {files.map(file => (
                            <Box key={file.id} component="label" sx={{ display: 'flex', alignItems: 'center' }}>
                                <Checkbox
                                    checked={deleteIds.has(file.id)}
                                    onChange={() =>
                                        setDeleteIds(current => {
                                            const next = new Set(current);
                                            if (next.has(file.id)) next.delete(file.id);
                                            else next.add(file.id);
                                            return next;
                                        })
                                    }
                                />
                                {file.name} ({formatBytes(file.size)})
                            </Box>
                        ))}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDeleteOpen(false)}>キャンセル</Button>
                    <Button color="error" disabled={deleteIds.size === 0 || deleteFiles.isPending} onClick={() => deleteFiles.mutate()}>
                        削除
                    </Button>
                </DialogActions>
            </Dialog>

            <Dialog open={downloadOpen} onClose={() => setDownloadOpen(false)} fullWidth maxWidth="xs">
                <DialogTitle>{item.name}</DialogTitle>
                <DialogContent>
                    <Typography sx={{ mb: 1 }}>video files</Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', mb: 2 }}>
                        {files.map(file => (
                            <Button key={file.id} variant="contained" onClick={() => download(file, false)}>
                                {file.name} ({formatBytes(file.size)})
                            </Button>
                        ))}
                    </Stack>
                    <Typography sx={{ mb: 1 }}>play lists</Typography>
                    <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap' }}>
                        {files.map(file => (
                            <Button key={file.id} variant="contained" onClick={() => download(file, true)}>
                                {file.name}
                            </Button>
                        ))}
                    </Stack>
                </DialogContent>
                <DialogActions>
                    <Button onClick={() => setDownloadOpen(false)}>閉じる</Button>
                </DialogActions>
            </Dialog>

            <Dialog open={infoOpen} onClose={() => setInfoOpen(false)} fullWidth maxWidth="md">
                <DialogTitle>Info</DialogTitle>
                <DialogContent>
                    {files.length > 1 && (
                        <Stack direction="row" spacing={1} sx={{ mb: 2, flexWrap: 'wrap' }}>
                            {files.map(file => (
                                <Button key={file.id} variant={infoVideoId === file.id ? 'contained' : 'outlined'} onClick={() => setInfoVideoId(file.id)}>
                                    {file.name}
                                </Button>
                            ))}
                        </Stack>
                    )}
                    {info.isLoading ? (
                        <Typography color="text.secondary">解析中...</Typography>
                    ) : info.isError ? (
                        <Typography color="error">解析情報を取得できません: {info.error.message}</Typography>
                    ) : info.data !== undefined ? (
                        <VideoInfoView info={info.data} />
                    ) : null}
                </DialogContent>
                <DialogActions>
                    <Button disabled={reanalyze.isPending || infoVideoId === null} onClick={() => reanalyze.mutate()}>
                        Reanalyze
                    </Button>
                    <Button onClick={() => setInfoOpen(false)}>閉じる</Button>
                </DialogActions>
            </Dialog>
        </>
    );
}

function VideoInfoView({ info }: { info: VideoAnalysisInfo }): ReactNode {
    const audios = info.streams.filter(stream => stream.type === 'audio');
    const subtitles = info.streams.filter(stream => stream.type === 'subtitle');
    const ts = info.ts as Record<string, any> | null;
    const rows: Array<[string, string]> = [
        ['File', info.fileName],
        ['Format', info.formatName ?? '-'],
        ['Size', formatBytes(info.size)],
        ['Duration', info.duration === null ? '-' : `${info.duration.toFixed(3)} sec`],
        ['Video', [info.videoCodec, info.videoProfile].filter(Boolean).join(' / ') || '-'],
        ['Resolution', info.width === null || info.height === null ? '-' : `${info.width} x ${info.height}`],
        ['Frame rate', info.frameRate === null ? '-' : `${info.frameRate.toFixed(3)} fps`],
        ['Pixel / HDR', [info.pixelFormat, info.bitDepth === null ? null : `${info.bitDepth} bit`, info.hdr].filter(Boolean).join(' / ') || '-'],
        ['Audio', audios.map(stream => `${stream.index}: ${stream.codec ?? '-'} ${stream.language ?? ''} ${stream.channels ?? ''}ch`).join('\n') || '-'],
        ['Subtitle', subtitles.map(stream => `${stream.index}: ${stream.codec ?? '-'} ${stream.language ?? ''} ${stream.title ?? ''}`).join('\n') || '-'],
        ['TS IDs', ts === null ? '-' : `network=${ts.networkId ?? '-'} transport=${ts.transportStreamId ?? '-'} service=${ts.serviceId ?? '-'}`],
        [
            'TS PIDs',
            ts === null ? '-' : `PMT=${ts.pmtPid ?? '-'} PCR=${ts.pcrPid ?? '-'} video=${ts.videoPid ?? '-'} audio=${ts.audioPid ?? '-'} subtitle=${ts.subtitlePid ?? '-'}`,
        ],
        ['Analyzed', info.analyzedAt === null ? '-' : new Date(info.analyzedAt).toLocaleString()],
        ['Status', info.analysisError ?? 'OK'],
    ];
    return (
        <Box sx={{ display: 'grid', gridTemplateColumns: 'minmax(100px, 160px) 1fr', gap: 1 }}>
            {rows.map(([label, value]) => (
                <Box key={label} sx={{ display: 'contents' }}>
                    <Typography color="text.secondary">{label}</Typography>
                    <Typography sx={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all' }}>{value}</Typography>
                </Box>
            ))}
        </Box>
    );
}
