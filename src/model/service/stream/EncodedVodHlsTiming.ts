export interface EncodedVodHlsTiming {
    frameRate: number;
    frameRateOption: string;
    gopFrames: number;
    segmentFrames: number;
    segmentDuration: number;
}

// Keep the one-second GOP separate from the frame-aligned segment interval.
// Rounding 23.976fps segments to four seconds accumulates seek drift.
export const getEncodedVodHlsTiming = (sourceFrameRate?: number): EncodedVodHlsTiming => {
    const rate =
        typeof sourceFrameRate === 'number' &&
        Number.isFinite(sourceFrameRate) &&
        sourceFrameRate >= 1 &&
        sourceFrameRate <= 240
            ? sourceFrameRate
            : 30;
    const broadcastRates = [24000, 30000, 60000, 120000].map(numerator => ({ numerator, denominator: 1001 }));
    const broadcast = broadcastRates.find(value => Math.abs(value.numerator / value.denominator - rate) < 0.0005);
    const numerator = broadcast?.numerator ?? Math.round(rate * 1000000);
    const denominator = broadcast?.denominator ?? 1000000;
    const frameRate = numerator / denominator;
    const gopFrames = Math.max(1, Math.round(frameRate));
    const segmentFrames = Math.max(1, Math.round(4 * frameRate));
    return {
        frameRate,
        frameRateOption: `${numerator.toString(10)}/${denominator.toString(10)}`,
        gopFrames,
        segmentFrames,
        segmentDuration: (segmentFrames * denominator) / numerator,
    };
};
