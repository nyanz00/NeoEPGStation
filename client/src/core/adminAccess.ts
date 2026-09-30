import { useQuery } from '@tanstack/react-query';
import { api } from './api/queries';
import { useActiveUser } from './storage/activeUser';
import { useViewerProfile } from './storage/viewerProfile';

export type ActiveAdminAccessStatus = 'checking' | 'error' | 'not-admin' | 'locked' | 'admin';

export function useActiveAdminAccess(): { status: ActiveAdminAccessStatus; error: Error | null } {
    const activeUser = useActiveUser();
    const viewerProfile = useViewerProfile();
    const users = useQuery({ queryKey: ['users'], queryFn: api.getUsers });
    const viewerProfiles = useQuery({
        queryKey: ['viewer-profiles'],
        queryFn: api.getViewerProfiles,
        enabled: typeof activeUser === 'number',
    });

    const checking = users.isPending || (typeof activeUser === 'number' && viewerProfiles.isPending);
    const error = users.error ?? (typeof activeUser === 'number' ? viewerProfiles.error : null);
    if (checking) return { status: 'checking', error: null };
    if (error !== null) return { status: 'error', error };

    if (typeof activeUser !== 'number') return { status: 'not-admin', error: null };
    const user = users.data?.users.find(item => item.id === activeUser);
    if (user?.isAdmin !== true) return { status: 'not-admin', error: null };

    const linkedProfile = viewerProfiles.data?.profiles.find(profile => profile.tvUserId === activeUser);
    if (linkedProfile?.lockRequired === true && (viewerProfile.profileId !== linkedProfile.id || viewerProfile.sessionToken === undefined)) {
        return { status: 'locked', error: null };
    }

    return { status: 'admin', error: null };
}
