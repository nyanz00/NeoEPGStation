'use strict';

const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { getBuildEnvironment, getResourcePlan } = require('./preflight-resources.cjs');

const task = process.argv[2];
const allowedBuildTasks = new Set(['build-server', 'build-client']);

if (task !== 'test' && !allowedBuildTasks.has(task)) {
    console.error('Usage: node scripts/preflight.cjs <build-server|build-client|test>');
    process.exit(2);
}

const plan = getResourcePlan();
const env = {
    ...getBuildEnvironment(process.env),
    EPGSTATION_MAX_WORKERS: String(plan.maxWorkers),
    npm_config_jobs: String(plan.maxWorkers),
    MAKEFLAGS: `-j${String(plan.maxWorkers)}`,
};

console.log(
    `Preflight resources: ${plan.availableParallelism} CPU(s), ${plan.totalMemoryBytes} bytes RAM, ${plan.maxWorkers} worker(s).`,
);

let command;
let args;

if (task === 'test') {
    const testDirectory = path.join(__dirname, 'tests');
    const testFiles = fs
        .readdirSync(testDirectory)
        .filter(file => file.endsWith('.test.cjs'))
        .sort()
        .map(file => path.join(testDirectory, file));

    command = process.execPath;
    args = ['--test', '--test-timeout=120000', `--test-concurrency=${String(plan.maxWorkers)}`, ...testFiles];
} else {
    const useWindowsNpmFallback = !process.env.npm_execpath && process.platform === 'win32';
    command = process.env.npm_execpath
        ? process.execPath
        : useWindowsNpmFallback
          ? process.env.ComSpec || 'cmd.exe'
          : 'npm';
    args = process.env.npm_execpath
        ? [process.env.npm_execpath, 'run', task]
        : useWindowsNpmFallback
          ? ['/d', '/s', '/c', `npm.cmd run ${task}`]
          : ['run', task];
}

const result = spawnSync(command, args, {
    cwd: process.cwd(),
    env,
    stdio: 'inherit',
    windowsHide: true,
});

if (result.error) {
    console.error(`Failed to run preflight task "${task}":`, result.error);
    process.exit(1);
}

process.exit(result.status ?? 1);
