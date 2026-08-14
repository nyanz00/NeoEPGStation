export function isAppleMobileWebKit(): boolean {
    const userAgent = navigator.userAgent;
    const appleMobileDevice = /iPad|iPhone|iPod/i.test(userAgent) || (/Macintosh/i.test(userAgent) && navigator.maxTouchPoints > 1);
    return appleMobileDevice && /AppleWebKit/i.test(userAgent);
}
