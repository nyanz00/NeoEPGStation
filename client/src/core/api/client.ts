import axios from 'axios';
import { withBasePath } from '../path';
import { activeUserStore } from '../storage/activeUser';
import { viewerProfileStore } from '../storage/viewerProfile';

export const apiClient = axios.create({
    baseURL: withBasePath('/api'),
    headers: {
        'Content-Type': 'application/json',
    },
    responseType: 'json',
    timeout: 30_000,
});

apiClient.interceptors.request.use(config => {
    const activeUser = activeUserStore.getSnapshot();
    if (!config.headers.has('X-EPGStation-User-Id')) {
        config.headers.set('X-EPGStation-User-Id', typeof activeUser === 'number' ? String(activeUser) : 'master');
    }
    for (const [name, value] of Object.entries(viewerProfileStore.headers())) config.headers.set(name, value);
    return config;
});

apiClient.interceptors.response.use(
    response => response,
    error => {
        if (axios.isAxiosError(error)) {
            const message = error.response?.data?.errors ?? error.response?.data?.message ?? error.message;
            if (message === '視聴者プロフィールのロックを解除してください') {
                const rawProfileId = error.config?.headers?.get('X-Viewer-Profile-Id');
                const profileId = Number(rawProfileId);
                if (Number.isInteger(profileId) && profileId > 0) {
                    const activeUser = activeUserStore.getSnapshot();
                    const activeSelection = viewerProfileStore.selectionForUser(activeUser);
                    viewerProfileStore.lock(profileId);
                    if (activeSelection.profileId === profileId) activeUserStore.save('master');
                }
            }
            return Promise.reject(new Error(message));
        }
        return Promise.reject(error);
    },
);
