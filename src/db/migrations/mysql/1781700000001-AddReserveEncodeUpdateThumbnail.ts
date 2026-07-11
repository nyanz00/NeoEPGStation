import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddReserveEncodeUpdateThumbnail1781700000001 implements MigrationInterface {
    name = 'AddReserveEncodeUpdateThumbnail1781700000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if ((await queryRunner.hasColumn('rule', 'updateThumbnail')) === false) {
            await queryRunner.query('ALTER TABLE `rule` ADD `updateThumbnail` tinyint NOT NULL DEFAULT 0');
        }
        if ((await queryRunner.hasColumn('reserve', 'updateThumbnail')) === false) {
            await queryRunner.query('ALTER TABLE `reserve` ADD `updateThumbnail` tinyint NOT NULL DEFAULT 0');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if ((await queryRunner.hasColumn('reserve', 'updateThumbnail')) === true) {
            await queryRunner.query('ALTER TABLE `reserve` DROP COLUMN `updateThumbnail`');
        }
        if ((await queryRunner.hasColumn('rule', 'updateThumbnail')) === true) {
            await queryRunner.query('ALTER TABLE `rule` DROP COLUMN `updateThumbnail`');
        }
    }
}
