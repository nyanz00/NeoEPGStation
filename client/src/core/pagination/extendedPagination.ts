export function parsePageJump(value: string, count: number): number | null {
    if (!/^\d+$/.test(value)) return null;
    const page = Number(value);
    return Number.isSafeInteger(page) && page >= 1 && page <= count ? page : null;
}
