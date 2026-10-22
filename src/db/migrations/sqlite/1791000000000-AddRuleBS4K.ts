import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuleBS4K1791000000000 implements MigrationInterface {
    name = 'AddRuleBS4K1791000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('rule', 'BS4K'))) {
            await queryRunner.query('ALTER TABLE "rule" ADD "BS4K" boolean NOT NULL DEFAULT (0)');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('rule', 'BS4K')) {
            await queryRunner.query('ALTER TABLE "rule" DROP COLUMN "BS4K"');
        }
    }
}
