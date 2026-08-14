import * as apid from '../../../../api';

export default interface IBlueskyApiModel {
    getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.BlueskyStatus>;
    connect(viewerProfileId: apid.ViewerProfileId, handle: string, appPassword: string): Promise<apid.BlueskyStatus>;
    disconnect(viewerProfileId: apid.ViewerProfileId): Promise<void>;
    getTimeline(viewerProfileId: apid.ViewerProfileId): Promise<apid.TwitterTimeline>;
    search(viewerProfileId: apid.ViewerProfileId, query: string): Promise<apid.TwitterTimeline>;
    post(viewerProfileId: apid.ViewerProfileId, text: string): Promise<void>;
}
