import type * as apid from '../../api';

export function parseAssComments(ass: string): apid.RecordedJikkyoComment[] {
    const comments: apid.RecordedJikkyoComment[] = [];
    const styleColors = new Map<string, string>();
    let sectionName = '';
    let styleFormat: string[] = [];
    let eventFormat: string[] = [];
    for (const line of ass.split(/\r?\n/)) {
        const section = line.match(/^\s*\[([^\]]+)]\s*$/);
        if (section !== null) {
            sectionName = section[1].trim().toLowerCase();
            continue;
        }

        if (sectionName === 'v4+ styles' || sectionName === 'v4 styles') {
            if (/^\s*Format:/i.test(line)) {
                styleFormat = parseAssFormat(line);
                continue;
            }
            if (!/^\s*Style:/i.test(line) || styleFormat.length === 0) continue;
            const values = splitFields(line.slice(line.indexOf(':') + 1).trimStart(), styleFormat.length);
            const fields = Object.fromEntries(styleFormat.map((name, index) => [name, values[index] ?? ''])) as Record<
                string,
                string
            >;
            const styleName = fields.name?.trim().toLowerCase();
            const primaryColor = parseAssColor(fields.primarycolour ?? fields.primarycolor);
            if (styleName && primaryColor !== null) styleColors.set(styleName, primaryColor);
            continue;
        }

        if (sectionName !== 'events') continue;
        if (/^\s*Format:/i.test(line)) {
            eventFormat = line
                .slice(line.indexOf(':') + 1)
                .split(',')
                .map(value => value.trim().toLowerCase());
            continue;
        }
        if (!/^\s*Dialogue:/i.test(line) || eventFormat.length === 0) continue;
        const values = splitFields(line.slice(line.indexOf(':') + 1).trimStart(), eventFormat.length);
        const fields = Object.fromEntries(eventFormat.map((name, index) => [name, values[index] ?? ''])) as Record<
            string,
            string
        >;
        const time = parseAssTime(fields.start);
        const raw = fields.text ?? '';
        const text = raw
            .replace(/\{[^}]*\}/g, '')
            .replace(/\\[Nn]/g, '\n')
            .replace(/\\h/g, ' ')
            .trim();
        if (time === null || text.length === 0 || /\\p[1-9]\d*/i.test(raw)) continue;
        comments.push({
            id: comments.length,
            time,
            text,
            color: assColor(raw, styleColors.get((fields.style ?? '').trim().toLowerCase())),
            position: assPosition(raw, fields.style ?? ''),
            size: assSize(raw, fields.style ?? ''),
            userId: fields.name ?? '',
            postedAt: 0,
        });
    }
    return comments.sort((left, right) => left.time - right.time);
}

function parseAssFormat(line: string): string[] {
    return line
        .slice(line.indexOf(':') + 1)
        .split(',')
        .map(value => value.trim().toLowerCase());
}

function splitFields(value: string, count: number): string[] {
    const fields: string[] = [];
    let start = 0;
    for (let index = 0; index < value.length && fields.length < count - 1; index++) {
        if (value[index] === ',') {
            fields.push(value.slice(start, index));
            start = index + 1;
        }
    }
    fields.push(value.slice(start));
    return fields;
}

function parseAssTime(value: string | undefined): number | null {
    const match = value?.trim().match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
    if (match === undefined || match === null) return null;
    const result = Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
    return Number.isFinite(result) ? result : null;
}

function assColor(value: string, styleColor?: string): string {
    const inlineColor = value.match(/\\(?:1?c)&H([0-9a-f]{6,8})&?/i)?.[1];
    return parseAssColor(inlineColor) ?? styleColor ?? '#FFFFFF';
}

function parseAssColor(value: string | undefined): string | null {
    const match = value?.trim().match(/^(?:&H)?([0-9a-f]{6,8})&?$/i);
    if (match === undefined || match === null) return null;
    const hex = match[1].padStart(6, '0').slice(-6);
    return `#${hex.slice(4, 6)}${hex.slice(2, 4)}${hex.slice(0, 2)}`;
}

function assPosition(value: string, style: string): apid.JikkyoCommentPosition {
    if (/\\move\s*\(/i.test(value) || /normal|naka|scroll|right/i.test(style)) return 'right';
    const alignment = Number(value.match(/\\an([1-9])/i)?.[1] ?? 0);
    if (/top|ue/i.test(style) || alignment >= 7) return 'top';
    if (/bottom|shita/i.test(style) || (alignment > 0 && alignment <= 3)) return 'bottom';
    return 'right';
}

function assSize(value: string, style: string): apid.JikkyoCommentSize {
    if (/big|large/i.test(style)) return 'big';
    if (/small/i.test(style)) return 'small';
    const size = Number(value.match(/\\fs(\d+(?:\.\d+)?)/i)?.[1] ?? 0);
    if (size >= 45) return 'big';
    if (size > 0 && size <= 28) return 'small';
    return 'medium';
}
