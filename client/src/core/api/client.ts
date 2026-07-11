import axios from 'axios';
import { withBasePath } from '../path';

export const apiClient = axios.create({
    baseURL: withBasePath('/api'),
    headers: {
        'Content-Type': 'application/json',
    },
    responseType: 'json',
    timeout: 30_000,
});

apiClient.interceptors.response.use(
    response => response,
    error => {
        if (axios.isAxiosError(error)) {
            const message = error.response?.data?.message ?? error.message;
            return Promise.reject(new Error(message));
        }
        return Promise.reject(error);
    },
);
