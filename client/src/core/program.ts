import type { ChannelItem, ChannelType, ScheduleProgramItem } from '../../../api';

export const genreNames = [
    'ニュース・報道',
    'スポーツ',
    '情報・ワイドショー',
    'ドラマ',
    '音楽',
    'バラエティ',
    '映画',
    'アニメ・特撮',
    'ドキュメンタリー・教養',
    '劇場・公演',
    '趣味・教育',
    '福祉',
    '予備',
    '予備',
    '拡張',
    'その他',
] as const;

// prettier-ignore
export const subGenreNames: ReadonlyArray<ReadonlyArray<string>> = [
    ['定時・総合', '天気', '特集・ドキュメント', '政治・国会', '経済・市況', '海外・国際', '解説', '討論・会談', '報道特番', 'ローカル・地域', '交通', '', '', '', '', 'その他'],
    ['スポーツニュース', '野球', 'サッカー', 'ゴルフ', 'その他の球技', '相撲・格闘技', 'オリンピック・国際大会', 'マラソン・陸上・水泳', 'モータースポーツ', 'マリン・ウィンタースポーツ', '競馬・公営競技', '', '', '', '', 'その他'],
    ['芸能・ワイドショー', 'ファッション', '暮らし・住まい', '健康・医療', 'ショッピング・通販', 'グルメ・料理', 'イベント', '番組紹介・お知らせ', '', '', '', '', '', '', '', 'その他'],
    ['国内ドラマ', '海外ドラマ', '時代劇', '', '', '', '', '', '', '', '', '', '', '', '', 'その他'],
    ['国内ロック・ポップス', '海外ロック・ポップス', 'クラシック・オペラ', 'ジャズ・フュージョン', '歌謡曲・演歌', 'ライブ・コンサート', 'ランキング・リクエスト', 'カラオケ・のど自慢', '民謡・邦楽', '童謡・キッズ', '民族音楽・ワールドミュージック', '', '', '', '', 'その他'],
    ['クイズ', 'ゲーム', 'トークバラエティ', 'お笑い・コメディ', '音楽バラエティ', '旅バラエティ', '料理バラエティ', '', '', '', '', '', '', '', '', 'その他'],
    ['洋画', '邦画', 'アニメ', '', '', '', '', '', '', '', '', '', '', '', '', 'その他'],
    ['国内アニメ', '海外アニメ', '特撮', '', '', '', '', '', '', '', '', '', '', '', '', 'その他'],
    ['社会・時事', '歴史・紀行', '自然・動物・環境', '宇宙・科学・医学', 'カルチャー・伝統文化', '文学・文芸', 'スポーツ', 'ドキュメンタリー全般', 'インタビュー・討論', '', '', '', '', '', '', 'その他'],
    ['現代劇・新劇', 'ミュージカル', 'ダンス・バレエ', '落語・演芸', '歌舞伎・古典', '', '', '', '', '', '', '', '', '', '', 'その他'],
    ['旅・釣り・アウトドア', '園芸・ペット・手芸', '音楽・美術・工芸', '囲碁・将棋', '麻雀・パチンコ', '車・オートバイ', 'コンピュータ・ＴＶゲーム', '会話・語学', '幼児・小学生', '中学生・高校生', '大学生・受験', '生涯教育・資格', '教育問題', '', '', 'その他'],
    ['高齢者', '障害者', '社会福祉', 'ボランティア', '手話', '文字（字幕）', '音声解説', '', '', '', '', '', '', '', '', 'その他'],
    [],
    [],
    ['BS／地上デジタル放送用番組付属情報', '広帯域CSデジタル放送用拡張', '', 'サーバー型番組付属情報', 'IP放送用番組付属情報'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', '', '', 'その他'],
];

export const weekItems = [
    { label: '月', bit: 0x02 },
    { label: '火', bit: 0x04 },
    { label: '水', bit: 0x08 },
    { label: '木', bit: 0x10 },
    { label: '金', bit: 0x20 },
    { label: '土', bit: 0x40 },
    { label: '日', bit: 0x01 },
] as const;

export function formatProgramDate(value: number): string {
    return new Intl.DateTimeFormat('ja-JP', {
        year: 'numeric',
        month: '2-digit',
        day: '2-digit',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hour12: false,
    }).format(new Date(value));
}

export function formatProgramTime(value: number): string {
    return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hour12: false }).format(new Date(value));
}

export function channelName(channels: ChannelItem[] | undefined, channelId: number): string {
    return channels?.find(channel => channel.id === channelId)?.name ?? channelId.toString(10);
}

export function channelTypeLabel(type: ChannelType): string {
    return type.startsWith('GR-ALT') ? type.slice(3) : type;
}

export function programDuration(program: Pick<ScheduleProgramItem, 'startAt' | 'endAt'>): number {
    return Math.max(0, Math.round((program.endAt - program.startAt) / 60_000));
}

/** 番組情報がない場合に、放送休止の可能性が高い深夜帯かを判定する。 */
export function isLikelyBroadcastPauseTime(value: number = Date.now()): boolean {
    const hour = new Date(value).getHours();
    return hour >= 23 || hour < 7;
}

export function normalizeChannelFilter(value: string): string {
    return value
        .normalize('NFKC')
        .toLocaleLowerCase('ja')
        .replace(/[\s\u3000]+/g, '');
}

/** Vue版の番組ダイアログと同じように、話数や括弧書きを除いた関連検索語を作る。 */
export function createProgramSearchKeyword(name: string): string {
    const title = name
        .replace(/\[.+?\]/g, ' ')
        .replace(/【.+?】/g, ' ')
        .replace(/\(.\)/g, ' ')
        .replace(/ +/g, ' ')
        .trim();
    const delimiter = title.includes(' #') ? ' #' : title.includes('「') ? '「' : '';
    const keyword = delimiter.length > 0 ? title.split(delimiter)[0] : title;
    return keyword.length > 0 ? keyword : name.trim();
}
