import ViewerCredential from '../../db/entities/ViewerCredential';
import ViewerProfile from '../../db/entities/ViewerProfile';
import ViewerProfileSession from '../../db/entities/ViewerProfileSession';

export default interface IViewerProfileDB {
    findAll(): Promise<ViewerProfile[]>;
    findId(profileId: number): Promise<ViewerProfile | null>;
    findByTvUserId(tvUserId: number): Promise<ViewerProfile | null>;
    insert(name: string, tvUserId: number | null, pinSalt: string, pinHash: string): Promise<number>;
    updateSecurity(
        profileId: number,
        pinSalt: string,
        pinHash: string,
        recoveryCodeSalt: string,
        recoveryCodeHash: string,
    ): Promise<void>;
    updateRecoveryCode(profileId: number, recoveryCodeSalt: string, recoveryCodeHash: string): Promise<void>;
    findSession(profileId: number, tokenHash: string): Promise<ViewerProfileSession | null>;
    insertSession(profileId: number, tokenHash: string): Promise<void>;
    deleteSessions(profileId: number): Promise<void>;
    findCredential(profileId: number, provider: string): Promise<ViewerCredential | null>;
    upsertCredential(
        profileId: number,
        provider: string,
        encryptedValue: string,
        iv: string,
        authTag: string,
    ): Promise<void>;
    deleteCredential(profileId: number, provider: string): Promise<void>;
    deleteCredentials(profileId: number): Promise<void>;
}
