import * as fs from 'fs';

const TS_PACKET_SIZE = 188;
const PCR_CLOCK = 27000000;
const PCR_CYCLE_SECONDS = 2 ** 33 / 90000;
const HEAD_SCAN_LIMIT = 256 * 1024 * 1024;
const TAIL_SCAN_SIZE = 16 * 1024 * 1024;
const READ_CHUNK_SIZE = 1024 * 1024;
const SEEK_SCAN_WINDOW = 4 * 1024 * 1024;

export interface MpegTsTimeInfo {
    startAt: number;
    pcrDuration: number | null;
}

interface PcrValue {
    pid: number;
    seconds: number;
}

function packetPid(packet: Buffer): number {
    return ((packet[1] & 0x1f) << 8) | packet[2];
}

function packetPcr(packet: Buffer): number | null {
    const adaptationFieldControl = (packet[3] >> 4) & 0x03;
    if (adaptationFieldControl !== 2 && adaptationFieldControl !== 3) return null;

    const adaptationLength = packet[4];
    if (adaptationLength < 7 || (packet[5] & 0x10) === 0) return null;

    const pcrBase = packet[6] * 2 ** 25 + packet[7] * 2 ** 17 + packet[8] * 2 ** 9 + packet[9] * 2 + (packet[10] >> 7);
    const pcrExtension = ((packet[10] & 0x01) << 8) | packet[11];
    return (pcrBase * 300 + pcrExtension) / PCR_CLOCK;
}

function packetPayload(packet: Buffer): Buffer | null {
    const adaptationFieldControl = (packet[3] >> 4) & 0x03;
    if (adaptationFieldControl !== 1 && adaptationFieldControl !== 3) return null;

    const offset = adaptationFieldControl === 3 ? 5 + packet[4] : 4;
    return offset < TS_PACKET_SIZE ? packet.subarray(offset) : null;
}

function decodeBcd(value: number): number | null {
    const high = value >> 4;
    const low = value & 0x0f;
    return high <= 9 && low <= 9 ? high * 10 + low : null;
}

function decodeTotTime(section: Buffer): number | null {
    if (section.length < 8 || section[0] !== 0x73) return null;

    const mjd = (section[3] << 8) | section[4];
    const yearBase = Math.floor((mjd - 15078.2) / 365.25);
    const monthBase = Math.floor((mjd - 14956.1 - Math.floor(yearBase * 365.25)) / 30.6001);
    const day = mjd - 14956 - Math.floor(yearBase * 365.25) - Math.floor(monthBase * 30.6001);
    const correction = monthBase === 14 || monthBase === 15 ? 1 : 0;
    const year = yearBase + correction + 1900;
    const month = monthBase - 1 - correction * 12;
    const hour = decodeBcd(section[5]);
    const minute = decodeBcd(section[6]);
    const second = decodeBcd(section[7]);
    if (hour === null || minute === null || second === null || month < 1 || month > 12 || day < 1 || day > 31) {
        return null;
    }

    // ARIB STD-B10 のTOTは日本標準時で伝送されるため、JSTからUnix timeへ変換する。
    return Date.UTC(year, month - 1, day, hour, minute, second) - 9 * 60 * 60 * 1000;
}

function pcrDelta(start: number, end: number): number {
    return end >= start ? end - start : end + PCR_CYCLE_SECONDS - start;
}

async function scanPackets(
    filePath: string,
    start: number,
    end: number,
    onPacket: (packet: Buffer, offset: number) => boolean,
): Promise<void> {
    const file = await fs.promises.open(filePath, 'r');
    let position = start;
    let pending = Buffer.alloc(0);
    let pendingOffset = start;
    let synchronized = false;

    try {
        while (position < end) {
            const length = Math.min(READ_CHUNK_SIZE, end - position);
            const chunk = Buffer.allocUnsafe(length);
            const result = await file.read(chunk, 0, length, position);
            if (result.bytesRead === 0) break;
            if (pending.length === 0) pendingOffset = position;
            position += result.bytesRead;
            pending = Buffer.concat([pending, chunk.subarray(0, result.bytesRead)]);

            while (true) {
                if (synchronized === false) {
                    let syncOffset = -1;
                    for (let index = 0; index + TS_PACKET_SIZE * 2 < pending.length; index++) {
                        if (
                            pending[index] === 0x47 &&
                            pending[index + TS_PACKET_SIZE] === 0x47 &&
                            pending[index + TS_PACKET_SIZE * 2] === 0x47
                        ) {
                            syncOffset = index;
                            break;
                        }
                    }
                    if (syncOffset < 0) {
                        const retainedOffset = Math.max(0, pending.length - TS_PACKET_SIZE * 2);
                        pending = pending.subarray(retainedOffset);
                        pendingOffset += retainedOffset;
                        break;
                    }
                    pending = pending.subarray(syncOffset);
                    pendingOffset += syncOffset;
                    synchronized = true;
                }

                if (pending.length < TS_PACKET_SIZE) break;
                if (pending[0] !== 0x47) {
                    pending = pending.subarray(1);
                    pendingOffset++;
                    synchronized = false;
                    continue;
                }

                const packet = pending.subarray(0, TS_PACKET_SIZE);
                const packetOffset = pendingOffset;
                pending = pending.subarray(TS_PACKET_SIZE);
                pendingOffset += TS_PACKET_SIZE;
                if (onPacket(packet, packetOffset) === true) return;
            }
        }
    } finally {
        await file.close();
    }
}

/**
 * Finds a transport-stream packet close to the requested media time by PCR.
 * Unlike a file-size ratio, PCR remains accurate for variable-bitrate recordings.
 */
export async function findMpegTsByteOffset(filePath: string, targetSeconds: number): Promise<number | null> {
    if (!Number.isFinite(targetSeconds) || targetSeconds <= 0) return 0;
    const stat = await fs.promises.stat(filePath);
    if (stat.size < TS_PACKET_SIZE * 3) return null;

    let firstPcr: PcrValue | null = null;
    await scanPackets(filePath, 0, Math.min(stat.size, SEEK_SCAN_WINDOW), packet => {
        const pcr = packetPcr(packet);
        if (pcr === null) return false;
        firstPcr = { pid: packetPid(packet), seconds: pcr };
        return true;
    });
    const reference = firstPcr as PcrValue | null;
    if (reference === null) return null;

    let lower = 0;
    let upper = stat.size;
    let bestOffset = 0;
    for (let iteration = 0; iteration < 24 && upper - lower > SEEK_SCAN_WINDOW / 4; iteration++) {
        const scanStart = Math.floor((lower + upper) / 2);
        let sample: { offset: number; elapsed: number } | null = null;
        await scanPackets(filePath, scanStart, Math.min(stat.size, scanStart + SEEK_SCAN_WINDOW), (packet, offset) => {
            if (packetPid(packet) !== reference.pid) return false;
            const pcr = packetPcr(packet);
            if (pcr === null) return false;
            sample = { offset, elapsed: pcrDelta(reference.seconds, pcr) };
            return true;
        });
        const resolvedSample = sample as { offset: number; elapsed: number } | null;
        if (resolvedSample === null) {
            upper = scanStart;
        } else if (resolvedSample.elapsed <= targetSeconds) {
            bestOffset = resolvedSample.offset;
            lower = resolvedSample.offset + TS_PACKET_SIZE;
        } else {
            upper = scanStart;
        }
    }

    const finalEnd = Math.min(stat.size, Math.max(upper, bestOffset + SEEK_SCAN_WINDOW));
    await scanPackets(filePath, bestOffset, finalEnd, (packet, offset) => {
        if (packetPid(packet) !== reference.pid) return false;
        const pcr = packetPcr(packet);
        if (pcr === null) return false;
        if (pcrDelta(reference.seconds, pcr) > targetSeconds) return true;
        bestOffset = offset;
        return false;
    });

    return bestOffset;
}

/**
 * KonomiTVと同じく、TS内のPCRとTOTを対応付けて録画開始日時を算出する。
 */
export async function analyzeMpegTsTime(filePath: string): Promise<MpegTsTimeInfo | null> {
    const stat = await fs.promises.stat(filePath);
    if (stat.size < TS_PACKET_SIZE * 3) return null;

    let firstPcr: PcrValue | null = null;
    let currentPcr: number | null = null;
    let totPcr: number | null = null;
    let totTime: number | null = null;
    let sectionBuffer = Buffer.alloc(0);
    let sectionStartPcr: number | null = null;

    const consumeSections = (): void => {
        while (sectionBuffer.length >= 3 && sectionBuffer[0] !== 0xff) {
            const sectionLength = ((sectionBuffer[1] & 0x0f) << 8) | sectionBuffer[2];
            const totalLength = sectionLength + 3;
            if (sectionBuffer.length < totalLength) return;
            const decoded = decodeTotTime(sectionBuffer.subarray(0, totalLength));
            if (decoded !== null && sectionStartPcr !== null) {
                totTime = decoded;
                totPcr = sectionStartPcr;
                return;
            }
            sectionBuffer = sectionBuffer.subarray(totalLength);
            sectionStartPcr = currentPcr;
        }
        if (sectionBuffer[0] === 0xff) sectionBuffer = Buffer.alloc(0);
    };

    await scanPackets(filePath, 0, Math.min(stat.size, HEAD_SCAN_LIMIT), packet => {
        const pid = packetPid(packet);
        const pcr = packetPcr(packet);
        if (pcr !== null) {
            if (firstPcr === null) firstPcr = { pid, seconds: pcr };
            if (firstPcr.pid === pid) currentPcr = pcr;
        }

        if (pid !== 0x14) return false;
        const payload = packetPayload(packet);
        if (payload === null || payload.length === 0) return false;

        if ((packet[1] & 0x40) !== 0) {
            const pointer = payload[0];
            if (pointer + 1 > payload.length) {
                sectionBuffer = Buffer.alloc(0);
                return false;
            }
            if (sectionBuffer.length > 0 && pointer > 0) {
                sectionBuffer = Buffer.concat([sectionBuffer, payload.subarray(1, pointer + 1)]);
                consumeSections();
            }
            sectionBuffer = Buffer.from(payload.subarray(pointer + 1));
            sectionStartPcr = currentPcr;
            consumeSections();
        } else if (sectionBuffer.length > 0) {
            sectionBuffer = Buffer.concat([sectionBuffer, payload]);
            consumeSections();
        }

        return firstPcr !== null && totTime !== null && totPcr !== null;
    });

    const resolvedFirstPcr = firstPcr as PcrValue | null;
    const resolvedTotTime = totTime as number | null;
    const resolvedTotPcr = totPcr as number | null;
    if (resolvedFirstPcr === null || resolvedTotTime === null || resolvedTotPcr === null) return null;

    let lastPcr: number | null = null;
    await scanPackets(filePath, Math.max(0, stat.size - TAIL_SCAN_SIZE), stat.size, packet => {
        if (packetPid(packet) === resolvedFirstPcr.pid) {
            const pcr = packetPcr(packet);
            if (pcr !== null) lastPcr = pcr;
        }
        return false;
    });

    return {
        startAt: resolvedTotTime - pcrDelta(resolvedFirstPcr.seconds, resolvedTotPcr) * 1000,
        pcrDuration: lastPcr === null ? null : pcrDelta(resolvedFirstPcr.seconds, lastPcr),
    };
}
