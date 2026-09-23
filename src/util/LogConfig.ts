import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import * as yaml from 'js-yaml';
import * as apid from '../../api';

interface LogAppender {
    type?: unknown;
    filename?: unknown;
    appender?: unknown;
    alwaysIncludePattern?: unknown;
    pattern?: unknown;
    fileNameSep?: unknown;
    keepFileExt?: unknown;
}

interface LogConfiguration {
    appenders?: Record<string, LogAppender>;
    categories?: Record<string, { appenders?: unknown }>;
}

const sources: apid.SystemLogSource[] = ['Operator', 'Service', 'EPGUpdater'];
const categories: apid.SystemLogCategory[] = ['system', 'access', 'stream', 'encode'];
const appRoot = path.join(__dirname, '..', '..');

export function getLogConfigPath(source: apid.SystemLogSource): string {
    const configName = source === 'EPGUpdater' ? 'epgUpdaterLogConfig.yml' : `${source.toLowerCase()}LogConfig.yml`;
    return path.join(appRoot, 'config', configName);
}

/** Use the same substitutions as LoggerModel before interpreting a log4js configuration. */
export function expandLogConfigPaths(text: string): string {
    let expanded = text;
    for (const source of sources) {
        for (const category of categories) {
            const token = `%${source}${category.charAt(0).toUpperCase()}${category.slice(1)}%`;
            const filename = path.join(appRoot, 'logs', source, `${category}.log`);
            const yamlPath = process.platform === 'win32' ? filename.replace(/\\/g, '\\\\') : filename;
            expanded = expanded.split(token).join(yamlPath);
        }
    }
    return expanded;
}

function absoluteLogPath(filename: string): string {
    const expanded =
        filename.startsWith('~/') || filename.startsWith('~\\') ? path.join(os.homedir(), filename.slice(2)) : filename;
    return path.resolve(expanded);
}

function collectFileAppenders(
    appenderName: string,
    appenders: Record<string, LogAppender>,
    visited: Set<string>,
): LogAppender[] {
    if (visited.has(appenderName)) return [];
    visited.add(appenderName);
    const appender = appenders[appenderName];
    if (appender === undefined) throw new Error(`ログ設定のアペンダーが見つかりません: ${appenderName}`);
    if (appender.type === 'file' || appender.type === 'dateFile') return [appender];
    if (
        (appender.type === 'logLevelFilter' || appender.type === 'categoryFilter') &&
        typeof appender.appender === 'string'
    ) {
        return collectFileAppenders(appender.appender, appenders, visited);
    }
    return [];
}

/** Resolve the file actually configured for a category; null means it has no file appender. */
export function getConfiguredLogFile(
    source: apid.SystemLogSource,
    category: apid.SystemLogCategory,
): {
    filename: string;
    dateFileWithPattern: boolean;
    pattern: string;
    fileNameSep: string;
    keepFileExt: boolean;
} | null {
    const content = fs.readFileSync(getLogConfigPath(source), 'utf8');
    const config = yaml.load(expandLogConfigPaths(content)) as LogConfiguration | undefined;
    const appenderNames = config?.categories?.[category]?.appenders ?? config?.categories?.default?.appenders;
    if (appenderNames === undefined) return null;
    if (!Array.isArray(appenderNames) || config?.appenders === undefined) {
        throw new Error('ログファイルの出力設定が不正です');
    }
    const fileAppenders = appenderNames.flatMap(name =>
        typeof name === 'string' ? collectFileAppenders(name, config.appenders!, new Set()) : [],
    );
    const filenames = [...new Set(fileAppenders.map(appender => appender.filename))];
    if (filenames.length === 0) return null;
    if (filenames.length > 1) throw new Error('複数のログファイル出力先は、この画面では表示できません');
    const filename = filenames[0];
    if (typeof filename !== 'string' || filename.length === 0) {
        throw new Error('ログファイルの保存先設定が不正です');
    }
    const appender = fileAppenders[0];
    return {
        filename: absoluteLogPath(filename),
        dateFileWithPattern: appender.type === 'dateFile' && appender.alwaysIncludePattern === true,
        pattern: typeof appender.pattern === 'string' && appender.pattern.length > 0 ? appender.pattern : 'yyyy-MM-dd',
        fileNameSep:
            typeof appender.fileNameSep === 'string' && appender.fileNameSep.length > 0 ? appender.fileNameSep : '.',
        keepFileExt: appender.keepFileExt === true,
    };
}

function matchesDatePattern(value: string, pattern: string): boolean {
    const tokens: Record<string, string> = {
        yyyy: '\\d{4}',
        yyy: '\\d{2}',
        yy: '\\d{2}',
        y: '\\d{2}',
        MM: '(?:0[1-9]|1[0-2])',
        dd: '(?:0[1-9]|[12]\\d|3[01])',
        hh: '(?:[01]\\d|2[0-3])',
        mm: '[0-5]\\d',
        ss: '[0-5]\\d',
        SSS: '\\d{3}',
        O: '(?:Z|[+-]\\d{2}:\\d{2})',
    };
    const escape = (part: string): string => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const matcher = /yyyy|yyy|yy|y|MM|dd|hh|mm|ss|SSS|O/g;
    let lastIndex = 0;
    let expression = '';
    for (const match of pattern.matchAll(matcher)) {
        const index = match.index ?? 0;
        expression += escape(pattern.slice(lastIndex, index)) + tokens[match[0]];
        lastIndex = index + match[0].length;
    }
    expression += escape(pattern.slice(lastIndex));
    return new RegExp(`^${expression}$`).test(value);
}

/** For dateFile with alwaysIncludePattern, the current file name is date-dependent. */
export async function resolveCurrentLogFile(
    configured: NonNullable<ReturnType<typeof getConfiguredLogFile>>,
): Promise<string> {
    if (!configured.dateFileWithPattern) return configured.filename;
    const directory = path.dirname(configured.filename);
    const base = path.basename(configured.filename);
    const extension = path.extname(base);
    const stem = configured.keepFileExt && extension.length > 0 ? base.slice(0, -extension.length) : base;
    const prefix = `${stem}${configured.fileNameSep}`;
    let entries: string[];
    try {
        entries = await fs.promises.readdir(directory);
    } catch (error: any) {
        if (error?.code === 'ENOENT') return configured.filename;
        throw error;
    }
    const candidates = entries.filter(entry => {
        if (!entry.startsWith(prefix)) return false;
        if (configured.keepFileExt && extension.length > 0 && !entry.endsWith(extension)) return false;
        const suffix = entry.slice(
            prefix.length,
            configured.keepFileExt && extension.length > 0 ? -extension.length : undefined,
        );
        return matchesDatePattern(suffix, configured.pattern);
    });
    const files = await Promise.all(
        candidates.map(async entry => {
            const filename = path.join(directory, entry);
            try {
                const stat = await fs.promises.stat(filename);
                return stat.isFile() ? { filename, modifiedAt: stat.mtimeMs } : null;
            } catch (error: any) {
                if (error?.code === 'ENOENT') return null;
                throw error;
            }
        }),
    );
    return (
        files
            .filter((file): file is { filename: string; modifiedAt: number } => file !== null)
            .sort((a, b) => b.modifiedAt - a.modifiedAt)[0]?.filename ?? configured.filename
    );
}
