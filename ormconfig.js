const fs = require('node:fs');
const path = require('node:path');
const { loadConfigYaml } = require('./dist/util/ConfigYamlUtil.js');
const { DataSource } = require('typeorm');

// config.yml 読み込み
const configFilePath = path.join('config', 'config.yml');
const config = loadConfigYaml(fs.readFileSync(configFilePath, 'utf-8'));

// dist 下のディレクトリ設定
const distDBBasePath = path.join('dist', 'db');
const entitie = path.join(distDBBasePath, 'entities', '**', '*.js');
const subscriber = path.join(distDBBasePath, 'subscribers', '**', '*.js');

const migrationDBType = ['sqlite', 'better-sqlite3'].includes(config.dbtype) ? 'sqlite' : config.dbtype;
const migrations = [path.join(distDBBasePath, 'migrations', migrationDBType, '**', '*.js')];

// database の種類に応じた設定
let ormConfig;
switch (config.dbtype) {
    case 'sqlite':
    case 'better-sqlite3':
        ormConfig = new DataSource({
            type: 'better-sqlite3',
            database: path.join(__dirname, 'data', 'database.db'),
            timeout: config.sqlite?.busyTimeout ?? 90000,
            enableWAL: config.sqlite?.enableWAL ?? true,
            synchronize: false,
            logging: false,
            entities: [entitie],
            subscribers: [subscriber],
            migrationsRun: false,
            migrations: migrations,
        });
        break;

    case 'mysql':
        ormConfig = new DataSource({
            type: 'mysql',
            host: config.mysql.host,
            port: config.mysql.port,
            username: config.mysql.user,
            password: config.mysql.password,
            database: config.mysql.database,
            socketPath: config.mysql.socketPath,
            ssl: config.mysql.ssl,
            charset: typeof config.mysql.charset === 'undefined' ? 'utf8mb4' : config.mysql.charset,
            bigNumberStrings: false,
            synchronize: false,
            logging: false,
            entities: [entitie],
            subscribers: [subscriber],
            migrationsRun: false,
            migrations: migrations,
        });
        break;

    default:
        throw new Error('db config error');
}

module.exports = { ormConfig };
