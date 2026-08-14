import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewerProfileSessions1781900001001 implements MigrationInterface {
    name = 'AddViewerProfileSessions1781900001001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('viewer_profile_session')) return;
        await queryRunner.query(
            [
                'CREATE TABLE `viewer_profile_session` (`id` int NOT NULL AUTO_INCREMENT,',
                '`viewerProfileId` int NOT NULL, `tokenHash` varchar(64) NOT NULL, `createdAt` bigint NOT NULL,',
                'UNIQUE INDEX `IDX_viewer_profile_session_token` (`tokenHash`),',
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
            ].join(' '),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('viewer_profile_session')) {
            await queryRunner.query('DROP TABLE `viewer_profile_session`');
        }
    }
}
