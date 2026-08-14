import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordedPlaybacks1781900004000 implements MigrationInterface {
    name = 'AddRecordedPlaybacks1781900004000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('recorded_playback'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE "recorded_playback" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,',
                    '"recordedId" integer NOT NULL, "userId" integer NOT NULL, "position" double NOT NULL,',
                    '"duration" double NOT NULL, "watchedSeconds" double NOT NULL, "lastObservedAt" bigint NOT NULL,',
                    '"createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
                ].join(' '),
            );
            await queryRunner.query(
                'CREATE UNIQUE INDEX "IDX_recorded_playback_recorded_user" ON "recorded_playback" ("recordedId", "userId")',
            );
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'workAnnictId'))) {
            await queryRunner.query('ALTER TABLE "annict_episode_watch" ADD "workAnnictId" integer');
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'statusSyncPending'))) {
            await queryRunner.query(
                'ALTER TABLE "annict_episode_watch" ADD "statusSyncPending" boolean NOT NULL DEFAULT (0)',
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('recorded_playback')) {
            await queryRunner.query('DROP TABLE "recorded_playback"');
        }
        if (await queryRunner.hasColumn('annict_episode_watch', 'statusSyncPending')) {
            await queryRunner.query('ALTER TABLE "annict_episode_watch" DROP COLUMN "statusSyncPending"');
        }
        if (await queryRunner.hasColumn('annict_episode_watch', 'workAnnictId')) {
            await queryRunner.query('ALTER TABLE "annict_episode_watch" DROP COLUMN "workAnnictId"');
        }
    }
}
