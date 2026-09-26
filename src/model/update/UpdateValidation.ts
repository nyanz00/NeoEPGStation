import type { StartSystemUpdateOption } from '../../../api';

export const STABLE_UPDATE_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

// The last pre-React EPGStation releases have higher version numbers than NeoEPGStation 1.0.0.
// Keep the release boundary tied to history, rather than comparing their unrelated version numbers.
export const REACT_RELEASE_BASE_COMMIT = '2bd24421f7ee01ab757e05fb9d149e39eef6270a';

export const isSupportedStableUpdateTarget = (tag: string, isReactRelease: boolean): boolean =>
    STABLE_UPDATE_TAG_PATTERN.test(tag) && isReactRelease;

export const isExpectedUpdateRepository = (value: string): boolean =>
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)nyanz00\/NeoEPGStation(?:\.git)?\/?$/i.test(
        value,
    );

export const isStartSystemUpdateOption = (value: unknown): value is StartSystemUpdateOption => {
    if (typeof value !== 'object' || value === null) return false;
    const option = value as Partial<StartSystemUpdateOption>;
    return (
        (option.target === 'stable' || option.target === 'develop') &&
        (option.packageManager === 'auto' || option.packageManager === 'npm' || option.packageManager === 'pnpm') &&
        typeof option.preserveLocalChanges === 'boolean'
    );
};
