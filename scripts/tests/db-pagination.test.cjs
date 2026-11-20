const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
require('./ts-cjs-compat.cjs');
const ts = require('typescript');

const sourcePath = path.join(__dirname, '../../src/model/db/DBUtil.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
}).outputText;
const fixtureModule = { exports: {} };
vm.runInNewContext(compiled, { module: fixtureModule, exports: fixtureModule.exports });

const resolvePagination = fixtureModule.exports.default.resolvePagination;
assert.deepEqual({ ...resolvePagination(undefined, 25, 'mysql') }, { limit: 25 });
assert.deepEqual({ ...resolvePagination(0, 25, 'mysql') }, { offset: 0, limit: 25 });
assert.deepEqual({ ...resolvePagination(40, undefined, 'mysql') }, { offset: 40, limit: 2147483647 });
assert.deepEqual({ ...resolvePagination(40, 0, 'mysql') }, { offset: 40, limit: 2147483647 });
assert.deepEqual({ ...resolvePagination(40, undefined, 'better-sqlite3') }, { offset: 40 });
assert.deepEqual({ ...resolvePagination(40, 0, 'better-sqlite3') }, { offset: 40 });
assert.deepEqual({ ...resolvePagination(undefined, 0, 'mysql') }, {});

console.log('db pagination tests passed');
