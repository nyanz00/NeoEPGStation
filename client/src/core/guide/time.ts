const JST_OFFSET_MS = 9 * 60 * 60 * 1_000;
const DAY_MS = 24 * 60 * 60 * 1_000;
const JST_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const;

interface JstDateParts {
    year: number;
    month: number;
    day: number;
    hour: number;
    minute: number;
    second: number;
    millisecond: number;
}

function getJstDateParts(timestamp: number): JstDateParts | undefined {
    if (!Number.isFinite(timestamp)) return undefined;

    const shiftedDate = new Date(timestamp + JST_OFFSET_MS);
    if (!Number.isFinite(shiftedDate.getTime())) return undefined;

    return {
        year: shiftedDate.getUTCFullYear(),
        month: shiftedDate.getUTCMonth() + 1,
        day: shiftedDate.getUTCDate(),
        hour: shiftedDate.getUTCHours(),
        minute: shiftedDate.getUTCMinutes(),
        second: shiftedDate.getUTCSeconds(),
        millisecond: shiftedDate.getUTCMilliseconds(),
    };
}

function requireJstDateParts(timestamp: number): JstDateParts {
    const parts = getJstDateParts(timestamp);
    if (parts === undefined) throw new RangeError('A valid epoch timestamp is required.');
    return parts;
}

function epochFromJstDateAndTime(year: number, month: number, day: number, hour: number, minute = 0, second = 0, millisecond = 0): number {
    const timestamp = Date.UTC(year, month - 1, day, hour, minute, second, millisecond) - JST_OFFSET_MS;
    if (!Number.isFinite(timestamp) || !Number.isFinite(new Date(timestamp).getTime())) {
        throw new RangeError('The specified JST date and time are outside the supported range.');
    }
    return timestamp;
}

/** Return the epoch timestamp for the start of the timestamp's JST calendar day. */
export function startOfJstDay(timestamp: number): number {
    const { year, month, day } = requireJstDateParts(timestamp);
    return epochFromJstDateAndTime(year, month, day, 0);
}

/** Return the epoch timestamp for the start of the timestamp's JST hour. */
export function startOfJstHour(timestamp: number): number {
    const { year, month, day, hour } = requireJstDateParts(timestamp);
    return epochFromJstDateAndTime(year, month, day, hour);
}

/** Parse an exact YYMMddHH value. The two-digit year maps to 2000–2099. */
export function parseGuideTime(value: string | null | undefined): number | undefined {
    if (value === null || value === undefined || !/^\d{8}$/.test(value)) return undefined;

    const year = 2000 + Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const day = Number(value.slice(4, 6));
    const hour = Number(value.slice(6, 8));
    if (month < 1 || month > 12 || hour > 23) return undefined;

    const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();
    if (day < 1 || day > daysInMonth) return undefined;

    return epochFromJstDateAndTime(year, month, day, hour);
}

/** Format an epoch timestamp as the guide's exact YYMMddHH query value. */
export function formatGuideTime(timestamp: number): string {
    const { year, month, day, hour } = requireJstDateParts(timestamp);
    if (year < 2000 || year > 2099) throw new RangeError('Guide time can only represent years 2000–2099.');

    return `${String(year % 100).padStart(2, '0')}${String(month).padStart(2, '0')}${String(day).padStart(2, '0')}${String(hour).padStart(2, '0')}`;
}

/** Format a JST calendar date as MM/DD(曜). */
export function formatJstDateLabel(timestamp: number): string {
    const { year, month, day } = requireJstDateParts(timestamp);
    const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
    return `${String(month).padStart(2, '0')}/${String(day).padStart(2, '0')}(${JST_WEEKDAYS[weekday]})`;
}

/** Return the hour of an epoch timestamp in JST. */
export function getJstHour(timestamp: number): number {
    return requireJstDateParts(timestamp).hour;
}

/** Format an epoch timestamp as HH:mm in JST. */
export function formatJstTime(timestamp: number): string {
    const { hour, minute } = requireJstDateParts(timestamp);
    return `${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}`;
}

/** Return the epoch timestamp for a JST calendar date at the specified hour. */
export function jstDateAndHourToEpoch(dateTimestamp: number, hour: number): number {
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) throw new RangeError('JST hour must be an integer from 0 to 23.');

    const { year, month, day } = requireJstDateParts(dateTimestamp);
    return epochFromJstDateAndTime(year, month, day, hour);
}

/** Return the whole-day difference from today using JST calendar days. */
export function getJstDayOffset(timestamp: number, todayTimestamp = Date.now()): number | undefined {
    const targetDay = getJstDateParts(timestamp);
    const today = getJstDateParts(todayTimestamp);
    if (targetDay === undefined || today === undefined) return undefined;

    const targetStart = epochFromJstDateAndTime(targetDay.year, targetDay.month, targetDay.day, 0);
    const todayStart = epochFromJstDateAndTime(today.year, today.month, today.day, 0);
    const offset = (targetStart - todayStart) / DAY_MS;
    return Number.isSafeInteger(offset) ? offset : undefined;
}
