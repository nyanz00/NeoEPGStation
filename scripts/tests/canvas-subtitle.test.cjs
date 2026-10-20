const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../client/src/core/player/CanvasSubtitleLayout.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);
const { parseAssSubtitle, activeAssEvents, drawAssSubtitles } = loadedModule.exports;

// Captured from Amatsukaze CaptionASSFormatter output. Its formatter uses a
// Yu Gothic 46 style, initial spacing 4, absolute positions and per-fragment
// scale/color overrides.
const amatsukazeAss = [
    '[Script Info]',
    'ScriptType: v4.00+',
    'PlayResX: 960',
    'PlayResY: 540',
    '[V4+ Styles]',
    'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
    'Style: Default,Yu Gothic,46,&H00FFFFFF,&H000000FF,&H00000000,&H7F000000,1,0,0,0,100,100,4,0,1,2,2,1,0,0,0,1',
    '[Events]',
    'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
    'Dialogue: 0,0:00:10.58,0:00:14.61,Default,,0000,0000,0000,,{\\pos(172,443)\\c&H00FFFF00\\fscx50\\fscy50}ふしぐろめぐみ',
    'Dialogue: 0,0:00:10.58,0:00:14.61,Default,,0000,0000,0000,,{\\pos(172,497)\\c&H00FFFF00\\fscx50\\fscy50}（{\\fscx100}伏黒恵{\\fscx50}）{\\fscx100}領域展開{\\fscx50}。',
    'Dialogue: 0,0:00:14.61,0:00:20.95,Default,,0000,0000,0000,,{\\pos(172,497)}♬～',
].join('\n');

function makeContext(measuredWidth = 80) {
    const calls = [];
    const stack = [];
    let currentPath = [];
    const ctx = {
        calls,
        font: '',
        fillStyle: '',
        strokeStyle: '',
        lineWidth: 1,
        textAlign: 'start',
        textBaseline: 'alphabetic',
        globalAlpha: 1,
        shadowOffsetX: 0,
        shadowOffsetY: 0,
        shadowColor: '',
        tx: 0,
        ty: 0,
        save() {
            stack.push({
                font: this.font,
                fillStyle: this.fillStyle,
                strokeStyle: this.strokeStyle,
                lineWidth: this.lineWidth,
                textAlign: this.textAlign,
                textBaseline: this.textBaseline,
                globalAlpha: this.globalAlpha,
                shadowOffsetX: this.shadowOffsetX,
                shadowOffsetY: this.shadowOffsetY,
                shadowColor: this.shadowColor,
                tx: this.tx,
                ty: this.ty,
            });
            calls.push({ type: 'save' });
        },
        restore() {
            Object.assign(this, stack.pop());
            calls.push({ type: 'restore' });
        },
        measureText(text) {
            calls.push({ type: 'measureText', text, font: this.font });
            const fontSize = Number.parseFloat(this.font.match(/[\d.]+px/)?.[0] ?? '20');
            const scale = fontSize / 20;
            return {
                width: measuredWidth * scale,
                actualBoundingBoxAscent: 20 * scale,
                actualBoundingBoxDescent: 5 * scale,
            };
        },
        fillText(text, x, y) {
            calls.push({
                type: 'fillText',
                text,
                x: this.tx + x,
                y: this.ty + y,
                font: this.font,
                fillStyle: this.fillStyle,
            });
        },
        fillRect(x, y, width, height) {
            calls.push({ type: 'fillRect', x, y, width, height, fillStyle: this.fillStyle });
        },
        beginPath() {
            currentPath = [];
            calls.push({ type: 'beginPath' });
        },
        rect(x, y, width, height) {
            currentPath.push({ x, y, width, height });
            calls.push({ type: 'rect', x, y, width, height });
        },
        fill() {
            calls.push({ type: 'fill', fillStyle: this.fillStyle, rects: currentPath.slice() });
        },
        strokeText(text, x, y) {
            calls.push({ type: 'strokeText', text, x: this.tx + x, y: this.ty + y });
        },
        translate(x, y) {
            this.tx += x;
            this.ty += y;
            calls.push({ type: 'translate', x: this.tx, y: this.ty });
        },
        scale(x, y) {
            calls.push({ type: 'scale', x, y });
        },
    };
    return ctx;
}

function makePositionedPair({
    rubyX = 172,
    rubyY = 443,
    bodyX = 172,
    bodyY = 497,
    rubyStart = '0:00:10.58',
    bodyStart = rubyStart,
    rubyLayer = 0,
    bodyLayer = 0,
    rubyScale = 50,
    bodyScale = 100,
} = {}) {
    const header = amatsukazeAss.split('\n').filter(line => !line.startsWith('Dialogue:'));
    header.push(
        `Dialogue: ${rubyLayer},${rubyStart},0:00:14.61,Default,,0000,0000,0000,,{\\pos(${rubyX},${rubyY})\\c&H00FFFF00\\fscx${rubyScale}\\fscy${rubyScale}}ふりがな`,
        `Dialogue: ${bodyLayer},${bodyStart},0:00:14.61,Default,,0000,0000,0000,,{\\pos(${bodyX},${bodyY})\\c&H00FFFF00\\fscx${bodyScale}\\fscy${bodyScale}}本文`,
    );
    return parseAssSubtitle(header.join('\n'));
}

function backgroundRects(ctx) {
    return [
        ...ctx.calls.filter(call => call.type === 'fillRect'),
        ...ctx.calls.filter(call => call.type === 'fill').flatMap(call => call.rects),
    ];
}

test('parses Amatsukaze Yu Gothic 46 captions, run overrides, and positioned ruby/body events', () => {
    const doc = parseAssSubtitle(amatsukazeAss);

    assert.equal(doc.width, 960);
    assert.equal(doc.height, 540);
    assert.ok(doc.styles instanceof Map);
    assert.equal(doc.events.length, 3);
    assert.equal(doc.events[0].start, 10.58);
    assert.equal(doc.events[0].end, 14.61);
    assert.deepEqual(doc.events[0].position, { x: 172, y: 443 });
    assert.deepEqual(doc.events[1].position, { x: 172, y: 497 });
    assert.equal(doc.events[0].alignment, 1);
    assert.equal(doc.events[0].runs[0].text, 'ふしぐろめぐみ');
    assert.equal(doc.events[0].runs[0].style.scaleX, 0.5);
    assert.equal(doc.events[0].runs[0].style.scaleY, 0.5);
    assert.equal(doc.events[0].runs[0].style.spacing, 4);
    assert.equal(doc.events[0].runs[0].style.bold, false, 'Amatsukaze Yu Gothic 46 uses normal weight');
    assert.equal(doc.events[0].runs[0].style.outline, 2, 'the outline stays at two pixels per 36px ARIB cell');
    assert.equal(doc.events[0].runs[0].style.fontSizeFactor, 36 / 46);

    const bodyRuns = doc.events[1].runs;
    assert.deepEqual(
        bodyRuns.map(run => run.text),
        ['（', '伏黒恵', '）', '領域展開', '。'],
    );
    assert.deepEqual(
        bodyRuns.map(run => run.style.scaleX),
        [0.5, 1, 0.5, 1, 0.5],
    );
    assert.ok(doc.events[0].runs[0].style.color);
    assert.ok(doc.events[0].runs[0].style.background);
});

test('bridges a positioned Amatsukaze ruby background to its matching body band', () => {
    const doc = makePositionedPair();
    const ctx = makeContext();

    drawAssSubtitles(ctx, doc, 12, false, 'sans-serif');

    const painted = ctx.calls
        .filter(call => call.type === 'fillText')
        .map(call => call.text)
        .join('');
    assert.ok(painted.includes('ふりがな'));
    assert.ok(painted.includes('本文'));
    const fills = ctx.calls.filter(call => call.type === 'fill');
    assert.equal(fills.length, 1, 'same-color caption bands should be painted in one path');
    const backgrounds = fills[0].rects;
    assert.equal(backgrounds.length, 2, 'the ruby and body remain separate rectangles in the union path');

    const [ruby, body] = doc.events;
    const rubyContext = makeContext();
    const bodyContext = makeContext();
    drawAssSubtitles(rubyContext, { ...doc, events: [ruby] }, 12, false, 'sans-serif');
    drawAssSubtitles(bodyContext, { ...doc, events: [body] }, 12, false, 'sans-serif');
    const rubyBackground = rubyContext.calls.find(call => call.type === 'fillRect');
    const bodyBackground = bodyContext.calls.find(call => call.type === 'fillRect');
    assert.ok(rubyBackground, 'ruby should receive its own background band');
    assert.ok(bodyBackground, 'body should receive its own background band');
    assert.ok(rubyBackground.y < bodyBackground.y, 'the ruby band should remain above the body band');
    assert.ok(
        rubyBackground.width < bodyBackground.width,
        'the half-scale ruby band should be narrower than the body band',
    );
    const [combinedRuby, combinedBody] = backgrounds;
    assert.ok(combinedRuby.y + combinedRuby.height >= combinedBody.y, 'the ruby band should reach the body band top');
    assert.ok(combinedRuby.width === rubyBackground.width, 'the bridge should preserve the ruby band width');
    assert.ok(
        combinedRuby.y + combinedRuby.height <= combinedBody.y + combinedBody.height,
        'the ruby extension must stop within the body band',
    );
    assert.ok(
        ctx.calls.findIndex(call => call.type === 'fill') < ctx.calls.findIndex(call => call.type === 'fillText'),
        'all caption backgrounds must be painted before glyphs',
    );
});

test('does not bridge ruby-like bands across layer, interval, distance, horizontal position, or size', () => {
    const cases = [
        ['different layer', { bodyLayer: 1 }],
        ['different interval', { bodyStart: '0:00:10.59' }],
        ['too far vertically', { bodyY: 540 }],
        ['no horizontal overlap', { bodyX: 900 }],
        ['similar size', { rubyScale: 100 }],
    ];
    for (const [name, options] of cases) {
        const ctx = makeContext();
        drawAssSubtitles(ctx, makePositionedPair(options), 12, false, 'sans-serif');
        const [ruby, body] = backgroundRects(ctx);
        assert.ok(ruby && body, `${name}: both bands should still be painted`);
        assert.ok(ruby.y + ruby.height < body.y, `${name}: the bands should remain disconnected`);
    }
});

test('fills overlapping same-color caption bands once before painting any glyphs', () => {
    const ctx = makeContext();
    drawAssSubtitles(ctx, makePositionedPair({ bodyY: 455 }), 12, false, 'sans-serif');
    assert.equal(ctx.calls.filter(call => call.type === 'fill').length, 1);
    assert.equal(ctx.calls.filter(call => call.type === 'fill')[0].rects.length, 2);
    assert.ok(
        ctx.calls.findIndex(call => call.type === 'fill') < ctx.calls.findIndex(call => call.type === 'fillText'),
        'the union background must be painted before the ruby and body glyphs',
    );
});

test('normalizes only recognized Amatsukaze styles and keeps explicit bold and unrelated styles', () => {
    const inline = parseAssSubtitle(
        amatsukazeAss.replace(
            /Dialogue:[^\n]+ふしぐろめぐみ/,
            'Dialogue: 0,0:00:10.58,0:00:14.61,Default,,0000,0000,0000,,{\\pos(172,443)\\c&H00FFFF00\\fscx50\\fscy50}normal{\\b1}bold',
        ),
    );
    assert.equal(inline.events[0].runs[0].style.bold, false);
    assert.equal(inline.events[0].runs[1].style.bold, true, 'inline \\b1 must override the normalized style');
    const inlineContext = makeContext();
    drawAssSubtitles(inlineContext, inline, 12, false, 'sans-serif');
    const inlineFonts = inlineContext.calls.filter(call => call.type === 'fillText');
    assert.match(inlineFonts.find(call => call.text === 'n').font, /^\d+(?:\.\d+)?px /);
    assert.match(inlineFonts.find(call => call.text === 'b').font, /^bold \d+(?:\.\d+)?px /);

    const unrelatedAss = amatsukazeAss
        .replace('Yu Gothic,46', 'Arial,46')
        .replace(/Dialogue:[\s\S]*/, 'Dialogue: 0,0:00:10.00,0:00:14.00,Default,,0,0,0,,still bold');
    const unrelated = parseAssSubtitle(unrelatedAss);
    assert.equal(unrelated.events[0].runs[0].style.bold, true, 'non-Amatsukaze style weight must be preserved');
    const unrelatedContext = makeContext();
    drawAssSubtitles(unrelatedContext, unrelated, 12, false, 'sans-serif');
    assert.match(unrelatedContext.calls.find(call => call.type === 'fillText').font, /^bold /);
    const nicoContext = makeContext();
    drawAssSubtitles(nicoContext, unrelated, 12, true, 'sans-serif');
    assert.match(
        nicoContext.calls.find(call => call.type === 'fillText').font,
        /^bold /,
        'NicoJk rendering must retain the supplied style weight',
    );
});

test('uses measured glyph width for background bounds', () => {
    const doc = parseAssSubtitle(amatsukazeAss);
    const narrow = makeContext(20);
    const wide = makeContext(140);

    drawAssSubtitles(narrow, doc, 12, false, 'sans-serif');
    drawAssSubtitles(wide, doc, 12, false, 'sans-serif');

    const narrowRects = backgroundRects(narrow);
    const wideRects = backgroundRects(wide);
    assert.ok(narrowRects.length > 0);
    assert.ok(wideRects.length > 0);
    assert.notEqual(wideRects[0].width, narrowRects[0].width);
});

test('renders only within the event interval and interpolates move positions', () => {
    const ass = [
        '[Script Info]',
        'PlayResX: 640',
        'PlayResY: 360',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,{\\an7\\move(10,20,110,220,500,1500)}moving',
    ].join('\n');
    const doc = parseAssSubtitle(ass);
    assert.deepEqual(doc.events[0].move, { x1: 10, y1: 20, x2: 110, y2: 220, start: 0.5, end: 1.5 });

    const before = makeContext();
    drawAssSubtitles(before, doc, 0.99, false, 'sans-serif');
    assert.equal(
        before.calls.some(call => call.type === 'fillText'),
        false,
    );
    const middle = makeContext();
    drawAssSubtitles(middle, doc, 2, false, 'sans-serif');
    const text = middle.calls.find(call => call.type === 'translate');
    assert.ok(text);
    assert.equal(text.x, 60);
    assert.equal(text.y, 140);
    const after = makeContext();
    drawAssSubtitles(after, doc, 3, false, 'sans-serif');
    assert.equal(
        after.calls.some(call => call.type === 'fillText'),
        false,
    );
});

test('handles long overlapping events when seeking across active-time boundaries', () => {
    const ass = [
        '[Script Info]',
        'PlayResX: 640',
        'PlayResY: 360',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:01.00,0:20:00.00,Default,,0,0,0,,long event',
        'Dialogue: 0,0:00:30.00,0:00:40.00,Default,,0,0,0,,short event',
    ].join('\n');
    const doc = parseAssSubtitle(ass);

    assert.deepEqual(activeAssEvents(doc, 19 * 60), [doc.events[0]]);
    assert.deepEqual(activeAssEvents(doc, 35), [doc.events[0], doc.events[1]]);
    assert.deepEqual(activeAssEvents(doc, 20 * 60), []);
    assert.deepEqual(
        activeAssEvents(doc, 35),
        [doc.events[0], doc.events[1]],
        'seeking backward should restore active events',
    );
});

test('keeps supplementary variation selectors attached to their base glyph', () => {
    const glyph = `葛${String.fromCodePoint(0xe0100)}`;
    const ass = [
        '[Script Info]',
        'PlayResX: 640',
        'PlayResY: 360',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        `Dialogue: 0,0:00:01.00,0:00:03.00,Default,,0,0,0,,${glyph}`,
    ].join('\n');
    const ctx = makeContext();
    drawAssSubtitles(ctx, parseAssSubtitle(ass), 2, false, 'sans-serif');

    assert.deepEqual(
        ctx.calls.filter(call => call.type === 'fillText').map(call => call.text),
        [glyph],
    );
});

test('honors ASS color/reset and text scale, spacing, and FFmpeg line escapes', () => {
    const ass = [
        '[Script Info]',
        'PlayResX: 1280',
        'PlayResY: 720',
        '[V4+ Styles]',
        'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
        'Style: Default,Arial,40,&H00FFFFFF,&H000000FF,&H00000000,&H7F000000,0,0,0,0,100,100,0,0,1,0,0,2,0,0,0,1',
        '[Events]',
        'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: 0,0:00:01.00,0:00:04.00,Default,,0,0,0,,{\\an2\\c&H0000FF&\\fscx125\\fscy80\\fsp3\\b1\\i1\\u1}red{\\rDefault} reset\\Nnext\\hword',
    ].join('\n');
    const doc = parseAssSubtitle(ass);
    const event = doc.events[0];
    assert.equal(event.alignment, 2);
    assert.deepEqual(
        event.runs.map(run => run.text),
        ['red', ' reset\nnext word'],
    );
    const styled = event.runs[0].style;
    const reset = event.runs[1].style;
    assert.equal(styled.scaleX, 1.25);
    assert.equal(styled.scaleY, 0.8);
    assert.equal(styled.spacing, 3);
    assert.equal(styled.bold, true);
    assert.equal(styled.italic, true);
    assert.equal(styled.underline, true);
    assert.notEqual(styled.color, reset.color);
    assert.equal(reset.scaleX, 1);
    assert.equal(reset.scaleY, 1);
    assert.equal(reset.spacing, 0);

    const ctx = makeContext();
    drawAssSubtitles(ctx, doc, 2, false, 'Arial');
    assert.ok(ctx.calls.some(call => call.type === 'fillText' && call.text === '\u00a0'));
    assert.ok(new Set(ctx.calls.filter(call => call.type === 'translate').map(call => call.y)).size > 1);
});

test('reuses measured glyph layout for animated comments without adding caption bands', () => {
    const ass = amatsukazeAss.replace(
        /Dialogue:[\s\S]*/,
        'Dialogue: 0,0:00:10.00,0:00:14.00,Default,,0,0,0,,{\\an7\\move(900,50,-100,50)}実況コメント',
    );
    const doc = parseAssSubtitle(ass);
    const ctx = makeContext();
    drawAssSubtitles(ctx, doc, 11, true, 'sans-serif');
    const measurements = ctx.calls.filter(call => call.type === 'measureText').length;
    const firstPosition = ctx.calls.find(call => call.type === 'translate').x;
    ctx.calls.length = 0;
    drawAssSubtitles(ctx, doc, 12, true, 'sans-serif');
    assert.ok(measurements > 0);
    assert.equal(
        ctx.calls.some(call => call.type === 'measureText'),
        false,
    );
    assert.equal(
        ctx.calls.some(call => call.type === 'fillRect'),
        false,
    );
    assert.ok(ctx.calls.find(call => call.type === 'translate').x < firstPosition);
});

test('applies per-run alpha, resets colors, and does not render vector commands as text', () => {
    const ass = amatsukazeAss.replace(
        /Dialogue:[\s\S]*/,
        'Dialogue: 0,0:00:10.00,0:00:14.00,Default,,0,0,0,,{\\c&H0000FF&\\1a&H80&\\4c&H00FF00&\\4a&HFF&}赤{\\c\\4c\\1a&H00&}白{\\p1}m 0 0 l 10 0 10 10{\\p0}字幕',
    );
    const doc = parseAssSubtitle(ass);
    assert.deepEqual(
        doc.events[0].runs.map(run => run.text),
        ['赤', '白', '字幕'],
    );
    assert.equal(doc.events[0].runs[0].style.color, '#ff00007f');
    assert.equal(doc.events[0].runs[0].style.background, '#00ff0000');
    assert.equal(doc.events[0].runs[1].style.color, '#ffffffff');
    assert.equal(doc.events[0].runs[1].style.background, '#00000080');
});

test('keeps a single background across glyphs with different ink heights', () => {
    const doc = parseAssSubtitle(
        amatsukazeAss.replace(
            /Dialogue:[\s\S]*/,
            'Dialogue: 0,0:00:10.00,0:00:14.00,Default,,0,0,0,,{\\pos(100,450)}あgい',
        ),
    );
    const ctx = makeContext();
    ctx.measureText = text => ({
        width: 36,
        actualBoundingBoxAscent: text === 'あ' ? 32 : 29,
        actualBoundingBoxDescent: text === 'g' ? 10 : 3,
    });
    drawAssSubtitles(ctx, doc, 12, false, 'sans-serif');
    assert.equal(
        ctx.calls.filter(call => call.type === 'fillRect').length,
        1,
        'glyph bounds must not produce overlapping translucent bands',
    );
});
