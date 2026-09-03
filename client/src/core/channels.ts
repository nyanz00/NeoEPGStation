import type { ScheduleChannleItem } from '../../../api';

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
