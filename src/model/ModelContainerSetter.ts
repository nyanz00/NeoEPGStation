import { Container } from 'inversify';

import ApiUtil from './api/ApiUtil.js';
import AnnictApiModel from './api/annict/AnnictApiModel.js';
import IAnnictApiModel from './api/annict/IAnnictApiModel.js';
import BlueskyApiModel from './api/bluesky/BlueskyApiModel.js';
import IBlueskyApiModel from './api/bluesky/IBlueskyApiModel.js';
import MisskeyApiModel from './api/misskey/MisskeyApiModel.js';
import IMisskeyApiModel from './api/misskey/IMisskeyApiModel.js';
import INiconicoApiModel from './api/niconico/INiconicoApiModel.js';
import NiconicoApiModel from './api/niconico/NiconicoApiModel.js';
import ChannelApiModel from './api/channel/ChannelApiModel.js';
import IChannelApiModel from './api/channel/IChannelApiModel.js';
import ConfigApiModel from './api/config/ConfigApiModel.js';
import IConfigApiModel from './api/config/IConfigApiModel.js';
import DropLogApiModel from './api/dropLog/DropLogApiModel.js';
import IDropLogApiModel from './api/dropLog/IDropLogApiModel.js';
import EncodeApiModel from './api/encode/EncodeApiModel.js';
import IEncodeApiModel from './api/encode/IEncodeApiModel.js';
import IApiUtil from './api/IApiUtil.js';
import IIPTVApiModel from './api/iptv/IIPTVApiModel.js';
import IPTVApiModel from './api/iptv/IPTVApiModel.js';
import IRecordedItemUtil from './api/IRecordedItemUtil.js';
import IJikkyoApiModel from './api/jikkyo/IJikkyoApiModel.js';
import JikkyoApiModel from './api/jikkyo/JikkyoApiModel.js';
import IVideoCommentApiModel from './api/video/IVideoCommentApiModel.js';
import VideoCommentApiModel from './api/video/VideoCommentApiModel.js';
import IRecordedApiModel from './api/recorded/IRecordedApiModel.js';
import IRecordedPlaybackApiModel from './api/recorded/IRecordedPlaybackApiModel.js';
import RecordedApiModel from './api/recorded/RecordedApiModel.js';
import RecordedPlaybackApiModel from './api/recorded/RecordedPlaybackApiModel.js';
import RecordedItemUtil from './api/RecordedItemUtil.js';
import IRecordedTagApiModel from './api/recordedTag/IRecordedTagApiModel.js';
import RecordedTagApiModel from './api/recordedTag/RecordedTagApiModel.js';
import IRecordingApiModel from './api/recording/IRecordingApiModel.js';
import RecordingApiModel from './api/recording/RecordingApiModel.js';
import IReserveApiModel from './api/reserve/IReserveApiModel.js';
import ReserveApiModel from './api/reserve/ReserveApiModel.js';
import IRuleApiModel, { RuleApiModelProvider } from './api/rule/IRuleApiModel.js';
import RuleApiModel from './api/rule/RuleApiModel.js';
import IScheduleApiModel from './api/schedule/IScheduleApiModel.js';
import ScheduleApiModel from './api/schedule/ScheduleApiModel.js';
import IStorageApiModel from './api/storage/IStorageApiModel.js';
import StorageApiModel from './api/storage/StorageApiModel.js';
import IMirakurunStatusApiModel from './api/system/IMirakurunStatusApiModel.js';
import MirakurunStatusApiModel from './api/system/MirakurunStatusApiModel.js';
import IStreamApiModel from './api/stream/IStreamApiModel.js';
import StreamApiModel from './api/stream/StreamApiModel.js';
import IThumbnailApiModel from './api/thumbnail/IThumbnailApiModel.js';
import ThumbnailApiModel from './api/thumbnail/ThumbnailApiModel.js';
import ITwitterApiModel from './api/twitter/ITwitterApiModel.js';
import TwitterApiModel from './api/twitter/TwitterApiModel.js';
import IUserApiModel from './api/user/IUserApiModel.js';
import UserApiModel from './api/user/UserApiModel.js';
import IViewerProfileApiModel from './api/viewerProfile/IViewerProfileApiModel.js';
import ViewerProfileApiModel from './api/viewerProfile/ViewerProfileApiModel.js';
import IVideoApiModel from './api/video/IVideoApiModel.js';
import IVideoUtil from './api/video/IVideoUtil.js';
import VideoApiModel from './api/video/VideoApiModel.js';
import VideoUtil from './api/video/VideoUtil.js';
import ITsInfoAnalyzer from './recorded/ts/ITsInfoAnalyzer.js';
import TsInfoAnalyzer from './recorded/ts/TsInfoAnalyzer.js';
import IVideoAnalysisModel from './video/IVideoAnalysisModel.js';
import VideoAnalysisModel from './video/VideoAnalysisModel.js';
import Configuration from './Configuration.js';
import AutoEncodeSettingsModel from './encode/AutoEncodeSettingsModel.js';
import IAutoEncodeSettingsModel from './encode/IAutoEncodeSettingsModel.js';
import ConnectionCheckModel from './ConnectionCheckModel.js';
import AnnictEpisodeDB from './db/AnnictEpisodeDB.js';
import AnnictRuleLinkDB from './db/AnnictRuleLinkDB.js';
import ChannelDB from './db/ChannelDB.js';
import DBOperator from './db/DBOperator.js';
import DropLogFileDB from './db/DropLogFileDB.js';
import IAnnictEpisodeDB from './db/IAnnictEpisodeDB.js';
import IAnnictRuleLinkDB from './db/IAnnictRuleLinkDB.js';
import IChannelDB from './db/IChannelDB.js';
import IDBOperator from './db/IDBOperator.js';
import IDropLogFileDB from './db/IDropLogFileDB.js';
import IProgramDB from './db/IProgramDB.js';
import IRecordedDB from './db/IRecordedDB.js';
import IRecordedHistoryDB from './db/IRecordedHistoryDB.js';
import IRecordedPlaybackDB from './db/IRecordedPlaybackDB.js';
import IRecordedTagDB from './db/IRecordedTagDB.js';
import IReserveDB from './db/IReserveDB.js';
import IRuleDB from './db/IRuleDB.js';
import IThumbnailDB from './db/IThumbnailDB.js';
import ITvUserDB from './db/ITvUserDB.js';
import IViewerProfileDB from './db/IViewerProfileDB.js';
import IVideoFileDB from './db/IVideoFileDB.js';
import ProgramDB from './db/ProgramDB.js';
import RecordedDB from './db/RecordedDB.js';
import RecordedHistoryDB from './db/RecordedHistoryDB.js';
import RecordedPlaybackDB from './db/RecordedPlaybackDB.js';
import RecordedTagDB from './db/RecordedTagDB.js';
import ReserveDB from './db/ReserveDB.js';
import RuleDB from './db/RuleDB.js';
import ThumbnailDB from './db/ThumbnailDB.js';
import TvUserDB from './db/TvUserDB.js';
import ViewerProfileDB from './db/ViewerProfileDB.js';
import VideoFileDB from './db/VideoFileDB.js';
import EPGUpdateExecutorManageModel from './epgUpdater/EPGUpdateExecutorManageModel.js';
import EPGUpdateManageModel from './epgUpdater/EPGUpdateManageModel.js';
import EPGUpdater from './epgUpdater/EPGUpdater.js';
import IEPGUpdateExecutorManageModel from './epgUpdater/IEPGUpdateExecutorManageModel.js';
import IEPGUpdateManageModel from './epgUpdater/IEPGUpdateManageModel.js';
import IEPGUpdater from './epgUpdater/IEPGUpdater.js';
import EncodeEvent from './event/EncodeEvent.js';
import EPGUpdateEvent from './event/EPGUpdateEvent.js';
import EventSetter from './event/EventSetter.js';
import IEncodeEvent from './event/IEncodeEvent.js';
import IEPGUpdateEvent from './event/IEPGUpdateEvent.js';
import IEventSetter from './event/IEventSetter.js';
import IOperatorEncodeEvent from './event/IOperatorEncodeEvent.js';
import IRecordedEvent from './event/IRecordedEvent.js';
import IRecordedTagEvent from './event/IRecordedTagEvent.js';
import IRecordingEvent from './event/IRecordingEvent.js';
import IReserveEvent from './event/IReserveEvent.js';
import IRuleEvent from './event/IRuleEvent.js';
import IThumbnailEvent from './event/IThumbnailEvent.js';
import OperatorEncodeEvent from './event/OperatorEncodeEvent.js';
import RecordedEvent from './event/RecordedEvent.js';
import RecordedTagEvent from './event/RecordedTagEvent.js';
import RecordingEvent from './event/RecordingEvent.js';
import ReserveEvent from './event/ReserveEvent.js';
import RuleEvent from './event/RuleEvent.js';
import ThumbnailEvent from './event/ThumbnailEvent.js';
import ExecutionManagementModel from './ExecutionManagementModel.js';
import IConfiguration from './IConfiguration.js';
import IConnectionCheckModel from './IConnectionCheckModel.js';
import IExecutionManagementModel from './IExecutionManagementModel.js';
import ILoggerModel from './ILoggerModel.js';
import IMirakurunClientModel from './IMirakurunClientModel.js';
import IIPCClient from './ipc/IIPCClient.js';
import IIPCServer from './ipc/IIPCServer.js';
import IPCClient from './ipc/IPCClient.js';
import IPCServer from './ipc/IPCServer.js';
import { IPromiseQueue } from './IPromiseQueue.js';
import IPromiseRetry from './IPromiseRetry.js';
import LoggerModel from './LoggerModel.js';
import MirakurunClientModel from './MirakurunClientModel.js';
import ExternalCommandManageModel from './operator/externalCommand/ExternalCommandManageModel.js';
import IExternalCommandManageModel from './operator/externalCommand/IExternalCommandManageModel.js';
import DiscordNotificationModel from './operator/discord/DiscordNotificationModel.js';
import IDiscordNotificationModel from './operator/discord/IDiscordNotificationModel.js';
import IReserveOptionChecker from './operator/IReserveOptionChecker.js';
import IRecordedManageModel from './operator/recorded/IRecordedManageModel.js';
import RecordedManageModel from './operator/recorded/RecordedManageModel.js';
import IRecordedTagManadeModel from './operator/recordedTag/IRecordedTagManadeModel.js';
import RecordedTagManadeModel from './operator/recordedTag/RecordedTagManadeModel.js';
import DropCheckerModel from './operator/recording/DropCheckerModel.js';
import IDropCheckerModel from './operator/recording/IDropCheckerModel.js';
import IRecorderModel, { RecorderModelProvider } from './operator/recording/IRecorderModel.js';
import IRecordingManageModel from './operator/recording/IRecordingManageModel.js';
import IRecordingStreamCreator from './operator/recording/IRecordingStreamCreator.js';
import IRecordingUtilModel from './operator/recording/IRecordingUtilModel.js';
import RecorderModel from './operator/recording/RecorderModel.js';
import RecordingManageModel from './operator/recording/RecordingManageModel.js';
import RecordingStreamCreator from './operator/recording/RecordingStreamCreator.js';
import RecordingUtilModel from './operator/recording/RecordingUtilModel.js';
import IReservationManageModel from './operator/reservation/IReservationManageModel.js';
import ReservationManageModel from './operator/reservation/ReservationManageModel.js';
import ReserveOptionChecker from './operator/ReserveOptionChecker.js';
import IRuleManageModel from './operator/rule/IRuleManageModel.js';
import RuleManageModel from './operator/rule/RuleManageModel.js';
import IStorageManageModel from './operator/storage/IStorageManageModel.js';
import StorageManageModel from './operator/storage/StorageManageModel.js';
import IThumbnailManageModel from './operator/thumbnail/IThumbnailManageModel.js';
import ThumbnailManageModel from './operator/thumbnail/ThumbnailManageModel.js';
import PromiseQueue from './PromiseQueue.js';
import PromiseRetry from './PromiseRetry.js';
import EncodeFileManageModel from './service/encode/EncodeFileManageModel.js';
import EncodeFinishModel from './service/encode/EncodeFinishModel.js';
import EncodeManageModel from './service/encode/EncodeManageModel.js';
import EncodeProcessManageModel from './service/encode/EncodeProcessManageModel.js';
import EncoderModel from './service/encode/EncoderModel.js';
import IEncodeFileManageModel from './service/encode/IEncodeFileManageModel.js';
import IEncodeFinishModel from './service/encode/IEncodeFinishModel.js';
import IEncodeManageModel from './service/encode/IEncodeManageModel.js';
import IEncodeProcessManageModel from './service/encode/IEncodeProcessManageModel.js';
import { EncoderModelProvider, IEncoderModel } from './service/encode/IEncoderModel.js';
import IServiceServer from './service/IServiceServer.js';
import ServiceServer from './service/ServiceServer.js';
import ISocketIOManageModel from './service/socketio/ISocketIOManageModel.js';
import SocketIOManageModel from './service/socketio/SocketIOManageModel.js';
import ILiveStreamBaseModel, {
    LiveHLSStreamModelProvider,
    LiveStreamModelProvider,
} from './service/stream/base/ILiveStreamBaseModel.js';
import IRecordedStreamBaseModel, {
    RecordedHLSStreamModelProvider,
    RecordedStreamModelProvider,
} from './service/stream/base/IRecordedStreamBaseModel.js';
import LiveHLSStreamModel from './service/stream/LiveHLSStreamModel.js';
import LiveStreamModel from './service/stream/LiveStreamModel.js';
import IStreamManageModel from './service/stream/manager/IStreamManageModel.js';
import StreamManageModel from './service/stream/manager/StreamManageModel.js';
import RecordedHLSStreamModel from './service/stream/RecordedHLSStreamModel.js';
import RecordedStreamModel from './service/stream/RecordedStreamModel.js';
import HLSFileDeleterModel from './service/stream/util/HLSFileDeleterModel.js';
import IHLSFileDeleterModel from './service/stream/util/IHLSFileDeleterModel.js';

/**
 * container に 各 Model を登録する
 */
export const set = (container: Container): void => {
    container.bind<ILoggerModel>('ILoggerModel').to(LoggerModel).inSingletonScope();

    container.bind<IConfiguration>('IConfiguration').to(Configuration).inSingletonScope();

    container.bind<IConnectionCheckModel>('IConnectionCheckModel').to(ConnectionCheckModel).inSingletonScope();

    container.bind<IPromiseQueue>('IPromiseQueue').to(PromiseQueue);

    container.bind<IPromiseRetry>('IPromiseRetry').to(PromiseRetry);

    container.bind<IExecutionManagementModel>('IExecutionManagementModel').to(ExecutionManagementModel);

    container.bind<IIPCClient>('IIPCClient').to(IPCClient).inSingletonScope();

    container.bind<IIPCServer>('IIPCServer').to(IPCServer).inSingletonScope();

    container.bind<IDBOperator>('IDBOperator').to(DBOperator).inSingletonScope();

    container.bind<IChannelDB>('IChannelDB').to(ChannelDB).inSingletonScope();

    container.bind<IProgramDB>('IProgramDB').to(ProgramDB).inSingletonScope();

    container.bind<IRecordedDB>('IRecordedDB').to(RecordedDB).inSingletonScope();

    container.bind<IRecordedTagDB>('IRecordedTagDB').to(RecordedTagDB).inSingletonScope();

    container.bind<IRecordedHistoryDB>('IRecordedHistoryDB').to(RecordedHistoryDB).inSingletonScope();

    container.bind<IRecordedPlaybackDB>('IRecordedPlaybackDB').to(RecordedPlaybackDB).inSingletonScope();

    container.bind<IReserveDB>('IReserveDB').to(ReserveDB).inSingletonScope();

    container.bind<IRuleDB>('IRuleDB').to(RuleDB).inRequestScope();

    container.bind<IAnnictEpisodeDB>('IAnnictEpisodeDB').to(AnnictEpisodeDB).inSingletonScope();

    container.bind<IAnnictRuleLinkDB>('IAnnictRuleLinkDB').to(AnnictRuleLinkDB).inSingletonScope();

    container.bind<IThumbnailDB>('IThumbnailDB').to(ThumbnailDB).inSingletonScope();

    container.bind<IVideoFileDB>('IVideoFileDB').to(VideoFileDB).inSingletonScope();

    container.bind<IDropLogFileDB>('IDropLogFileDB').to(DropLogFileDB).inSingletonScope();

    container.bind<ITvUserDB>('ITvUserDB').to(TvUserDB).inSingletonScope();

    container.bind<IViewerProfileDB>('IViewerProfileDB').to(ViewerProfileDB).inSingletonScope();

    container.bind<IRuleEvent>('IRuleEvent').to(RuleEvent).inSingletonScope();

    container.bind<IThumbnailEvent>('IThumbnailEvent').to(ThumbnailEvent).inSingletonScope();

    container.bind<IRecordedEvent>('IRecordedEvent').to(RecordedEvent).inSingletonScope();

    container.bind<IRecordingEvent>('IRecordingEvent').to(RecordingEvent).inSingletonScope();

    container.bind<IRecordedTagEvent>('IRecordedTagEvent').to(RecordedTagEvent).inSingletonScope();

    container.bind<IReserveEvent>('IReserveEvent').to(ReserveEvent).inSingletonScope();

    container.bind<IEPGUpdateEvent>('IEPGUpdateEvent').to(EPGUpdateEvent).inSingletonScope();

    container.bind<IOperatorEncodeEvent>('IOperatorEncodeEvent').to(OperatorEncodeEvent).inSingletonScope();

    container
        .bind<IEPGUpdateExecutorManageModel>('IEPGUpdateExecutorManageModel')
        .to(EPGUpdateExecutorManageModel)
        .inSingletonScope();

    container.bind<IReserveOptionChecker>('IReserveOptionChecker').to(ReserveOptionChecker).inSingletonScope();

    container.bind<IMirakurunClientModel>('IMirakurunClientModel').to(MirakurunClientModel).inSingletonScope();

    container.bind<IEPGUpdateManageModel>('IEPGUpdateManageModel').to(EPGUpdateManageModel).inSingletonScope();

    container.bind<IEPGUpdater>('IEPGUpdater').to(EPGUpdater).inSingletonScope();

    container.bind<IReservationManageModel>('IReservationManageModel').to(ReservationManageModel).inSingletonScope();

    container.bind<IRuleManageModel>('IRuleManageModel').to(RuleManageModel).inSingletonScope();

    container.bind<IRecordingStreamCreator>('IRecordingStreamCreator').to(RecordingStreamCreator).inSingletonScope();

    container.bind<IRecordingUtilModel>('IRecordingUtilModel').to(RecordingUtilModel).inSingletonScope();

    container.bind<IDropCheckerModel>('IDropCheckerModel').to(DropCheckerModel);

    container.bind<IRecorderModel>('IRecorderModel').to(RecorderModel);

    container.bind<RecorderModelProvider>('RecorderModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecorderModel>(
                (resolve: (model: IRecorderModel) => void, reject: (err: Error) => void) => {
                    try {
                        const recorderModel = context.container.get<IRecorderModel>('IRecorderModel');
                        resolve(recorderModel);
                    } catch (err: any) {
                        reject(err);
                    }
                },
            );
        };
    });

    container.bind<IRecordedManageModel>('IRecordedManageModel').to(RecordedManageModel).inSingletonScope();

    container.bind<IRecordingManageModel>('IRecordingManageModel').to(RecordingManageModel).inSingletonScope();

    container.bind<IRecordedTagManadeModel>('IRecordedTagManadeModel').to(RecordedTagManadeModel).inSingletonScope();

    container.bind<IThumbnailManageModel>('IThumbnailManageModel').to(ThumbnailManageModel).inSingletonScope();

    container.bind<IStorageManageModel>('IStorageManageModel').to(StorageManageModel).inSingletonScope();

    container.bind<IEventSetter>('IEventSetter').to(EventSetter).inSingletonScope();
    container.bind<IAutoEncodeSettingsModel>('IAutoEncodeSettingsModel').to(AutoEncodeSettingsModel).inSingletonScope();

    container.bind<ISocketIOManageModel>('ISocketIOManageModel').to(SocketIOManageModel).inSingletonScope();

    container
        .bind<IExternalCommandManageModel>('IExternalCommandManageModel')
        .to(ExternalCommandManageModel)
        .inSingletonScope();

    container
        .bind<IDiscordNotificationModel>('IDiscordNotificationModel')
        .to(DiscordNotificationModel)
        .inSingletonScope();

    container.bind<IServiceServer>('IServiceServer').to(ServiceServer).inSingletonScope();

    container.bind<IApiUtil>('IApiUtil').to(ApiUtil).inSingletonScope();

    container.bind<IRecordedItemUtil>('IRecordedItemUtil').to(RecordedItemUtil).inSingletonScope();

    container.bind<IConfigApiModel>('IConfigApiModel').to(ConfigApiModel).inSingletonScope();

    container.bind<IChannelApiModel>('IChannelApiModel').to(ChannelApiModel).inSingletonScope();

    container.bind<IAnnictApiModel>('IAnnictApiModel').to(AnnictApiModel).inSingletonScope();

    container.bind<IViewerProfileApiModel>('IViewerProfileApiModel').to(ViewerProfileApiModel).inSingletonScope();

    container.bind<ITwitterApiModel>('ITwitterApiModel').to(TwitterApiModel).inSingletonScope();

    container.bind<IBlueskyApiModel>('IBlueskyApiModel').to(BlueskyApiModel).inSingletonScope();
    container.bind<IMisskeyApiModel>('IMisskeyApiModel').to(MisskeyApiModel).inSingletonScope();
    container.bind<INiconicoApiModel>('INiconicoApiModel').to(NiconicoApiModel).inSingletonScope();

    container
        .bind<IRecordedPlaybackApiModel>('IRecordedPlaybackApiModel')
        .to(RecordedPlaybackApiModel)
        .inSingletonScope();

    container.bind<IScheduleApiModel>('IScheduleApiModel').to(ScheduleApiModel).inSingletonScope();

    container.bind<IReserveApiModel>('IReserveApiModel').to(ReserveApiModel).inSingletonScope();

    container.bind<IRecordedApiModel>('IRecordedApiModel').to(RecordedApiModel).inSingletonScope();

    container.bind<IJikkyoApiModel>('IJikkyoApiModel').to(JikkyoApiModel).inSingletonScope();
    container.bind<IVideoCommentApiModel>('IVideoCommentApiModel').to(VideoCommentApiModel).inSingletonScope();

    container.bind<IRecordingApiModel>('IRecordingApiModel').to(RecordingApiModel).inSingletonScope();

    container.bind<IRecordedTagApiModel>('IRecordedTagApiModel').to(RecordedTagApiModel).inSingletonScope();

    container.bind<IRuleApiModel>('IRuleApiModel').to(RuleApiModel).inSingletonScope();
    container.bind<RuleApiModelProvider>('RuleApiModelProvider').toProvider(context => {
        return () => Promise.resolve(context.container.get<IRuleApiModel>('IRuleApiModel'));
    });

    container.bind<IThumbnailApiModel>('IThumbnailApiModel').to(ThumbnailApiModel).inSingletonScope();

    container.bind<IUserApiModel>('IUserApiModel').to(UserApiModel).inSingletonScope();

    container.bind<IDropLogApiModel>('IDropLogApiModel').to(DropLogApiModel).inSingletonScope();

    container.bind<IVideoUtil>('IVideoUtil').to(VideoUtil).inSingletonScope();

    container.bind<ITsInfoAnalyzer>('ITsInfoAnalyzer').to(TsInfoAnalyzer);

    container.bind<IVideoAnalysisModel>('IVideoAnalysisModel').to(VideoAnalysisModel).inSingletonScope();

    container.bind<IVideoApiModel>('IVideoApiModel').to(VideoApiModel).inSingletonScope();

    container.bind<IEncodeApiModel>('IEncodeApiModel').to(EncodeApiModel).inSingletonScope();

    container.bind<IIPTVApiModel>('IIPTVApiModel').to(IPTVApiModel).inSingletonScope();

    container.bind<IEncodeEvent>('IEncodeEvent').to(EncodeEvent).inSingletonScope();

    container
        .bind<IEncodeProcessManageModel>('IEncodeProcessManageModel')
        .to(EncodeProcessManageModel)
        .inSingletonScope();

    container.bind<IEncodeFileManageModel>('IEncodeFileManageModel').to(EncodeFileManageModel).inSingletonScope();

    container.bind<IEncoderModel>('IEncoderModel').to(EncoderModel);

    container.bind<EncoderModelProvider>('EncoderModelProvider').toProvider(context => {
        return () => {
            return new Promise<IEncoderModel>(
                (resolve: (model: IEncoderModel) => void, reject: (err: Error) => void) => {
                    try {
                        const encoderModel = context.container.get<IEncoderModel>('IEncoderModel');
                        resolve(encoderModel);
                    } catch (err: any) {
                        reject(err);
                    }
                },
            );
        };
    });

    container.bind<IEncodeManageModel>('IEncodeManageModel').to(EncodeManageModel).inSingletonScope();

    container.bind<IEncodeFinishModel>('IEncodeFinishModel').to(EncodeFinishModel).inSingletonScope();

    container.bind<ILiveStreamBaseModel>('LiveStreamModel').to(LiveStreamModel);

    container.bind<LiveStreamModelProvider>('LiveStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<ILiveStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<ILiveStreamBaseModel>('LiveStreamModel');
                    resolve(streamModel);
                } catch (err: any) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IHLSFileDeleterModel>('IHLSFileDeleterModel').to(HLSFileDeleterModel);

    container.bind<ILiveStreamBaseModel>('LiveHLSStreamModel').to(LiveHLSStreamModel);

    container.bind<LiveHLSStreamModelProvider>('LiveHLSStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<ILiveStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<ILiveStreamBaseModel>('LiveHLSStreamModel');
                    resolve(streamModel);
                } catch (err: any) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IRecordedStreamBaseModel>('RecordedStreamModel').to(RecordedStreamModel);

    container.bind<RecordedStreamModelProvider>('RecordedStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecordedStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<IRecordedStreamBaseModel>('RecordedStreamModel');
                    resolve(streamModel);
                } catch (err: any) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IRecordedStreamBaseModel>('RecordedHLSStreamModel').to(RecordedHLSStreamModel);
    container.bind<RecordedHLSStreamModelProvider>('RecordedHLSStreamModelProvider').toProvider(context => {
        return () => {
            return new Promise<IRecordedStreamBaseModel>((resolve, reject) => {
                try {
                    const streamModel = context.container.get<IRecordedStreamBaseModel>('RecordedHLSStreamModel');
                    resolve(streamModel);
                } catch (err: any) {
                    reject(err);
                }
            });
        };
    });

    container.bind<IStreamManageModel>('IStreamManageModel').to(StreamManageModel).inSingletonScope();

    container.bind<IStreamApiModel>('IStreamApiModel').to(StreamApiModel).inSingletonScope();

    container.bind<IStorageApiModel>('IStorageApiModel').to(StorageApiModel).inSingletonScope();
    container.bind<IMirakurunStatusApiModel>('IMirakurunStatusApiModel').to(MirakurunStatusApiModel).inSingletonScope();
};
