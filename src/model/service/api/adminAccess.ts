import { Request } from 'express';
import IViewerProfileApiModel from '../../api/viewerProfile/IViewerProfileApiModel';
import ITvUserDB from '../../db/ITvUserDB';
import IViewerProfileDB from '../../db/IViewerProfileDB';
import container from '../../ModelContainer';
import { getActiveUserId } from './activeUser';

export class AdminAccessError extends Error {}

/** The optional profile lock is enforced when the selected admin has enabled it. */
export async function requireActiveAdmin(req: Request): Promise<number> {
    const userId = getActiveUserId(req);
    if (userId === 0) throw new AdminAccessError('管理者ユーザーへ切り替えてください');
    const user = await container.get<ITvUserDB>('ITvUserDB').findId(userId);
    if (user?.isAdmin !== true) throw new AdminAccessError('管理者ユーザーへ切り替えてください');

    const profile = await container.get<IViewerProfileDB>('IViewerProfileDB').findByTvUserId(userId);
    if (profile !== null && (profile.pinSalt.length > 0 || profile.pinHash.length > 0)) {
        if (req.header('x-viewer-profile-id') !== String(profile.id)) {
            throw new AdminAccessError('管理者ユーザーの外部連携ロックを解除してください');
        }
        const token = req.header('x-viewer-session') ?? '';
        if (!(await container.get<IViewerProfileApiModel>('IViewerProfileApiModel').authenticate(profile.id, token))) {
            throw new AdminAccessError('管理者ユーザーの外部連携ロックを解除してください');
        }
    }
    return userId;
}
