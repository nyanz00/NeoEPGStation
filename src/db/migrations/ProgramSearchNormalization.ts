import { QueryRunner } from 'typeorm';
import StrUtil from '../../util/StrUtil';

export const programSearchColumns = ['normalizedName', 'normalizedDescription', 'normalizedExtended'] as const;

interface LegacyProgramSearchRow {
    id: number | string;
    halfWidthName: string;
    halfWidthDescription: string | null;
    halfWidthExtended: string | null;
}

/** Backfill in small batches, retaining the original display and regular-expression fields. */
export async function backfillProgramSearchNormalization(queryRunner: QueryRunner): Promise<void> {
    let cursor: number | string | undefined;
    while (true) {
        const rows: LegacyProgramSearchRow[] = await queryRunner.query(
            'SELECT `id`, `halfWidthName`, `halfWidthDescription`, `halfWidthExtended` FROM `program` ' +
                'WHERE `normalizedName` IS NULL' +
                (cursor === undefined ? '' : ' AND `id` > ?') +
                ' ORDER BY `id` LIMIT 64',
            cursor === undefined ? [] : [cursor],
        );
        if (rows.length === 0) return;

        const parameters: Array<number | string | null> = [];
        const sourceColumns = ['halfWidthName', 'halfWidthDescription', 'halfWidthExtended'] as const;
        const assignments = programSearchColumns.map((column, index) => {
            const cases = rows.map(row => {
                const value = row[sourceColumns[index]];
                parameters.push(row.id, value === null ? null : StrUtil.normalizeSearch(value));
                return 'WHEN ? THEN ?';
            });
            return `\`${column}\` = CASE \`id\` ${cases.join(' ')} ELSE \`${column}\` END`;
        });
        parameters.push(...rows.map(row => row.id));
        await queryRunner.query(
            `UPDATE \`program\` SET ${assignments.join(', ')} WHERE \`normalizedName\` IS NULL AND \`id\` IN (${rows.map(() => '?').join(', ')})`,
            parameters,
        );
        cursor = rows[rows.length - 1].id;
    }
}
