import type { ChannelItem, ChannelType, ProgramAudioSamplingRate, ProgramVideoType, ScheduleProgramItem } from '../../../api';

const JST_TIME_ZONE = 'Asia/Tokyo';

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

/** 番組内容の検索条件として選択可能な大ジャンル。予備枠と付属情報用の拡張枠は除外する。 */
export const searchableGenreItems = genreNames.map((name, genre) => ({ genre, name })).filter(item => (item.genre >= 0 && item.genre <= 11) || item.genre === 15);

export function programGenreLabels(program: { genre1?: number; genre2?: number; genre3?: number }): string[] {
    return Array.from(
        new Set(
            [program.genre1, program.genre2, program.genre3]
                .filter((genre): genre is number => genre !== undefined)
                .map(genre => genreNames[genre] ?? `ジャンル ${genre.toString(10)}`),
        ),
    );
}

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

export function genrePathLabel(genre: number, subGenre?: number): string {
    const genreLabel = genreNames[genre] ?? `ジャンル ${genre.toString(10)}`;
    const subGenreLabel = subGenre === undefined ? undefined : subGenreNames[genre]?.[subGenre];
    return subGenreLabel === undefined || subGenreLabel.length === 0 ? genreLabel : `${genreLabel} / ${subGenreLabel}`;
}

export function programGenrePathLabels(program: { genre1?: number; subGenre1?: number; genre2?: number; subGenre2?: number; genre3?: number; subGenre3?: number }): string[] {
    return [
        [program.genre1, program.subGenre1],
        [program.genre2, program.subGenre2],
        [program.genre3, program.subGenre3],
    ].flatMap(([genre, subGenre]) => {
        if (genre === undefined) return [];
        return [genrePathLabel(genre, subGenre)];
    });
}

const videoComponentLabels: Record<number, string> = {
    0x01: '480i（525i）、アスペクト比4:3',
    0x02: '480i（525i）、アスペクト比16:9 パンベクトルあり',
    0x03: '480i（525i）、アスペクト比16:9 パンベクトルなし',
    0x04: '480i（525i）、アスペクト比 > 16:9',
    0x83: '4320p、アスペクト比16:9',
    0x91: '2160p、アスペクト比4:3',
    0x92: '2160p、アスペクト比16:9 パンベクトルあり',
    0x93: '2160p、アスペクト比16:9 パンベクトルなし',
    0x94: '2160p、アスペクト比 > 16:9',
    0xa1: '480p（525p）、アスペクト比4:3',
    0xa2: '480p（525p）、アスペクト比16:9 パンベクトルあり',
    0xa3: '480p（525p）、アスペクト比16:9 パンベクトルなし',
    0xa4: '480p（525p）、アスペクト比 > 16:9',
    0xb1: '1080i（1125i）、アスペクト比4:3',
    0xb2: '1080i（1125i）、アスペクト比16:9 パンベクトルあり',
    0xb3: '1080i（1125i）、アスペクト比16:9 パンベクトルなし',
    0xb4: '1080i（1125i）、アスペクト比 > 16:9',
    0xc1: '720p（750p）、アスペクト比4:3',
    0xc2: '720p（750p）、アスペクト比16:9 パンベクトルあり',
    0xc3: '720p（750p）、アスペクト比16:9 パンベクトルなし',
    0xc4: '720p（750p）、アスペクト比 > 16:9',
    0xd1: '240p、アスペクト比4:3',
    0xd2: '240p、アスペクト比16:9 パンベクトルあり',
    0xd3: '240p、アスペクト比16:9 パンベクトルなし',
    0xd4: '240p、アスペクト比 > 16:9',
    0xe1: '1080p（1125p）、アスペクト比4:3',
    0xe2: '1080p（1125p）、アスペクト比16:9 パンベクトルあり',
    0xe3: '1080p（1125p）、アスペクト比16:9 パンベクトルなし',
    0xe4: '1080p（1125p）、アスペクト比 > 16:9',
    0xf1: '180p、アスペクト比4:3',
    0xf2: '180p、アスペクト比16:9 パンベクトルあり',
    0xf3: '180p、アスペクト比16:9 パンベクトルなし',
    0xf4: '180p、アスペクト比 > 16:9',
};

const audioComponentLabels: Record<number, string> = {
    0x01: '1/0モード（モノラル）',
    0x02: '1/0＋1/0モード（デュアルモノ）',
    0x03: '2/0モード（ステレオ）',
    0x04: '2/1モード',
    0x05: '3/0モード',
    0x06: '2/2モード',
    0x07: '3/1モード',
    0x08: '3/2モード',
    0x09: '3/2＋LFEモード（5.1ch）',
    0x0a: '3/3.1モード',
    0x0b: '2/0/0-2/0/2-0.1モード',
    0x0c: '5/2.1モード',
    0x0d: '3/2/2.1モード',
    0x0e: '2/0/0-3/0/2-0.1モード',
    0x0f: '0/2/0-3/0/2-0.1モード',
    0x10: '2/0/0-3/2/3-0.2モード',
    0x11: '3/3/3-5/2/3-3/0/0.2モード',
};

export function programVideoComponentLabel(value: number | undefined): string | undefined {
    if (value === undefined) return undefined;
    return videoComponentLabels[value];
}

export function programVideoCodecLabel(value: ProgramVideoType | undefined): string | undefined {
    if (value === 'mpeg2') return 'MPEG-2';
    if (value === 'h.264') return 'H.264';
    if (value === 'h.265') return 'H.265';
    return undefined;
}

export function programAudioComponentLabel(value: number | undefined): string | undefined {
    if (value === undefined) return undefined;
    return audioComponentLabels[value] ?? `音声モード 0x${value.toString(16).padStart(2, '0')}`;
}

export function programAudioSamplingRateLabel(value: ProgramAudioSamplingRate | undefined): string | undefined {
    if (value === undefined) return undefined;
    const kiloHertz = value / 1000;
    return `${Number.isInteger(kiloHertz) ? kiloHertz.toFixed(0) : kiloHertz.toString()}kHz`;
}

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
        hourCycle: 'h23',
        timeZone: JST_TIME_ZONE,
    }).format(new Date(value));
}

export function formatProgramTime(value: number): string {
    return new Intl.DateTimeFormat('ja-JP', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', timeZone: JST_TIME_ZONE }).format(new Date(value));
}

export function formatProgramDateCompact(value: number): string {
    const parts = new Intl.DateTimeFormat('ja-JP', {
        month: 'numeric',
        day: 'numeric',
        weekday: 'short',
        hour: '2-digit',
        minute: '2-digit',
        hourCycle: 'h23',
        timeZone: JST_TIME_ZONE,
    }).formatToParts(new Date(value));
    const part = (type: Intl.DateTimeFormatPartTypes): string => parts.find(item => item.type === type)?.value ?? '';
    return `${part('month')}/${part('day')}(${part('weekday')}) ${part('hour').padStart(2, '0')}:${part('minute').padStart(2, '0')}`;
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
    if (!Number.isFinite(value)) return false;
    const hour = new Date(value + 9 * 60 * 60 * 1_000).getUTCHours();
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
