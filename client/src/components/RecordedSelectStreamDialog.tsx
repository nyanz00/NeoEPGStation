import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, InputLabel, MenuItem, Select, Stack, Typography } from '@mui/material';
import { useQuery } from '@tanstack/react-query';
import type { Config, VideoFile, VideoSubtitle } from '../../../api';
import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../core/api/queries';
import { useNotifications } from '../core/notifications/Notifications';
import {
    getRecordedStreamOptions,
    getRecordedStreamWatchPath,
    loadRecordedSelectStreamSettings,
    saveRecordedSelectStreamSettings,
    type RecordedStreamType,
} from '../core/media/recorded';
import { preferredSubtitleIndex } from '../core/media/subtitles';
import type { AppSettings } from '../core/storage/settings';

interface RecordedSelectStreamDialogProps {
    recordedId: number;
    video: VideoFile | null;
    config?: Config;
    settings: AppSettings;
    onClose: () => void;
    onWatch: (path: string) => void;
}

function initialMode(qualities: string[], settings: AppSettings, savedMode: number): number {
    const preferred = settings.watchDefaultQuality === null ? -1 : qualities.indexOf(settings.watchDefaultQuality);
    if (preferred >= 0) return preferred;
    return Math.min(Math.max(savedMode, 0), Math.max(qualities.length - 1, 0));
}

function preferredSubtitle(subtitles: VideoSubtitle[], settings: AppSettings, saved: number | null): number | null {
    const preferred = preferredSubtitleIndex(subtitles, settings.watchSubtitlePreferredKeywords);
    if (preferred !== null) return preferred;
    if (saved !== null && subtitles.some(item => item.subtitleIndex === saved)) return saved;
    return null;
}

export function RecordedSelectStreamDialog({ recordedId, video, config, settings, onClose, onWatch }: RecordedSelectStreamDialogProps): ReactNode {
    const [type, setType] = useState<RecordedStreamType>('HLS');
    const [mode, setMode] = useState(0);
    const [subtitleIndex, setSubtitleIndex] = useState<number | null>(null);
    const [preparing, setPreparing] = useState(false);
    const subtitlePreparation = useRef<{
        videoFileId: number;
        subtitleIndex: number;
        promise: ReturnType<typeof api.prepareVideoSubtitle>;
    } | null>(null);
    const { notify } = useNotifications();
    const options = useMemo(() => getRecordedStreamOptions(video, config), [config, video]);
    const selectedOption = options.find(option => option.type === type) ?? options[0];
    const subtitles = useQuery({
        queryKey: ['video-subtitles', video?.id],
        queryFn: () => api.getVideoSubtitles(video!.id),
        enabled: video !== null && video.type === 'encoded',
        staleTime: Number.POSITIVE_INFINITY,
    });
    const prepareSubtitle = useCallback((videoFileId: number, index: number) => {
        const current = subtitlePreparation.current;
        if (current?.videoFileId === videoFileId && current.subtitleIndex === index) return current.promise;

        const promise = api.prepareVideoSubtitle(videoFileId, index);
        const entry = { videoFileId, subtitleIndex: index, promise };
        subtitlePreparation.current = entry;
        void promise.catch(() => {
            if (subtitlePreparation.current === entry) subtitlePreparation.current = null;
        });
        return promise;
    }, []);

    useEffect(() => {
        if (video === null) return;
        const saved = loadRecordedSelectStreamSettings();
        const initial = options.find(option => option.type === saved.type) ?? options[0];
        setType(initial?.type ?? (video.type === 'ts' ? 'HLS-TS' : 'HLS'));
        setMode(initial === undefined ? 0 : initialMode(initial.qualities, settings, saved.mode));
    }, [options, settings, video]);

    useEffect(() => {
        if (video?.type !== 'encoded' || subtitles.data === undefined) {
            setSubtitleIndex(null);
            return;
        }
        const saved = loadRecordedSelectStreamSettings();
        setSubtitleIndex(preferredSubtitle(subtitles.data.items, settings, saved.subtitleIndex));
    }, [settings, subtitles.data, video]);

    useEffect(() => {
        if (video?.type !== 'encoded' || subtitleIndex === null) return;
        // Start extracting the selected subtitle while the user is still choosing
        // stream settings. watch() awaits this exact request instead of issuing another.
        void prepareSubtitle(video.id, subtitleIndex).catch(() => {});
    }, [prepareSubtitle, subtitleIndex, video]);

    const changeType = (next: RecordedStreamType): void => {
        const nextOption = options.find(option => option.type === next);
        setType(next);
        setMode(nextOption === undefined ? 0 : initialMode(nextOption.qualities, settings, 0));
    };
    const close = (): void => {
        saveRecordedSelectStreamSettings({ type: selectedOption?.type ?? type, mode, subtitleIndex });
        onClose();
    };
    const watch = async (): Promise<void> => {
        if (video === null || selectedOption === undefined) return;
        const quality = selectedOption.qualities[mode];
        if (quality === undefined) return;
        setPreparing(true);
        try {
            const selectedIndex = video.type === 'encoded' ? subtitleIndex : null;
            const prepared = selectedIndex === null ? undefined : await prepareSubtitle(video.id, selectedIndex);
            saveRecordedSelectStreamSettings({ type: selectedOption.type, mode, subtitleIndex });
            onWatch(getRecordedStreamWatchPath(recordedId, video.id, selectedOption.type, mode, quality, settings, selectedIndex, prepared?.subtitleFileKey));
            onClose();
        } catch (error) {
            notify(`字幕の準備に失敗しました: ${error instanceof Error ? error.message : String(error)}`, 'error');
        } finally {
            setPreparing(false);
        }
    };

    return (
        <Dialog open={video !== null} onClose={close} fullWidth maxWidth="xs">
            <DialogTitle>{video?.name ?? ''} - STREAMING</DialogTitle>
            <DialogContent>
                {options.length === 0 ? (
                    <Typography color="text.secondary">この録画ファイルで利用できるストリーム設定がありません。</Typography>
                ) : (
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <Stack direction="row" spacing={1.5}>
                            <FormControl variant="standard" sx={{ flex: 1 }}>
                                <InputLabel>ストリーム</InputLabel>
                                <Select value={selectedOption?.type ?? ''} onChange={event => changeType(event.target.value as RecordedStreamType)}>
                                    {options.map(option => (
                                        <MenuItem key={option.type} value={option.type}>
                                            {option.type}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                            <FormControl variant="standard" sx={{ flex: 1 }}>
                                <InputLabel>画質</InputLabel>
                                <Select value={mode} onChange={event => setMode(Number(event.target.value))}>
                                    {(selectedOption?.qualities ?? []).map((quality, index) => (
                                        <MenuItem key={`${quality}-${index.toString(10)}`} value={index}>
                                            {quality}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Stack>
                        {video?.type === 'encoded' && (
                            <FormControl variant="standard" fullWidth>
                                <InputLabel>字幕</InputLabel>
                                <Select
                                    value={subtitleIndex === null ? 'none' : subtitleIndex}
                                    onChange={event => setSubtitleIndex(event.target.value === 'none' ? null : Number(event.target.value))}
                                >
                                    <MenuItem value="none">字幕なし</MenuItem>
                                    {(subtitles.data?.items ?? []).map(subtitle => (
                                        <MenuItem key={subtitle.subtitleIndex} value={subtitle.subtitleIndex}>
                                            {subtitle.displayName}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        )}
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                <Button color="inherit" onClick={close}>
                    キャンセル
                </Button>
                <Button disabled={preparing || selectedOption === undefined || (video?.type === 'encoded' && subtitles.isPending)} onClick={() => void watch()}>
                    {preparing ? '字幕を準備中…' : '視聴'}
                </Button>
            </DialogActions>
        </Dialog>
    );
}
