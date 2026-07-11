import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuleEncodeChannelIds1781600000001 implements MigrationInterface {
    name = 'AddRuleEncodeChannelIds1781600000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if ((await queryRunner.hasColumn('rule', 'encodeChannelId1')) === false) {
            await queryRunner.query('ALTER TABLE `rule` ADD `encodeChannelId1` bigint NULL');
        }
        if ((await queryRunner.hasColumn('rule', 'encodeChannelId2')) === false) {
            await queryRunner.query('ALTER TABLE `rule` ADD `encodeChannelId2` bigint NULL');
        }
        if ((await queryRunner.hasColumn('rule', 'encodeChannelId3')) === false) {
            await queryRunner.query('ALTER TABLE `rule` ADD `encodeChannelId3` bigint NULL');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if ((await queryRunner.hasColumn('rule', 'encodeChannelId3')) === true) {
            await queryRunner.query('ALTER TABLE `rule` DROP COLUMN `encodeChannelId3`');
        }
        if ((await queryRunner.hasColumn('rule', 'encodeChannelId2')) === true) {
            await queryRunner.query('ALTER TABLE `rule` DROP COLUMN `encodeChannelId2`');
        }
        if ((await queryRunner.hasColumn('rule', 'encodeChannelId1')) === true) {
            await queryRunner.query('ALTER TABLE `rule` DROP COLUMN `encodeChannelId1`');
        }
    }
}
