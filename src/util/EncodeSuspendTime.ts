export interface EncodeSuspendTime {
    start: string;
    end: string;
}

interface ParsedEncodeSuspendTime {
    start: number;
    end: number;
}

function parseClockTime(value: unknown, index: number, endpoint: 'start' | 'end'): number {
    if (typeof value !== 'string') {
        throw new Error(`EncodeSuspendTime[${index}].${endpoint} must be HH:mm`);
    }

    const match = /^(?:([01]\d|2[0-3])):([0-5]\d)$/.exec(value);
    if (match === null) {
        throw new Error(`EncodeSuspendTime[${index}].${endpoint} must be a valid 24-hour HH:mm time`);
    }

    return Number(match[1]) * 60 + Number(match[2]);
}

function parseEncodeSuspendTimes(times: readonly EncodeSuspendTime[] | undefined): ParsedEncodeSuspendTime[] {
    if (typeof times === 'undefined') return [];
    if (!Array.isArray(times)) {
        throw new Error('EncodeSuspendTime must be an array');
    }

    return times.map((time, index) => {
        if (time === null || typeof time !== 'object') {
            throw new Error(`EncodeSuspendTime[${index}] must contain start and end times`);
        }

        const start = parseClockTime(time.start, index, 'start');
        const end = parseClockTime(time.end, index, 'end');
        if (start === end) {
            throw new Error(`EncodeSuspendTime[${index}] start and end must differ`);
        }

        return { start, end };
    });
}

/** Validate configured daily suspension intervals and throw for invalid settings. */
export function validateEncodeSuspendTimes(times: readonly EncodeSuspendTime[] | undefined): void {
    parseEncodeSuspendTimes(times);
}

function localMinute(date: Date): number {
    return date.getHours() * 60 + date.getMinutes();
}

function localDateAtMinute(reference: Date, dayOffset: number, minute: number): Date {
    const result = new Date(reference.getTime());
    result.setHours(0, 0, 0, 0);
    result.setDate(result.getDate() + dayOffset);
    result.setHours(Math.floor(minute / 60), minute % 60, 0, 0);
    return result;
}

function activeEndTimes(date: Date, intervals: readonly ParsedEncodeSuspendTime[]): Date[] {
    const minute = localMinute(date);
    const ends: Date[] = [];

    for (const interval of intervals) {
        if (interval.start < interval.end) {
            if (minute >= interval.start && minute < interval.end) {
                ends.push(localDateAtMinute(date, 0, interval.end));
            }
        } else if (minute >= interval.start) {
            ends.push(localDateAtMinute(date, 1, interval.end));
        } else if (minute < interval.end) {
            ends.push(localDateAtMinute(date, 0, interval.end));
        }
    }

    return ends;
}

/** Return whether local wall-clock time falls within any configured suspension interval. */
export function isEncodeSuspended(times: readonly EncodeSuspendTime[] | undefined, now: Date = new Date()): boolean {
    const intervals = parseEncodeSuspendTimes(times);
    if (Number.isNaN(now.getTime())) {
        throw new Error('EncodeSuspendTime current time is invalid');
    }
    return activeEndTimes(now, intervals).length > 0;
}

/**
 * Return the first local time when all active suspension intervals have ended.
 * Returns null if encoding is currently allowed or the daily intervals leave no release time.
 */
export function getNextEncodeResumeTime(
    times: readonly EncodeSuspendTime[] | undefined,
    now: Date = new Date(),
): Date | null {
    const intervals = parseEncodeSuspendTimes(times);
    if (Number.isNaN(now.getTime())) {
        throw new Error('EncodeSuspendTime current time is invalid');
    }

    let cursor = new Date(now.getTime());
    let ends = activeEndTimes(cursor, intervals);
    if (ends.length === 0) return null;

    // A finite daily interval set should reach a gap within a small number of boundaries.
    // The bound also makes an all-day union (assembled from multiple intervals) return null.
    for (let i = 0; i < intervals.length * 4 + 4; i++) {
        const next = new Date(Math.max(...ends.map(end => end.getTime())));
        if (next.getTime() <= cursor.getTime()) return null;

        ends = activeEndTimes(next, intervals);
        if (ends.length === 0) return next;
        cursor = next;
    }

    return null;
}
