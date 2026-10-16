const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/util/AssCommentParser.ts');
const compiled = ts.transpileModule(fs.readFileSync(sourcePath, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
}).outputText;
const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
loadedModule._compile(compiled, sourcePath);
const { parseAssComments } = loadedModule.exports;

test('ASS comments preserve field formats and normalize text, style, color, position, and size', () => {
    const ass = [
        '[Script Info]',
        'Title: Parser test',
        '[V4+ Styles]',
        'Format: PrimaryColour, Name',
        'Style: &H00332211&, Top',
        'Style: &H000000FF&, Normal',
        '[Events]',
        'Format: Name, End, Start, Style, Layer, MarginL, MarginR, MarginV, Effect, Text',
        'Dialogue: alice,0:00:05.00,0:00:02.25,Top,0,0,0,0,,{\\an2}first, with comma\\Nnext\\hword',
        'Dialogue: bob,0:00:05.00,0:00:01.50,Normal,0,0,0,0,,{\\an8\\fs50\\c&H563412&}hello',
        'Dialogue: claire,0:00:04.00,0:00:01.00,Unknown,0,0,0,0,,{\\an2\\fs28}bottom',
        'Dialogue: ignored,0:00:04.00,not-a-time,Unknown,0,0,0,0,,invalid time',
        'Dialogue: ignored,0:00:04.00,0:00:03.00,Unknown,0,0,0,0,,{\\i1}',
        'Dialogue: ignored,0:00:04.00,0:00:03.50,Unknown,0,0,0,0,,{\\p1}m 0 0 l 10 10',
    ].join('\n');

    assert.deepEqual(parseAssComments(ass), [
        {
            id: 2,
            time: 1,
            text: 'bottom',
            color: '#FFFFFF',
            position: 'bottom',
            size: 'small',
            userId: 'claire',
            postedAt: 0,
        },
        {
            id: 1,
            time: 1.5,
            text: 'hello',
            color: '#123456',
            position: 'right',
            size: 'big',
            userId: 'bob',
            postedAt: 0,
        },
        {
            id: 0,
            time: 2.25,
            text: 'first, with comma\nnext word',
            color: '#112233',
            position: 'top',
            size: 'medium',
            userId: 'alice',
            postedAt: 0,
        },
    ]);
});

test('ASS comments use defaults when no style or override is available', () => {
    const ass = [
        '[Events]',
        'Format: Start, End, Style, Name, Text',
        'Dialogue: 0:00:00.29,0:00:01.00,Other,,default',
    ].join('\n');

    assert.deepEqual(parseAssComments(ass), [
        {
            id: 0,
            time: 0.29,
            text: 'default',
            color: '#FFFFFF',
            position: 'right',
            size: 'medium',
            userId: '',
            postedAt: 0,
        },
    ]);
    assert.deepEqual(parseAssComments(''), []);
});
