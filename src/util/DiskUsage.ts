import { statfs } from 'fs/promises';
import type { DiskUsage } from '../../api';

/** Query the filesystem containing the path without invoking platform commands. */
export async function getDiskUsage(dirPath: string): Promise<DiskUsage> {
    const stats = await statfs(dirPath);
    return {
        total: stats.blocks * stats.bsize,
        used: (stats.blocks - stats.bfree) * stats.bsize,
        available: stats.bavail * stats.bsize,
    };
}
