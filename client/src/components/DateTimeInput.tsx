import AccessTimeOutlined from '@mui/icons-material/AccessTimeOutlined';
import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import { Box, IconButton, InputAdornment, TextField } from '@mui/material';
import { type ChangeEvent, type ReactNode, useEffect, useState } from 'react';
import { dateTextFromValue, formatDateText, formatDateTimeText, formatTimeText, parseDateText, parseDateTimeText, parseTimeText } from '../core/dateTimeInput';
import { DateTimePickerDialog } from './DateTimePickerDialog';

interface CommonInputProps {
    label: string;
    value: string;
    onChange: (value: string) => void;
    fullWidth?: boolean;
}

interface DateTextInputProps extends CommonInputProps {
    onValidityChange?: (isValid: boolean) => void;
}

interface TimeTextInputProps extends CommonInputProps {
    onValidityChange?: (isValid: boolean) => void;
}

export function DateTextInput({ label, value, onChange, fullWidth = true, onValidityChange }: DateTextInputProps): ReactNode {
    const [text, setText] = useState(() => dateTextFromValue(value));
    const [pickerOpen, setPickerOpen] = useState(false);

    useEffect(() => {
        if (value.length > 0) setText(dateTextFromValue(value));
        else if (parseDateText(text) !== null) setText('');
    }, [text, value]);

    const update = (event: ChangeEvent<HTMLInputElement>): void => {
        const raw = event.target.value;
        const next = raw.length < text.length ? raw : formatDateText(raw);
        const parsed = parseDateText(next);
        setText(next);
        onChange(parsed ?? '');
        onValidityChange?.(next.length === 0 || parsed !== null);
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
                                <IconButton aria-label={`${label}をカレンダーから選択`} edge="end" onClick={() => setPickerOpen(true)}>
                                    <CalendarMonthOutlined />
                                </IconButton>
                            </InputAdornment>
                        ),
                    },
                }}
            />
            <DateTimePickerDialog
                open={pickerOpen}
                mode="date"
                value={value}
                label={label}
                onClose={() => setPickerOpen(false)}
                onCommit={next => {
                    setPickerOpen(false);
                    setText(dateTextFromValue(next));
                    onChange(next);
                    onValidityChange?.(true);
                }}
            />
        </Box>
    );
}

export function TimeTextInput({ label, value, onChange, fullWidth = true, onValidityChange }: TimeTextInputProps): ReactNode {
    const [text, setText] = useState(value);
    const [pickerOpen, setPickerOpen] = useState(false);

    useEffect(() => {
        if (value.length > 0) setText(value);
        else if (parseTimeText(text) !== null) setText('');
    }, [text, value]);

    const update = (event: ChangeEvent<HTMLInputElement>): void => {
        const raw = event.target.value;
        const next = raw.length < text.length ? raw : formatTimeText(raw);
        setText(next);
        onChange(parseTimeText(next) !== null ? next : '');
        onValidityChange?.(next.length === 0 || parseTimeText(next) !== null);
    };

    return (
        <Box sx={{ position: 'relative', width: fullWidth ? '100%' : 'auto' }}>
            <TextField
                fullWidth={fullWidth}
                label={label}
                value={text}
                onChange={update}
                placeholder="HH:mm"
                error={text.length === 5 && parseTimeText(text) === null}
                slotProps={{
                    htmlInput: { inputMode: 'numeric', maxLength: 5 },
                    input: {
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton aria-label={`${label}を時計から選択`} edge="end" onClick={() => setPickerOpen(true)}>
                                    <AccessTimeOutlined />
                                </IconButton>
                            </InputAdornment>
                        ),
                    },
                }}
            />
            <DateTimePickerDialog
                open={pickerOpen}
                mode="time"
                value={value}
                label={label}
                onClose={() => setPickerOpen(false)}
                onCommit={next => {
                    setPickerOpen(false);
                    setText(next);
                    onChange(next);
                    onValidityChange?.(true);
                }}
            />
        </Box>
    );
}

interface DateTimeTextInputProps extends CommonInputProps {
    onValidityChange?: (isValid: boolean) => void;
}

export function DateTimeTextInput({ label, value, onChange, fullWidth = true, onValidityChange }: DateTimeTextInputProps): ReactNode {
    const [text, setText] = useState(() => formatDateTimeText(value));
    const [pickerOpen, setPickerOpen] = useState(false);
    useEffect(() => {
        if (value.length > 0) setText(formatDateTimeText(value));
        else if (parseDateTimeText(text) !== null) setText('');
    }, [text, value]);

    const update = (event: ChangeEvent<HTMLInputElement>): void => {
        const raw = event.target.value;
        const next = raw.length < text.length ? raw : formatDateTimeText(raw);
        const parsed = parseDateTimeText(next);
        setText(next);
        onChange(parsed ?? '');
        onValidityChange?.(next.length === 0 || parsed !== null);
    };

    return (
        <Box sx={{ position: 'relative', width: fullWidth ? '100%' : 'auto' }}>
            <TextField
                fullWidth={fullWidth}
                label={label}
                value={text}
                onChange={update}
                placeholder="YYYY/MM/DD HH:mm"
                error={text.length === 16 && parseDateTimeText(text) === null}
                slotProps={{
                    htmlInput: { inputMode: 'numeric', maxLength: 16 },
                    input: {
                        endAdornment: (
                            <InputAdornment position="end">
                                <IconButton aria-label={`${label}をカレンダーから選択`} edge="end" onClick={() => setPickerOpen(true)}>
                                    <CalendarMonthOutlined />
                                </IconButton>
                                <IconButton aria-label={`${label}を時計から選択`} edge="end" onClick={() => setPickerOpen(true)}>
                                    <AccessTimeOutlined />
                                </IconButton>
                            </InputAdornment>
                        ),
                    },
                }}
            />
            <DateTimePickerDialog
                open={pickerOpen}
                mode="datetime"
                value={value}
                label={label}
                onClose={() => setPickerOpen(false)}
                onCommit={next => {
                    setPickerOpen(false);
                    setText(formatDateTimeText(next));
                    onChange(next);
                    onValidityChange?.(true);
                }}
            />
        </Box>
    );
}
