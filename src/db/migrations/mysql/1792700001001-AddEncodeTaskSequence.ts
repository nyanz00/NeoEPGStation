import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEncodeTaskSequence1792700001001 implements MigrationInterface {
    public async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            'CREATE TABLE IF NOT EXISTS `encode_task_sequence` (`id` int PRIMARY KEY NOT NULL, `nextEncodeId` int NOT NULL) ENGINE=InnoDB',
        );
        const rows = await runner.query('SELECT `id` FROM `encode_task_sequence` WHERE `id` = 1');
        if (rows.length === 0)
            await runner.query(
                'INSERT INTO `encode_task_sequence` (`id`, `nextEncodeId`) SELECT 1, LEAST(COALESCE(MAX(`encodeId`), 0) + 1, 2147483647) FROM `encode_task`',
            );
    }
    public async down(runner: QueryRunner): Promise<void> {
        await runner.query('DROP TABLE IF EXISTS `encode_task_sequence`');
    }
}
