export interface UpdateCommandInvocation {
    command: string;
    args: string[];
}

export const createUpdatePackageEnvironment = (environment: NodeJS.ProcessEnv = process.env): NodeJS.ProcessEnv => ({
    ...environment,
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
        return {
            command: commandProcessor ?? 'cmd.exe',
            args: ['/d', '/s', '/c', command, ...args],
        };
    }
    return { command, args };
};

export const stripUpdateLogControlSequences = (value: string): string => value.replace(ANSI_ESCAPE_PATTERN, '');
