const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const test = require('node:test');

const repoRoot = path.resolve(__dirname, '../..');

test('legacy config/enc.js can keep using require in a module package', t => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-esm-config-'));
    t.after(() => fs.rmSync(tempDir, { recursive: true, force: true }));

    fs.writeFileSync(path.join(tempDir, 'package.json'), '{"type":"module"}');
    const configDir = path.join(tempDir, 'config');
    fs.mkdirSync(configDir);
    const configPackage = fs.readFileSync(path.join(repoRoot, 'config', 'package.json'), 'utf8');
    assert.equal(JSON.parse(configPackage).type, 'commonjs');
    fs.writeFileSync(path.join(configDir, 'package.json'), configPackage);
    fs.writeFileSync(
        path.join(configDir, 'enc.js'),
        "const fs = require('node:fs');\nfs.writeFileSync(process.env.RESULT_FILE, 'loaded');\n",
    );

    const resultFile = path.join(tempDir, 'result.txt');
    const result = spawnSync(process.execPath, [path.join(configDir, 'enc.js')], {
        encoding: 'utf8',
        env: { ...process.env, RESULT_FILE: resultFile },
    });

    assert.equal(result.status, 0, result.stderr);
    assert.equal(fs.readFileSync(resultFile, 'utf8'), 'loaded');
});

test('OpenAPI validation remains runnable as CommonJS under root type module', () => {
    const result = spawnSync(process.execPath, ['scripts/validate-openapi.cjs'], {
        cwd: repoRoot,
        encoding: 'utf8',
    });

    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /api\.yml validation passed/);
});

test('ormconfig uses ESM exports and Node 20-compatible URL path resolution', () => {
    const source = fs.readFileSync(path.join(repoRoot, 'ormconfig.js'), 'utf8');

    assert.match(source, /export default ormConfig/);
    assert.match(source, /fileURLToPath\(import\.meta\.url\)/);
    assert.doesNotMatch(source, /\b(?:require|module\.exports|__dirname)\b/);
});
