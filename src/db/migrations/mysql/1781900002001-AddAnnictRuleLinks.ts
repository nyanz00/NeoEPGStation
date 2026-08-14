import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddAnnictRuleLinks1781900002001 implements MigrationInterface {
    name = 'AddAnnictRuleLinks1781900002001';

    public async up(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('annict_rule_link')) return;
        await queryRunner.query(
            [
                'CREATE TABLE `annict_rule_link` (`id` int NOT NULL AUTO_INCREMENT,',
                '`ruleId` int NOT NULL, `annictId` int NOT NULL, `viewerProfileId` int NULL,',
                "`source` varchar(32) NOT NULL DEFAULT 'anime', `createdAt` bigint NOT NULL, `updatedAt` bigint NOT NULL,",
                'UNIQUE INDEX `IDX_annict_rule_link_rule` (`ruleId`),',
                'INDEX `IDX_annict_rule_link_work_profile` (`annictId`, `viewerProfileId`),',
                'PRIMARY KEY (`id`)) ENGINE=InnoDB',
            ].join(' '),
        );
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        if (await queryRunner.hasTable('annict_rule_link')) {
            await queryRunner.query('DROP TABLE `annict_rule_link`');
        }
    }
}
