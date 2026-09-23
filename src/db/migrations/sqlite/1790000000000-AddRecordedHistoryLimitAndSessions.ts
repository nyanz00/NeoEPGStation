import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordedHistoryLimitAndSessions1790000000000 implements MigrationInterface {
    name = 'AddRecordedHistoryLimitAndSessions1790000000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('tv_user', 'recordedHistoryLimit'))) {
            await queryRunner.query('ALTER TABLE "tv_user" ADD "recordedHistoryLimit" integer NOT NULL DEFAULT (50)');
        }
        if (!(await queryRunner.hasColumn('recorded_playback', 'watchedSessions'))) {
            await queryRunner.query('ALTER TABLE "recorded_playback" ADD "watchedSessions" text');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('recorded_playback', 'watchedSessions')) {
            await queryRunner.query('ALTER TABLE "recorded_playback" DROP COLUMN "watchedSessions"');
        }
        if (await queryRunner.hasColumn('tv_user', 'recordedHistoryLimit')) {
            await queryRunner.query('ALTER TABLE "tv_user" DROP COLUMN "recordedHistoryLimit"');
        }
    }
}
