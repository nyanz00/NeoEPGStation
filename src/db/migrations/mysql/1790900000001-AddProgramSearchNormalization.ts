import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillProgramSearchNormalization, programSearchColumns } from '../ProgramSearchNormalization';

export class AddProgramSearchNormalization1790900000001 implements MigrationInterface {
    name = 'AddProgramSearchNormalization1790900000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const additions: string[] = [];
        for (const column of programSearchColumns) {
            if (!(await queryRunner.hasColumn('program', column))) additions.push(`ADD COLUMN \`${column}\` text NULL`);
        }
        if (additions.length > 0) await queryRunner.query(`ALTER TABLE \`program\` ${additions.join(', ')}`);
        await backfillProgramSearchNormalization(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        const removals: string[] = [];
        for (const column of [...programSearchColumns].reverse()) {
            if (await queryRunner.hasColumn('program', column)) removals.push(`DROP COLUMN \`${column}\``);
        }
        if (removals.length > 0) await queryRunner.query(`ALTER TABLE \`program\` ${removals.join(', ')}`);
    }
}
