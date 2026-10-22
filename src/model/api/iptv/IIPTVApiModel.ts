import type { IptvRequestContext } from './IptvDocumentRequestGuard';

export default interface IIPTVApiModel {
    getChannelList(
        host: string,
        isSecure: boolean,
        mode: number,
        isHalfWidth: boolean,
        subDirectory?: string,
        requestContext?: IptvRequestContext,
    ): Promise<string>;
    getEpg(days: number, isHalfWidth: boolean, requestContext?: IptvRequestContext): Promise<string>;
}
