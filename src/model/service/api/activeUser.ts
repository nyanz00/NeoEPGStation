import { Request } from 'express';

/**
 * The master view is stored as user 0. It is intentionally separate from every numbered TV user.
 */
export function getActiveUserId(req: Request): number {
    const raw = req.header('x-epgstation-user-id');
    if (raw === undefined || raw.length === 0 || raw === 'master') return 0;
    const userId = Number(raw);
    if (!Number.isInteger(userId) || userId <= 0) throw new Error('ユーザーIDが不正です');
    return userId;
}
