import type { ChannelId, ChannelItem, ScheduleChannleItem } from '../../../api';

const paidBroadcastChannelPattern =
    /AT[\s-]*X|キッズステーション|アニマックス|ディズニー|WOWOW|スターチャンネル|J[\s:：-]*COM[\s-]*BS|J SPORTS|日本映画専門|時代劇専門|チャンネルNECO|ファミリー劇場|テレ朝チャンネル|TBSチャンネル|フジテレビ(?:ONE|TWO|NEXT)|日テレプラス|ホームドラマ|衛星劇場|東映チャンネル|カートゥーン|GAORA|スカイA/i;

export function isPaidBroadcastChannel(channel: { name: string }): boolean {
    return paidBroadcastChannelPattern.test(channel.name.normalize('NFKC'));
}

export function isAudioVideoChannel(channel: { type?: number | null }): boolean {
    switch (channel.type) {
        case 0x01:
        case 0x02:
        case 0xa1:
        case 0xa2:
        case 0xa5:
        case 0xa6:
        case 0xad:
        case null:
        case undefined:
            return true;
        default:
            return false;
    }
}

/** Keep Annict's preferred stations consistent with the schedule's main-channel detection. */
export function isMainBroadcastChannel(channel: Pick<ChannelItem, 'channelType' | 'serviceId' | 'type'>): boolean {
    if (!isAudioVideoChannel(channel)) return false;
    if (channel.channelType === 'GR' || channel.channelType.startsWith('GR-ALT')) return (channel.serviceId & 0x0187) === 0;
    if (channel.channelType !== 'BS') return true;
    return !(
        channel.serviceId === 102 ||
        channel.serviceId === 104 ||
        (142 <= channel.serviceId && channel.serviceId <= 149) ||
        (152 <= channel.serviceId && channel.serviceId <= 159) ||
        (162 <= channel.serviceId && channel.serviceId <= 169) ||
        (172 <= channel.serviceId && channel.serviceId <= 179) ||
        (182 <= channel.serviceId && channel.serviceId <= 189) ||
        channel.serviceId === 232 ||
        channel.serviceId === 233
    );
}

export function ruleEncodePriorityChannelIds(resultChannelIds: ChannelId[], searchChannelIds: ChannelId[], fromAnime: boolean): ChannelId[] {
    return Array.from(new Set([...resultChannelIds, ...(fromAnime || resultChannelIds.length === 0 ? searchChannelIds : [])]));
}

export function sortRuleEncodeChannels(channels: ChannelItem[], priorityChannelIds: ChannelId[], annictPriorityChannelIds: ChannelId[]): ChannelItem[] {
    const annictChannelIds = new Set(annictPriorityChannelIds);
    const mainAnnictChannelIds = new Set(channels.filter(channel => annictChannelIds.has(channel.id) && isMainBroadcastChannel(channel)).map(channel => channel.id));
    const preferredChannelIds = Array.from(
        new Set([
            ...priorityChannelIds.filter(id => !annictChannelIds.has(id) || mainAnnictChannelIds.has(id)),
            ...annictPriorityChannelIds.filter(id => mainAnnictChannelIds.has(id)),
        ]),
    );
    const rank = new Map(preferredChannelIds.map((id, index) => [id, index]));
    return [...channels].sort((a, b) => {
        const aRank = rank.get(a.id);
        const bRank = rank.get(b.id);
        if (aRank === undefined && bRank === undefined) return 0;
        if (aRank === undefined) return 1;
        if (bRank === undefined) return -1;
        return aRank - bRank;
    });
}

export function isDefaultVisibleChannel(channel: Pick<ScheduleChannleItem, 'name' | 'type'>): boolean {
    if (!isAudioVideoChannel(channel)) return false;

    const name = channel.name
        .normalize('NFKC')
        .replace(/[\s　]+/g, '')
        .toUpperCase();
    return !(
        /^NHK(?:DATA|データ)(?:\d|$)/.test(name) ||
        /^707チャンネル$/.test(name) ||
        /^放送大学ラジオ$/.test(name) ||
        /^プレミアムナビ$/.test(name) ||
        /^WOWOW.*(?:ご案内|案内チャンネル)/.test(name) ||
        /^BS10(?:プレミアム)?(?:の)?ご案内/.test(name) ||
        /^スカパー!?(?:ガイド|.*ご案内チャンネル)/.test(name)
    );
}
