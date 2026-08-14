import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index(['recordedId', 'userId'], { unique: true })
export default class RecordedPlayback extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'integer' })
    public recordedId!: number;

    /**
     * EPGStation user id. The master view is intentionally not tracked.
     */
    @Column({ type: 'integer' })
    public userId!: number;

    @Column({ type: 'double' })
    public position!: number;

    @Column({ type: 'double' })
    public duration!: number;

    /**
     * Accumulated media time that advanced normally. Seeking does not add to this value.
     */
    @Column({ type: 'double' })
    public watchedSeconds!: number;

    @Column({ type: 'bigint' })
    public lastObservedAt!: number;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;

    /**
     * Last time this playback was added to the user's watch history. Null keeps resume data without listing it.
     */
    @Column({ type: 'bigint', nullable: true })
    public historyUpdatedAt!: number | null;
}
