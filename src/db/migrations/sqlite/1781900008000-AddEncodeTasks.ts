import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEncodeTasks1781900008000 implements MigrationInterface {
    name = 'AddEncodeTasks1781900008000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('encode_task'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE "encode_task" ("encodeId" integer PRIMARY KEY NOT NULL,',
                    '"optionJson" text NOT NULL, "status" varchar(32) NOT NULL, "position" integer NOT NULL,',
                    '"ownerFingerprint" varchar(64) NOT NULL, "startedAt" bigint NOT NULL,',
                    '"outputFilePath" text, "createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
                ].join(' '),
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('encode_task')) {
            await queryRunner.query('DROP TABLE "encode_task"');
        }
    }
}
