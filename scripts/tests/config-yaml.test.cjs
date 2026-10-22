const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

function loadTypeScript(relativePath) {
    const absolutePath = path.resolve(__dirname, relativePath);
    const source = fs.readFileSync(absolutePath, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2021 },
    }).outputText;
    const loadedModule = new Module(absolutePath, module);
    loadedModule.filename = absolutePath;
    loadedModule.paths = Module._nodeModulePaths(path.dirname(absolutePath));
    loadedModule._compile(compiled, absolutePath);
    return loadedModule.exports;
}

const { loadConfigYaml } = loadTypeScript('../../src/util/ConfigYamlUtil.ts');

test('!env returns the exact environment value as a string', () => {
    const previous = process.env.CONFIG_YAML_TEST_VALUE;
    process.env.CONFIG_YAML_TEST_VALUE = '00123';
    try {
        assert.deepEqual(loadConfigYaml('value: !env CONFIG_YAML_TEST_VALUE'), { value: '00123' });
    } finally {
        if (previous === undefined) delete process.env.CONFIG_YAML_TEST_VALUE;
        else process.env.CONFIG_YAML_TEST_VALUE = previous;
    }
});

test('YAML anchors, aliases, and merge keys preserve explicit overrides', () => {
    const config = loadConfigYaml(
        ['defaults: &defaults', '  host: localhost', '  port: 8080', 'server:', '  <<: *defaults', '  port: 9090'].join(
            '\n',
        ),
    );
    assert.deepEqual(config, {
        defaults: { host: 'localhost', port: 8080 },
        server: { host: 'localhost', port: 9090 },
    });
});

test('missing environment variables fail without including environment values', () => {
    const secret = 'do-not-print-this-secret';
    process.env.CONFIG_YAML_TEST_SECRET = secret;
    delete process.env.CONFIG_YAML_TEST_MISSING;
    try {
        assert.throws(
            () => loadConfigYaml('value: !env CONFIG_YAML_TEST_MISSING'),
            error => {
                assert.match(error.message, /CONFIG_YAML_TEST_MISSING/);
                assert.equal(error.message.includes(secret), false);
                return true;
            },
        );
    } finally {
        delete process.env.CONFIG_YAML_TEST_SECRET;
    }
});
