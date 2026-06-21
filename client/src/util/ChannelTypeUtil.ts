import * as apid from '../../../api';

namespace ChannelTypeUtil {
    export const grAltChannelTypes: apid.ChannelType[] = Array.from({ length: 20 }, (_, i) => `GR-ALT${i + 1}` as apid.ChannelType);

    export const broadcastTypes: apid.ChannelType[] = (['GR'] as apid.ChannelType[]).concat(grAltChannelTypes).concat(['BS', 'CS', 'SKY'] as apid.ChannelType[]);

    export const getDisplayName = (type: apid.ChannelType): string => {
        if (type.startsWith('GR-ALT')) {
            return type.replace('GR-', '');
        }

        return type;
    };
}

export default ChannelTypeUtil;
