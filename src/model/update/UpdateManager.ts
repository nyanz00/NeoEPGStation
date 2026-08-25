import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import type {
    SystemUpdateInfo,
    SystemUpdateJob,
    SystemUpdatePackageManager,
    SystemUpdateRelation,
    SystemUpdateTarget,
} from '../../../api';
import { isExpectedUpdateRepository, STABLE_UPDATE_TAG_PATTERN } from './UpdateValidation';
import { createUpdateCommandInvocation, stripUpdateLogControlSequences } from './UpdateCommand';

const execFile = promisify(childProcess.execFile);
const REPOSITORY_URL = 'https://github.com/nyanz00/NeoEPGStation.git';
const COMMAND_TIMEOUT = 30 * 60 * 1000;
const LOG_TAIL_LINES = 400;
const DEPENDENCY_FILES = [
    '.npmrc',
    'package.json',
    'package-lock.json',
    'pnpm-lock.yaml',
    'pnpm-workspace.yaml',
    'client/package.json',
    'client/package-lock.json',
];

interface PersistedState {
    packageManager?: Exclude<SystemUpdatePackageManager, 'auto'>;
    preferredPackageManager?: Exclude<SystemUpdatePackageManager, 'auto'>;
    nodeVersion?: string;
    dependencyHash?: string;
    remoteCache?: SystemUpdateInfo['targets'];
    remoteCacheAt?: number;
    job?: SystemUpdateJob;
}

interface CommandResult {
    stdout: string;
    stderr: string;
}

class CommandFailure extends Error {
    public readonly command: string;
    public readonly exitCode: number | null;
    public readonly timedOut: boolean;
    public readonly output: string;

    constructor(command: string, cause: any) {
        super(cause?.message ?? `${command} failed`);
        this.command = command;
        this.exitCode = typeof cause?.code === 'number' ? cause.code : null;
        this.timedOut = cause?.killed === true || cause?.code === 'ETIMEDOUT';
        this.output = [cause?.stdout, cause?.stderr]
            .filter((value): value is string => typeof value === 'string')
            .join('\n');
    }
}

export default class UpdateManager {
    private static instance: UpdateManager | null = null;
    private readonly rootDir: string;
    private readonly updateDir: string;
    private readonly statePath: string;
    private readonly gitExecutable: string;
    private state: PersistedState;
    private running = false;

    public static getInstance(): UpdateManager {
        if (UpdateManager.instance === null) UpdateManager.instance = new UpdateManager();
        return UpdateManager.instance;
    }

    private constructor() {
        this.rootDir = path.resolve(__dirname, '..', '..', '..');
        this.updateDir = path.join(this.rootDir, 'data', 'update');
        this.statePath = path.join(this.updateDir, 'state.json');
        this.gitExecutable = this.resolveGitExecutable();
        this.state = this.readState();
        if (this.state.job !== undefined) {
            this.state.job.logs = this.state.job.logs.map(stripUpdateLogControlSequences);
            if (this.state.job.error !== null) {
                this.state.job.error = stripUpdateLogControlSequences(this.state.job.error);
            }
        }
        if (this.state.job !== undefined && typeof this.state.job.stashCommit !== 'string') {
            this.state.job.stashCommit = null;
        }
        this.running = this.state.job?.status === 'running';
        if (this.running && this.state.job !== undefined) {
            this.state.job = {
                ...this.state.job,
                status: 'failed',
                stage: 'interrupted',
                finishedAt: Date.now(),
                error: 'NeoEPGStationの終了により更新処理が中断されました',
            };
            this.running = false;
            this.writeState();
        } else if (this.state.job?.status === 'success' && this.state.job.restartRequired) {
            this.state.job.restartRequired = false;
            this.state.job.stage = 'applied';
            this.writeState();
        }
    }

    public async getInfo(force = false): Promise<SystemUpdateInfo> {
        const version = await this.readPackageVersion();
        let commit: string | null = null;
        let branch: string | null = null;
        let clean: string | null = null;
        let isGitRepository: string | null = null;
        let gitError: string | null = null;
        try {
            [commit, branch, clean, isGitRepository] = await Promise.all([
                this.gitRequiredText(['rev-parse', 'HEAD']),
                this.gitRequiredText(['branch', '--show-current']),
                this.gitRequiredText(['status', '--porcelain']),
                this.gitRequiredText(['rev-parse', '--is-inside-work-tree']),
            ]);
        } catch (err) {
            gitError = this.safeMessage(err);
        }
        const remoteTargets = await this.getRemoteTargets(force);
        const targets = await this.addTargetRelations(remoteTargets, commit);
        const dirtyFiles = clean === null || clean === '' ? [] : clean.split(/\r?\n/).filter(Boolean);
        const currentTag = gitError === null ? await this.gitOptional(['describe', '--tags', '--always']) : null;
        const hasStableUpdate = targets.stable?.relation === 'ahead';

        return {
            version,
            commit,
            branch: branch === '' ? null : branch,
            currentTag,
            isGitRepository: isGitRepository === 'true',
            isClean: clean === '',
            gitError,
            dirtyFiles,
            packageManager: this.detectPackageManager(),
            rememberedPackageManager: this.state.preferredPackageManager ?? this.state.packageManager ?? null,
            targets,
            hasStableUpdate,
            job: this.state.job ?? null,
        };
    }

    public start(
        target: SystemUpdateTarget,
        requestedManager: SystemUpdatePackageManager,
        preserveLocalChanges: boolean,
    ): SystemUpdateJob {
        if (this.running) throw new Error('更新処理は既に実行中です');
        if (target !== 'stable' && target !== 'develop') throw new Error('更新対象が不正です');
        if (!['auto', 'npm', 'pnpm'].includes(requestedManager)) throw new Error('パッケージ管理方式が不正です');

        const job: SystemUpdateJob = {
            id: `${Date.now().toString(36)}-${crypto.randomBytes(4).toString('hex')}`,
            target,
            packageManager: requestedManager,
            status: 'running',
            stage: 'preparing',
            startedAt: Date.now(),
            finishedAt: null,
            installRan: false,
            restartRequired: false,
            rollback: 'none',
            logs: [],
            error: null,
            command: null,
            exitCode: null,
            timedOut: false,
            stashCommit: null,
        };
        this.state.job = job;
        this.running = true;
        this.writeState();
        void this.run(job, requestedManager, preserveLocalChanges);
        return job;
    }

    public requestRestart(): void {
        if (this.running) throw new Error('更新処理中は再起動できません');
        if (this.state.job?.status !== 'success' || this.state.job.restartRequired !== true) {
            throw new Error('再起動が必要な更新はありません');
        }
        if (typeof process.send !== 'function') throw new Error('この起動方式ではWeb UIから再起動できません');
        process.send({ type: 'update-restart-request' });
    }

    private async run(
        job: SystemUpdateJob,
        requestedManager: SystemUpdatePackageManager,
        preserveLocalChanges: boolean,
    ): Promise<void> {
        let oldCommit: string | null = null;
        let oldBranch: string | null = null;
        let switched = false;
        try {
            this.setStage(job, 'checking', 'Gitリポジトリと更新対象を確認しています');
            await this.assertRepository();
            const dirty = await this.git(['status', '--porcelain']);
            if (dirty.stdout.trim() !== '') {
                if (!preserveLocalChanges) throw new Error('未コミットの変更があるため更新できません');
                this.setStage(job, 'stashing', '未コミットの変更をGit stashへ退避しています');
                job.stashCommit = await this.stashLocalChanges(job.id);
                this.append(job, `ローカル変更をstashへ退避しました: ${job.stashCommit.slice(0, 12)}`);
                if ((await this.gitRequiredText(['status', '--porcelain'])) !== '') {
                    throw new Error('stash後も未コミットの変更が残っているため更新を中止しました');
                }
            }
            oldCommit = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
            oldBranch = (await this.git(['branch', '--show-current'])).stdout.trim() || null;

            this.setStage(job, 'fetching', '固定リポジトリから更新情報を取得しています');
            const info = await this.getInfo(true);
            const remoteTarget = targetInfo(info, job.target);
            if (remoteTarget === null) throw new Error('選択した更新対象を取得できませんでした');
            const targetCommit = remoteTarget.commit;
            if (!/^[0-9a-f]{40}$/i.test(targetCommit)) throw new Error('更新先コミットが不正です');
            if (job.target === 'stable') {
                if (remoteTarget.tag === null || STABLE_UPDATE_TAG_PATTERN.test(remoteTarget.tag) === false) {
                    throw new Error('安定版タグが不正です');
                }
                await this.git(['merge-base', '--is-ancestor', targetCommit, 'refs/remotes/neoe-update/nyanz-master']);
            } else {
                const fetchedDevelop = (
                    await this.git(['rev-parse', 'refs/remotes/neoe-update/develop'])
                ).stdout.trim();
                if (fetchedDevelop !== targetCommit) throw new Error('developの更新先が一致しません');
            }
            if (targetCommit === oldCommit) {
                await this.restoreStashedChanges(job);
                this.finish(job, 'success', 'already-current', '既に選択したバージョンです');
                return;
            }
            const relation = await this.getCommitRelation(oldCommit, targetCommit);
            if (relation !== 'ahead') {
                throw new Error(
                    relation === 'behind'
                        ? '選択した更新先は現在より古いため更新できません'
                        : '選択した更新先は現在の履歴の先にないため更新できません',
                );
            }

            this.setStage(job, 'backing-up', 'DBとconfig.ymlをバックアップしています');
            await this.createBackup(job.id);

            const manager = requestedManager === 'auto' ? this.detectPackageManager() : requestedManager;
            job.packageManager = manager;
            this.state.preferredPackageManager = manager;
            this.writeState();
            const dependencyHash = await this.hashDependencyFiles(targetCommit);
            const dependencyFilesChanged =
                (
                    await this.git(['diff', '--name-only', oldCommit, targetCommit, '--', ...DEPENDENCY_FILES])
                ).stdout.trim() !== '';
            const installRequired =
                dependencyFilesChanged ||
                this.state.packageManager !== manager ||
                this.state.nodeVersion !== process.version ||
                this.state.dependencyHash !== dependencyHash;

            this.setStage(job, 'switching', `更新先 ${remoteTarget.label} へ切り替えています`);
            if (job.target === 'develop') {
                await this.git(['checkout', 'develop']);
                switched = true;
                await this.git(['merge', '--ff-only', targetCommit]);
            } else {
                await this.git(['checkout', '--detach', targetCommit]);
                switched = true;
            }

            if (installRequired) {
                job.installRan = true;
                this.setStage(job, 'installing', `${manager}で依存パッケージを更新しています`);
                await this.install(manager);
            } else {
                this.append(job, '依存関係ファイルに変更がないためinstallを省略しました');
            }

            this.setStage(job, 'building', 'サーバーとWeb UIを検証・ビルドしています');
            await this.build(manager);
            this.state.packageManager = manager;
            this.state.nodeVersion = process.version;
            this.state.dependencyHash = dependencyHash;
            this.finish(job, 'success', 'completed', '更新とビルドが完了しました。再起動すると反映されます');
            if (job.stashCommit !== null) {
                this.append(
                    job,
                    `更新前のローカル変更はstash ${job.stashCommit.slice(0, 12)} に保存されています。必要な場合だけ手動で復元してください`,
                );
            }
            job.restartRequired = true;
            this.writeState();
        } catch (err: any) {
            this.captureFailure(job, err);
            if (switched && oldCommit !== null) {
                job.rollback = 'running';
                this.setStage(job, 'rolling-back', '更新前のコードへ自動復旧しています');
                try {
                    if (oldBranch !== null) {
                        await this.git(['checkout', oldBranch]);
                        const restoredCommit = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
                        if (restoredCommit !== oldCommit) {
                            await this.git(['checkout', '--detach', oldCommit]);
                            await this.git(['branch', '--force', oldBranch, oldCommit]);
                            await this.git(['checkout', oldBranch]);
                        }
                    } else {
                        await this.git(['checkout', '--detach', oldCommit]);
                    }
                    if (job.installRan) await this.install(job.packageManager === 'pnpm' ? 'pnpm' : 'npm');
                    await this.build(job.packageManager === 'pnpm' ? 'pnpm' : 'npm');
                    await this.restoreStashedChanges(job);
                    job.rollback = 'success';
                    this.finish(job, 'rolled-back', 'failed', '更新に失敗したため、更新前のコードへ復旧しました');
                } catch (rollbackError: any) {
                    job.rollback = 'failed';
                    this.captureFailure(job, rollbackError);
                    this.finish(
                        job,
                        'rollback-failed',
                        'failed',
                        '更新と自動復旧の両方に失敗しました。手動対応が必要です',
                    );
                }
            } else {
                await this.restoreStashedChanges(job);
                this.finish(job, 'failed', 'failed', job.error ?? '更新に失敗しました');
            }
        } finally {
            this.running = false;
            this.writeState();
        }
    }

    private async assertRepository(): Promise<void> {
        if ((await this.git(['rev-parse', '--is-inside-work-tree'])).stdout.trim() !== 'true') {
            throw new Error('Git clone環境ではありません');
        }
        const origin = (await this.git(['remote', 'get-url', 'origin'])).stdout.trim();
        if (!isExpectedUpdateRepository(origin)) throw new Error('originがnyanz00/NeoEPGStationではありません');
    }

    private async stashLocalChanges(jobId: string): Promise<string> {
        await this.git(['stash', 'push', '--include-untracked', '--message', `NeoEPGStation Web update ${jobId}`]);
        const stashCommit = await this.gitRequiredText(['rev-parse', 'refs/stash']);
        if (!/^[0-9a-f]{40}$/i.test(stashCommit)) throw new Error('ローカル変更のstashを確認できませんでした');
        return stashCommit;
    }

    private async restoreStashedChanges(job: SystemUpdateJob): Promise<void> {
        if (job.stashCommit === null) return;
        const stashCommit = job.stashCommit;
        this.append(job, `退避したローカル変更 ${stashCommit.slice(0, 12)} を復元しています`);
        try {
            await this.git(['stash', 'apply', '--index', stashCommit]);
            const list = await this.git(['stash', 'list', '--format=%H%x09%gd']);
            const match = list.stdout
                .split(/\r?\n/)
                .map(line => line.split('\t'))
                .find(parts => parts[0] === stashCommit && /^stash@\{\d+\}$/.test(parts[1] ?? ''));
            if (match !== undefined) await this.git(['stash', 'drop', match[1]]);
            job.stashCommit = null;
            this.append(job, '退避したローカル変更を復元しました');
        } catch (err) {
            this.append(
                job,
                `ローカル変更を自動復元できませんでした。stash ${stashCommit.slice(0, 12)} は保持されています: ${this.safeMessage(err)}`,
            );
        }
    }

    private async getRemoteTargets(force: boolean): Promise<SystemUpdateInfo['targets']> {
        if (
            !force &&
            this.state.remoteCache !== undefined &&
            Date.now() - (this.state.remoteCacheAt ?? 0) < 10 * 60_000
        ) {
            return this.state.remoteCache;
        }
        try {
            await this.git([
                'fetch',
                '--quiet',
                '--force',
                '--tags',
                '--no-write-fetch-head',
                REPOSITORY_URL,
                '+refs/heads/develop:refs/remotes/neoe-update/develop',
                '+refs/heads/nyanz-master:refs/remotes/neoe-update/nyanz-master',
            ]);
            const [heads, tags] = await Promise.all([
                this.git(['ls-remote', '--heads', REPOSITORY_URL, 'develop']),
                this.git(['ls-remote', '--tags', REPOSITORY_URL]),
            ]);
            const developMatch = /^([0-9a-f]{40})\s+refs\/heads\/develop$/im.exec(heads.stdout);
            const tagCommits = new Map<string, string>();
            for (const line of tags.stdout.split(/\r?\n/)) {
                const match = /^([0-9a-f]{40})\s+refs\/tags\/(v?\d+\.\d+\.\d+)(\^\{\})?$/.exec(line);
                if (match !== null) tagCommits.set(match[2], match[1]);
            }
            const stableCandidates = [...tagCommits.keys()].sort((a, b) => {
                const av = this.parseVersion(a)!;
                const bv = this.parseVersion(b)!;
                return this.compareVersion(bv, av);
            });
            let stableTag: string | undefined;
            for (const candidate of stableCandidates) {
                const commit = tagCommits.get(candidate)!;
                if ((await this.isAncestor(commit, 'refs/remotes/neoe-update/nyanz-master')) === true) {
                    stableTag = candidate;
                    break;
                }
            }
            const targets: SystemUpdateInfo['targets'] = {
                develop:
                    developMatch === null
                        ? null
                        : {
                              label: `develop (${developMatch[1].slice(0, 8)})`,
                              version: null,
                              tag: null,
                              commit: developMatch[1],
                              relation: 'unknown',
                          },
                stable:
                    stableTag === undefined
                        ? null
                        : {
                              label: stableTag,
                              version: stableTag.replace(/^v/, ''),
                              tag: stableTag,
                              commit: tagCommits.get(stableTag)!,
                              relation: 'unknown',
                          },
                checkedAt: Date.now(),
                error: null,
            };
            this.state.remoteCache = targets;
            this.state.remoteCacheAt = Date.now();
            this.writeState();
            return targets;
        } catch (err: any) {
            if (this.state.remoteCache !== undefined)
                return { ...this.state.remoteCache, error: this.safeMessage(err) };
            return { stable: null, develop: null, checkedAt: Date.now(), error: this.safeMessage(err) };
        }
    }

    private detectPackageManager(): Exclude<SystemUpdatePackageManager, 'auto'> {
        const modulesYaml = path.join(this.rootDir, 'node_modules', '.modules.yaml');
        const pnpmStore = path.join(this.rootDir, 'node_modules', '.pnpm');
        if (fs.existsSync(modulesYaml) || fs.existsSync(pnpmStore)) return 'pnpm';
        return this.state.preferredPackageManager ?? this.state.packageManager ?? 'npm';
    }

    private async addTargetRelations(
        targets: SystemUpdateInfo['targets'],
        currentCommit: string | null,
    ): Promise<SystemUpdateInfo['targets']> {
        if (currentCommit === null) return targets;
        const add = async (target: SystemUpdateInfo['targets']['stable']) =>
            target === null
                ? null
                : { ...target, relation: await this.getCommitRelation(currentCommit, target.commit) };
        const [stable, develop] = await Promise.all([add(targets.stable), add(targets.develop)]);
        return { ...targets, stable, develop };
    }

    private async getCommitRelation(currentCommit: string, targetCommit: string): Promise<SystemUpdateRelation> {
        if (currentCommit === targetCommit) return 'same';
        const currentIsAncestor = await this.isAncestor(currentCommit, targetCommit);
        if (currentIsAncestor === true) return 'ahead';
        const targetIsAncestor = await this.isAncestor(targetCommit, currentCommit);
        if (targetIsAncestor === true) return 'behind';
        if (currentIsAncestor === false && targetIsAncestor === false) return 'diverged';
        return 'unknown';
    }

    private async isAncestor(ancestor: string, descendant: string): Promise<boolean | null> {
        try {
            await this.git(['merge-base', '--is-ancestor', ancestor, descendant]);
            return true;
        } catch (err: any) {
            if (err?.code === 1) return false;
            return null;
        }
    }

    private async install(manager: 'npm' | 'pnpm'): Promise<void> {
        if (manager === 'pnpm') {
            await this.runLogged('pnpm', ['install', '--frozen-lockfile']);
        } else {
            await this.runLogged('npm', ['ci', '--no-audit', '--no-fund']);
            await this.runLogged('npm', ['ci', '--no-audit', '--no-fund'], path.join(this.rootDir, 'client'));
        }
    }

    private async build(manager: 'npm' | 'pnpm'): Promise<void> {
        await this.runPackage(manager, ['run', 'validate-api']);
        await this.runPackage(manager, ['run', 'compile']);
        await this.runPackage(manager, ['run', 'check'], path.join(this.rootDir, 'client'));
        await this.runPackage(manager, ['run', 'build'], path.join(this.rootDir, 'client'));
    }

    private async runPackage(manager: 'npm' | 'pnpm', args: string[], cwd = this.rootDir): Promise<void> {
        await this.runLogged(manager, args, cwd);
    }

    private async runLogged(command: string, args: string[], cwd = this.rootDir): Promise<void> {
        const executable =
            process.platform === 'win32' && (command === 'npm' || command === 'pnpm')
                ? this.resolveNodeCommandShim(command)
                : command;
        const display = `${command} ${args.join(' ')}`;
        if (this.state.job !== undefined) this.append(this.state.job, `$ ${display}`);
        try {
            const result = await this.command(executable, args, cwd);
            if (this.state.job !== undefined) {
                const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
                if (output !== '') this.append(this.state.job, output);
            }
        } catch (err: any) {
            throw new CommandFailure(display, err);
        }
    }

    private async createBackup(jobId: string): Promise<void> {
        const backupsDir = path.join(this.updateDir, 'backups');
        const temporary = path.join(backupsDir, `.creating-${jobId}`);
        const destination = path.join(backupsDir, new Date().toISOString().replace(/[:.]/g, '-'));
        fs.mkdirSync(temporary, { recursive: true });
        try {
            const configPath = path.join(this.rootDir, 'config', 'config.yml');
            if (!fs.existsSync(configPath)) throw new Error('config/config.ymlが見つかりません');
            fs.copyFileSync(configPath, path.join(temporary, 'config.yml'));
            await this.runLogged(process.execPath, [
                path.join(this.rootDir, 'dist', 'DBTools.js'),
                '-m',
                'backup',
                '-o',
                path.join(temporary, 'database.json'),
            ]);
            const database = path.join(temporary, 'database.json');
            if (fs.statSync(database).size === 0) throw new Error('DBバックアップが空です');
            JSON.parse(fs.readFileSync(database, 'utf8'));
            fs.renameSync(temporary, destination);
            const generations = fs
                .readdirSync(backupsDir, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && !entry.name.startsWith('.'))
                .sort((a, b) => b.name.localeCompare(a.name));
            for (const old of generations.slice(3))
                fs.rmSync(path.join(backupsDir, old.name), { recursive: true, force: true });
            if (this.state.job !== undefined) this.append(this.state.job, `バックアップを作成しました: ${destination}`);
        } catch (err) {
            fs.rmSync(temporary, { recursive: true, force: true });
            throw err;
        }
    }

    private async hashDependencyFiles(ref: string): Promise<string> {
        const result = await this.git(['ls-tree', '-r', ref, '--', ...DEPENDENCY_FILES]);
        return crypto.createHash('sha256').update(result.stdout).digest('hex');
    }

    private git(args: string[]): Promise<CommandResult> {
        return this.command(this.gitExecutable, ['-c', `safe.directory=${this.rootDir}`, ...args]);
    }

    private async gitRequiredText(args: string[]): Promise<string> {
        return (await this.git(args)).stdout.trim();
    }

    private async gitOptional(args: string[]): Promise<string | null> {
        try {
            return (await this.git(args)).stdout.trim();
        } catch {
            return null;
        }
    }

    private async command(command: string, args: string[], cwd = this.rootDir): Promise<CommandResult> {
        const invocation = createUpdateCommandInvocation(command, args);
        const result = await execFile(invocation.command, invocation.args, {
            cwd,
            timeout: COMMAND_TIMEOUT,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
            encoding: 'utf8',
        });
        return { stdout: result.stdout, stderr: result.stderr };
    }

    private resolveGitExecutable(): string {
        if (process.platform !== 'win32') return 'git';
        const userHome = this.findWindowsUserHome();
        const candidates = [
            process.env.ProgramFiles === undefined
                ? null
                : path.join(process.env.ProgramFiles, 'Git', 'cmd', 'git.exe'),
            process.env['ProgramFiles(x86)'] === undefined
                ? null
                : path.join(process.env['ProgramFiles(x86)'], 'Git', 'cmd', 'git.exe'),
            userHome === null ? null : path.join(userHome, 'AppData', 'Local', 'Programs', 'Git', 'cmd', 'git.exe'),
            userHome === null ? null : path.join(userHome, 'scoop', 'apps', 'git', 'current', 'cmd', 'git.exe'),
            this.findGitHubDesktopGit(userHome),
        ];
        return (
            candidates.find((candidate): candidate is string => candidate !== null && fs.existsSync(candidate)) ??
            'git.exe'
        );
    }

    private resolveNodeCommandShim(command: 'npm' | 'pnpm'): string {
        const adjacent = path.join(path.dirname(process.execPath), `${command}.cmd`);
        return fs.existsSync(adjacent) ? adjacent : `${command}.cmd`;
    }

    private findWindowsUserHome(): string | null {
        const match = /^([A-Za-z]:\\Users\\[^\\]+)(?:\\|$)/i.exec(this.rootDir);
        return match?.[1] ?? null;
    }

    private findGitHubDesktopGit(userHome: string | null): string | null {
        if (userHome === null) return null;
        const desktopRoot = path.join(userHome, 'AppData', 'Local', 'GitHubDesktop');
        try {
            const versions = fs
                .readdirSync(desktopRoot, { withFileTypes: true })
                .filter(entry => entry.isDirectory() && entry.name.startsWith('app-'))
                .map(entry => entry.name)
                .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }));
            for (const version of versions) {
                const candidate = path.join(desktopRoot, version, 'resources', 'app', 'git', 'cmd', 'git.exe');
                if (fs.existsSync(candidate)) return candidate;
            }
        } catch {
            return null;
        }
        return null;
    }

    private async readPackageVersion(): Promise<string> {
        try {
            return (JSON.parse(fs.readFileSync(path.join(this.rootDir, 'package.json'), 'utf8')) as { version: string })
                .version;
        } catch {
            return 'unknown';
        }
    }

    private parseVersion(value: string): [number, number, number, number] | null {
        const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-.]?beta\d*)?$/i.exec(value);
        return match === null
            ? null
            : [Number(match[1]), Number(match[2]), Number(match[3]), /beta/i.test(value) ? 0 : 1];
    }

    private compareVersion(a: [number, number, number, number], b: [number, number, number, number]): number {
        return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3];
    }

    private setStage(job: SystemUpdateJob, stage: string, message: string): void {
        job.stage = stage;
        this.append(job, message);
    }

    private append(job: SystemUpdateJob, value: string): void {
        const redacted = this.redact(value);
        const lines = redacted.split(/\r?\n/);
        job.logs.push(...lines);
        if (job.logs.length > LOG_TAIL_LINES) job.logs.splice(0, job.logs.length - LOG_TAIL_LINES);
        fs.mkdirSync(path.join(this.updateDir, 'jobs'), { recursive: true });
        fs.appendFileSync(
            path.join(this.updateDir, 'jobs', `${job.id}.log`),
            `[${new Date().toISOString()}] ${redacted}\n`,
            'utf8',
        );
        this.writeState();
    }

    private captureFailure(job: SystemUpdateJob, err: any): void {
        job.error = this.safeMessage(err);
        if (err instanceof CommandFailure) {
            job.command = err.command;
            job.exitCode = err.exitCode;
            job.timedOut = err.timedOut;
            if (err.output.trim() !== '') this.append(job, err.output);
        }
        this.append(job, `エラー: ${job.error}`);
    }

    private finish(job: SystemUpdateJob, status: SystemUpdateJob['status'], stage: string, message: string): void {
        job.status = status;
        job.stage = stage;
        job.finishedAt = Date.now();
        this.append(job, message);
    }

    private safeMessage(err: any): string {
        return this.redact(err instanceof Error ? err.message : String(err));
    }

    private redact(value: string): string {
        return stripUpdateLogControlSequences(value)
            .replace(/(https?:\/\/)[^\s/@:]+:[^\s/@]+@/gi, '$1***:***@')
            .replace(/((?:token|password|secret|authorization)["'\s:=]+)[^\s,"']+/gi, '$1***');
    }

    private readState(): PersistedState {
        try {
            return JSON.parse(fs.readFileSync(this.statePath, 'utf8')) as PersistedState;
        } catch {
            return {};
        }
    }

    private writeState(): void {
        fs.mkdirSync(this.updateDir, { recursive: true });
        const temporary = `${this.statePath}.${process.pid.toString(10)}.tmp`;
        fs.writeFileSync(temporary, JSON.stringify(this.state, null, 2), { encoding: 'utf8', mode: 0o600 });
        fs.rmSync(this.statePath, { force: true });
        fs.renameSync(temporary, this.statePath);
    }
}

function targetInfo(info: SystemUpdateInfo, target: SystemUpdateTarget) {
    return target === 'stable' ? info.targets.stable : info.targets.develop;
}
