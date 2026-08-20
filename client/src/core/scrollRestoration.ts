const scrollPositions = new Map<string, number>();

/** Store a scroll position before a route transition starts. */
export function rememberAppScrollPosition(locationKey: string, scrollY: number): void {
    if (locationKey.length === 0 || !Number.isFinite(scrollY) || scrollY < 0) return;
    scrollPositions.set(locationKey, scrollY);
    if (scrollPositions.size > 100) scrollPositions.delete(scrollPositions.keys().next().value as string);
}

export function loadAppScrollPosition(locationKey: string): number | undefined {
    return scrollPositions.get(locationKey);
}
