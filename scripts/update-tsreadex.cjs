const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');

const repoRoot = path.resolve(__dirname, '..');

const run = (command, args, options = {}) => {
    const result = spawnSync(command, args, {
        cwd: options.cwd ?? repoRoot,
        env: process.env,
        stdio: 'inherit',
    });
    if (result.error) {
        throw new Error(`Failed to run ${command}: ${result.error.message}`);
    }
    if (result.status !== 0) {
        throw new Error(`${command} exited with status ${String(result.status)}`);
    }
};

const requireCommand = command => {
    const result = spawnSync(command, ['--version'], { stdio: 'ignore' });
    if (result.error || result.status !== 0) {
        throw new Error(`${command} is required to build tsreadex on Linux.`);
    }
};

const installWindowsBinary = () => {
    run('powershell.exe', [
        '-NoLogo',
        '-NoProfile',
        '-ExecutionPolicy',
        'Bypass',
        '-File',
        path.join(__dirname, 'update-tsreadex.ps1'),
        '-RepoRoot',
        repoRoot,
    ]);
};

const getLatestReleaseTag = async () => {
    const response = await fetch('https://api.github.com/repos/xtne6f/tsreadex/releases/latest', {
        headers: {
            Accept: 'application/vnd.github+json',
            'User-Agent': 'NeoEPGStation update-tsreadex',
        },
    });
    if (!response.ok) {
        throw new Error(`Failed to get the latest tsreadex release: HTTP ${String(response.status)}`);
    }

    const release = await response.json();
    if (typeof release.tag_name !== 'string' || release.tag_name.length === 0) {
        throw new Error('The latest tsreadex release tag was not found.');
    }
    return release.tag_name;
};

const installLinuxBinary = async () => {
    for (const command of ['git', 'make', 'g++']) {
        requireCommand(command);
    }

    const tag = await getLatestReleaseTag();
    const temporaryDir = fs.mkdtempSync(path.join(os.tmpdir(), 'epgstation-tsreadex-'));
    const sourceDir = path.join(temporaryDir, 'source');
    const destinationDir = path.join(repoRoot, 'thirdparty', 'tsreadex');
    const destinationPath = path.join(destinationDir, 'tsreadex.elf');
    const stagedPath = `${destinationPath}.tmp-${String(process.pid)}`;

    try {
        console.log(`Building tsreadex ${tag} for Linux...`);
        run(
            'git',
            [
                'clone',
                '--quiet',
                '--depth',
                '1',
                '--branch',
                tag,
                '--single-branch',
                'https://github.com/xtne6f/tsreadex.git',
                sourceDir,
            ],
            { cwd: temporaryDir },
        );
        run('make', [`-j${String(Math.max(1, os.availableParallelism()))}`], { cwd: sourceDir });

        const sourcePath = path.join(sourceDir, 'tsreadex');
        if (!fs.existsSync(sourcePath)) {
            throw new Error('The tsreadex build did not produce a binary.');
        }

        fs.mkdirSync(destinationDir, { recursive: true });
        fs.copyFileSync(sourcePath, stagedPath);
        fs.chmodSync(stagedPath, 0o755);
        fs.renameSync(stagedPath, destinationPath);

        const licensePath = path.join(sourceDir, 'License.txt');
        if (fs.existsSync(licensePath)) {
            fs.copyFileSync(licensePath, path.join(destinationDir, 'License.txt'));
        }
        console.log(`Installed tsreadex ${tag}: ${destinationPath}`);
    } finally {
        fs.rmSync(stagedPath, { force: true });
        fs.rmSync(temporaryDir, { force: true, recursive: true });
    }
};

const main = async () => {
    if (process.platform === 'win32') {
        installWindowsBinary();
        return;
    }
    if (process.platform === 'linux') {
        await installLinuxBinary();
        return;
    }
    throw new Error(`Automatic tsreadex installation is not supported on ${process.platform}.`);
};

main().catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
