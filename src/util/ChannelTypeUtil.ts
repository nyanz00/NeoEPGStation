import * as apid from '../../api';

namespace ChannelTypeUtil {
    export const grAltChannelTypes: apid.ChannelType[] = Array.from(
        { length: 20 },
        (_, i) => `GR-ALT${i + 1}` as apid.ChannelType,
    );

    export const broadcastTypes: apid.ChannelType[] = (['GR'] as apid.ChannelType[])
        .concat(grAltChannelTypes)
        .concat(['BS', 'CS', 'SKY'] as apid.ChannelType[]);

    export const createBroadcastStatus = (): apid.BroadcastStatus => {
        const status = {} as apid.BroadcastStatus;
        for (const type of broadcastTypes) {
            status[type] = false;
        }

        return status;
    };

    export const parseChannelTypes = (value: unknown): apid.ChannelType[] => {
        if (typeof value === 'undefined' || value === null) {
            return [];
        }

        if (Array.isArray(value)) {
            return value.flatMap(item => parseChannelTypes(item));
        }

        if (typeof value !== 'string') {
            return [];
        }

        try {
            const parsed = JSON.parse(value);
            if (Array.isArray(parsed)) {
                return filterChannelTypes(parsed);
            }
        } catch {
            // fall through to comma-separated parsing
        }

        return filterChannelTypes(value.split(','));
    };

    export const filterChannelTypes = (types: unknown[]): apid.ChannelType[] => {
        const result: apid.ChannelType[] = [];
        for (const type of types) {
            if (typeof type !== 'string') {
                continue;
            }
            if (broadcastTypes.indexOf(type as apid.ChannelType) === -1) {
                continue;
            }
            if (result.indexOf(type as apid.ChannelType) === -1) {
                result.push(type as apid.ChannelType);
            }
        }

        return result;
    };

    export const getRuleChannelTypes = (option: apid.RuleSearchOption): apid.ChannelType[] => {
        const types: apid.ChannelType[] = [];

        if (option.GR === true) {
            types.push('GR');
        }
        if (option.BS === true) {
            types.push('BS');
        }
        if (option.CS === true) {
            types.push('CS');
        }
        if (option.SKY === true) {
            types.push('SKY');
        }
        if (typeof option.channelTypes !== 'undefined') {
            for (const type of option.channelTypes) {
                types.push(type);
            }
        }

        return filterChannelTypes(types);
    };
}

export default ChannelTypeUtil;
