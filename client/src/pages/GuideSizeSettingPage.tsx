import { Box, Button, Card, FormControl, MenuItem, Popover, Select, Stack, Tab, Tabs, Tooltip, Typography } from '@mui/material';
import { type MouseEvent, type ReactNode, useState } from 'react';
import { PageHeader } from '../components/PageHeader';
import { ThemedColorPicker } from '../components/ThemedColorPicker';
import { useNotifications } from '../core/notifications/Notifications';
import {
    cloneGuideColorSettings,
    defaultGuideColorSettings,
    defaultGuideSizeSettings,
    guideColorLabels,
    loadGuideColorSettings,
    loadGuideSizeSettings,
    saveGuideColorSettings,
    saveGuideSizeSettings,
    type GuideColorSettings,
    type GuideSizeSettings,
    type GuideSizeValue,
} from '../core/storage/guide';

const channelHeights = Array.from(new Set([...Array.from({ length: 10 }, (_, index) => (index + 1) * 10), 54])).sort((left, right) => left - right);
const channelWidths = Array.from({ length: 61 }, (_, index) => index * 10);
const timeHeights = Array.from({ length: 40 }, (_, index) => (index + 1) * 10);
const timeWidths = channelHeights;
const fontSizes = Array.from({ length: 80 }, (_, index) => (index + 1) / 2);

const rows: Array<{ key: keyof GuideSizeValue; label: string; values: number[] }> = [
    { key: 'channelHeight', label: 'チャンネル高さ', values: channelHeights },
    { key: 'channelWidth', label: 'チャンネル横幅', values: channelWidths },
    { key: 'channelFontsize', label: 'チャンネルフォント', values: fontSizes },
    { key: 'timescaleHeight', label: '時刻高さ', values: timeHeights },
    { key: 'timescaleWidth', label: '時刻横幅', values: timeWidths },
    { key: 'timescaleFontsize', label: '時刻フォント', values: fontSizes },
    { key: 'programFontSize', label: '番組フォント', values: fontSizes },
];

type GuideSettingTab = 'size' | 'color';
type GuidePalette = keyof GuideColorSettings;

const colorPresets = [
    '#ffffff',
    '#eceff1',
    '#cfd8dc',
    '#90a4ae',
    '#607d8b',
    '#455a64',
    '#ffcdd2',
    '#ef9a9a',
    '#e57373',
    '#ef5350',
    '#f8bbd0',
    '#f48fb1',
    '#f06292',
    '#ec407a',
    '#e1bee7',
    '#ce93d8',
    '#ba68c8',
    '#ab47bc',
    '#c5cae9',
    '#9fa8da',
    '#7986cb',
    '#5c6bc0',
    '#bbdefb',
    '#90caf9',
    '#64b5f6',
    '#42a5f5',
    '#b2ebf2',
    '#80deea',
    '#4dd0e1',
    '#26c6da',
    '#b2dfdb',
    '#80cbc4',
    '#4db6ac',
    '#26a69a',
    '#c8e6c9',
    '#a5d6a7',
    '#81c784',
    '#66bb6a',
    '#dcedc8',
    '#c5e1a5',
    '#aed581',
    '#9ccc65',
    '#fff9c4',
    '#fff59d',
    '#fff176',
    '#ffee58',
    '#ffe0b2',
    '#ffcc80',
    '#ffb74d',
    '#ffa726',
    '#ffccbc',
    '#ffab91',
    '#ff8a65',
    '#ff7043',
];

function SizeColumn({ title, value, onChange }: { title: string; value: GuideSizeValue; onChange: (key: keyof GuideSizeValue, value: number) => void }): ReactNode {
    return (
        <Box sx={{ flex: 1, minWidth: 280 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                {title}
            </Typography>
            <Stack spacing={1.25}>
                {rows.map(row => (
                    <Box key={row.key} sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 2 }}>
                        <Typography>{row.label}</Typography>
                        <FormControl variant="standard" sx={{ width: 108 }}>
                            <Select value={value[row.key]} onChange={event => onChange(row.key, Number(event.target.value))}>
                                {row.values.map(item => (
                                    <MenuItem key={item} value={item}>
                                        {Number.isInteger(item) ? item : item.toFixed(1)}
                                    </MenuItem>
                                ))}
                            </Select>
                        </FormControl>
                    </Box>
                ))}
            </Stack>
        </Box>
    );
}

function ColorColumn({ title, value, onChange }: { title: string; value: string[]; onChange: (index: number, value: string) => void }): ReactNode {
    return (
        <Box sx={{ flex: 1, minWidth: 280 }}>
            <Typography variant="h6" sx={{ mb: 2 }}>
                {title}
            </Typography>
            <Stack spacing={0.75}>
                {guideColorLabels.map((label, index) => (
                    <Box key={label} sx={{ minHeight: 40, display: 'flex', alignItems: 'center', gap: 1.5 }}>
                        <Typography sx={{ flex: 1 }}>{label}</Typography>
                        <Typography variant="caption" sx={{ width: 58, color: 'text.secondary', fontFamily: 'monospace', textTransform: 'uppercase' }}>
                            {value[index]}
                        </Typography>
                        <ColorPicker value={value[index]} label={`${title}の${label}の色`} onChange={next => onChange(index, next)} />
                    </Box>
                ))}
            </Stack>
        </Box>
    );
}

function ColorPicker({ value, label, onChange }: { value: string; label: string; onChange: (value: string) => void }): ReactNode {
    const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
    const openPicker = (event: MouseEvent<HTMLElement>): void => setAnchorElement(event.currentTarget);
    const closePicker = (): void => setAnchorElement(null);
    const selectPreset = (color: string): void => {
        onChange(color);
        closePicker();
    };

    return (
        <>
            <Tooltip title="色を選択">
                <Box
                    component="button"
                    type="button"
                    aria-label={label}
                    onClick={openPicker}
                    sx={{
                        width: 44,
                        height: 32,
                        p: 0.375,
                        border: 1,
                        borderColor: anchorElement ? 'primary.main' : 'divider',
                        borderRadius: 1,
                        bgcolor: 'background.paper',
                        cursor: 'pointer',
                    }}
                >
                    <Box sx={{ width: '100%', height: '100%', borderRadius: 0.5, bgcolor: value }} />
                </Box>
            </Tooltip>
            <Popover
                open={anchorElement !== null}
                anchorEl={anchorElement}
                onClose={closePicker}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'right' }}
                transformOrigin={{ vertical: 'top', horizontal: 'right' }}
                slotProps={{ paper: { sx: { p: 1.5, bgcolor: 'background.paper', color: 'text.primary' } } }}
            >
                <Typography variant="subtitle2" sx={{ mb: 1 }}>
                    プリセット
                </Typography>
                <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(7, 28px)', gap: 0.75 }}>
                    {colorPresets.map(color => (
                        <Tooltip key={color} title={color.toUpperCase()}>
                            <Box
                                component="button"
                                type="button"
                                aria-label={`${color}を選択`}
                                onClick={() => selectPreset(color)}
                                sx={{
                                    width: 28,
                                    height: 28,
                                    p: 0,
                                    border: color === value ? 2 : 1,
                                    borderColor: color === value ? 'primary.main' : 'divider',
                                    borderRadius: 0.75,
                                    bgcolor: color,
                                    cursor: 'pointer',
                                    outline: color === value ? '1px solid' : 'none',
                                    outlineColor: 'background.paper',
                                    outlineOffset: -3,
                                }}
                            />
                        </Tooltip>
                    ))}
                </Box>
                <Stack direction="row" spacing={1.25} sx={{ alignItems: 'center', mt: 1.5, pt: 1.25, borderTop: 1, borderColor: 'divider' }}>
                    <Typography variant="body2" color="text.secondary" sx={{ flex: 1 }}>
                        任意の色
                    </Typography>
                    <Typography variant="caption" sx={{ fontFamily: 'monospace', textTransform: 'uppercase' }}>
                        {value}
                    </Typography>
                    <ThemedColorPicker value={value} label={`${label}を詳細に選択`} onChange={onChange} showPresets={false} width={44} height={32} />
                </Stack>
            </Popover>
        </>
    );
}

export function GuideSizeSettingPage(): ReactNode {
    const { notify } = useNotifications();
    const [activeTab, setActiveTab] = useState<GuideSettingTab>('size');
    const [value, setValue] = useState<GuideSizeSettings>(() => loadGuideSizeSettings());
    const [colors, setColors] = useState<GuideColorSettings>(() => loadGuideColorSettings());
    const update = (target: keyof GuideSizeSettings, key: keyof GuideSizeValue, next: number): void => {
        setValue(current => ({ ...current, [target]: { ...current[target], [key]: next } }));
    };
    const updateColor = (palette: GuidePalette, index: number, next: string): void => {
        setColors(current => ({
            ...current,
            [palette]: current[palette].map((color, colorIndex) => (colorIndex === index ? next.toLowerCase() : color)),
        }));
    };
    const resetSize = (): void => {
        setValue({ tablet: { ...defaultGuideSizeSettings.tablet }, mobile: { ...defaultGuideSizeSettings.mobile } });
    };
    const saveSize = (): void => {
        saveGuideSizeSettings(value);
        notify('保存されました', 'success');
    };
    const resetColors = (): void => {
        setColors(cloneGuideColorSettings(defaultGuideColorSettings));
    };
    const saveColors = (): void => {
        saveGuideColorSettings(colors);
        notify('番組表の色を保存しました', 'success');
    };

    return (
        <>
            <PageHeader title="番組表設定" />
            <Box sx={{ p: 2 }}>
                <Card variant="outlined" sx={{ maxWidth: 1000, mx: 'auto', mb: 2 }}>
                    <Tabs value={activeTab} onChange={(_event, next: GuideSettingTab) => setActiveTab(next)} variant="fullWidth" aria-label="番組表表示設定">
                        <Tab value="size" label="サイズ" />
                        <Tab value="color" label="色" />
                    </Tabs>
                </Card>
                {activeTab === 'size' ? (
                    <Card variant="outlined" sx={{ maxWidth: 800, mx: 'auto', p: 2 }}>
                        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={4}>
                            <SizeColumn title="通常表示" value={value.tablet} onChange={(key, next) => update('tablet', key, next)} />
                            <SizeColumn title="モバイル表示" value={value.mobile} onChange={(key, next) => update('mobile', key, next)} />
                        </Stack>
                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 2 }}>
                            <Button color="inherit" onClick={resetSize}>
                                リセット
                            </Button>
                            <Button onClick={saveSize}>保存</Button>
                        </Stack>
                    </Card>
                ) : (
                    <Card variant="outlined" sx={{ maxWidth: 1000, mx: 'auto', p: 2 }}>
                        <Typography color="text.secondary" sx={{ mb: 2 }}>
                            番組のジャンルごとの背景色を設定します。「ダークテーマの配色を無効化する」が有効な場合は、通常配色が使用されます。
                        </Typography>
                        <Stack direction={{ xs: 'column', md: 'row' }} spacing={4}>
                            <ColorColumn title="通常配色" value={colors.light} onChange={(index, next) => updateColor('light', index, next)} />
                            <ColorColumn title="ダーク配色" value={colors.dark} onChange={(index, next) => updateColor('dark', index, next)} />
                        </Stack>
                        <Stack direction="row" spacing={1} sx={{ justifyContent: 'flex-end', mt: 2 }}>
                            <Button color="inherit" onClick={resetColors}>
                                既定色に戻す
                            </Button>
                            <Button onClick={saveColors}>保存</Button>
                        </Stack>
                    </Card>
                )}
            </Box>
        </>
    );
}
