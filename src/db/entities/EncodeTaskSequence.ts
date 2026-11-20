import { BaseEntity, Column, Entity, PrimaryColumn } from 'typeorm';

/** Shared monotonic IDs for requests received by both operator and service. */
@Entity()
export default class EncodeTaskSequence extends BaseEntity {
    @PrimaryColumn({ type: 'integer' }) public id!: number;
    @Column({ type: 'integer' }) public nextEncodeId!: number;
}
