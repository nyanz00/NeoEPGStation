import { BaseEntity, Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity()
export default class TvUser extends BaseEntity {
    @PrimaryGeneratedColumn({
        type: 'integer',
    })
    public id!: number;

    @Column({
        type: 'text',
    })
    public name!: string;

    @Column({
        type: 'bigint',
    })
    public createdAt!: number;
}
