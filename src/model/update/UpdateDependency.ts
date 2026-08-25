export interface UpdateDependencyFingerprint {
    packageManager: 'npm' | 'pnpm';
    nodeVersion: string;
    dependencyHash: string;
}

export const shouldInstallUpdateDependencies = (
    dependencyFilesChanged: boolean,
    current: UpdateDependencyFingerprint,
    previous: Partial<UpdateDependencyFingerprint>,
): boolean =>
    dependencyFilesChanged ||
    (previous.packageManager !== undefined && previous.packageManager !== current.packageManager) ||
    (previous.nodeVersion !== undefined && previous.nodeVersion !== current.nodeVersion) ||
    (previous.dependencyHash !== undefined && previous.dependencyHash !== current.dependencyHash);
