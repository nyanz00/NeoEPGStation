import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillRecordingTitleMarkers } from '../RecordingTitleMarkers';

export class PreserveRecordingTitleMarkers1792700000000 implements MigrationInterface {
    public async up(runner: QueryRunner): Promise<void> {
        await backfillRecordingTitleMarkers(runner);
    }
    public async down(): Promise<void> {
        /* Comparison names are retained when rolling back. */
    }
}
