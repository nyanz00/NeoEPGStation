import * as childProcess from 'child_process';
import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';

import type { SystemUpdateInfo, SystemUpdateJob, SystemUpdatePackageManager, SystemUpdateTarget } from '../../../api';
import { isExpectedUpdateRepository, STABLE_UPDATE_TAG_PATTERN } from './UpdateValidation';

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
        this.state = this.readState();
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
        const [version, commit, branch, clean, isGitRepository] = await Promise.all([
            this.readPackageVersion(),
            this.gitOptional(['rev-parse', 'HEAD']),
            this.gitOptional(['branch', '--show-current']),
            this.gitOptional(['status', '--porcelain']),
            this.gitOptional(['rev-parse', '--is-inside-work-tree']),
        ]);
        const targets = await this.getRemoteTargets(force);
        const currentTag = await this.gitOptional(['describe', '--tags', '--exact-match']);
        const currentComparable = this.parseVersion(currentTag ?? '') ?? this.parseVersion(version);
        const stableComparable = this.parseVersion(targets.stable?.version ?? '');
        const hasStableUpdate =
            stableComparable !== null &&
            currentComparable !== null &&
            this.compareVersion(stableComparable, currentComparable) > 0;

        return {
            version,
            commit,
            branch: branch === '' ? null : branch,
            currentTag,
            isGitRepository: isGitRepository === 'true',
            isClean: clean === '',
            packageManager: this.detectPackageManager(),
            rememberedPackageManager: this.state.preferredPackageManager ?? this.state.packageManager ?? null,
            targets,
            hasStableUpdate,
            job: this.state.job ?? null,
        };
    }

    public start(target: SystemUpdateTarget, requestedManager: SystemUpdatePackageManager): SystemUpdateJob {
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
        };
        this.state.job = job;
        this.running = true;
        this.writeState();
        void this.run(job, requestedManager);
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

    private async run(job: SystemUpdateJob, requestedManager: SystemUpdatePackageManager): Promise<void> {
        let oldCommit: string | null = null;
        let oldBranch: string | null = null;
        let switched = false;
        try {
            this.setStage(job, 'checking', 'Gitリポジトリと更新対象を確認しています');
            await this.assertRepository();
            const dirty = await this.git(['status', '--porcelain']);
            if (dirty.stdout.trim() !== '') throw new Error('未コミットの変更があるため更新できません');
            oldCommit = (await this.git(['rev-parse', 'HEAD'])).stdout.trim();
            oldBranch = (await this.git(['branch', '--show-current'])).stdout.trim() || null;

            this.setStage(job, 'fetching', '固定リポジトリから更新情報を取得しています');
            await this.git([
                'fetch',
                '--force',
                '--tags',
                REPOSITORY_URL,
                '+refs/heads/develop:refs/remotes/neoe-update/develop',
                '+refs/heads/nyanz-master:refs/remotes/neoe-update/nyanz-master',
            ]);
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
                this.finish(job, 'success', 'already-current', '既に選択したバージョンです');
                return;
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
                await this.git(['merge', '--ff-only', targetCommit]);
            } else {
                await this.git(['checkout', '--detach', targetCommit]);
            }
            switched = true;

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

    private async getRemoteTargets(force: boolean): Promise<SystemUpdateInfo['targets']> {
        if (
            !force &&
            this.state.remoteCache !== undefined &&
            Date.now() - (this.state.remoteCacheAt ?? 0) < 10 * 60_000
        ) {
            return this.state.remoteCache;
        }
        try {
            const [heads, tags] = await Promise.all([
                this.command('git', ['ls-remote', '--heads', REPOSITORY_URL, 'develop']),
                this.command('git', ['ls-remote', '--tags', REPOSITORY_URL]),
            ]);
            const developMatch = /^([0-9a-f]{40})\s+refs\/heads\/develop$/im.exec(heads.stdout);
            const tagCommits = new Map<string, string>();
            for (const line of tags.stdout.split(/\r?\n/)) {
                const match = /^([0-9a-f]{40})\s+refs\/tags\/(v?\d+\.\d+\.\d+)(\^\{\})?$/.exec(line);
                if (match !== null) tagCommits.set(match[2], match[1]);
            }
            const stableTag = [...tagCommits.keys()].sort((a, b) => {
                const av = this.parseVersion(a)!;
                const bv = this.parseVersion(b)!;
                return this.compareVersion(bv, av);
            })[0];
            const targets: SystemUpdateInfo['targets'] = {
                develop:
                    developMatch === null
                        ? null
                        : {
                              label: `develop (${developMatch[1].slice(0, 8)})`,
                              version: null,
                              tag: null,
                              commit: developMatch[1],
                          },
                stable:
                    stableTag === undefined
                        ? null
                        : {
                              label: stableTag,
                              version: stableTag.replace(/^v/, ''),
                              tag: stableTag,
                              commit: tagCommits.get(stableTag)!,
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
            process.platform === 'win32' && (command === 'npm' || command === 'pnpm') ? `${command}.cmd` : command;
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
        return this.command('git', args);
    }

    private async gitOptional(args: string[]): Promise<string | null> {
        try {
            return (await this.git(args)).stdout.trim();
        } catch {
            return null;
        }
    }

    private async command(command: string, args: string[], cwd = this.rootDir): Promise<CommandResult> {
        const result = await execFile(command, args, {
            cwd,
            timeout: COMMAND_TIMEOUT,
            windowsHide: true,
            maxBuffer: 16 * 1024 * 1024,
            encoding: 'utf8',
        });
        return { stdout: result.stdout, stderr: result.stderr };
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
        return value
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
