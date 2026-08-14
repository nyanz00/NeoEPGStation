import AccessTimeOutlined from '@mui/icons-material/AccessTimeOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import { Box, IconButton, InputAdornment, TextField, useTheme } from '@mui/material';
import { type ChangeEvent, type ReactNode, useEffect, useRef, useState } from 'react';

function dateTextFromValue(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match === null ? '' : `${match[1]}/${match[2]}/${match[3]}`;
}

function parseDateText(value: string): string | null {
    const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value.normalize('NFKC'));
    if (match === null) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    const date = new Date(year, month - 1, day);
    if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

function formatDateText(value: string): string {
    const digits = value.normalize('NFKC').replace(/\D/g, '').slice(0, 8);
    if (digits.length < 4) return digits;
    if (digits.length === 4) return `${digits}/`;
    if (digits.length < 6) return `${digits.slice(0, 4)}/${digits.slice(4)}`;
    if (digits.length === 6) return `${digits.slice(0, 4)}/${digits.slice(4)}/`;
    return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6)}`;
}

function formatTimeText(value: string): string {
    const digits = value.normalize('NFKC').replace(/\D/g, '').slice(0, 4);
    if (digits.length < 2) return digits;
    if (digits.length === 2) return `${digits}:`;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

function isValidTime(value: string): boolean {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    return match !== null && Number(match[1]) <= 23 && Number(match[2]) <= 59;
}

function openNativePicker(input: HTMLInputElement | null): void {
    if (input === null) return;
    try {
        input.showPicker();
    } catch {
        input.click();
    }
}

interface CommonInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    fullWidth?: boolean;
}

export function DateTextInput({ label, value, onChange, fullWidth = true }: CommonInputProps): ReactNode {
    const theme = useTheme();
    const [text, setText] = useState(() => dateTextFromValue(value));
    const pickerRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (value.length > 0) setText(dateTextFromValue(value));
        else if (parseDateText(text) !== null) setText('');
    }, [text, value]);

    const update = (event: ChangeEvent<HTMLInputElement>): void => {
        const raw = event.target.value;
        const next = raw.length < text.length ? raw : formatDateText(raw);
        setText(next);
        onChange(parseDateText(next) ?? '');
    };

    return (
        <Box sx={{ position: 'relative', width: fullWidth ? '100%' : 'auto' }}>
            <TextField
                fullWidth={fullWidth}
                label={label}
                value={text}
                onChange={update}
                placeholder="YYYY/MM/DD"
                error={text.length === 10 && parseDateText(text) === null}
                slotProps={{
                    htmlInput: { inputMode: 'numeric', maxLength: 10 },
                    input: {
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton aria-label={`${label}をカレンダーから選択`} edge="end" onClick={() => openNativePicker(pickerRef.current)}>
                                    <CalendarMonthOutlined />
                                </IconButton>
                            </InputAdornment>
                        ),
                    },
                }}
            />
            <input
                ref={pickerRef}
                type="date"
                autoComplete="off"
                min="0001-01-01"
                max="9999-12-31"
                value={value}
                onChange={event => {
                    setText(dateTextFromValue(event.target.value));
                    onChange(event.target.value);
                }}
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: 'absolute', top: 0, right: 0, width: 48, height: '100%', opacity: 0, pointerEvents: 'none', colorScheme: theme.palette.mode }}
            />
        </Box>
    );
}

export function TimeTextInput({ label, value, onChange, fullWidth = true }: CommonInputProps): ReactNode {
    const theme = useTheme();
    const [text, setText] = useState(value);
    const pickerRef = useRef<HTMLInputElement>(null);

    useEffect(() => {
        if (value.length > 0) setText(value);
        else if (isValidTime(text)) setText('');
    }, [text, value]);

    const update = (event: ChangeEvent<HTMLInputElement>): void => {
        const raw = event.target.value;
        const next = raw.length < text.length ? raw : formatTimeText(raw);
        setText(next);
        onChange(isValidTime(next) ? next : '');
    };

    return (
        <Box sx={{ position: 'relative', width: fullWidth ? '100%' : 'auto' }}>
            <TextField
                fullWidth={fullWidth}
                label={label}
                value={text}
                onChange={update}
                placeholder="HH:mm"
                error={text.length === 5 && !isValidTime(text)}
                slotProps={{
                    htmlInput: { inputMode: 'numeric', maxLength: 5 },
                    input: {
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton aria-label={`${label}を時計から選択`} edge="end" onClick={() => openNativePicker(pickerRef.current)}>
                                    <AccessTimeOutlined />
                                </IconButton>
                            </InputAdornment>
                        ),
                    },
                }}
            />
            <input
                ref={pickerRef}
                type="time"
                autoComplete="off"
                value={value}
                onChange={event => {
                    setText(event.target.value);
                    onChange(event.target.value);
                }}
                tabIndex={-1}
                aria-hidden="true"
                style={{ position: 'absolute', top: 0, right: 0, width: 48, height: '100%', opacity: 0, pointerEvents: 'none', colorScheme: theme.palette.mode }}
            />
        </Box>
    );
}
