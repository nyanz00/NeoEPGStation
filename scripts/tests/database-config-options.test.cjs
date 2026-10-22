const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const test = require('node:test');
const ts = require('typescript');

const sourcePath = path.resolve(__dirname, '../../src/model/db/DBOperator.ts');
const source = fs.readFileSync(sourcePath, 'utf8');
const compiled = ts.transpileModule(source, {
    compilerOptions: {
        experimentalDecorators: true,
        esModuleInterop: true,
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2021,
    },
}).outputText;
const dataSourceOptions = [];
class MockDataSource {
    constructor(options) {
        this.options = options;
        dataSourceOptions.push(options);
    }

    async initialize() {
        return this;
    }
}

const loadedModule = new Module(sourcePath, module);
loadedModule.filename = sourcePath;
loadedModule.paths = Module._nodeModulePaths(path.dirname(sourcePath));
const originalLoad = Module._load;
Module._load = function (request, parent, isMain) {
    if (parent?.filename === sourcePath) {
        if (request === 'inversify') return { inject: () => () => {}, injectable: target => target };
        if (request === 'typeorm') return { DataSource: MockDataSource };
        if (request.startsWith('.')) return {};
    }
    return originalLoad.call(this, request, parent, isMain);
};
try {
    loadedModule._compile(compiled, sourcePath);
} finally {
    Module._load = originalLoad;
}
const DBOperator = loadedModule.exports.default;

async function captureRuntimeOptions(config) {
    dataSourceOptions.length = 0;
    const model = new DBOperator(
        { getLogger: () => ({ system: { info() {}, error() {} } }) },
        { getConfig: () => config },
    );

    await model.getConnection();
    assert.equal(dataSourceOptions.length, 1);
    return dataSourceOptions[0];
}

test('runtime SQLite options default to WAL and a 90-second busy timeout', async () => {
    const options = await captureRuntimeOptions({ dbtype: 'sqlite' });

    assert.equal(options.type, 'better-sqlite3');
    assert.equal(options.enableWAL, true);
    assert.equal(options.timeout, 90_000);
});

test('runtime SQLite options pass explicit WAL and busy-timeout values', async () => {
    const options = await captureRuntimeOptions({
        dbtype: 'better-sqlite3',
        sqlite: { enableWAL: false, busyTimeout: 1234 },
    });

    assert.equal(options.enableWAL, false);
    assert.equal(options.timeout, 1234);
});

test('runtime MySQL options pass socketPath and SSL settings unchanged', async () => {
    const ssl = { ca: 'synthetic-ca-certificate', rejectUnauthorized: true };
    const options = await captureRuntimeOptions({
        dbtype: 'mysql',
        mysql: {
            host: 'localhost',
            port: 3306,
            user: 'synthetic-user',
            password: 'synthetic-password',
            database: 'synthetic-database',
            socketPath: 'C:/synthetic/mysql.sock',
            ssl,
        },
    });

    assert.equal(options.type, 'mysql');
    assert.equal(options.socketPath, 'C:/synthetic/mysql.sock');
    assert.equal(options.ssl, ssl);
});

test('ormconfig keeps matching SQLite defaults and MySQL socket/SSL options', () => {
    const ormConfig = fs.readFileSync(path.resolve(__dirname, '../../ormconfig.js'), 'utf8');

    assert.match(ormConfig, /timeout\s*:\s*config\.sqlite\?\.busyTimeout\s*\?\?\s*90000/);
    assert.match(ormConfig, /enableWAL\s*:\s*config\.sqlite\?\.enableWAL\s*\?\?\s*true/);
    assert.match(ormConfig, /socketPath\s*:\s*config\.mysql\.socketPath/);
    assert.match(ormConfig, /ssl\s*:\s*config\.mysql\.ssl/);
});
