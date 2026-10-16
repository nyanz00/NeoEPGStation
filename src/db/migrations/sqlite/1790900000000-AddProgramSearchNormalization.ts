import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillProgramSearchNormalization, programSearchColumns } from '../ProgramSearchNormalization';

export class AddProgramSearchNormalization1790900000000 implements MigrationInterface {
    name = 'AddProgramSearchNormalization1790900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        for (const column of programSearchColumns) {
            if (!(await queryRunner.hasColumn('program', column))) {
                await queryRunner.query(`ALTER TABLE \`program\` ADD COLUMN \`${column}\` text NULL`);
            }
        }
        await backfillProgramSearchNormalization(queryRunner);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        for (const column of [...programSearchColumns].reverse()) {
            if (await queryRunner.hasColumn('program', column)) {
                await queryRunner.query(`ALTER TABLE \`program\` DROP COLUMN \`${column}\``);
            }
        }
    }
}
