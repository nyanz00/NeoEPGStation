import * as apid from '../../../api.js';
import VideoFile from '../../db/entities/VideoFile.js';

export default interface IKeyframeAnalysisModel {
    request(video: VideoFile, size: number, mtime: number, force?: boolean): Promise<apid.VideoKeyframeAnalysis>;
    start(): Promise<void>;
    stop(): Promise<void>;
}
