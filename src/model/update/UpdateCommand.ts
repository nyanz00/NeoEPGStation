import { getBuildEnvironment } from '../../../scripts/preflight-resources.cjs';
import * as fs from 'fs';
import * as path from 'path';
import * as iconv from 'iconv-lite';

export function resolveUpdatePackageCommand(
    command: 'npm' | 'pnpm',
    options: {
        platform?: NodeJS.Platform;
        execPath?: string;
        environment?: NodeJS.ProcessEnv;
        exists?: (file: string) => boolean;
    } = {},
): string {
    if ((options.platform ?? process.platform) !== 'win32') return command;
    const environment = options.environment ?? process.env;
    const get = (key: string): string | undefined =>
        Object.entries(environment).find(([name]) => name.toLowerCase() === key.toLowerCase())?.[1];
    const dirs = [
        path.win32.dirname(options.execPath ?? process.execPath),
        ...(get('PATH') ?? '').split(';').map(value => value.replace(/^"|"$/g, '')),
        get('PNPM_HOME'),
        get('APPDATA') && path.win32.join(get('APPDATA')!, 'npm'),
        get('LOCALAPPDATA') && path.win32.join(get('LOCALAPPDATA')!, 'pnpm'),
        get('USERPROFILE') && path.win32.join(get('USERPROFILE')!, 'AppData', 'Roaming', 'npm'),
    ];
    const exists = options.exists ?? fs.existsSync;
    for (const dir of dirs) {
        if (!dir) continue;
        const file = path.win32.join(dir, `${command}.cmd`);
        if (exists(file)) return file;
    }
    throw new Error(
        `${command}.cmd が見つかりません。${command}をインストールしてNeoEPGStationを再起動するか、更新画面で別のパッケージマネージャーを指定してください。`,
    );
}

export function decodeUpdateCommandOutput(value: Buffer | string | undefined, platform = process.platform): string {
    if (value === undefined) return '';
    if (typeof value === 'string') return value;
    try {
        return new TextDecoder('utf-8', { fatal: true }).decode(value);
    } catch {
        return platform === 'win32' ? iconv.decode(value, 'cp932') : value.toString('utf8');
    }
}

export interface UpdateCommandInvocation {
    command: string;
    args: string[];
    windowsVerbatimArguments?: boolean;
}

export const createUpdatePackageEnvironment = (environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
    ...getBuildEnvironment(environment),
    CI: 'true',
    COREPACK_ENABLE_DOWNLOAD_PROMPT: '0',
});

// ANSI color sequences intentionally contain the ESC control character.
// eslint-disable-next-line no-control-regex
const ANSI_ESCAPE_PATTERN = new RegExp('\u001b\\[[0-?]*[ -/]*[@-~]', 'g');

export const createUpdateCommandInvocation = (
    command: string,
    args: string[],
    platform = process.platform,
    commandProcessor = process.env.ComSpec,
): UpdateCommandInvocation => {
    if (platform === 'win32' && /\.(?:cmd|bat)$/i.test(command)) {
        const escapeMeta = (value: string): string => value.replace(/[()[\]%!^"`<>&|;, *?]/g, '^$&');
        const escapeArgument = (value: string): string => {
            const quoted = '"' + value.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\+)$/, '$1$1') + '"';
            const escaped = escapeMeta(quoted);
            return /node_modules[\\/]\.bin[\\/]/i.test(command) ? escapeMeta(escaped) : escaped;
        };
        return {
            command: commandProcessor ?? 'cmd.exe',
            args: ['/d', '/s', '/c', `"${[escapeMeta(command), ...args.map(escapeArgument)].join(' ')}"`],
            windowsVerbatimArguments: true,
        };
    }
    return { command, args };
};

export const stripUpdateLogControlSequences = (value: string): string => value.replace(ANSI_ESCAPE_PATTERN, '');
