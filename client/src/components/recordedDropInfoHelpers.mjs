export function hasRecordedDropError(drop) {
    return drop.dropCnt > 0 || drop.errorCnt > 0 || drop.scramblingCnt > 0;
}

export function sumRecordedVideoFileSize(videoFiles) {
    return videoFiles?.reduce((total, videoFile) => total + Math.max(0, videoFile.size), 0) ?? 0;
}

export function formatRecordedVideoFileSize(size) {
    const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
    let value = Number.isFinite(size) ? Math.max(0, size) : 0;
    let unitIndex = 0;
    while (value >= 1024 && unitIndex < units.length - 1) {
        value /= 1024;
        unitIndex++;
    }
    return `${value.toFixed(1)}${units[unitIndex]}`;
}
