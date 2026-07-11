import type { Config, GetRecordedOption, GetReserveOption, Records, ReserveCnts, Reserves, Users, VersionInfo } from '../../../../api';
import { apiClient } from './client';

export const api = {
    async getConfig(): Promise<Config> {
        return (await apiClient.get<Config>('/config')).data;
    },
    async getVersion(): Promise<VersionInfo> {
        return (await apiClient.get<VersionInfo>('/version')).data;
    },
    async getUsers(): Promise<Users> {
        return (await apiClient.get<Users>('/users')).data;
    },
    async addUser(name: string): Promise<number> {
        return (await apiClient.post<{ userId: number }>('/users', { name })).data.userId;
    },
    async updateUser(userId: number, name: string): Promise<void> {
        await apiClient.put(`/users/${userId}`, { name });
    },
    async getRecording(option: GetRecordedOption): Promise<Records> {
        return (await apiClient.get<Records>('/recording', { params: option })).data;
    },
    async getRecorded(option: GetRecordedOption): Promise<Records> {
        return (await apiClient.get<Records>('/recorded', { params: option })).data;
    },
    async getReserves(option: GetReserveOption): Promise<Reserves> {
        return (await apiClient.get<Reserves>('/reserves', { params: option })).data;
    },
    async getReserveCounts(): Promise<ReserveCnts> {
        return (await apiClient.get<ReserveCnts>('/reserves/cnts')).data;
    },
};
