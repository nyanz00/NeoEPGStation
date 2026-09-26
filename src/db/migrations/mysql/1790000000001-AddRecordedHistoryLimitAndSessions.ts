import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordedHistoryLimitAndSessions1790000000001 implements MigrationInterface {
    name = 'AddRecordedHistoryLimitAndSessions1790000000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('tv_user', 'recordedHistoryLimit'))) {
            await queryRunner.query('ALTER TABLE `tv_user` ADD `recordedHistoryLimit` int NOT NULL DEFAULT 50');
        }
        if (!(await queryRunner.hasColumn('recorded_playback', 'watchedSessions'))) {
            await queryRunner.query('ALTER TABLE `recorded_playback` ADD `watchedSessions` text NULL');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('recorded_playback', 'watchedSessions')) {
            await queryRunner.query('ALTER TABLE `recorded_playback` DROP COLUMN `watchedSessions`');
        }
        if (await queryRunner.hasColumn('tv_user', 'recordedHistoryLimit')) {
            await queryRunner.query('ALTER TABLE `tv_user` DROP COLUMN `recordedHistoryLimit`');
        }
    }
}
