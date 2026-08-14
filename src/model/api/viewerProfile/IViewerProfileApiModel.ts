import * as apid from '../../../../api';

export default interface IViewerProfileApiModel {
    gets(): Promise<apid.ViewerProfiles>;
    add(option: apid.CreateViewerProfileOption): Promise<apid.ViewerProfileId>;
    unlock(profileId: apid.ViewerProfileId, password: string): Promise<apid.ViewerProfileSession>;
    updatePin(profileId: apid.ViewerProfileId, password?: string): Promise<apid.ViewerProfileSession>;
    rotateRecoveryCode(profileId: apid.ViewerProfileId): Promise<apid.ViewerProfileRecoveryCode>;
    recoverPin(
        profileId: apid.ViewerProfileId,
        recoveryCode: string,
        password: string,
    ): Promise<apid.ViewerProfileRecoveryCode>;
    wipeExternalCredentials(profileId: apid.ViewerProfileId): Promise<void>;
    authenticate(profileId: apid.ViewerProfileId, sessionToken: string): Promise<boolean>;
    hasCredential(profileId: apid.ViewerProfileId, provider: string): Promise<boolean>;
    getCredential(profileId: apid.ViewerProfileId, provider: string): Promise<string | null>;
    setCredential(profileId: apid.ViewerProfileId, provider: string, value: string): Promise<void>;
    deleteCredential(profileId: apid.ViewerProfileId, provider: string): Promise<void>;
}
