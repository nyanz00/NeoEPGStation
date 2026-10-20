// ASS emitted by Amatsukaze, FFmpeg's SubRip decoder and NicoJK converters.
// Text is always drawn by Canvas2D; font names in the source do not select web fonts.
export interface AssTextStyle {
    fontSize: number;
    scaleX: number;
    scaleY: number;
    spacing: number;
    bold: boolean;
    italic: boolean;
    underline: boolean;
    strikeout: boolean;
    color: string;
    outlineColor: string;
    background: string;
    outline: number;
    shadow: number;
    borderStyle: number;
    fontSizeFactor: number;
}

interface AssStyle extends AssTextStyle {
    alignment: number;
    marginL: number;
    marginR: number;
    marginV: number;
}

export interface AssEvent {
    start: number;
    end: number;
    layer: number;
    order: number;
    runs: { text: string; style: AssTextStyle }[];
    position?: { x: number; y: number };
    move?: { x1: number; y1: number; x2: number; y2: number; start: number; end: number };
    fade?: { in: number; out: number };
    alignment: number;
    marginL: number;
    marginR: number;
    marginV: number;
    wrap: number;
}

export interface AssSubtitleDocument {
    width: number;
    height: number;
    styles: Map<string, AssStyle>;
    events: AssEvent[];
    // Monotone prefix maxima allow seeking without scanning the entire recording.
    endTimes: number[];
}

const DEFAULT_STYLE: AssStyle = {
    fontSize: 20,
    scaleX: 1,
    scaleY: 1,
    spacing: 0,
    bold: false,
    italic: false,
    underline: false,
    strikeout: false,
    color: '#ffffff',
    outlineColor: '#000000',
    background: '#00000080',
    outline: 1,
    shadow: 0,
    borderStyle: 1,
    fontSizeFactor: 1,
    alignment: 2,
    marginL: 10,
    marginR: 10,
    marginV: 10,
};

function number(value: string | undefined, fallback: number): number {
    if (value === undefined || value.trim() === '') return fallback;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
}

function fields(body: string, format: string[]): Record<string, string> {
    const values: string[] = [];
    let start = 0;
    for (let i = 0; i < body.length && values.length < format.length - 1; i++) {
        if (body[i] !== ',') continue;
        values.push(body.slice(start, i));
        start = i + 1;
    }
    values.push(body.slice(start));
    return Object.fromEntries(format.map((key, i) => [key, values[i] ?? '']));
}

function time(value: string): number {
    const match = value?.trim().match(/^(\d+):(\d{1,2}):(\d{1,2}(?:\.\d+)?)$/);
    return match === null || match === undefined ? NaN : Number(match[1]) * 3600 + Number(match[2]) * 60 + Number(match[3]);
}

function alpha(color: string, opacity: number): string {
    return `${color.slice(0, 7)}${Math.round(Math.max(0, Math.min(1, opacity)) * 255)
        .toString(16)
        .padStart(2, '0')}`;
}

function color(value: string | undefined, fallback: string): string {
    const match = value?.trim().match(/^(?:&H)([\da-f]{1,8})&?$/i);
    if (!match) return fallback;
    const hex = match[1].padStart(6, '0');
    const rgb = hex.slice(-6);
    const result = `#${rgb.slice(4, 6)}${rgb.slice(2, 4)}${rgb.slice(0, 2)}`.toLowerCase();
    return hex.length > 6 ? alpha(result, 1 - parseInt(hex.slice(0, -6), 16) / 255) : result + fallback.slice(7);
}

function parseStyle(f: Record<string, string>): AssStyle {
    const result: AssStyle = {
        ...DEFAULT_STYLE,
        fontSize: Math.max(1, number(f.fontsize, 20)),
        scaleX: Math.max(0, number(f.scalex, 100)) / 100,
        scaleY: Math.max(0, number(f.scaley, 100)) / 100,
        spacing: number(f.spacing, 0),
        bold: number(f.bold, 0) !== 0,
        italic: number(f.italic, 0) !== 0,
        underline: number(f.underline, 0) !== 0,
        strikeout: number(f.strikeout, 0) !== 0,
        color: color(f.primarycolour, '#ffffff'),
        outlineColor: color(f.outlinecolour, '#000000'),
        background: color(f.backcolour, '#00000080'),
        outline: Math.max(0, number(f.outline, 1)),
        shadow: number(f.shadow, 0),
        borderStyle: number(f.borderstyle, 1),
        alignment: Math.max(1, Math.min(9, number(f.alignment, 2))),
        marginL: Math.max(0, number(f.marginl, 10)),
        marginR: Math.max(0, number(f.marginr, 10)),
        marginV: Math.max(0, number(f.marginv, 10)),
    };
    // Amatsukaze adds 10px specifically for Yu Gothic's em metrics. Native
    // ARIB fonts use a 36px cell; keep its pos/fscx/fscy/fsp geometry intact.
    if (/^yu gothic$/i.test(f.fontname?.trim() ?? '') && result.fontSize === 46 && result.spacing === 4 && result.marginL === 0 && result.marginV === 0) {
        result.fontSizeFactor = 36 / 46;
        // The formatter's default bold compensates for Yu Gothic. Native ARIB
        // fonts use normal weight and a 2px outline per 36px cell instead.
        result.bold = false;
        result.outline = 2;
    }
    return result;
}

const STYLE_FORMAT =
    'Name,Fontname,Fontsize,PrimaryColour,SecondaryColour,OutlineColour,BackColour,Bold,Italic,Underline,StrikeOut,ScaleX,ScaleY,Spacing,Angle,BorderStyle,Outline,Shadow,Alignment,MarginL,MarginR,MarginV,Encoding'
        .toLowerCase()
        .split(',');
const EVENT_FORMAT = 'layer,start,end,style,name,marginl,marginr,marginv,effect,text'.split(',');

export function parseAssSubtitle(text: string): AssSubtitleDocument {
    let section = '';
    let styleFormat = STYLE_FORMAT;
    let eventFormat = EVENT_FORMAT;
    const styles = new Map<string, AssStyle>([['default', { ...DEFAULT_STYLE }]]);
    const rawEvents: Record<string, string>[] = [];
    let width = 0;
    let height = 0;
    let wrap = 0;
    for (const raw of text.replace(/^\uFEFF/, '').split(/\r?\n/)) {
        const line = raw.trim();
        const header = line.match(/^\[([^\]]+)\]$/);
        if (header) {
            section = header[1].toLowerCase();
            continue;
        }
        const colon = line.indexOf(':');
        if (colon < 0) continue;
        const key = line.slice(0, colon).toLowerCase();
        const body = line.slice(colon + 1).trimStart();
        if (section === 'script info') {
            if (key === 'playresx') width = Math.max(0, number(body, 0));
            if (key === 'playresy') height = Math.max(0, number(body, 0));
            if (key === 'wrapstyle') wrap = number(body, 0);
        } else if (section === 'v4+ styles') {
            if (key === 'format')
                styleFormat = body
                    .toLowerCase()
                    .split(',')
                    .map(value => value.trim());
            if (key === 'style') {
                const f = fields(body, styleFormat);
                if (f.name?.trim()) styles.set(f.name.trim().toLowerCase(), parseStyle(f));
            }
        } else if (section === 'events') {
            if (key === 'format')
                eventFormat = body
                    .toLowerCase()
                    .split(',')
                    .map(value => value.trim());
            if (key === 'dialogue') rawEvents.push(fields(body, eventFormat));
        }
    }
    if (width <= 0 && height <= 0) {
        width = 384;
        height = 288;
    } else if (width <= 0) width = (height * 4) / 3;
    else if (height <= 0) height = (width * 3) / 4;
    const events: AssEvent[] = [];
    for (const f of rawEvents) {
        const start = time(f.start);
        const end = time(f.end);
        if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) continue;
        const base = styles.get((f.style ?? '').trim().toLowerCase()) ?? styles.get('default')!;
        const event: AssEvent = {
            start,
            end,
            layer: number(f.layer, 0),
            order: events.length,
            runs: [],
            alignment: base.alignment,
            wrap,
            marginL: number(f.marginl, 0) || base.marginL,
            marginR: number(f.marginr, 0) || base.marginR,
            marginV: number(f.marginv, 0) || base.marginV,
        };
        let current = { ...base };
        let drawing = false;
        for (const part of (f.text ?? '').split(/(\{[^}]*\})/g)) {
            if (!part.startsWith('{')) {
                if (!drawing && part)
                    event.runs.push({
                        text: part
                            .replace(/\\N/g, '\n')
                            .replace(/\\n/g, event.wrap === 2 ? '\n' : ' ')
                            .replace(/\\h/g, '\u00a0'),
                        style: { ...current },
                    });
                continue;
            }
            // Longest names first: \fscx must not be consumed as \fs, etc.
            for (const tag of part.slice(1, -1).matchAll(/\\(fscx|fscy|fsp|bord|shad|alpha|[134]a|[134]c|pos|move|fad|an|fs|[cbiusprq])([^\\]*)/gi)) {
                const key = tag[1].toLowerCase();
                const arg = tag[2].trim();
                const value = number(arg, NaN);
                const args = arg
                    .replace(/^\(|\)$/g, '')
                    .split(',')
                    .map(Number);
                if (key === 'r') {
                    current = { ...(styles.get(arg.toLowerCase()) ?? base) };
                    continue;
                }
                if (key === 'pos' && args.length === 2 && args.every(Number.isFinite)) event.position = { x: args[0], y: args[1] };
                if (key === 'move' && (args.length === 4 || args.length === 6) && args.every(Number.isFinite)) {
                    event.move = { x1: args[0], y1: args[1], x2: args[2], y2: args[3], start: (args[4] ?? 0) / 1000, end: (args[5] ?? (end - start) * 1000) / 1000 };
                }
                if (key === 'fad' && args.length === 2 && args.every(Number.isFinite)) event.fade = { in: Math.max(0, args[0]) / 1000, out: Math.max(0, args[1]) / 1000 };
                if (key === 'c' || key === '1c') current.color = arg === '' ? base.color : color(arg, current.color);
                if (key === '3c') current.outlineColor = arg === '' ? base.outlineColor : color(arg, current.outlineColor);
                if (key === '4c') current.background = arg === '' ? base.background : color(arg, current.background);
                if (key === 'alpha' || /^[134]a$/.test(key)) {
                    const hex = arg.match(/^&H([\da-f]{1,2})&?$/i);
                    if (hex) {
                        const opacity = 1 - parseInt(hex[1], 16) / 255;
                        if (key === 'alpha' || key === '1a') current.color = alpha(current.color, opacity);
                        if (key === 'alpha' || key === '3a') current.outlineColor = alpha(current.outlineColor, opacity);
                        if (key === 'alpha' || key === '4a') current.background = alpha(current.background, opacity);
                    }
                }
                if (!Number.isFinite(value)) continue;
                if (key === 'fs') current.fontSize = Math.max(1, value);
                if (key === 'fscx') current.scaleX = Math.max(0, value) / 100;
                if (key === 'fscy') current.scaleY = Math.max(0, value) / 100;
                if (key === 'fsp') current.spacing = value;
                if (key === 'bord') current.outline = Math.max(0, value);
                if (key === 'shad') current.shadow = value;
                if (key === 'b') current.bold = value !== 0;
                if (key === 'i') current.italic = value !== 0;
                if (key === 'u') current.underline = value !== 0;
                if (key === 's') current.strikeout = value !== 0;
                if (key === 'p') drawing = value !== 0;
                if (key === 'an' && value >= 1 && value <= 9) event.alignment = Math.floor(value);
                if (key === 'q') event.wrap = value;
            }
        }
        if (event.runs.length) events.push(event);
    }
    events.sort((a, b) => a.start - b.start || a.order - b.order);
    let maxEnd = 0;
    return { width, height, styles, events, endTimes: events.map(event => (maxEnd = Math.max(maxEnd, event.end))) };
}

export function activeAssEvents(doc: AssSubtitleDocument, time: number): AssEvent[] {
    let low = 0;
    let high = doc.events.length;
    while (low < high) {
        const mid = (low + high) >>> 1;
        if (doc.endTimes[mid] <= time) low = mid + 1;
        else high = mid;
    }
    const result: AssEvent[] = [];
    for (let i = low; i < doc.events.length && doc.events[i].start <= time; i++) {
        if (doc.events[i].end > time) result.push(doc.events[i]);
    }
    return result.sort((a, b) => a.layer - b.layer || a.order - b.order);
}

interface Glyph {
    text: string;
    style: AssTextStyle;
    width: number;
    ascent: number;
    descent: number;
    advance: number;
}

interface Line {
    glyphs: Glyph[];
    width: number;
    ascent: number;
    descent: number;
}

let layoutCache = new WeakMap<CanvasRenderingContext2D, WeakMap<AssEvent, { family: string; maxWidth: number; lines: Line[] }>>();

export function clearAssSubtitleMeasurements(): void {
    layoutCache = new WeakMap();
}

// Intl.Segmenter keeps surrogate pairs, combining marks and variation selectors
// together, including the supplementary characters emitted for mapped DRCS.
const segmenter = new Intl.Segmenter('ja', { granularity: 'grapheme' });

function font(style: AssTextStyle, family: string): string {
    return `${style.italic ? 'italic ' : ''}${style.bold ? 'bold ' : ''}${style.fontSize * style.fontSizeFactor}px ${family}`;
}

function layoutLines(ctx: CanvasRenderingContext2D, event: AssEvent, family: string, maxWidth: number): Line[] {
    let cache = layoutCache.get(ctx);
    if (!cache) {
        cache = new WeakMap();
        layoutCache.set(ctx, cache);
    }
    const existing = cache.get(event);
    if (existing?.family === family && existing.maxWidth === maxWidth) return existing.lines;
    const lines: Line[] = [];
    let line: Line = { glyphs: [], width: 0, ascent: 0, descent: 0 };
    const finish = (): void => {
        const last = line.glyphs.at(-1);
        if (last) line.width -= last.advance - last.width;
        lines.push(line);
        line = { glyphs: [], width: 0, ascent: 0, descent: 0 };
    };
    for (const run of event.runs) {
        const s = run.style;
        if (s.scaleX <= 0 || s.scaleY <= 0) continue;
        ctx.font = font(s, family);
        for (const { segment } of segmenter.segment(run.text)) {
            if (segment === '\n') {
                finish();
                continue;
            }
            const metrics = ctx.measureText(segment);
            const em = s.fontSize * s.fontSizeFactor;
            const glyph: Glyph = {
                text: segment,
                style: s,
                width: metrics.width * s.scaleX,
                advance: (metrics.width + s.spacing) * s.scaleX,
                ascent: Math.max(metrics.actualBoundingBoxAscent || em * 0.8, em * 0.8) * s.scaleY,
                descent: Math.max(metrics.actualBoundingBoxDescent || em * 0.2, em * 0.2) * s.scaleY,
            };
            if (event.wrap !== 2 && !event.position && !event.move && line.glyphs.length && line.width + glyph.width > maxWidth) finish();
            line.glyphs.push(glyph);
            line.width += glyph.advance;
            line.ascent = Math.max(line.ascent, glyph.ascent);
            line.descent = Math.max(line.descent, glyph.descent);
        }
    }
    if (line.glyphs.length) finish();
    cache.set(event, { family, maxWidth, lines });
    return lines;
}

interface SubtitleBackground {
    left: number;
    right: number;
    top: number;
    bottom: number;
    color: string;
    cellHeight: number;
    opacity: number;
    event: AssEvent;
}

function drawSubtitleBackgrounds(ctx: CanvasRenderingContext2D, backgrounds: SubtitleBackground[], connectRuby: boolean): void {
    if (connectRuby) {
        for (const ruby of backgrounds) {
            if (!ruby.event.position || ruby.event.move) continue;
            let bodyTop = Number.POSITIVE_INFINITY;
            for (const body of backgrounds) {
                // ASS has no semantic ruby tag. Limit joining to small, nearby
                // positioned fragments belonging to the same caption interval.
                if (
                    body.event === ruby.event ||
                    !body.event.position ||
                    body.event.move ||
                    body.event.start !== ruby.event.start ||
                    body.event.end !== ruby.event.end ||
                    body.event.layer !== ruby.event.layer ||
                    body.color !== ruby.color ||
                    body.opacity !== ruby.opacity ||
                    ruby.cellHeight > body.cellHeight * 0.65 ||
                    ruby.left >= body.right ||
                    ruby.right <= body.left ||
                    body.top < ruby.bottom ||
                    body.top - ruby.bottom > body.cellHeight
                )
                    continue;
                bodyTop = Math.min(bodyTop, body.top);
            }
            if (Number.isFinite(bodyTop)) ruby.bottom = bodyTop;
        }
    }
    const groups = new Map<string, SubtitleBackground[]>();
    for (const box of backgrounds) {
        const key = `${box.event.layer}:${box.opacity}:${box.color}`;
        const group = groups.get(key);
        if (group) group.push(box);
        else groups.set(key, [box]);
    }
    for (const boxes of groups.values()) {
        ctx.fillStyle = boxes[0].color;
        ctx.globalAlpha = boxes[0].opacity;
        if (boxes.length === 1) {
            const box = boxes[0];
            ctx.fillRect(box.left, box.top, box.right - box.left, box.bottom - box.top);
        } else {
            // One fill of the union prevents translucent overlaps becoming darker.
            ctx.beginPath();
            for (const box of boxes) ctx.rect(box.left, box.top, box.right - box.left, box.bottom - box.top);
            ctx.fill();
        }
    }
}

export function drawAssSubtitles(ctx: CanvasRenderingContext2D, doc: AssSubtitleDocument, time: number, isNicoJk: boolean, family: string): void {
    const occupied: { left: number; top: number; right: number; bottom: number; layer: number }[] = [];
    const backgrounds: SubtitleBackground[] = [];
    const renderedLines: { line: Line; baseline: number; x: number; opacity: number; layer: number }[] = [];
    ctx.save();
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.lineJoin = 'round';
    for (const event of activeAssEvents(doc, time)) {
        const lines = layoutLines(ctx, event, family, Math.max(1, doc.width - event.marginL - event.marginR));
        if (!lines.length) continue;
        const horizontal = (event.alignment - 1) % 3;
        const vertical = Math.floor((event.alignment - 1) / 3);
        let x = horizontal === 0 ? event.marginL : horizontal === 1 ? doc.width / 2 : doc.width - event.marginR;
        let y = vertical === 0 ? doc.height - event.marginV : vertical === 1 ? doc.height / 2 : event.marginV;
        if (event.move) {
            const m = event.move;
            const progress = Math.max(0, Math.min(1, (time - event.start - m.start) / Math.max(0.001, m.end - m.start)));
            x = m.x1 + (m.x2 - m.x1) * progress;
            y = m.y1 + (m.y2 - m.y1) * progress;
        } else if (event.position) {
            x = event.position.x;
            y = event.position.y;
        }
        const height = lines.reduce((sum, line) => sum + line.ascent + line.descent, 0);
        let top = y - (vertical === 0 ? height : vertical === 1 ? height / 2 : 0);
        const width = Math.max(...lines.map(line => line.width));
        const left = x - (width * horizontal) / 2;
        // Only unpositioned captions (e.g. SRT) participate in collision avoidance.
        if (!event.position && !event.move && !isNicoJk) {
            let collision;
            do {
                collision = occupied.find(box => box.layer === event.layer && left < box.right && left + width > box.left && top < box.bottom && top + height > box.top);
                if (collision) top = vertical === 2 ? collision.bottom + 2 : collision.top - height - 2;
            } while (collision);
            occupied.push({ left, right: left + width, top, bottom: top + height, layer: event.layer });
        }
        const opacity = event.fade
            ? Math.max(0, Math.min(1, event.fade.in ? (time - event.start) / event.fade.in : 1, event.fade.out ? (event.end - time) / event.fade.out : 1))
            : 1;
        for (const line of lines) {
            const baseline = top + line.ascent;
            let cursor = x - (line.width * horizontal) / 2;
            const lineBackgrounds: { x: number; right: number; top: number; bottom: number; color: string; padding: number; cellHeight: number }[] = [];
            for (const glyph of line.glyphs) {
                const s = glyph.style;
                if (!isNicoJk || s.borderStyle === 3) {
                    const padding = Math.max(1, s.fontSize * s.fontSizeFactor * Math.min(s.scaleX, s.scaleY) * 0.08);
                    const cellHeight = s.fontSize * s.fontSizeFactor * s.scaleY;
                    // FFmpeg's default SRT style supplies an opaque black shadow.
                    // Use the same translucent band as broadcast captions instead.
                    const background = !isNicoJk && s.background === '#000000ff' ? '#00000080' : s.background;
                    const previous = lineBackgrounds.at(-1);
                    if (previous && previous.color === background && previous.cellHeight === cellHeight) {
                        previous.right = cursor + glyph.width;
                        previous.top = Math.min(previous.top, baseline - glyph.ascent);
                        previous.bottom = Math.max(previous.bottom, baseline + glyph.descent);
                    } else
                        lineBackgrounds.push({
                            x: cursor,
                            right: cursor + glyph.width,
                            top: baseline - glyph.ascent,
                            bottom: baseline + glyph.descent,
                            color: background,
                            padding,
                            cellHeight,
                        });
                }
                cursor += glyph.advance;
            }
            backgrounds.push(
                ...lineBackgrounds.map(box => ({
                    left: box.x - box.padding,
                    right: box.right + box.padding,
                    top: box.top - box.padding,
                    bottom: box.bottom + box.padding,
                    color: box.color,
                    cellHeight: box.cellHeight,
                    event,
                    opacity,
                })),
            );
            renderedLines.push({ line, baseline, x: x - (line.width * horizontal) / 2, opacity, layer: event.layer });
            top += line.ascent + line.descent;
        }
    }
    for (const layer of new Set(renderedLines.map(line => line.layer))) {
        drawSubtitleBackgrounds(
            ctx,
            backgrounds.filter(box => box.event.layer === layer),
            !isNicoJk,
        );
        // Paint each layer's bands first so the body cannot cover ruby glyphs.
        for (const { line, baseline, x, opacity } of renderedLines.filter(line => line.layer === layer)) {
            ctx.globalAlpha = opacity;
            let cursor = x;
            for (const glyph of line.glyphs) {
                const s = glyph.style;
                if (s.scaleX <= 0 || s.scaleY <= 0) {
                    cursor += glyph.advance;
                    continue;
                }
                ctx.save();
                ctx.translate(cursor, baseline);
                ctx.scale(s.scaleX, s.scaleY);
                ctx.font = font(s, family);
                ctx.fillStyle = s.color;
                ctx.strokeStyle = s.outlineColor;
                ctx.lineWidth = s.outline * 2;
                if (isNicoJk && s.shadow !== 0) {
                    ctx.shadowColor = s.background;
                    ctx.shadowOffsetX = s.shadow;
                    ctx.shadowOffsetY = s.shadow;
                }
                if (s.outline > 0) ctx.strokeText(glyph.text, 0, 0);
                ctx.fillText(glyph.text, 0, 0);
                ctx.shadowOffsetX = 0;
                ctx.shadowOffsetY = 0;
                if (s.underline || s.strikeout) {
                    const em = s.fontSize * s.fontSizeFactor;
                    const thickness = Math.max(1, em / 18);
                    if (s.underline) ctx.fillRect(0, em * 0.12, glyph.advance / s.scaleX, thickness);
                    if (s.strikeout) ctx.fillRect(0, -em * 0.3, glyph.advance / s.scaleX, thickness);
                }
                ctx.restore();
                cursor += glyph.advance;
            }
        }
    }
    ctx.restore();
}
