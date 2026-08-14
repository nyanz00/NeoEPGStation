import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewerProfileSessions1781900001000 implements MigrationInterface {
    name = 'AddViewerProfileSessions1781900001000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('viewer_profile_session')) return;
        await queryRunner.query(
            [
                'CREATE TABLE "viewer_profile_session" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,',
                '"viewerProfileId" integer NOT NULL, "tokenHash" text NOT NULL, "createdAt" bigint NOT NULL)',
            ].join(' '),
        );
        await queryRunner.query(
            'CREATE UNIQUE INDEX "IDX_viewer_profile_session_token" ON "viewer_profile_session" ("tokenHash")',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('viewer_profile_session')) {
            await queryRunner.query('DROP TABLE "viewer_profile_session"');
        }
    }
}
