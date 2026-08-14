import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnictEpisodeCompletion1781900005001 implements MigrationInterface {
    name = 'AddAnnictEpisodeCompletion1781900005001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'completionPending'))) {
            await queryRunner.query(
                'ALTER TABLE `annict_episode_watch` ADD `completionPending` tinyint NOT NULL DEFAULT 0',
            );
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'ruleDisablePending'))) {
            await queryRunner.query(
                'ALTER TABLE `annict_episode_watch` ADD `ruleDisablePending` tinyint NOT NULL DEFAULT 0',
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('annict_episode_watch', 'ruleDisablePending')) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` DROP COLUMN `ruleDisablePending`');
        }
        if (await queryRunner.hasColumn('annict_episode_watch', 'completionPending')) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` DROP COLUMN `completionPending`');
        }
    }
}
