import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenViewerProfilesAndAnnictRetries1781900009000 implements MigrationInterface {
    name = 'HardenViewerProfilesAndAnnictRetries1781900009000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const profileTable = await queryRunner.getTable('viewer_profile');
        if (
            profileTable !== undefined &&
            !profileTable.indices.some(index => index.name === 'IDX_viewer_profile_tv_user_id')
        ) {
            await queryRunner.query(
                `CREATE UNIQUE INDEX "IDX_viewer_profile_tv_user_id" ON "viewer_profile" ("tvUserId")`,
            );
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'retryCount'))) {
            await queryRunner.query('ALTER TABLE "annict_episode_watch" ADD "retryCount" integer NOT NULL DEFAULT (0)');
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'nextRetryAt'))) {
            await queryRunner.query('ALTER TABLE "annict_episode_watch" ADD "nextRetryAt" bigint');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('annict_episode_watch', 'nextRetryAt')) {
            await queryRunner.query('ALTER TABLE "annict_episode_watch" DROP COLUMN "nextRetryAt"');
        }
        if (await queryRunner.hasColumn('annict_episode_watch', 'retryCount')) {
            await queryRunner.query('ALTER TABLE "annict_episode_watch" DROP COLUMN "retryCount"');
        }
        const profileTable = await queryRunner.getTable('viewer_profile');
        if (profileTable?.indices.some(index => index.name === 'IDX_viewer_profile_tv_user_id')) {
            await queryRunner.query('DROP INDEX "IDX_viewer_profile_tv_user_id"');
        }
    }
}
