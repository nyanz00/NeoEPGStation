import * as apid from '../../../../api';

export default interface IMisskeyApiModel {
    getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.MisskeyStatus>;
    beginAuthorization(
        viewerProfileId: apid.ViewerProfileId,
        visibility: apid.MisskeyVisibility,
    ): Promise<apid.MisskeyAuthorizationStart>;
    checkAuthorization(
        viewerProfileId: apid.ViewerProfileId,
        sessionId: string,
    ): Promise<apid.MisskeyAuthorizationCheck>;
    disconnect(viewerProfileId: apid.ViewerProfileId): Promise<void>;
    getTimeline(viewerProfileId: apid.ViewerProfileId): Promise<apid.TwitterTimeline>;
    search(viewerProfileId: apid.ViewerProfileId, query: string): Promise<apid.TwitterTimeline>;
    post(viewerProfileId: apid.ViewerProfileId, text: string): Promise<void>;
}
