import type { ScheduleChannleItem } from '../../../api';

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
