import CalendarMonthOutlined from '@mui/icons-material/CalendarMonthOutlined';
import AccessTimeOutlined from '@mui/icons-material/AccessTimeOutlined';
import { Box, Button, Dialog, DialogActions, DialogContent, DialogTitle, Stack, Typography } from '@mui/material';
import { useEffect, useState, type ReactNode } from 'react';
import dayjs, { type Dayjs } from 'dayjs';
import 'dayjs/locale/ja';
import updateLocale from 'dayjs/plugin/updateLocale';
import { DateCalendar } from '@mui/x-date-pickers/DateCalendar';
import { LocalizationProvider } from '@mui/x-date-pickers/LocalizationProvider';
import { TimeClock } from '@mui/x-date-pickers/TimeClock';
import { AdapterDayjs } from '@mui/x-date-pickers/AdapterDayjs';
import { jaJP } from '@mui/x-date-pickers/locales';
import {
    datePickerDateToValue,
    datePickerValueToDate,
    dateTimePickerDateToValue,
    dateTimePickerValueToDate,
    timePickerDateToValue,
    timePickerValueToDate,
} from '../core/dateTimeInput';
import { programDialogPaper } from './programDialogStyles';

dayjs.extend(updateLocale);
dayjs.updateLocale('ja', { weekStart: 1 });

export type DateTimePickerMode = 'date' | 'time' | 'datetime';

interface DateTimePickerDialogProps {
    open: boolean;
    mode: DateTimePickerMode;
    value: string;
    label: string;
    onClose: () => void;
    onCommit: (value: string) => void;
}

function initialPickerValue(mode: DateTimePickerMode, value: string): Dayjs {
    const pickedDate = mode === 'date' ? datePickerValueToDate(value) : mode === 'time' ? timePickerValueToDate(value) : dateTimePickerValueToDate(value);
    return dayjs(pickedDate ?? new Date());
}

export function DateTimePickerDialog({ open, mode, value, label, onClose, onCommit }: DateTimePickerDialogProps): ReactNode {
    const [draft, setDraft] = useState<Dayjs>(() => initialPickerValue(mode, value));

    useEffect(() => {
        if (open) setDraft(initialPickerValue(mode, value));
    }, [mode, open, value]);

    const commit = (): void => {
        const selected =
            mode === 'date' ? datePickerDateToValue(draft.toDate()) : mode === 'time' ? timePickerDateToValue(draft.toDate()) : dateTimePickerDateToValue(draft.toDate());
        if (selected !== null) onCommit(selected);
    };

    return (
        <Dialog
            open={open}
            onClose={onClose}
            fullWidth
            maxWidth="sm"
            slotProps={{ paper: { sx: theme => ({ ...programDialogPaper(theme), width: { xs: 'calc(100% - 24px)', sm: 400 } }) } }}
        >
            <DialogTitle>{label}を選択</DialogTitle>
            <DialogContent sx={{ display: 'grid', placeItems: 'center', px: { xs: 1, sm: 2 }, py: 1 }}>
                <LocalizationProvider dateAdapter={AdapterDayjs} adapterLocale="ja" localeText={jaJP.components.MuiLocalizationProvider.defaultProps.localeText}>
                    {mode === 'date' ? (
                        <DateCalendar
                            value={draft}
                            onChange={next => next !== null && next.isValid() && setDraft(next)}
                            views={['year', 'month', 'day']}
                            openTo="day"
                            dayOfWeekFormatter={date => `${date.format('dd')}`}
                            sx={{ maxWidth: '100%' }}
                        />
                    ) : mode === 'time' ? (
                        <Stack spacing={1} sx={{ width: '100%', py: 1, alignItems: 'center' }}>
                            <Typography variant="h5" aria-live="polite">
                                {draft.format('HH:mm')}
                            </Typography>
                            <TimeClock value={draft} onChange={next => next !== null && next.isValid() && setDraft(next)} ampm={false} minutesStep={1} />
                        </Stack>
                    ) : (
                        <Stack spacing={1} sx={{ width: '100%', py: 1, alignItems: 'center' }}>
                            <DateCalendar
                                value={draft}
                                onChange={next => next !== null && next.isValid() && setDraft(current => next.hour(current.hour()).minute(current.minute()))}
                                views={['year', 'month', 'day']}
                                openTo="day"
                                dayOfWeekFormatter={date => `${date.format('dd')}`}
                                sx={{ maxWidth: '100%' }}
                            />
                            <Typography variant="h5" aria-live="polite">
                                {draft.format('HH:mm')}
                            </Typography>
                            <TimeClock
                                value={draft}
                                onChange={next => next !== null && next.isValid() && setDraft(current => current.hour(next.hour()).minute(next.minute()))}
                                ampm={false}
                                minutesStep={1}
                            />
                        </Stack>
                    )}
                </LocalizationProvider>
            </DialogContent>
            <DialogActions>
                <Button onClick={() => onCommit('')}>クリア</Button>
                <Box sx={{ flex: 1 }} />
                <Button onClick={onClose}>キャンセル</Button>
                <Button onClick={commit} variant="contained" startIcon={mode === 'date' ? <CalendarMonthOutlined /> : <AccessTimeOutlined />}>
                    選択
                </Button>
            </DialogActions>
        </Dialog>
    );
}
