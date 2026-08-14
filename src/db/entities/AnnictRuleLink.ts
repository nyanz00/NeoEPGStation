import { BaseEntity, Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
@Index(['ruleId'], { unique: true })
@Index(['annictId', 'viewerProfileId'])
export default class AnnictRuleLink extends BaseEntity {
    @PrimaryGeneratedColumn({ type: 'integer' })
    public id!: number;

    @Column({ type: 'integer' })
    public ruleId!: number;

    @Column({ type: 'integer' })
    public annictId!: number;

    @Column({ type: 'integer', nullable: true })
    public viewerProfileId?: number | null;

    @Column({ type: 'text', default: 'anime' })
    public source!: string;

    @Column({ type: 'bigint' })
    public createdAt!: number;

    @Column({ type: 'bigint' })
    public updatedAt!: number;
}
