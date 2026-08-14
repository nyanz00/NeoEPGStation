import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordedHistorySettings1781900007001 implements MigrationInterface {
    name = 'AddRecordedHistorySettings1781900007001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('tv_user', 'isRecordedHistoryEnabled'))) {
            await queryRunner.query('ALTER TABLE `tv_user` ADD `isRecordedHistoryEnabled` tinyint NOT NULL DEFAULT 1');
        }
        if (!(await queryRunner.hasColumn('recorded_playback', 'historyUpdatedAt'))) {
            await queryRunner.query('ALTER TABLE `recorded_playback` ADD `historyUpdatedAt` bigint NULL');
            await queryRunner.query('UPDATE `recorded_playback` SET `historyUpdatedAt` = `updatedAt`');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('recorded_playback', 'historyUpdatedAt')) {
            await queryRunner.query('ALTER TABLE `recorded_playback` DROP COLUMN `historyUpdatedAt`');
        }
        if (await queryRunner.hasColumn('tv_user', 'isRecordedHistoryEnabled')) {
            await queryRunner.query('ALTER TABLE `tv_user` DROP COLUMN `isRecordedHistoryEnabled`');
        }
    }
}
