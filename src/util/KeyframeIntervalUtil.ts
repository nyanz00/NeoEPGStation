export interface KeyframeSampleWindow {
    start: number;
    end: number;
}

export interface KeyframePacketSample extends KeyframeSampleWindow {
    keyframeTimes: number[];
}

const SAMPLE_WINDOW_SECONDS = 20;

function finiteTimestamp(value: unknown): number | null {
    if (typeof value !== 'number' && typeof value !== 'string') return null;
    if (typeof value === 'string' && value.trim() === '') return null;
    const timestamp = Number(value);
    return Number.isFinite(timestamp) ? timestamp : null;
}

export function planKeyframeSampleWindows(duration: number): KeyframeSampleWindow[] {
    if (!Number.isFinite(duration) || duration <= 0) return [];

    const windowLength = Math.min(duration, SAMPLE_WINDOW_SECONDS);
    const lastStart = duration - windowLength;
    const candidates = [
        { start: 0, end: windowLength },
        {
            start: Math.max(0, Math.min(lastStart, duration / 2 - SAMPLE_WINDOW_SECONDS / 2)),
            end: 0,
        },
        { start: lastStart, end: duration },
    ];
    candidates[1].end = Math.min(duration, candidates[1].start + windowLength);

    const sorted = candidates.sort((a, b) => a.start - b.start || a.end - b.end);
    const merged: KeyframeSampleWindow[] = [];
    for (const candidate of sorted) {
        const previous = merged[merged.length - 1];
        if (previous && candidate.start <= previous.end) {
            previous.end = Math.max(previous.end, candidate.end);
        } else {
            merged.push({ ...candidate });
        }
    }
    return merged;
}

export function parseKeyframePacketSample(
    output: string,
    fallbackWindow: KeyframeSampleWindow,
    startTime = 0,
): KeyframePacketSample {
    let parsed: unknown;
    try {
        parsed = JSON.parse(output);
    } catch {
        throw new Error('Invalid ffprobe packet JSON');
    }

    if (parsed === null || typeof parsed !== 'object' || !('packets' in parsed) || !Array.isArray(parsed.packets)) {
        throw new Error('ffprobe packet JSON is missing packets');
    }

    const offset = Number.isFinite(startTime) ? startTime : 0;
    const packetTimes: number[] = [];
    const keyframeTimes: number[] = [];
    for (const packet of parsed.packets) {
        if (packet === null || typeof packet !== 'object') continue;
        const ptsTime = finiteTimestamp('pts_time' in packet ? packet.pts_time : undefined);
        const timestamp = ptsTime ?? finiteTimestamp('dts_time' in packet ? packet.dts_time : undefined);
        if (timestamp === null) continue;

        const relativeTime = timestamp - offset;
        packetTimes.push(relativeTime);
        const flags = 'flags' in packet && typeof packet.flags === 'string' ? packet.flags : '';
        if (flags.includes('K') && !flags.includes('D') && !flags.includes('C')) keyframeTimes.push(relativeTime);
    }

    const validFallback =
        Number.isFinite(fallbackWindow.start) &&
        Number.isFinite(fallbackWindow.end) &&
        fallbackWindow.end >= fallbackWindow.start;
    if (packetTimes.length === 0) {
        const fallback = validFallback ? fallbackWindow : { start: 0, end: 0 };
        return { start: fallback.start, end: fallback.end, keyframeTimes: [] };
    }

    const packetRange = packetTimes.reduce(
        (range, timestamp) => ({ start: Math.min(range.start, timestamp), end: Math.max(range.end, timestamp) }),
        { start: Number.POSITIVE_INFINITY, end: Number.NEGATIVE_INFINITY },
    );
    return {
        start: packetRange.start,
        end: packetRange.end,
        keyframeTimes: [...new Set(keyframeTimes)].sort((a, b) => a - b),
    };
}

export function summarizeKeyframeSamples(samples: KeyframePacketSample[]): {
    averageInterval: number | null;
    minInterval: number | null;
    maxInterval: number | null;
    intervalCount: number;
    keyframeCount: number;
    sampledDuration: number;
    sampleWindows: Array<{ start: number; end: number; keyframeCount: number }>;
} {
    const intervals: number[] = [];
    const keyframes = new Set<number>();
    const sampleWindows: Array<{ start: number; end: number; keyframeCount: number }> = [];
    let sampledDuration = 0;

    for (const sample of samples) {
        if (!Number.isFinite(sample.start) || !Number.isFinite(sample.end) || sample.end < sample.start) continue;
        sampledDuration += sample.end - sample.start;
        const times = [...new Set(sample.keyframeTimes.filter(Number.isFinite))].sort((a, b) => a - b);
        for (const time of times) keyframes.add(time);
        for (let index = 1; index < times.length; index += 1) {
            const interval = times[index] - times[index - 1];
            if (interval > 0 && Number.isFinite(interval)) intervals.push(interval);
        }
        sampleWindows.push({ start: sample.start, end: sample.end, keyframeCount: times.length });
    }

    const intervalCount = intervals.length;
    const intervalSum = intervals.reduce((sum, interval) => sum + interval, 0);
    const intervalRange = intervals.reduce(
        (range, interval) => ({ min: Math.min(range.min, interval), max: Math.max(range.max, interval) }),
        { min: Number.POSITIVE_INFINITY, max: Number.NEGATIVE_INFINITY },
    );
    return {
        averageInterval: intervalCount > 0 ? intervalSum / intervalCount : null,
        minInterval: intervalCount > 0 ? intervalRange.min : null,
        maxInterval: intervalCount > 0 ? intervalRange.max : null,
        intervalCount,
        keyframeCount: keyframes.size,
        sampledDuration,
        sampleWindows,
    };
}
