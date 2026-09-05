import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEncodeStartDelay1781900011001 implements MigrationInterface {
    name = 'AddEncodeStartDelay1781900011001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('rule', 'encodeStartDelayMinutes'))) {
            await queryRunner.query('ALTER TABLE `rule` ADD `encodeStartDelayMinutes` int NOT NULL DEFAULT 0');
        }
        if (!(await queryRunner.hasColumn('reserve', 'encodeStartDelayMinutes'))) {
            await queryRunner.query('ALTER TABLE `reserve` ADD `encodeStartDelayMinutes` int NOT NULL DEFAULT 0');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('reserve', 'encodeStartDelayMinutes')) {
            await queryRunner.query('ALTER TABLE `reserve` DROP COLUMN `encodeStartDelayMinutes`');
        }
        if (await queryRunner.hasColumn('rule', 'encodeStartDelayMinutes')) {
            await queryRunner.query('ALTER TABLE `rule` DROP COLUMN `encodeStartDelayMinutes`');
        }
    }
}
