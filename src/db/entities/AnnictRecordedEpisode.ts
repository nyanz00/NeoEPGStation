import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index(['recordedId'], { unique: true })
@Index(['annictId', 'episodeAnnictId'])
export default class AnnictRecordedEpisode extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'integer' })
    public recordedId!: number;

    @Column({ type: 'integer' })
    public annictId!: number;

    @Column({ type: 'integer', nullable: true })
    public programAnnictId?: number | null;

    @Column({ type: 'integer', nullable: true })
    public episodeAnnictId?: number | null;

    @Column({ type: 'integer', nullable: true })
    public episodeNumber?: number | null;

    @Column({ type: 'text', nullable: true })
    public episodeNumberText?: string | null;

    @Column({ type: 'text', nullable: true })
    public episodeTitle?: string | null;

    @Column({ type: 'text' })
    public status!: string;

    @Column({ type: 'text', nullable: true })
    public pendingReason?: string | null;

    @Column({ type: 'bigint', nullable: true })
    public lastCheckedAt?: number | null;

    @Column({ type: 'bigint', nullable: true })
    public matchedAt?: number | null;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;
}
