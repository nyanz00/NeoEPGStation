const { spawnSync } = require('node:child_process');
const path = require('node:path');

const args = process.argv.slice(2);
let cwd = process.cwd();

if (args[0] === '--cwd') {
    if (args.length < 3) {
        console.error('Usage: run-package-scripts.cjs [--cwd directory] script [...]');
        process.exit(1);
    }

    cwd = path.resolve(cwd, args[1]);
    args.splice(0, 2);
}

if (args.length === 0) {
    console.error('No package script was specified.');
    process.exit(1);
}

const packageManagerCli = process.env.npm_execpath;

for (const script of args) {
    if (!/^[A-Za-z0-9:_-]+$/.test(script)) {
        console.error(`Invalid package script name: "${script}"`);
        process.exit(1);
    }

    const useWindowsNpmFallback = !packageManagerCli && process.platform === 'win32';
    const command = packageManagerCli
        ? process.execPath
        : useWindowsNpmFallback
          ? process.env.ComSpec || 'cmd.exe'
          : 'npm';
    const commandArgs = packageManagerCli
        ? [packageManagerCli, 'run', script]
        : useWindowsNpmFallback
          ? ['/d', '/s', '/c', `npm.cmd run ${script}`]
          : ['run', script];
    const result = spawnSync(command, commandArgs, {
        cwd,
        env: process.env,
        stdio: 'inherit',
    });

    if (result.error) {
        console.error(`Failed to run package script "${script}":`, result.error);
        process.exit(1);
    }

    if (result.status !== 0) {
        process.exit(result.status ?? 1);
    }
}
