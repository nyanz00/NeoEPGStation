import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddEncodeTaskSequence1792700001000 implements MigrationInterface {
    public async up(runner: QueryRunner): Promise<void> {
        await runner.query(
            'CREATE TABLE IF NOT EXISTS `encode_task_sequence` (`id` integer PRIMARY KEY NOT NULL, `nextEncodeId` integer NOT NULL)',
        );
        const rows = await runner.query('SELECT `id` FROM `encode_task_sequence` WHERE `id` = 1');
        if (rows.length === 0)
            await runner.query(
                'INSERT INTO `encode_task_sequence` (`id`, `nextEncodeId`) SELECT 1, COALESCE(MAX(`encodeId`), 0) + 1 FROM `encode_task`',
            );
    }
    public async down(runner: QueryRunner): Promise<void> {
        await runner.query('DROP TABLE IF EXISTS `encode_task_sequence`');
    }
}
