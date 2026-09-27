import * as yaml from 'js-yaml';

export type WinserResolution = { kind: 'resolved'; version: string } | { kind: 'absent' } | { kind: 'unknown' };

type PackageManager = 'npm' | 'pnpm';

const EXACT_VERSION_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export function resolveWinserResolution(
    packageJsonText: string | null,
    lockfileText: string | null,
    packageManager: PackageManager,
): WinserResolution {
    if (packageJsonText === null) return { kind: 'unknown' };

    let packageJson: Record<string, unknown>;
    try {
        packageJson = asRecord(JSON.parse(packageJsonText));
    } catch {
        return { kind: 'unknown' };
    }

    const declaredVersion = getDeclaredWinserVersion(packageJson);
    if (typeof declaredVersion === 'undefined') return { kind: 'absent' };
    if (typeof declaredVersion !== 'string') return { kind: 'unknown' };

    const lockedVersion = getLockedWinserVersion(lockfileText, packageManager);
    if (lockedVersion !== null) {
        return isVersionCompatibleWithSpecifier(lockedVersion, declaredVersion)
            ? { kind: 'resolved', version: lockedVersion }
            : { kind: 'unknown' };
    }
    if (EXACT_VERSION_PATTERN.test(declaredVersion)) return { kind: 'resolved', version: declaredVersion };
    return { kind: 'unknown' };
}

export function getWinserChangeBlockReason(current: WinserResolution, target: WinserResolution): string | null {
    if (current.kind === 'unknown' || target.kind === 'unknown') {
        return 'Windowsサービス更新の安全確認でwinserのバージョンを特定できませんでした。package.jsonと選択したパッケージ管理方式のlockfileを確認してください';
    }
    if (current.kind === 'absent' && target.kind === 'absent') return null;
    if (current.kind === 'resolved' && target.kind === 'resolved' && current.version === target.version) return null;

    if (target.kind === 'absent') {
        return `更新先でWindowsサービスに必要なwinserが削除されるため、Web UIから更新できません（現在: ${formatVersion(current)}）。サービスを停止し、winserを含めて手動で更新してください`;
    }

    return `Windowsサービスで使用中のwinserが変わるため、Web UIから更新できません（${formatVersion(current)} → ${formatVersion(target)}）。サービスを停止し、winserを含めて手動で更新してください`;
}

function getDeclaredWinserVersion(packageJson: Record<string, unknown>): unknown {
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const dependencies = asRecord(packageJson[section]);
        if (Object.prototype.hasOwnProperty.call(dependencies, 'winser')) return dependencies.winser;
    }
    return undefined;
}

function getLockedWinserVersion(lockfileText: string | null, packageManager: PackageManager): string | null {
    if (lockfileText === null) return null;

    try {
        const lockfile =
            packageManager === 'npm' ? asRecord(JSON.parse(lockfileText)) : asRecord(yaml.load(lockfileText));
        const version = packageManager === 'npm' ? getNpmLockedVersion(lockfile) : getPnpmLockedVersion(lockfile);
        return typeof version === 'string' ? normalizeVersion(version) : null;
    } catch {
        return null;
    }
}

function getNpmLockedVersion(lockfile: Record<string, unknown>): unknown {
    const packageEntry = asRecord(asRecord(lockfile.packages)['node_modules/winser']);
    if (typeof packageEntry.version === 'string') return packageEntry.version;

    return asRecord(asRecord(lockfile.dependencies).winser).version;
}

function getPnpmLockedVersion(lockfile: Record<string, unknown>): unknown {
    const importer = asRecord(asRecord(lockfile.importers)['.']);
    for (const section of ['dependencies', 'devDependencies', 'optionalDependencies']) {
        const rawDependency = asRecord(importer[section]).winser;
        if (typeof rawDependency === 'string') return rawDependency;

        const version = asRecord(rawDependency).version;
        if (typeof version === 'string') return version;
    }
    return null;
}

function normalizeVersion(value: string): string | null {
    const match = /^(\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?)(?:\(|$)/.exec(value);
    return match?.[1] ?? null;
}

function isVersionCompatibleWithSpecifier(version: string, specifier: string): boolean {
    if (EXACT_VERSION_PATTERN.test(specifier)) return version === specifier;

    const aliasMatch = /^npm:winser@(.+)$/.exec(specifier);
    const value = aliasMatch?.[1] ?? specifier;
    const rangeMatch = /^([~^])(\d+)\.(\d+)\.(\d+)$/.exec(value);
    if (rangeMatch === null) return false;

    const actualMatch = /^(\d+)\.(\d+)\.(\d+)$/.exec(version);
    if (actualMatch === null) return false;

    const actual = actualMatch.slice(1).map(Number);
    const lower = rangeMatch.slice(2).map(Number);
    const compare = (left: number[], right: number[]): number =>
        left[0] - right[0] || left[1] - right[1] || left[2] - right[2];
    if (compare(actual, lower) < 0) return false;

    const upper = [...lower];
    if (rangeMatch[1] === '~') {
        upper[1] += 1;
        upper[2] = 0;
    } else if (lower[0] > 0) {
        upper[0] += 1;
        upper[1] = 0;
        upper[2] = 0;
    } else if (lower[1] > 0) {
        upper[1] += 1;
        upper[2] = 0;
    } else {
        upper[2] += 1;
    }
    return compare(actual, upper) < 0;
}

function formatVersion(resolution: Exclude<WinserResolution, { kind: 'unknown' }>): string {
    return resolution.kind === 'absent' ? 'なし' : resolution.version;
}

function asRecord(value: unknown): Record<string, unknown> {
    return typeof value === 'object' && value !== null && Array.isArray(value) === false
        ? (value as Record<string, unknown>)
        : {};
}
