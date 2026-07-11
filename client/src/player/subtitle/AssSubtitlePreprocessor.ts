export interface AssSubtitlePreprocessOptions {
    isNicoJk: boolean;
}

interface SubtitleBandRange {
    start: string;
    end: string;
    style: string;
    minX: number;
    maxX: number;
    minY: number;
    maxY: number;
}

const FONT_NAMES = ['Arial', 'Meiryo', 'MS Gothic', 'MS PGothic', 'Noto Sans CJK JP', 'Noto Sans JP', 'Noto Sans JP Thin', 'Yu Gothic', 'Yu Gothic Medium'];
const FONT_NAME_PATTERN = FONT_NAMES.map(fontName => fontName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
const STYLE_FONT_REGEX = /^(Style:\s*)((?:[^,\r\n]*,){1})([^,\r\n]*)/gim;
const OVERRIDE_FONT_REGEX = new RegExp(`\\\\fn(?:${FONT_NAME_PATTERN})(?=[\\\\}])`, 'gi');
const POSITION_REGEX = /\\pos\(\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\)/i;
const POSITION_TAG_REGEX = /\\pos\([^)]*\)/gi;
const SCALE_X_REGEX = /\\fscx(\d+(?:\.\d+)?)/i;
const OVERRIDE_TAG_REGEX = /\{[^}]*\}/g;

export const preprocessAssSubtitle = (ass: string, options: AssSubtitlePreprocessOptions): string => {
    const normalized = normalizeFonts(ass);
    if (options.isNicoJk === true) {
        return normalized;
    }

    return addBackgroundBands(attachStandaloneFullStops(normalized));
};

const normalizeFonts = (ass: string): string => {
    return ass
        .replace(STYLE_FONT_REGEX, (_match, prefix: string, namePart: string) => {
            return `${prefix}${namePart}Noto Sans JP`;
        })
        .replace(OVERRIDE_FONT_REGEX, '\\fnNoto Sans JP');
};

const attachStandaloneFullStops = (ass: string): string => {
    const lineEnding = ass.includes('\r\n') === true ? '\r\n' : '\n';
    const lines = ass.split(/\r?\n/);
    const removedLineIndexes = new Set<number>();

    for (let periodIndex = 0; periodIndex < lines.length; periodIndex++) {
        const periodFields = splitDialogueFields(lines[periodIndex]);
        if (periodFields === null || getPlainDialogueText(periodFields[9]) !== '。') {
            continue;
        }

        const periodPosition = parsePosition(periodFields[9]);
        if (periodPosition === null) {
            continue;
        }

        let nearestTextIndex = -1;
        let nearestTextX = Number.NEGATIVE_INFINITY;
        for (let textIndex = 0; textIndex < lines.length; textIndex++) {
            if (textIndex === periodIndex || removedLineIndexes.has(textIndex) === true) {
                continue;
            }

            const textFields = splitDialogueFields(lines[textIndex]);
            if (
                textFields === null ||
                textFields[1] !== periodFields[1] ||
                textFields[2] !== periodFields[2] ||
                textFields[3] !== periodFields[3] ||
                getPlainDialogueText(textFields[9]).trim().length === 0
            ) {
                continue;
            }

            const textPosition = parsePosition(textFields[9]);
            if (textPosition === null || Math.abs(textPosition.y - periodPosition.y) > 1 || textPosition.x >= periodPosition.x || textPosition.x <= nearestTextX) {
                continue;
            }

            nearestTextIndex = textIndex;
            nearestTextX = textPosition.x;
        }

        if (nearestTextIndex === -1) {
            continue;
        }

        const textFields = splitDialogueFields(lines[nearestTextIndex]);
        if (textFields === null) {
            continue;
        }

        const periodOverrides = extractOverridesWithoutPosition(periodFields[9]);
        textFields[9] += `${periodOverrides}。`;
        lines[nearestTextIndex] = `Dialogue: ${textFields.join(',')}`;
        removedLineIndexes.add(periodIndex);
    }

    return lines.filter((_line, index) => removedLineIndexes.has(index) === false).join(lineEnding);
};

const parsePosition = (text: string): { x: number; y: number } | null => {
    const match = text.match(POSITION_REGEX);
    if (match === null) {
        return null;
    }

    const x = Number(match[1]);
    const y = Number(match[2]);
    return Number.isFinite(x) === true && Number.isFinite(y) === true ? { x, y } : null;
};

const getPlainDialogueText = (text: string): string => {
    return text
        .replace(OVERRIDE_TAG_REGEX, '')
        .replace(/\\[Nn]/g, '\n')
        .replace(/\\h/g, ' ');
};

const extractOverridesWithoutPosition = (text: string): string => {
    const tags = text.match(OVERRIDE_TAG_REGEX);
    if (tags === null) {
        return '';
    }

    const overrides = tags
        .map(tag => tag.slice(1, -1).replace(POSITION_TAG_REGEX, ''))
        .join('')
        .trim();
    return overrides.length === 0 ? '' : `{${overrides}}`;
};

const addBackgroundBands = (ass: string): string => {
    const playResX = parseScriptResolution(ass, 'PlayResX');
    const playResY = parseScriptResolution(ass, 'PlayResY');
    if (playResX === null || playResY === null) {
        return ass;
    }

    const lineEnding = ass.includes('\r\n') === true ? '\r\n' : '\n';
    const lines = ass.split(/\r?\n/);
    const ranges = collectSubtitleBandRanges(lines);
    if (ranges.length === 0) {
        return ass;
    }

    const firstDialogueIndex = lines.findIndex(line => /^Dialogue:/i.test(line));
    if (firstDialogueIndex === -1) {
        return ass;
    }

    const backgroundLines = ranges.map(range => createBackgroundDialogue(range, playResX, playResY));
    return lines.slice(0, firstDialogueIndex).concat(backgroundLines, lines.slice(firstDialogueIndex)).join(lineEnding);
};

const parseScriptResolution = (ass: string, key: 'PlayResX' | 'PlayResY'): number | null => {
    const match = ass.match(new RegExp(`^${key}:\\s*(\\d+)\\s*$`, 'im'));
    if (match === null) {
        return null;
    }

    const value = Number(match[1]);
    return Number.isFinite(value) === true && value > 0 ? value : null;
};

const collectSubtitleBandRanges = (lines: string[]): SubtitleBandRange[] => {
    const ranges = new Map<string, SubtitleBandRange>();
    for (const line of lines) {
        const fields = splitDialogueFields(line);
        if (fields === null) {
            continue;
        }

        const position = fields[9].match(POSITION_REGEX);
        if (position === null) {
            continue;
        }

        const x = Number(position[1]);
        const y = Number(position[2]);
        if (Number.isFinite(x) === false || Number.isFinite(y) === false) {
            continue;
        }

        const width = estimateDialogueWidth(fields[9]);

        const key = `${fields[1]}\u0000${fields[2]}\u0000${fields[3]}`;
        const existing = ranges.get(key);
        if (typeof existing === 'undefined') {
            ranges.set(key, {
                start: fields[1],
                end: fields[2],
                style: fields[3],
                minX: x,
                maxX: x + width,
                minY: y,
                maxY: y,
            });
        } else {
            existing.minX = Math.min(existing.minX, x);
            existing.maxX = Math.max(existing.maxX, x + width);
            existing.minY = Math.min(existing.minY, y);
            existing.maxY = Math.max(existing.maxY, y);
        }
    }

    return Array.from(ranges.values());
};

const estimateDialogueWidth = (text: string): number => {
    let scaleX = 1;
    let lineWidth = 0;
    let maximumWidth = 0;
    for (const part of text.split(/(\{[^}]*\})/g)) {
        if (part.startsWith('{') === true) {
            const scaleMatch = part.match(SCALE_X_REGEX);
            if (scaleMatch !== null) {
                scaleX = Number(scaleMatch[1]) / 100;
            }
            continue;
        }

        const plainText = part.replace(/\\[Nn]/g, '\n').replace(/\\h/g, ' ');
        for (const character of Array.from(plainText)) {
            if (character === '\n') {
                maximumWidth = Math.max(maximumWidth, lineWidth);
                lineWidth = 0;
                continue;
            }

            const codePoint = character.codePointAt(0);
            lineWidth += (typeof codePoint === 'number' && codePoint <= 0x7f ? 18 : 36) * scaleX;
        }
    }

    return Math.max(maximumWidth, lineWidth);
};

const splitDialogueFields = (line: string): string[] | null => {
    if (/^Dialogue:/i.test(line) === false) {
        return null;
    }

    const fields: string[] = [];
    const body = line.slice(line.indexOf(':') + 1).trimStart();
    let fieldStart = 0;
    for (let index = 0; index < body.length && fields.length < 9; index++) {
        if (body[index] === ',') {
            fields.push(body.slice(fieldStart, index));
            fieldStart = index + 1;
        }
    }
    fields.push(body.slice(fieldStart));
    return fields.length === 10 ? fields : null;
};

const createBackgroundDialogue = (range: SubtitleBandRange, playResX: number, playResY: number): string => {
    const left = Math.max(0, Math.floor(range.minX - 4));
    const right = Math.min(playResX, Math.max(left + 1, Math.ceil(range.maxX + 4)));
    const top = Math.max(0, Math.floor(range.minY - 46));
    const bottom = Math.min(playResY, Math.ceil(range.maxY + 6));
    const drawing = `m ${left} ${top} l ${right} ${top} ${right} ${bottom} ${left} ${bottom}`;
    const tags = '{\\an7\\pos(0,0)\\p1\\bord0\\shad0\\fscx100\\fscy100\\1c&H000000&\\1a&H80&}';
    return `Dialogue: -1,${range.start},${range.end},${range.style},,0000,0000,0000,,${tags}${drawing}`;
};
