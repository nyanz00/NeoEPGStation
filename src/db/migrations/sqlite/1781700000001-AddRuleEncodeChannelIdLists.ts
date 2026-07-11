import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddRuleEncodeChannelIdLists1781700000001 implements MigrationInterface {
    name = 'AddRuleEncodeChannelIdLists1781700000001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if ((await queryRunner.hasColumn('rule', 'encodeChannelIds1')) === false) {
            await queryRunner.query(`ALTER TABLE "rule" ADD "encodeChannelIds1" text`);
            await queryRunner.query(
                `UPDATE "rule" SET "encodeChannelIds1" = '[' || "encodeChannelId1" || ']' WHERE "encodeChannelId1" IS NOT NULL`,
            );
        }
        if ((await queryRunner.hasColumn('rule', 'encodeChannelIds2')) === false) {
            await queryRunner.query(`ALTER TABLE "rule" ADD "encodeChannelIds2" text`);
            await queryRunner.query(
                `UPDATE "rule" SET "encodeChannelIds2" = '[' || "encodeChannelId2" || ']' WHERE "encodeChannelId2" IS NOT NULL`,
            );
        }
        if ((await queryRunner.hasColumn('rule', 'encodeChannelIds3')) === false) {
            await queryRunner.query(`ALTER TABLE "rule" ADD "encodeChannelIds3" text`);
            await queryRunner.query(
                `UPDATE "rule" SET "encodeChannelIds3" = '[' || "encodeChannelId3" || ']' WHERE "encodeChannelId3" IS NOT NULL`,
            );
        }
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if ((await queryRunner.hasColumn('rule', 'encodeChannelIds3')) === true) {
            await queryRunner.query(`ALTER TABLE "rule" DROP COLUMN "encodeChannelIds3"`);
        }
        if ((await queryRunner.hasColumn('rule', 'encodeChannelIds2')) === true) {
            await queryRunner.query(`ALTER TABLE "rule" DROP COLUMN "encodeChannelIds2"`);
        }
        if ((await queryRunner.hasColumn('rule', 'encodeChannelIds1')) === true) {
            await queryRunner.query(`ALTER TABLE "rule" DROP COLUMN "encodeChannelIds1"`);
        }
    }
}
