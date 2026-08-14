import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnictRecordedEpisodes1781900003001 implements MigrationInterface {
    name = 'AddAnnictRecordedEpisodes1781900003001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('annict_recorded_episode'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE `annict_recorded_episode` (`id` int NOT NULL AUTO_INCREMENT,',
                    '`recordedId` int NOT NULL, `annictId` int NOT NULL, `programAnnictId` int NULL,',
                    '`episodeAnnictId` int NULL, `episodeNumber` int NULL, `episodeNumberText` text NULL,',
                    '`episodeTitle` text NULL, `status` varchar(32) NOT NULL, `pendingReason` varchar(64) NULL,',
                    '`lastCheckedAt` bigint NULL, `matchedAt` bigint NULL, `createdAt` bigint NOT NULL,',
                    '`updatedAt` bigint NOT NULL,',
                    'UNIQUE INDEX `IDX_annict_recorded_episode_recorded` (`recordedId`),',
                    'INDEX `IDX_annict_recorded_episode_work_episode` (`annictId`, `episodeAnnictId`),',
                    'PRIMARY KEY (`id`)) ENGINE=InnoDB',
                ].join(' '),
            );
        }
        if (!(await queryRunner.hasTable('annict_episode_watch'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE `annict_episode_watch` (`id` int NOT NULL AUTO_INCREMENT,',
                    '`episodeAnnictId` int NOT NULL, `viewerProfileId` int NOT NULL, `annictRecordId` int NULL,',
                    '`status` varchar(32) NOT NULL, `lastError` text NULL, `watchedAt` bigint NULL,',
                    '`createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL,',
                    'UNIQUE INDEX `IDX_annict_episode_watch_episode_profile` (`episodeAnnictId`, `viewerProfileId`),',
                    'PRIMARY KEY (`id`)) ENGINE=InnoDB',
                ].join(' '),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('annict_episode_watch')) {
            await queryRunner.query('DROP TABLE `annict_episode_watch`');
        }
        if (await queryRunner.hasTable('annict_recorded_episode')) {
            await queryRunner.query('DROP TABLE `annict_recorded_episode`');
        }
    }
}
