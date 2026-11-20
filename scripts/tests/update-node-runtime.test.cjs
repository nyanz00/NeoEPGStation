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

const { assertUpdateNodeRuntime } = require('../../src/model/update/UpdateNodeRuntime.ts');
const requirement = '^22.13.0 || >=24.11.0';

test('accepts the first supported Node.js releases and later supported majors', () => {
    for (const version of ['22.13.0', '22.13.1', '24.11.0', '24.11.1', '26.0.0']) {
        assert.doesNotThrow(() => assertUpdateNodeRuntime({ engines: { node: requirement } }, version));
    }
});

test('rejects Node.js releases below either supported range', () => {
    for (const version of ['20.20.0', '22.12.0', '24.10.0']) {
        assert.throws(() => assertUpdateNodeRuntime({ engines: { node: requirement } }, version), /更新先にはNode\.js/);
    }
});

test('keeps compatibility when the package manifest has no Node.js engine requirement', () => {
    for (const manifest of [null, {}, { engines: {} }, { engines: { npm: '>=10' } }]) {
        assert.doesNotThrow(() => assertUpdateNodeRuntime(manifest, '20.0.0'));
    }
});

test('rejects a malformed Node.js engine requirement', () => {
    for (const node of ['not semver', '=>=22', 22, null]) {
        assert.throws(() => assertUpdateNodeRuntime({ engines: { node } }, '24.11.0'), {
            message: '更新先のNode.js要件が不正です',
        });
    }
});
