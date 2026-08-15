import { Button, Dialog, DialogActions, DialogContent, DialogTitle, FormControl, FormControlLabel, InputLabel, MenuItem, Select, Stack, Switch, Typography } from '@mui/material';
import type { Config, ScheduleChannleItem } from '../../../api';
import { type ReactNode, useEffect, useMemo, useState } from 'react';
import {
    getLivePlaylistURL,
    getLiveSchemeURL,
    getLiveStreamOptions,
    getLiveWatchPath,
    loadOnAirSelectStreamSettings,
    saveOnAirSelectStreamSettings,
    type LiveStreamType,
} from '../core/media/live';
import type { AppSettings } from '../core/storage/settings';

interface OnAirSelectStreamDialogProps {
    channel: ScheduleChannleItem | null;
    config?: Config;
    settings: AppSettings;
    onClose: () => void;
    onGuide?: (channelId: number) => void;
    onWatch: (path: string) => void;
}

function defaultMode(qualities: string[], settings: AppSettings, savedMode: number): number {
    const preferred = settings.watchDefaultQuality === null ? -1 : qualities.indexOf(settings.watchDefaultQuality);
    if (preferred >= 0) return preferred;
    return Math.min(Math.max(savedMode, 0), Math.max(qualities.length - 1, 0));
}

export function OnAirSelectStreamDialog({ channel, config, settings, onClose, onGuide, onWatch }: OnAirSelectStreamDialogProps): ReactNode {
    const [useURLScheme, setUseURLScheme] = useState(false);
    const [type, setType] = useState<LiveStreamType>('M2TS');
    const [mode, setMode] = useState(0);
    const options = useMemo(() => getLiveStreamOptions(config, settings, useURLScheme), [config, settings, useURLScheme]);
    const selectedOption = options.find(option => option.type === type) ?? options[0];

    useEffect(() => {
        if (channel === null) return;
        const saved = loadOnAirSelectStreamSettings();
        const initialUseURLScheme = !settings.isPreferredPlayingLiveM2TSOnWeb;
        const initialOptions = getLiveStreamOptions(config, settings, initialUseURLScheme);
        // The current low-latency setting determines the default stream type.
        // A type saved by an earlier dialog operation must not override it.
        const initial = initialOptions[0];
        setUseURLScheme(initialUseURLScheme);
        setType(initial?.type ?? 'M2TS');
        setMode(initial === undefined ? 0 : defaultMode(initial.qualities, settings, saved.mode));
    }, [channel, config, settings]);

    const changeExternal = (next: boolean): void => {
        const nextOptions = getLiveStreamOptions(config, settings, next);
        const nextOption = nextOptions.find(option => option.type === type) ?? nextOptions[0];
        setUseURLScheme(next);
        setType(nextOption?.type ?? 'M2TS');
        setMode(nextOption === undefined ? 0 : defaultMode(nextOption.qualities, settings, 0));
    };
    const changeType = (next: LiveStreamType): void => {
        const nextOption = options.find(option => option.type === next);
        setType(next);
        setMode(nextOption === undefined ? 0 : defaultMode(nextOption.qualities, settings, 0));
    };
    const close = (): void => {
        saveOnAirSelectStreamSettings({ useURLScheme, type, mode });
        onClose();
    };
    const watch = (): void => {
        if (channel === null || config === undefined || selectedOption === undefined) return;
        const quality = selectedOption.qualities[mode];
        if (quality === undefined) return;
        saveOnAirSelectStreamSettings({ useURLScheme, type: selectedOption.type, mode });
        if (useURLScheme) {
            window.location.href = getLiveSchemeURL(channel.id, mode, quality, config, settings) ?? getLivePlaylistURL(channel.id, mode, quality, settings);
            onClose();
            return;
        }
        onWatch(getLiveWatchPath(channel.id, selectedOption.type, mode, quality, settings));
        onClose();
    };

    return (
        <Dialog open={channel !== null} onClose={close} fullWidth maxWidth="xs">
            <DialogTitle>{channel?.name ?? ''}</DialogTitle>
            <DialogContent>
                {options.length === 0 ? (
                    <Typography color="text.secondary">利用できる視聴設定がありません。</Typography>
                ) : (
                    <Stack spacing={2} sx={{ pt: 1 }}>
                        <Stack direction="row" spacing={1.5}>
                            <FormControl variant="standard" sx={{ flex: 1 }}>
                                <InputLabel>ストリーム</InputLabel>
                                <Select value={selectedOption?.type ?? ''} onChange={event => changeType(event.target.value as LiveStreamType)}>
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
                                        <MenuItem key={`${quality}-${index}`} value={index}>
                                            {quality}
                                        </MenuItem>
                                    ))}
                                </Select>
                            </FormControl>
                        </Stack>
                        <FormControlLabel control={<Switch checked={useURLScheme} onChange={event => changeExternal(event.target.checked)} />} label="外部アプリで開く" />
                    </Stack>
                )}
            </DialogContent>
            <DialogActions>
                {onGuide !== undefined && channel !== null && (
                    <Button
                        onClick={() => {
                            onGuide(channel.id);
                            onClose();
                        }}
                    >
                        番組表
                    </Button>
                )}
                <Button color="inherit" onClick={close}>
                    キャンセル
                </Button>
                <Button disabled={selectedOption === undefined} onClick={watch}>
                    視聴
                </Button>
            </DialogActions>
        </Dialog>
    );
}
