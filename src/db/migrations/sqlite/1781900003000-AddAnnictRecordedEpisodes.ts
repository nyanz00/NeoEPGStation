import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnictRecordedEpisodes1781900003000 implements MigrationInterface {
    name = 'AddAnnictRecordedEpisodes1781900003000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('annict_recorded_episode'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE "annict_recorded_episode" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,',
                    '"recordedId" integer NOT NULL, "annictId" integer NOT NULL, "programAnnictId" integer,',
                    '"episodeAnnictId" integer, "episodeNumber" integer, "episodeNumberText" text, "episodeTitle" text,',
                    '"status" text NOT NULL, "pendingReason" text, "lastCheckedAt" bigint, "matchedAt" bigint,',
                    '"createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
                ].join(' '),
            );
            await queryRunner.query(
                'CREATE UNIQUE INDEX "IDX_annict_recorded_episode_recorded" ON "annict_recorded_episode" ("recordedId")',
            );
            await queryRunner.query(
                'CREATE INDEX "IDX_annict_recorded_episode_work_episode" ON "annict_recorded_episode" ("annictId", "episodeAnnictId")',
            );
        }
        if (!(await queryRunner.hasTable('annict_episode_watch'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE "annict_episode_watch" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,',
                    '"episodeAnnictId" integer NOT NULL, "viewerProfileId" integer NOT NULL, "annictRecordId" integer,',
                    '"status" text NOT NULL, "lastError" text, "watchedAt" bigint,',
                    '"createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
                ].join(' '),
            );
            await queryRunner.query(
                'CREATE UNIQUE INDEX "IDX_annict_episode_watch_episode_profile" ON "annict_episode_watch" ("episodeAnnictId", "viewerProfileId")',
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('annict_episode_watch')) {
            await queryRunner.query('DROP TABLE "annict_episode_watch"');
        }
        if (await queryRunner.hasTable('annict_recorded_episode')) {
            await queryRunner.query('DROP TABLE "annict_recorded_episode"');
        }
    }
}
