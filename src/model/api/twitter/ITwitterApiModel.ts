import * as apid from '../../../../api';

export default interface ITwitterApiModel {
    getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.TwitterStatus>;
    connect(
        viewerProfileId: apid.ViewerProfileId,
        cookiesText: string,
        userAgent?: string,
    ): Promise<apid.TwitterStatus>;
    disconnect(viewerProfileId: apid.ViewerProfileId): Promise<void>;
    getTimeline(viewerProfileId: apid.ViewerProfileId): Promise<apid.TwitterTimeline>;
    search(viewerProfileId: apid.ViewerProfileId, query: string): Promise<apid.TwitterTimeline>;
    post(viewerProfileId: apid.ViewerProfileId, text: string): Promise<void>;
}
