import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEncodeTasks1781900008001 implements MigrationInterface {
    name = 'AddEncodeTasks1781900008001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('encode_task'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE `encode_task` (`encodeId` int NOT NULL, `optionJson` longtext NOT NULL,',
                    '`status` varchar(32) NOT NULL, `position` int NOT NULL,',
                    '`ownerFingerprint` varchar(64) NOT NULL, `startedAt` bigint NOT NULL,',
                    '`outputFilePath` text NULL, `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL,',
                    'PRIMARY KEY (`encodeId`)) ENGINE=InnoDB',
                ].join(' '),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('encode_task')) {
            await queryRunner.query('DROP TABLE `encode_task`');
        }
    }
}
