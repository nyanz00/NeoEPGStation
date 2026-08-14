import type { VideoFileType } from '../../../../api';

export interface UploadFilenameInference {
    date?: string;
    time?: string;
    programName?: string;
    viewName: string;
    fileType: VideoFileType;
}

interface ParsedDateTime {
    date: string;
    time: string;
    remainder: string;
}

const TS_EXTENSIONS = new Set(['m2ts', 'mts', 'ts']);
const ENCODE_SUFFIX_PATTERN = /^(?:amvfr|x26[45]|h26[45]|avc|hevc|qsvenc(?:c)?|nvenc(?:c)?|vceenc(?:c)?|ffmpeg)[a-z0-9._+]*$/i;

function validDateTime(year: number, month: number, day: number, hour: number, minute: number): boolean {
    if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return false;
    const value = new Date(year, month - 1, day, hour, minute);
    return value.getFullYear() === year && value.getMonth() === month - 1 && value.getDate() === day;
}

function createDateTime(yearText: string, monthText: string, dayText: string, hourText: string, minuteText: string, remainder: string): ParsedDateTime | null {
    const year = Number(yearText);
    const month = Number(monthText);
    const day = Number(dayText);
    const hour = Number(hourText);
    const minute = Number(minuteText);
    if (!validDateTime(year, month, day, hour, minute)) return null;
    return {
        date: `${yearText.padStart(4, '0')}-${monthText.padStart(2, '0')}-${dayText.padStart(2, '0')}`,
        time: `${hourText.padStart(2, '0')}:${minuteText.padStart(2, '0')}`,
        remainder: remainder.replace(/^[-_\s　]+/, '').trim(),
    };
}

function parseDateTime(stem: string): ParsedDateTime | null {
    const normalized = stem.normalize('NFKC');
    const japanese = /^(\d{4})年\s*(\d{1,2})月\s*(\d{1,2})日\s*(\d{1,2})時\s*(\d{1,2})分(?:\s*\d{1,2}秒)?(.*)$/.exec(normalized);
    if (japanese !== null) return createDateTime(japanese[1], japanese[2], japanese[3], japanese[4], japanese[5], japanese[6]);

    const compact = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(?:\d{2})?(.*)$/.exec(normalized);
    if (compact !== null) return createDateTime(compact[1], compact[2], compact[3], compact[4], compact[5], compact[6]);
    return null;
}

function splitEncodeSuffix(value: string): { title: string; suffix?: string } {
    const match = /^(.*?)[-_]([A-Za-z][A-Za-z0-9._+]{1,31})$/.exec(value.trim());
    if (match === null) return { title: value.trim() };
    const suffix = match[2];
    if (!ENCODE_SUFFIX_PATTERN.test(suffix) && !/\d/.test(suffix)) return { title: value.trim() };
    return { title: match[1].trim(), suffix };
}

export function inferUploadFilename(filename: string): UploadFilenameInference {
    const extensionMatch = /\.([^.]+)$/.exec(filename);
    const extension = extensionMatch?.[1].normalize('NFKC').toLowerCase() ?? '';
    const stem = extensionMatch === null ? filename : filename.slice(0, -extensionMatch[0].length);
    const dateTime = parseDateTime(stem);
    const titleAndSuffix = splitEncodeSuffix(dateTime?.remainder ?? stem.normalize('NFKC'));
    const fileType: VideoFileType = TS_EXTENSIONS.has(extension) ? 'ts' : 'encoded';
    const viewName = titleAndSuffix.suffix?.toUpperCase() ?? (fileType === 'ts' ? 'TS' : extension.toUpperCase() || 'ENCODED');

    return {
        ...(dateTime === null ? {} : { date: dateTime.date, time: dateTime.time }),
        ...(dateTime !== null && titleAndSuffix.title.length > 0 ? { programName: titleAndSuffix.title } : {}),
        viewName,
        fileType,
    };
}
