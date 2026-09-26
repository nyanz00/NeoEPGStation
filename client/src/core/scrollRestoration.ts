const scrollPositions = new Map<string, number>();
const guideScrollPositions = new Map<string, { left: number; top: number }>();

/** Store a scroll position before a route transition starts. */
export function rememberAppScrollPosition(locationKey: string, scrollY: number): void {
    if (locationKey.length === 0 || !Number.isFinite(scrollY) || scrollY < 0) return;
    scrollPositions.set(locationKey, scrollY);
    if (scrollPositions.size > 100) scrollPositions.delete(scrollPositions.keys().next().value as string);
}

export function loadAppScrollPosition(locationKey: string): number | undefined {
    return scrollPositions.get(locationKey);
}

/** Store the nested guide scroller position for a browser-history entry. */
export function rememberGuideScrollPosition(locationKey: string, left: number, top: number): void {
    if (locationKey.length === 0 || !Number.isFinite(left) || !Number.isFinite(top) || left < 0 || top < 0) return;
    guideScrollPositions.set(locationKey, { left, top });
    if (guideScrollPositions.size > 100) guideScrollPositions.delete(guideScrollPositions.keys().next().value as string);
}

export function loadGuideScrollPosition(locationKey: string): { left: number; top: number } | undefined {
    return guideScrollPositions.get(locationKey);
}
