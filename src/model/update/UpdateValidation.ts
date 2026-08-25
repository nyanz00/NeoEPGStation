import type { StartSystemUpdateOption } from '../../../api';

export const STABLE_UPDATE_TAG_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

export const isExpectedUpdateRepository = (value: string): boolean =>
    /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)nyanz00\/NeoEPGStation(?:\.git)?\/?$/i.test(
        value,
    );

export const isStartSystemUpdateOption = (value: unknown): value is StartSystemUpdateOption => {
    if (typeof value !== 'object' || value === null) return false;
    const option = value as Partial<StartSystemUpdateOption>;
    return (
        (option.target === 'stable' || option.target === 'develop') &&
        (option.packageManager === 'auto' || option.packageManager === 'npm' || option.packageManager === 'pnpm')
    );
};
