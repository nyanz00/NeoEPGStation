import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewerProfiles1781900000001 implements MigrationInterface {
    name = 'AddViewerProfiles1781900000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('viewer_profile'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE `viewer_profile` (`id` int NOT NULL AUTO_INCREMENT, `name` text NOT NULL,',
                    '`tvUserId` int NULL, `pinSalt` text NOT NULL, `pinHash` text NOT NULL,',
                    '`createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL,',
                    'UNIQUE INDEX `IDX_viewer_profile_tv_user_id` (`tvUserId`), PRIMARY KEY (`id`)) ENGINE=InnoDB',
                ].join(' '),
            );
        }
        if (!(await queryRunner.hasTable('viewer_credential'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE `viewer_credential` (`id` int NOT NULL AUTO_INCREMENT, `viewerProfileId` int NOT NULL,',
                    '`provider` varchar(64) NOT NULL, `encryptedValue` text NOT NULL, `iv` text NOT NULL,',
                    '`authTag` text NOT NULL, `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL,',
                    'UNIQUE INDEX `IDX_viewer_credential_profile_provider` (`viewerProfileId`, `provider`),',
                    'PRIMARY KEY (`id`)) ENGINE=InnoDB',
                ].join(' '),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('viewer_credential')) await queryRunner.query('DROP TABLE `viewer_credential`');
        if (await queryRunner.hasTable('viewer_profile')) await queryRunner.query('DROP TABLE `viewer_profile`');
    }
}
