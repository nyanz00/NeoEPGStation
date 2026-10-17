// Keep native ARIB captions and converted ASS/SRT captions on the same font chain.
export function getSubtitleFontFamily(userAgent = navigator.userAgent): string {
    return /Windows/.test(userAgent) && /Firefox/.test(userAgent)
        ? '"Windows TV MaruGothic", "MS Gothic", "Yu Gothic", sans-serif'
        : '"Windows TV MaruGothic", "Hiragino Maru Gothic Pro", "HGMaruGothicMPRO", "Yu Gothic Medium", sans-serif';
}
