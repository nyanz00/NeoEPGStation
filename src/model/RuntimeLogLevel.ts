import * as fs from 'fs';
import * as yaml from 'js-yaml';
import * as path from 'path';
import * as apid from '../../api';

export const runtimeLogLevelPath = path.join(__dirname, '..', '..', 'data', 'runtime-log-levels.json');

const levels: apid.SystemLogLevel[] = ['trace', 'debug', 'info', 'warn', 'error', 'fatal', 'off'];

type RuntimeLogLevels = Partial<
    Record<apid.SystemLogSource, Partial<Record<apid.SystemLogCategory, apid.SystemLogLevel>>>
>;

export function isSystemLogLevel(value: unknown): value is apid.SystemLogLevel {
    return typeof value === 'string' && levels.includes(value as apid.SystemLogLevel);
}

export function readRuntimeLogLevels(): RuntimeLogLevels {
    try {
        const parsed = JSON.parse(fs.readFileSync(runtimeLogLevelPath, 'utf8')) as RuntimeLogLevels;
        return parsed !== null && typeof parsed === 'object' ? parsed : {};
    } catch (_err: any) {
        return {};
    }
}

export function getRuntimeLogLevel(
    source: apid.SystemLogSource,
    category: apid.SystemLogCategory,
): apid.SystemLogLevel {
    const override = readRuntimeLogLevels()[source]?.[category];
    if (isSystemLogLevel(override)) return override;

    const configName = `${source.charAt(0).toLowerCase()}${source.slice(1)}LogConfig.yml`;
    const configPath = path.join(__dirname, '..', '..', 'config', configName);
    try {
        const config = yaml.load(fs.readFileSync(configPath, 'utf8')) as {
            categories?: Record<string, { level?: unknown }>;
        };
        const configured = config.categories?.[category]?.level;
        return isSystemLogLevel(configured) ? configured : 'info';
    } catch (_err: any) {
        return 'info';
    }
}

export function setRuntimeLogLevel(
    source: apid.SystemLogSource,
    category: apid.SystemLogCategory,
    level: apid.SystemLogLevel,
): void {
    const settings = readRuntimeLogLevels();
    settings[source] = { ...settings[source], [category]: level };
    fs.mkdirSync(path.dirname(runtimeLogLevelPath), { recursive: true });
    fs.writeFileSync(runtimeLogLevelPath, `${JSON.stringify(settings, null, 2)}\n`, 'utf8');
}
