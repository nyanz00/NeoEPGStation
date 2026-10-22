export function dateTextFromValue(value: string): string {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
    return match === null ? '' : `${match[1]}/${match[2]}/${match[3]}`;
}

export function parseDateText(value: string): string | null {
    const match = /^(\d{4})[/-](\d{2})[/-](\d{2})$/.exec(value.normalize('NFKC'));
    if (match === null) return null;
    const year = Number(match[1]);
    const month = Number(match[2]);
    const day = Number(match[3]);
    if (year < 1) return null;
    const date = new Date(0);
    date.setUTCFullYear(year, month - 1, day);
    date.setUTCHours(0, 0, 0, 0);
    if (date.getUTCFullYear() !== year || date.getUTCMonth() !== month - 1 || date.getUTCDate() !== day) return null;
    return `${match[1]}-${match[2]}-${match[3]}`;
}

export function formatDateText(value: string): string {
    const digits = value.normalize('NFKC').replace(/\D/g, '').slice(0, 8);
    if (digits.length < 4) return digits;
    if (digits.length === 4) return `${digits}/`;
    if (digits.length < 6) return `${digits.slice(0, 4)}/${digits.slice(4)}`;
    if (digits.length === 6) return `${digits.slice(0, 4)}/${digits.slice(4)}/`;
    return `${digits.slice(0, 4)}/${digits.slice(4, 6)}/${digits.slice(6)}`;
}

export function formatTimeText(value: string): string {
    const digits = value.normalize('NFKC').replace(/\D/g, '').slice(0, 4);
    if (digits.length < 2) return digits;
    if (digits.length === 2) return `${digits}:`;
    return `${digits.slice(0, 2)}:${digits.slice(2)}`;
}

export function parseTimeText(value: string): { hour: number; minute: number } | null {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (match === null) return null;
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    return hour <= 23 && minute <= 59 ? { hour, minute } : null;
}

export function datePickerValueToDate(value: string): Date | null {
    const isoDate = parseDateText(value);
    if (isoDate === null) return null;
    const [year, month, day] = isoDate.split('-').map(Number);
    const date = new Date(0);
    date.setFullYear(year, month - 1, day);
    date.setHours(0, 0, 0, 0);
    return date;
}

export function datePickerDateToValue(value: Date): string | null {
    if (!Number.isFinite(value.getTime())) return null;
    const year = String(value.getFullYear()).padStart(4, '0');
    const month = String(value.getMonth() + 1).padStart(2, '0');
    const day = String(value.getDate()).padStart(2, '0');
    return parseDateText(`${year}-${month}-${day}`);
}

export function timePickerValueToDate(value: string): Date | null {
    const parsed = parseTimeText(value);
    if (parsed === null) return null;
    const date = new Date(2000, 0, 1, parsed.hour, parsed.minute, 0, 0);
    return date;
}

export function timePickerDateToValue(value: Date): string | null {
    if (!Number.isFinite(value.getTime())) return null;
    const text = `${String(value.getHours()).padStart(2, '0')}:${String(value.getMinutes()).padStart(2, '0')}`;
    return parseTimeText(text) === null ? null : text;
}

export function dateTimeValueParts(value: string): { date: string; time: string } | null {
    const match = /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})$/.exec(value);
    if (match === null || parseDateText(match[1]) === null || parseTimeText(match[2]) === null) return null;
    return { date: match[1], time: match[2] };
}

export function dateTimePickerValueToDate(value: string): Date | null {
    const parts = dateTimeValueParts(value);
    if (parts === null) return null;
    const date = datePickerValueToDate(parts.date);
    const time = parseTimeText(parts.time);
    if (date === null || time === null) return null;
    date.setHours(time.hour, time.minute, 0, 0);
    return date;
}

export function dateTimePickerDateToValue(value: Date): string | null {
    const date = datePickerDateToValue(value);
    const time = timePickerDateToValue(value);
    return date === null || time === null ? null : `${date}T${time}`;
}

export function combineDateTimeValue(date: string, time: string): string | null {
    const isoDate = parseDateText(date);
    if (isoDate === null || parseTimeText(time) === null) return null;
    return `${isoDate}T${time}`;
}

export function formatDateTimeText(value: string): string {
    const digits = value.normalize('NFKC').replace(/\D/g, '').slice(0, 12);
    const dateDigits = digits.slice(0, 8);
    const timeDigits = digits.slice(8);
    const date = formatDateText(dateDigits);
    const time = formatTimeText(timeDigits);
    return timeDigits.length > 0 ? `${date} ${time}` : date;
}

export function parseDateTimeText(value: string): string | null {
    const match = /^(\d{4}[/-]\d{2}[/-]\d{2})\s+(\d{2}:\d{2})$/.exec(value.normalize('NFKC'));
    if (match === null) return null;
    return combineDateTimeValue(match[1], match[2]);
}
