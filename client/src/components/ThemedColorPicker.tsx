import { Box, Popover, Slider, Stack, TextField, Tooltip, Typography } from '@mui/material';
import { type PointerEvent, type ReactNode, useMemo, useState } from 'react';

interface RgbColor {
    red: number;
    green: number;
    blue: number;
}

interface HsvColor {
    hue: number;
    saturation: number;
    value: number;
}

const commonColors = [
    '#ffffff',
    '#bdbdbd',
    '#616161',
    '#000000',
    '#ef5350',
    '#ec407a',
    '#ab47bc',
    '#7e57c2',
    '#5c6bc0',
    '#42a5f5',
    '#26c6da',
    '#26a69a',
    '#66bb6a',
    '#9ccc65',
    '#ffee58',
    '#ffca28',
    '#ffa726',
    '#ff7043',
];

function hexToRgb(hex: string): RgbColor {
    const normalized = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000';
    return {
        red: Number.parseInt(normalized.slice(0, 2), 16),
        green: Number.parseInt(normalized.slice(2, 4), 16),
        blue: Number.parseInt(normalized.slice(4, 6), 16),
    };
}

function rgbToHex({ red, green, blue }: RgbColor): string {
    return `#${[red, green, blue].map(channel => Math.round(channel).toString(16).padStart(2, '0')).join('')}`;
}

function rgbToHsv({ red, green, blue }: RgbColor): HsvColor {
    const r = red / 255;
    const g = green / 255;
    const b = blue / 255;
    const maximum = Math.max(r, g, b);
    const minimum = Math.min(r, g, b);
    const delta = maximum - minimum;
    let hue = 0;
    if (delta !== 0) {
        if (maximum === r) hue = 60 * (((g - b) / delta) % 6);
        else if (maximum === g) hue = 60 * ((b - r) / delta + 2);
        else hue = 60 * ((r - g) / delta + 4);
    }
    return {
        hue: hue < 0 ? hue + 360 : hue,
        saturation: maximum === 0 ? 0 : delta / maximum,
        value: maximum,
    };
}

function hsvToRgb({ hue, saturation, value }: HsvColor): RgbColor {
    const chroma = value * saturation;
    const secondary = chroma * (1 - Math.abs(((hue / 60) % 2) - 1));
    const offset = value - chroma;
    let channels: [number, number, number];
    if (hue < 60) channels = [chroma, secondary, 0];
    else if (hue < 120) channels = [secondary, chroma, 0];
    else if (hue < 180) channels = [0, chroma, secondary];
    else if (hue < 240) channels = [0, secondary, chroma];
    else if (hue < 300) channels = [secondary, 0, chroma];
    else channels = [chroma, 0, secondary];
    return { red: (channels[0] + offset) * 255, green: (channels[1] + offset) * 255, blue: (channels[2] + offset) * 255 };
}

export function ThemedColorPicker({
    value,
    label,
    onChange,
    showPresets = true,
    showHexInput = true,
    width = 52,
    height = 38,
}: {
    value: string;
    label: string;
    onChange: (value: string) => void;
    showPresets?: boolean;
    showHexInput?: boolean;
    width?: number;
    height?: number;
}): ReactNode {
    const [anchorElement, setAnchorElement] = useState<HTMLElement | null>(null);
    const [hexInput, setHexInput] = useState(value.toUpperCase());
    const hsv = useMemo(() => rgbToHsv(hexToRgb(value)), [value]);

    const updateHsv = (next: HsvColor): void => {
        const hex = rgbToHex(hsvToRgb(next));
        setHexInput(hex.toUpperCase());
        onChange(hex);
    };
    const updateSaturationValue = (event: PointerEvent<HTMLElement>): void => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const saturation = Math.min(1, Math.max(0, (event.clientX - bounds.left) / bounds.width));
        const brightness = Math.min(1, Math.max(0, 1 - (event.clientY - bounds.top) / bounds.height));
        updateHsv({ ...hsv, saturation, value: brightness });
    };

    return (
        <>
            <Tooltip title="色を選択">
                <Box
                    component="button"
                    type="button"
                    aria-label={label}
                    onClick={event => setAnchorElement(event.currentTarget)}
                    sx={{
                        width,
                        height,
                        p: 0.5,
                        border: 1,
                        borderColor: anchorElement === null ? 'divider' : 'primary.main',
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
                onClose={() => setAnchorElement(null)}
                anchorOrigin={{ vertical: 'bottom', horizontal: 'left' }}
                transformOrigin={{ vertical: 'top', horizontal: 'left' }}
                slotProps={{ paper: { sx: { width: 300, p: 2, bgcolor: 'background.paper', color: 'text.primary' } } }}
            >
                <Box
                    role="slider"
                    aria-label="彩度と明るさ"
                    tabIndex={0}
                    onPointerDown={event => {
                        event.currentTarget.setPointerCapture(event.pointerId);
                        updateSaturationValue(event);
                    }}
                    onPointerMove={event => {
                        if (event.currentTarget.hasPointerCapture(event.pointerId)) updateSaturationValue(event);
                    }}
                    sx={{
                        position: 'relative',
                        height: 170,
                        overflow: 'hidden',
                        borderRadius: 1,
                        bgcolor: `hsl(${hsv.hue} 100% 50%)`,
                        backgroundImage: 'linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, transparent)',
                        cursor: 'crosshair',
                        touchAction: 'none',
                    }}
                >
                    <Box
                        sx={{
                            position: 'absolute',
                            left: `${hsv.saturation * 100}%`,
                            top: `${(1 - hsv.value) * 100}%`,
                            width: 16,
                            height: 16,
                            border: '2px solid #fff',
                            borderRadius: '50%',
                            boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.75)',
                            transform: 'translate(-50%, -50%)',
                            pointerEvents: 'none',
                        }}
                    />
                </Box>
                <Slider
                    aria-label="色相"
                    value={hsv.hue}
                    min={0}
                    max={359}
                    onChange={(_, next) => updateHsv({ ...hsv, hue: Number(next) })}
                    sx={{
                        mt: 1.5,
                        mb: showPresets || showHexInput ? 1 : 0,
                        height: 10,
                        color: 'transparent',
                        '& .MuiSlider-rail': {
                            opacity: 1,
                            background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)',
                        },
                        '& .MuiSlider-track': { display: 'none' },
                        '& .MuiSlider-thumb': { width: 18, height: 18, bgcolor: value, border: '2px solid #fff', boxShadow: '0 0 0 1px rgba(0, 0, 0, 0.5)' },
                    }}
                />
                {showPresets && (
                    <Box sx={{ display: 'grid', gridTemplateColumns: 'repeat(9, 1fr)', gap: 0.75, mb: showHexInput ? 1.5 : 0 }}>
                        {commonColors.map(color => (
                            <Box
                                key={color}
                                component="button"
                                type="button"
                                aria-label={`${color}を選択`}
                                onClick={() => {
                                    setHexInput(color.toUpperCase());
                                    onChange(color);
                                }}
                                sx={{
                                    aspectRatio: '1',
                                    p: 0,
                                    border: color === value ? 2 : 1,
                                    borderColor: color === value ? 'primary.main' : 'divider',
                                    borderRadius: 0.75,
                                    bgcolor: color,
                                    cursor: 'pointer',
                                }}
                            />
                        ))}
                    </Box>
                )}
                {showHexInput && (
                    <Stack direction="row" spacing={1} sx={{ alignItems: 'center' }}>
                        <Typography variant="body2" color="text.secondary">
                            HEX
                        </Typography>
                        <TextField
                            size="small"
                            value={hexInput}
                            error={!/^#[0-9a-f]{6}$/i.test(hexInput)}
                            onChange={event => {
                                const next = event.target.value;
                                setHexInput(next);
                                if (/^#[0-9a-f]{6}$/i.test(next)) onChange(next.toLowerCase());
                            }}
                            onBlur={() => setHexInput(value.toUpperCase())}
                            slotProps={{ htmlInput: { maxLength: 7, spellCheck: false } }}
                            sx={{ flex: 1, '& input': { fontFamily: 'monospace', textTransform: 'uppercase' } }}
                        />
                    </Stack>
                )}
            </Popover>
        </>
    );
}
