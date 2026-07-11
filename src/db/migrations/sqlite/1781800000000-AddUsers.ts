import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddUsers1781800000000 implements MigrationInterface {
    name = 'AddUsers1781800000000';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if ((await queryRunner.hasTable('tv_user')) === false) {
            await queryRunner.query(
                `CREATE TABLE "tv_user" ("id" integer PRIMARY KEY AUTOINCREMENT NOT NULL, "name" text NOT NULL, "createdAt" bigint NOT NULL)`,
            );
        }

        const users = await queryRunner.query('SELECT "id" FROM "tv_user" LIMIT 1');
        if (users.length === 0) {
            await queryRunner.query(`INSERT INTO "tv_user" ("name", "createdAt") VALUES ('user1', ?)`, [Date.now()]);
        }

        if ((await queryRunner.hasColumn('rule', 'userId')) === false) {
            await queryRunner.query(`ALTER TABLE "rule" ADD "userId" integer`);
        }
        if ((await queryRunner.hasColumn('reserve', 'userId')) === false) {
            await queryRunner.query(`ALTER TABLE "reserve" ADD "userId" integer`);
        }
        if ((await queryRunner.hasColumn('recorded', 'userId')) === false) {
            await queryRunner.query(`ALTER TABLE "recorded" ADD "userId" integer`);
        }

        await queryRunner.query(`UPDATE "rule" SET "userId" = 1 WHERE "userId" IS NULL`);
        await queryRunner.query(`UPDATE "reserve" SET "userId" = 1 WHERE "userId" IS NULL`);
        await queryRunner.query(`UPDATE "recorded" SET "userId" = 1 WHERE "userId" IS NULL`);
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if ((await queryRunner.hasColumn('recorded', 'userId')) === true) {
            await queryRunner.query(`ALTER TABLE "recorded" DROP COLUMN "userId"`);
        }
        if ((await queryRunner.hasColumn('reserve', 'userId')) === true) {
            await queryRunner.query(`ALTER TABLE "reserve" DROP COLUMN "userId"`);
        }
        if ((await queryRunner.hasColumn('rule', 'userId')) === true) {
            await queryRunner.query(`ALTER TABLE "rule" DROP COLUMN "userId"`);
        }
        if ((await queryRunner.hasTable('tv_user')) === true) {
            await queryRunner.query(`DROP TABLE "tv_user"`);
        }
    }
}
