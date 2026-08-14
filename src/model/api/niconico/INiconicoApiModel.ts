import * as apid from '../../../../api';

export default interface INiconicoApiModel {
    getStatus(viewerProfileId?: apid.ViewerProfileId): Promise<apid.NiconicoStatus>;
    login(viewerProfileId: apid.ViewerProfileId, option: apid.NiconicoLoginOption): Promise<apid.NiconicoLoginResult>;
    disconnect(viewerProfileId: apid.ViewerProfileId): Promise<void>;
    getJikkyoInfo(channelId: apid.ChannelId, viewerProfileId?: apid.ViewerProfileId): Promise<apid.ChannelJikkyoInfo>;
    postComment(viewerProfileId: apid.ViewerProfileId, option: apid.NiconicoCommentOption): Promise<void>;
}
