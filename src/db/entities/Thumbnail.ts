import { BaseEntity, Column, Entity, JoinTable, ManyToOne, PrimaryGeneratedColumn, Relation } from 'typeorm';
import Recorded from './Recorded.js';

@Entity()
export default class Thumbnail extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public filePath!: string;

    @Column()
    public recordedId!: number;

    @ManyToOne(() => Recorded, recorded => recorded.thumbnails)
    @JoinTable({ name: 'recordedId' })
    public recorded?: Relation<Recorded>;
}
