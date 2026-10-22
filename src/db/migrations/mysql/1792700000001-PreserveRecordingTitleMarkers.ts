import { MigrationInterface, QueryRunner } from 'typeorm';
import { backfillRecordingTitleMarkers } from '../RecordingTitleMarkers.js';

export class PreserveRecordingTitleMarkers1792700000001 implements MigrationInterface {
    public async up(runner: QueryRunner): Promise<void> {
        await backfillRecordingTitleMarkers(runner);
    }
    public async down(): Promise<void> {
        /* Comparison names are retained when rolling back. */
    }
}
