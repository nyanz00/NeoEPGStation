import { Request } from 'express';
import IViewerProfileApiModel from '../../api/viewerProfile/IViewerProfileApiModel';
import container from '../../ModelContainer';

export async function getViewerProfileId(req: Request, requireUnlocked = true): Promise<number | undefined> {
    const rawId = req.header('x-viewer-profile-id');
    if (rawId === undefined || rawId.length === 0) return undefined;
    const profileId = Number(rawId);
    if (!Number.isInteger(profileId) || profileId <= 0) throw new Error('視聴者プロフィールIDが不正です');
    if (requireUnlocked) {
        const sessionToken = req.header('x-viewer-session') ?? '';
        if (
            !(await container
                .get<IViewerProfileApiModel>('IViewerProfileApiModel')
                .authenticate(profileId, sessionToken))
        ) {
            throw new Error('視聴者プロフィールのロックを解除してください');
        }
    }
    return profileId;
}
