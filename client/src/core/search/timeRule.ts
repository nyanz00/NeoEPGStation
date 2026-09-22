export function secondsToTime(value: number): string {
    const normalized = ((value % 86_400) + 86_400) % 86_400;
    return `${Math.floor(normalized / 3_600)
        .toString()
        .padStart(2, '0')}:${Math.floor((normalized % 3_600) / 60)
        .toString()
        .padStart(2, '0')}`;
}

export function timeToSeconds(value: string): number {
    const match = /^(\d{2}):(\d{2})$/.exec(value);
    if (match === null) throw new Error('時刻を正しく入力してください');
    const hour = Number(match[1]);
    const minute = Number(match[2]);
    if (hour > 23 || minute > 59) throw new Error('時刻を正しく入力してください');
    return hour * 3_600 + minute * 60;
}

export function timeRuleRangeSeconds(startValue: string, endValue: string): { start: number; range: number } {
    const start = timeToSeconds(startValue);
    const end = timeToSeconds(endValue);
    if (end === start) throw new Error('開始時刻と終了時刻を変えてください');
    return { start, range: end > start ? end - start : 86_400 - start + end };
}
