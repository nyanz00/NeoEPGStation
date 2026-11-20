'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const output = ts.transpileModule(source, {
        compilerOptions: {
            esModuleInterop: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: filename,
    }).outputText;
    module._compile(output, filename);
};

const { default: JsonEventParser } = require('../../src/model/tuner/JsonEventParser.ts');

test('parses Mirakurun array framing, multiple objects, nested data, and quoted braces', () => {
    const parser = new JsonEventParser();
    const first = { resource: 'program', data: { id: 1, nested: [{ text: 'brace } and quote "' }] }, time: 10 };
    const second = { resource: 'service', data: { id: 2 }, time: 20 };

    assert.deepEqual(parser.push(` [\n${JSON.stringify(first)}\n,\n${JSON.stringify(second)}\n,\n`), [first, second]);
    assert.deepEqual(parser.push(']'), []);
    parser.finish();
});

test('emits concatenated objects as soon as each object closes without a delimiter', () => {
    const parser = new JsonEventParser();
    const first = { id: 1, value: 'first' };
    const second = { id: 2, value: 'second' };

    assert.deepEqual(parser.push(`${JSON.stringify(first)}${JSON.stringify(second)}`), [first, second]);
    parser.finish();
});

test('keeps UTF-8 characters intact when a multibyte sequence is split across buffers', () => {
    const parser = new JsonEventParser();
    const expected = { name: '日本語字幕😀' };
    const input = Buffer.from(`[\n${JSON.stringify(expected)}\n]`, 'utf8');
    const parsed = [];

    for (let index = 0; index < input.length; index++) {
        parsed.push(...parser.push(input.subarray(index, index + 1)));
    }

    assert.deepEqual(parsed, [expected]);
    parser.finish();
});

test('reports malformed JSON when a complete object frame closes', () => {
    const parser = new JsonEventParser();

    assert.throws(() => parser.push('{"resource":oops}'), /Invalid Mirakurun event JSON object/);
});

test('reports an unfinished object when the stream finishes', () => {
    const parser = new JsonEventParser();
    assert.deepEqual(parser.push('{"resource":"program","data":'), []);

    assert.throws(() => parser.finish(), /Incomplete Mirakurun event JSON object/);
});

test('rejects an uncompleted object larger than 8 MiB', () => {
    const parser = new JsonEventParser();
    const oversized = Buffer.alloc(8 * 1024 * 1024 + 1, 0x61);
    oversized[0] = 0x7b;

    assert.throws(() => parser.push(oversized), /exceeds 8 MiB/);
});
