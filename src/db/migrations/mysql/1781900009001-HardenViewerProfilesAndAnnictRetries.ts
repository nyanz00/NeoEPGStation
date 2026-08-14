import { MigrationInterface, QueryRunner } from 'typeorm';

export class HardenViewerProfilesAndAnnictRetries1781900009001 implements MigrationInterface {
    name = 'HardenViewerProfilesAndAnnictRetries1781900009001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        const profileTable = await queryRunner.getTable('viewer_profile');
        if (
            profileTable !== undefined &&
            !profileTable.indices.some(index => index.name === 'IDX_viewer_profile_tv_user_id')
        ) {
            await queryRunner.query(
                'ALTER TABLE `viewer_profile` ADD UNIQUE INDEX `IDX_viewer_profile_tv_user_id` (`tvUserId`)',
            );
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'retryCount'))) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` ADD `retryCount` int NOT NULL DEFAULT 0');
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'nextRetryAt'))) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` ADD `nextRetryAt` bigint NULL');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('annict_episode_watch', 'nextRetryAt')) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` DROP COLUMN `nextRetryAt`');
        }
        if (await queryRunner.hasColumn('annict_episode_watch', 'retryCount')) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` DROP COLUMN `retryCount`');
        }
        const profileTable = await queryRunner.getTable('viewer_profile');
        if (profileTable?.indices.some(index => index.name === 'IDX_viewer_profile_tv_user_id')) {
            await queryRunner.query('ALTER TABLE `viewer_profile` DROP INDEX `IDX_viewer_profile_tv_user_id`');
        }
    }
}
