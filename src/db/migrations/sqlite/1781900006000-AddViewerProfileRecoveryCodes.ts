import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddViewerProfileRecoveryCodes1781900006000 implements MigrationInterface {
    name = 'AddViewerProfileRecoveryCodes1781900006000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('viewer_profile', 'recoveryCodeSalt'))) {
            await queryRunner.query('ALTER TABLE "viewer_profile" ADD "recoveryCodeSalt" text NOT NULL DEFAULT \'\'');
        }
        if (!(await queryRunner.hasColumn('viewer_profile', 'recoveryCodeHash'))) {
            await queryRunner.query('ALTER TABLE "viewer_profile" ADD "recoveryCodeHash" text NOT NULL DEFAULT \'\'');
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('viewer_profile', 'recoveryCodeHash')) {
            await queryRunner.query('ALTER TABLE "viewer_profile" DROP COLUMN "recoveryCodeHash"');
        }
        if (await queryRunner.hasColumn('viewer_profile', 'recoveryCodeSalt')) {
            await queryRunner.query('ALTER TABLE "viewer_profile" DROP COLUMN "recoveryCodeSalt"');
        }
    }
}
