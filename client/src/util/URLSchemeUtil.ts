import UaUtil from './UaUtil';

namespace URLSchemeUtil {
    export const build = (urlScheme: string, address: string, filename?: string): string => {
        const protocol = location.protocol.replace(':', '');
        const targetAddress = urlScheme.match(/vlc-x-callback/) === null ? address : encodeURIComponent(address);

        let result = urlScheme;
        if (UaUtil.isWindows() === true) {
            result = result.replace(/PROTOCOL:\/\/ADDRESS/g, `${protocol}%3A//${targetAddress}`);
        }

        result = result.replace(/PROTOCOL/g, protocol).replace(/ADDRESS/g, targetAddress);
        if (typeof filename === 'string') {
            result = result.replace(/FILENAME/g, filename);
        }

        return result;
    };
}

export default URLSchemeUtil;
