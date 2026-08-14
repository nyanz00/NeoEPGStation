import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index(['episodeAnnictId', 'viewerProfileId'], { unique: true })
export default class AnnictEpisodeWatch extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'integer' })
    public episodeAnnictId!: number;

    @Column({ type: 'integer' })
    public viewerProfileId!: number;

    @Column({ type: 'integer', nullable: true })
    public annictRecordId?: number | null;

    @Column({ type: 'integer', nullable: true })
    public workAnnictId?: number | null;

    @Column({ type: 'boolean', default: false })
    public statusSyncPending!: boolean;

    @Column({ type: 'boolean', default: false })
    public completionPending!: boolean;

    @Column({ type: 'boolean', default: false })
    public ruleDisablePending!: boolean;

    @Column({ type: 'boolean', default: false })
    public explicitFinalEpisode!: boolean;

    @Column({ type: 'text' })
    public status!: string;

    @Column({ type: 'text', nullable: true })
    public lastError?: string | null;

    @Column({ type: 'integer', default: 0 })
    public retryCount!: number;

    @Column({ type: 'bigint', nullable: true })
    public nextRetryAt?: number | null;

    @Column({ type: 'bigint', nullable: true })
    public watchedAt?: number | null;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;
}
