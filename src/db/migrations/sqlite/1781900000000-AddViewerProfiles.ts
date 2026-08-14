import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewerProfiles1781900000000 implements MigrationInterface {
    name = 'AddViewerProfiles1781900000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasTable('viewer_profile'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE "viewer_profile" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,',
                    '"name" text NOT NULL, "tvUserId" integer, "pinSalt" text NOT NULL,',
                    '"pinHash" text NOT NULL, "createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
                ].join(' '),
            );
            await queryRunner.query(
                `CREATE UNIQUE INDEX "IDX_viewer_profile_tv_user_id" ON "viewer_profile" ("tvUserId")`,
            );
        }
        if (!(await queryRunner.hasTable('viewer_credential'))) {
            await queryRunner.query(
                [
                    'CREATE TABLE "viewer_credential" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL,',
                    '"viewerProfileId" integer NOT NULL, "provider" text NOT NULL, "encryptedValue" text NOT NULL,',
                    '"iv" text NOT NULL, "authTag" text NOT NULL, "createdAt" bigint NOT NULL, "updatedAt" bigint NOT NULL)',
                ].join(' '),
            );
            await queryRunner.query(
                `CREATE UNIQUE INDEX "IDX_viewer_credential_profile_provider" ON "viewer_credential" ("viewerProfileId", "provider")`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('viewer_credential')) await queryRunner.query(`DROP TABLE "viewer_credential"`);
        if (await queryRunner.hasTable('viewer_profile')) await queryRunner.query(`DROP TABLE "viewer_profile"`);
    }
}
