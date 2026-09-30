import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUserAdmin1790100000000 implements MigrationInterface {
    name = 'AddUserAdmin1790100000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (!(await queryRunner.hasColumn('tv_user', 'isAdmin'))) {
            await queryRunner.query('ALTER TABLE "tv_user" ADD "isAdmin" boolean NOT NULL DEFAULT (0)');
        }
        await queryRunner.query(
            'UPDATE "tv_user" SET "isAdmin" = 1 WHERE "id" = (SELECT MIN("id") FROM "tv_user") AND NOT EXISTS (SELECT 1 FROM "tv_user" WHERE "isAdmin" = 1)',
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasColumn('tv_user', 'isAdmin')) {
            await queryRunner.query('ALTER TABLE "tv_user" DROP COLUMN "isAdmin"');
        }
    }
}
