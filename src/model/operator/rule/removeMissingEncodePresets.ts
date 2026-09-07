import * as apid from '../../../../api';
import IConfigFile from '../../IConfigFile';

/** Remove only slots whose preset no longer exists, including their dependent settings. */
export default function removeMissingEncodePresets(rule: apid.AddRuleOption, config: IConfigFile): boolean {
    if (rule.encodeOption === undefined || !Array.isArray(config.encode)) {
        return false;
    }
    const names = new Set(config.encode.map(preset => preset?.name).filter(name => typeof name === 'string'));
    const option = { ...rule.encodeOption };
    let changed = false;
    for (const slot of [1, 2, 3] as const) {
        const mode = option[`mode${slot}`];
        if (mode === undefined || names.has(mode)) {
            continue;
        }
        delete option[`mode${slot}`];
        delete option[`channelId${slot}`];
        delete option[`channelIds${slot}`];
        delete option[`encodeParentDirectoryName${slot}`];
        delete option[`directory${slot}`];
        changed = true;
    }
    if (changed) {
        rule.encodeOption =
            option.mode1 === undefined && option.mode2 === undefined && option.mode3 === undefined ? undefined : option;
    }
    return changed;
}
