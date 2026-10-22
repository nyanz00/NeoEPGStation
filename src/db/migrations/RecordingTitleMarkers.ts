import { QueryRunner } from 'typeorm';
import StrUtil from '../../util/StrUtil';

/** Refresh stored comparison names without changing display titles or deleting history. */
export async function backfillRecordingTitleMarkers(runner: QueryRunner): Promise<void> {
    let cursor: number | string = -1;
    for (;;) {
        const rows: Array<{ id: number | string; halfWidthName: string }> = await runner.query(
            'SELECT `id`, `halfWidthName` FROM `program` WHERE `id` > ? ORDER BY `id` LIMIT 64',
            [cursor],
        );
        if (rows.length === 0) break;
        for (const row of rows) {
            await runner.query('UPDATE `program` SET `shortName` = ? WHERE `id` = ?', [
                StrUtil.deleteBrackets(row.halfWidthName),
                row.id,
            ]);
        }
        cursor = rows[rows.length - 1].id;
    }
    cursor = -1;
    for (;;) {
        const rows: Array<{ id: number | string; name: string; channelId: number | string; endAt: number | string }> =
            await runner.query(
                'SELECT `id`, `name`, `channelId`, `endAt` FROM `recorded_history` WHERE `id` > ? ORDER BY `id` LIMIT 64',
                [cursor],
            );
        if (rows.length === 0) break;
        const recordings: Array<{ halfWidthName: string; channelId: number | string; endAt: number | string }> =
            await runner.query(
                'SELECT `halfWidthName`, `channelId`, `endAt` FROM `recorded` WHERE ' +
                    rows.map(() => '(`channelId` = ? AND `endAt` = ?)').join(' OR '),
                rows.flatMap(row => [row.channelId, row.endAt]),
            );
        for (const row of rows) {
            const names = new Set(
                recordings
                    .filter(
                        source =>
                            String(source.channelId) === String(row.channelId) &&
                            String(source.endAt) === String(row.endAt),
                    )
                    .map(source => StrUtil.deleteBrackets(source.halfWidthName))
                    .filter(name => name === row.name || name.replace(/(?:\[前\])?(?:\[後\])?$/, '') === row.name),
            );
            // If the original recording was deleted or is ambiguous, retain its history.
            if (names.size === 1)
                await runner.query('UPDATE `recorded_history` SET `name` = ? WHERE `id` = ?', [[...names][0], row.id]);
        }
        cursor = rows[rows.length - 1].id;
    }
}
