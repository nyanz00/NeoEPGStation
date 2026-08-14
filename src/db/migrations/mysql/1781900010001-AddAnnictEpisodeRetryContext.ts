import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnictEpisodeRetryContext1781900010001 implements MigrationInterface {
    name = 'AddAnnictEpisodeRetryContext1781900010001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'explicitFinalEpisode'))) {
            await queryRunner.query(
                'ALTER TABLE `annict_episode_watch` ADD `explicitFinalEpisode` tinyint NOT NULL DEFAULT 0',
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('annict_episode_watch', 'explicitFinalEpisode')) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` DROP COLUMN `explicitFinalEpisode`');
        }
    }
}
