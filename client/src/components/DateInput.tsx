import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import { Box, IconButton, InputBase, Typography, useTheme } from '@mui/material';
import { type ReactNode, useEffect, useRef, useState } from 'react';

function splitDate(value: string): [string, string, string] {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match === null ? ['', '', ''] : [match[1], match[2], match[3]];
}

export function DateInput({ label, value, onChange, size = 'medium' }: { label?: string; value: string; onChange: (value: string) => void; size?: 'small' | 'medium' }): ReactNode {
    const theme = useTheme();
    const initial = splitDate(value);
    const [year, setYear] = useState(initial[0]);
    const [month, setMonth] = useState(initial[1]);
    const [day, setDay] = useState(initial[2]);
    const monthRef = useRef<HTMLInputElement>(null);
    const dayRef = useRef<HTMLInputElement>(null);
    const pickerRef = useRef<HTMLInputElement>(null);
    const skipSyncRef = useRef(false);

    useEffect(() => {
        if (skipSyncRef.current) {
            skipSyncRef.current = false;
            return;
        }
        const next = splitDate(value);
        setYear(next[0]);
        setMonth(next[1]);
        setDay(next[2]);
    }, [value]);

    const emit = (nextYear: string, nextMonth: string, nextDay: string): void => {
        if (nextYear.length !== 4 || nextMonth.length === 0 || nextDay.length === 0) {
            skipSyncRef.current = true;
            onChange('');
            return;
        }
        const monthNumber = Number(nextMonth);
        const dayNumber = Number(nextDay);
        if (monthNumber < 1 || monthNumber > 12 || dayNumber < 1 || dayNumber > 31) return;
        skipSyncRef.current = true;
        onChange(`${nextYear}-${nextMonth.padStart(2, '0')}-${nextDay.padStart(2, '0')}`);
    };
    const digits = (text: string, length: number): string => text.replace(/\D/g, '').slice(0, length);
    const selectFromPicker = (nextValue: string): void => {
        const next = splitDate(nextValue);
        setYear(next[0]);
        setMonth(next[1]);
        setDay(next[2]);
        skipSyncRef.current = true;
        onChange(nextValue);
    };

    return (
        <Box sx={{ position: 'relative', flex: 1, minWidth: 0 }}>
            {label !== undefined && (
                <Typography
                    component="span"
                    variant="caption"
                    color="text.secondary"
                    sx={{ position: 'absolute', left: 12, top: -9, px: 0.5, bgcolor: 'background.paper', zIndex: 1 }}
                >
                    {label}
                </Typography>
            )}
            <Box
                sx={{
                    height: size === 'small' ? 40 : 56,
                    display: 'flex',
                    alignItems: 'center',
                    border: 1,
                    borderColor: 'rgba(255,255,255,.28)',
                    borderRadius: 1,
                    px: 1,
                    '&:focus-within': { borderColor: 'primary.main', borderWidth: 2, px: '7px' },
                }}
            >
                <InputBase
                    placeholder="年"
                    value={year}
                    inputProps={{ inputMode: 'numeric', maxLength: 4, 'aria-label': `${label ?? '日付'}の年` }}
                    onChange={event => {
                        const next = digits(event.target.value, 4);
                        setYear(next);
                        emit(next, month, day);
                        if (next.length === 4) monthRef.current?.focus();
                    }}
                    sx={{ width: 54 }}
                />
                <Typography color="text.secondary">/</Typography>
                <InputBase
                    inputRef={monthRef}
                    placeholder="月"
                    value={month}
                    inputProps={{ inputMode: 'numeric', maxLength: 2, 'aria-label': `${label ?? '日付'}の月` }}
                    onChange={event => {
                        const next = digits(event.target.value, 2);
                        setMonth(next);
                        emit(year, next, day);
                        if (next.length === 2) dayRef.current?.focus();
                    }}
                    sx={{ width: 32, ml: 0.5 }}
                />
                <Typography color="text.secondary">/</Typography>
                <InputBase
                    inputRef={dayRef}
                    placeholder="日"
                    value={day}
                    inputProps={{ inputMode: 'numeric', maxLength: 2, 'aria-label': `${label ?? '日付'}の日` }}
                    onChange={event => {
                        const next = digits(event.target.value, 2);
                        setDay(next);
                        emit(year, month, next);
                    }}
                    sx={{ width: 32, ml: 0.5 }}
                />
                <Box sx={{ flex: 1 }} />
                <IconButton size="small" aria-label={`${label ?? '日付'}をカレンダーから選択`} onClick={() => pickerRef.current?.showPicker()}>
                    <CalendarMonthOutlined fontSize="small" />
                </IconButton>
                <input
                    ref={pickerRef}
                    type="date"
                    autoComplete="off"
                    min="0001-01-01"
                    max="9999-12-31"
                    value={value}
                    onChange={event => selectFromPicker(event.target.value)}
                    tabIndex={-1}
                    aria-hidden="true"
                    style={{ position: 'absolute', top: 0, right: 0, width: 40, height: '100%', opacity: 0, pointerEvents: 'none', colorScheme: theme.palette.mode }}
                />
            </Box>
        </Box>
    );
}
