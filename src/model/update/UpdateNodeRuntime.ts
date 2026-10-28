import { satisfies, validRange } from 'semver';

/** Fail before checkout/install so an unsupported runtime can still run the current application. */
export function assertUpdateNodeRuntime(manifest: unknown, nodeVersion: string): void {
    const requirement = (manifest as { engines?: { node?: unknown } } | null)?.engines?.node;
    if (requirement === undefined) return;
    if (typeof requirement !== 'string' || validRange(requirement) === null)
        throw new Error('更新先のNode.js要件が不正です');
    if (!satisfies(nodeVersion, requirement))
        throw new Error(
            `更新先にはNode.js ${requirement}が必要です。現在は${nodeVersion}です。先にNode.jsを更新してください。`,
        );
}
