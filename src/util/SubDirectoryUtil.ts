import * as path from 'path';
import type * as apid from '../../api.js';

export const INVALID_SUB_DIRECTORY_ERROR = 'InvalidSubDirectory';

/** Stored paths are root relative, including the leading separators accepted by path.join. */
export const stripLeadingSeparators = (value: string, platformPath: path.PlatformPath = path): string =>
    value.replace(platformPath.sep === '\\' ? /^[\\/]+/ : /^\/+/, '');

export function isSubDirectoryInsideRoot(value: string, platformPath: path.PlatformPath = path): boolean {
    if (value.includes('\0')) return false;
    const relative = stripLeadingSeparators(value, platformPath);
    if (platformPath.parse(relative).root !== '') return false;
    const normalized = platformPath.normalize(relative);
    return normalized !== '..' && !normalized.startsWith(`..${platformPath.sep}`);
}

export function hasSubDirectoryOutsideRoot(save?: apid.ReserveSaveOption, encode?: apid.ReserveEncodedOption): boolean {
    return [save?.directory, encode?.directory1, encode?.directory2, encode?.directory3].some(
        value => typeof value === 'string' && !isSubDirectoryInsideRoot(value),
    );
}

/** Existing or expanded unsafe settings fall back to the selected root. */
export function safeSubDirectory(value: string): string {
    return isSubDirectoryInsideRoot(value) ? stripLeadingSeparators(value) : '';
}
