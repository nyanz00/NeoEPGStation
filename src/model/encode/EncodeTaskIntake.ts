import { createHash } from 'crypto';
import * as os from 'os';
import * as path from 'path';
import { In } from 'typeorm';
import EncodeTask from '../../db/entities/EncodeTask.js';
import EncodeTaskSequence from '../../db/entities/EncodeTaskSequence.js';
import type IDBOperator from '../db/IDBOperator.js';
import type { AddEncodeOption, EncodeOption } from '../service/encode/IEncoderModel.js';

const MAX_ENCODE_ID = 0x7fffffff;
const MAX_TRANSACTION_ATTEMPTS = 20;
const ACTIVE_STATUSES = ['pending', 'waiting', 'scheduled'];

class RetryEncodeIntake extends Error {}

export function getEncodeOwnerFingerprint(): string {
    return createHash('sha256')
        .update(`${os.hostname()}\0${path.resolve(process.cwd())}`)
        .digest('hex');
}

/** Persists an encode request before any caller publishes it to the in-memory queue. */
export async function persistEncodeRequest(
    dbOperator: IDBOperator,
    option: AddEncodeOption,
    maxPending: number,
): Promise<EncodeOption> {
    if (!Number.isSafeInteger(maxPending) || maxPending < 0) {
        throw new RangeError('InvalidEncodeMaxPending');
    }

    const connection = await dbOperator.getConnection();

    for (let attempt = 0; attempt < MAX_TRANSACTION_ATTEMPTS; attempt++) {
        try {
            return await connection.transaction(async manager => {
                const sequenceRepository = manager.getRepository(EncodeTaskSequence);
                const taskRepository = manager.getRepository(EncodeTask);
                const sequence = await sequenceRepository.findOne({ where: { id: 1 } });
                if (sequence === null) {
                    throw new Error('EncodeTaskSequenceMissing');
                }

                const pendingCount = await taskRepository.count({ where: { status: In(ACTIVE_STATUSES) } });
                if (pendingCount >= maxPending) {
                    throw new Error('EncodeQueueFull');
                }

                const maxRow = await taskRepository
                    .createQueryBuilder('encodeTask')
                    .select('MAX(encodeTask.encodeId)', 'maxEncodeId')
                    .getRawOne<{ maxEncodeId: number | string | null }>();
                const currentMax = maxRow?.maxEncodeId == null ? 0 : Number(maxRow.maxEncodeId);
                const nextEncodeId = Number(sequence.nextEncodeId);
                if (
                    !Number.isSafeInteger(currentMax) ||
                    currentMax < 0 ||
                    !Number.isSafeInteger(nextEncodeId) ||
                    nextEncodeId < 1
                ) {
                    throw new Error('EncodeIdOverflow');
                }

                const encodeId = Math.max(nextEncodeId, currentMax + 1);
                // The sequence itself is a signed 32-bit integer; reserve its maximum value
                // as the exhausted marker so it can never wrap or be reused.
                if (encodeId >= MAX_ENCODE_ID) {
                    throw new Error('EncodeIdOverflow');
                }

                const persistedOption: EncodeOption = { ...option, encodeId };
                const now = Date.now();
                const updateResult = await sequenceRepository.update(
                    { id: 1, nextEncodeId: sequence.nextEncodeId },
                    { nextEncodeId: encodeId + 1 },
                );
                if (updateResult.affected !== 1) {
                    throw new RetryEncodeIntake('EncodeTaskSequenceConflict');
                }

                await taskRepository.insert({
                    encodeId,
                    optionJson: JSON.stringify(persistedOption),
                    status: 'pending',
                    position: encodeId,
                    ownerFingerprint: getEncodeOwnerFingerprint(),
                    startedAt: 0,
                    outputFilePath: null,
                    createdAt: now,
                    updatedAt: now,
                });
                return persistedOption;
            });
        } catch (error) {
            if (isRetryableIntakeError(error) === false) {
                throw error;
            }
            if (attempt === MAX_TRANSACTION_ATTEMPTS - 1) {
                throw error;
            }
        }
    }

    throw new Error('EncodeTaskIntakeRetryLimit');
}

function isRetryableIntakeError(error: unknown): boolean {
    if (error instanceof RetryEncodeIntake || isEncodeIdPrimaryKeyConflict(error) === true) {
        return true;
    }
    const driver = getDriverError(error);
    const code = driver?.code;
    return typeof code === 'string' && code.startsWith('SQLITE_BUSY');
}

function isEncodeIdPrimaryKeyConflict(error: unknown): boolean {
    const driver = getDriverError(error);
    if (driver === null) return false;
    const code = driver.code;
    const errno = driver.errno;
    const message = String(driver.message ?? '');

    if (code === 'SQLITE_CONSTRAINT_PRIMARYKEY') {
        return true;
    }
    if (
        (code === 'SQLITE_CONSTRAINT_UNIQUE' || code === 'SQLITE_CONSTRAINT') &&
        /constraint failed:\s*[^,]*[.]["`]?encodeId["`]?\s*$/i.test(message)
    ) {
        return true;
    }
    if ((code === 'ER_DUP_ENTRY' || errno === 1062) && /for key\s+["'`]?[^\s"'`]*PRIMARY["'`]?\s*$/i.test(message)) {
        return true;
    }
    return false;
}

function getDriverError(error: unknown): { code?: unknown; errno?: unknown; message?: unknown } | null {
    if (error == null || typeof error !== 'object') {
        return null;
    }

    const outer = error as { code?: unknown; errno?: unknown; message?: unknown; driverError?: unknown };
    return outer.driverError != null && typeof outer.driverError === 'object'
        ? (outer.driverError as { code?: unknown; errno?: unknown; message?: unknown })
        : outer;
}
