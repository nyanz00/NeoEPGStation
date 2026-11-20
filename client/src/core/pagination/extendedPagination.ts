export function mobileExtendedPages(count: number, page: number, availableWidth: number, itemPitch: number): number[] {
    // 本家と同じ7〜17要素の奇数段階。両端の2要素は先頭・末尾ボタン。
    const fitting = [7, 9, 11, 13, 15, 17].filter(size => size * itemPitch <= availableWidth);
    const numberCount = Math.min(count, (fitting.at(-1) ?? 7) - 2);
    const start = Math.max(1, Math.min(page - Math.floor((numberCount - 1) / 2), count - numberCount + 1));
    return Array.from({ length: numberCount }, (_, index) => start + index);
}

export function parsePageJump(value: string, count: number): number | null {
    if (!/^\d+$/.test(value)) return null;
    const page = Number(value);
    return Number.isSafeInteger(page) && page >= 1 && page <= count ? page : null;
}
