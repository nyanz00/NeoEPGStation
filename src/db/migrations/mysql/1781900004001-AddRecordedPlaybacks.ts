import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRecordedPlaybacks1781900004001 implements MigrationInterface {
    name = 'AddRecordedPlaybacks1781900004001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('recorded_playback'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE `recorded_playback` (`id` int NOT NULL AUTO_INCREMENT,',
                    '`recordedId` int NOT NULL, `userId` int NOT NULL, `position` double NOT NULL,',
                    '`duration` double NOT NULL, `watchedSeconds` double NOT NULL, `lastObservedAt` bigint NOT NULL,',
                    '`createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL,',
                    'UNIQUE INDEX `IDX_recorded_playback_recorded_user` (`recordedId`, `userId`),',
                    'PRIMARY KEY (`id`)) ENGINE=InnoDB',
                ].join(' '),
            );
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'workAnnictId'))) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` ADD `workAnnictId` int NULL');
        }
        if (!(await queryRunner.hasColumn('annict_episode_watch', 'statusSyncPending'))) {
            await queryRunner.query(
                'ALTER TABLE `annict_episode_watch` ADD `statusSyncPending` tinyint NOT NULL DEFAULT 0',
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('recorded_playback')) {
            await queryRunner.query('DROP TABLE `recorded_playback`');
        }
        if (await queryRunner.hasColumn('annict_episode_watch', 'statusSyncPending')) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` DROP COLUMN `statusSyncPending`');
        }
        if (await queryRunner.hasColumn('annict_episode_watch', 'workAnnictId')) {
            await queryRunner.query('ALTER TABLE `annict_episode_watch` DROP COLUMN `workAnnictId`');
        }
    }
}
