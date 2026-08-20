import * as apid from '../../../../api';

export default interface IStorageApiModel {
    getInfo(): Promise<apid.StorageInfo>;
    getSystemInfo(): Promise<apid.SystemResourceInfo>;
    getGpuInfo(): Promise<apid.SystemGpuList>;
    getStorageVolumes(): Promise<apid.SystemStorageVolumeList>;
    getLog(
        source: apid.SystemLogSource,
        category: apid.SystemLogCategory,
        lineLimit: number,
    ): Promise<apid.SystemLogInfo>;
}
