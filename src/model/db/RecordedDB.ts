import { inject, injectable } from 'inversify';
import { In, IsNull, Not } from 'typeorm';
import * as apid from '../../../api';
import Recorded from '../../db/entities/Recorded';
import Thumbnail from '../../db/entities/Thumbnail';
import VideoFile from '../../db/entities/VideoFile';
import StrUtil from '../../util/StrUtil';
import IPromiseRetry from '../IPromiseRetry';
import DBUtil from './DBUtil';
import IDBOperator from './IDBOperator';
import IRecordedDB, { FindAllOption, RecordedColumnOption } from './IRecordedDB';

@injectable()
export default class RecordedDB implements IRecordedDB {
    private op: IDBOperator;
    private promieRetry: IPromiseRetry;

    constructor(@inject('IDBOperator') op: IDBOperator, @inject('IPromiseRetry') promieRetry: IPromiseRetry) {
        this.op = op;
        this.promieRetry = promieRetry;
    }

    /**
     * バックアップから復元
     * @param items: Recorded[]
     * @return Promise<void>
     */
    public async restore(items: Recorded[]): Promise<void> {
        // get queryRunner
        const connection = await this.op.getConnection();
        const queryRunner = connection.createQueryRunner();

        // start transaction
        await queryRunner.startTransaction();

        let hasError = false;
        try {
            // 削除
            await queryRunner.manager.clear(Thumbnail);
            await queryRunner.manager.clear(VideoFile);
            await queryRunner.manager.clear(Recorded);

            // 挿入処理
            for (const item of items) {
                await queryRunner.manager.insert(Recorded, item);
            }
            await queryRunner.commitTransaction();
        } catch (err: any) {
            console.error(err);
            hasError = err;
            await queryRunner.rollbackTransaction();
        } finally {
            await queryRunner.release();
        }

        if (hasError) {
            throw new Error('restore error');
        }
    }

    /**
     * 録画番組情報を 1 件挿入
     * @param recorded: Recorded
     * @return inserted id
     */
    public async insertOnce(recorded: Recorded): Promise<apid.RecordedId> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().insert().into(Recorded).values(recorded);
        const insertedResult = await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });

        return insertedResult.identifiers[0].id;
    }

    /**
     * 録画番組情報の更新
     * @param recorded: Recorded
     * @return Promise<void>
     */
    public async updateOnce(recorded: Recorded): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().update(Recorded).set(recorded).where({ id: recorded.id });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した録画情報の isRecording を false に
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async removeRecording(recordedId: apid.RecordedId): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }

        // すでに有効か
        if (recorded.isRecording === false) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                isRecording: false,
            })
            .where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した drop log file id を削除する
     * @param dropLogFileId: apid,DropLogFileId
     * @return Promise<void>
     */
    public async removeDropLogFileId(dropLogFileId: apid.DropLogFileId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                dropLogFileId: null,
            })
            .where({ dropLogFileId: dropLogFileId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した ruleId を削除する
     * @param ruleId: apid.RuleId
     * @return Promise<void>
     */
    public async removeRuleId(ruleId: apid.RuleId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                ruleId: null,
            })
            .where({ ruleId: ruleId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 保護状態を変更する
     * @param recordedId: apid.RecordedId
     * @param isProtect: boolean
     * @return Promise<void>
     */
    public async changeProtect(recordedId: apid.RecordedId, isProtect: boolean): Promise<void> {
        const recorded = await this.findId(recordedId);
        if (recorded === null) {
            throw new Error('RecordedIsNull');
        }

        // すでに同じ状態であれば何もしない
        if (recorded.isProtected === isProtect) {
            return;
        }

        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                isProtected: isProtect,
            })
            .where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した録画番組のユーザーを変更する
     * @param recordedId: apid.RecordedId
     * @param userId: apid.UserId
     * @return Promise<void>
     */
    public async changeUser(recordedId: apid.RecordedId, userId: apid.UserId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection
            .createQueryBuilder()
            .update(Recorded)
            .set({
                userId,
            })
            .where({ id: recordedId });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * 指定した録画番組情報を 1 件削除
     * @param recordedId: apid.RecordedId
     * @return Promise<void>
     */
    public async deleteOnce(recordedId: apid.RecordedId): Promise<void> {
        const connection = await this.op.getConnection();
        const queryBuilder = connection.createQueryBuilder().delete().from(Recorded).where({
            id: recordedId,
        });
        await this.promieRetry.run(() => {
            return queryBuilder.execute();
        });
    }

    /**
     * id を指定して録画番組情報取得
     * @param recordedId: apid.RecordedId
     * @return Recorded
     */
    public async findId(recordedId: apid.RecordedId): Promise<Recorded | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: recordedId })
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return result.length === 0 ? null : result[0];
    }

    /**
     * id を複数指定して番組情報を取得する
     * @param recordedIds: apid.RecordedId[]
     * @return Promise<Recorded[]>
     */
    public async findIds(
        recordedIds: apid.RecordedId[],
        columnOption?: RecordedColumnOption,
        isReverse?: boolean,
    ): Promise<Recorded[]> {
        if (recordedIds.length === 0) {
            return [];
        }

        const connection = await this.op.getConnection();

        let queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ id: In(recordedIds) });

        if (typeof columnOption === 'undefined') {
            queryBuilder = queryBuilder
                .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
                .leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
        } else {
            // videoFile
            if (columnOption.isNeedVideoFiles === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.videoFiles', 'videoFiles');
            }
            // thumbnail
            if (columnOption.isNeedThumbnails === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
            }
            // dropLogFile
            if (columnOption.isNeedsDropLog === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile');
            }

            // tags
            if (columnOption.isNeedTags === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.tags', 'tags');
            }
        }

        queryBuilder = queryBuilder.orderBy('recorded.startAt', isReverse ? 'ASC' : 'DESC');

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });

        return result;
    }

    /**
     * 全件取得
     * @param option: FindAllOption
     * @param columnOption: RecordedColumnOption
     * @return Promise<[Recorded[], number]>
     */
    public async findAll(option: FindAllOption, columnOption: RecordedColumnOption): Promise<[Recorded[], number]> {
        const connection = await this.op.getConnection();

        let queryBuilder = connection.getRepository(Recorded).createQueryBuilder('recorded');

        const querys: { query: string; values: any }[] = [];
        let needsDropLogFilter = false;

        // is recording
        if (typeof option.isRecording !== 'undefined') {
            querys.push({
                query: 'recorded.isRecording = :isRecording',
                values: {
                    isRecording: option.isRecording,
                },
            });
        }

        if (typeof option.userId !== 'undefined') {
            querys.push({
                query: 'recorded.userId = :userId',
                values: {
                    userId: option.userId,
                },
            });
        }

        // rule id
        if (typeof option.ruleId !== 'undefined') {
            if (option.ruleId === 0) {
                querys.push({
                    query: 'recorded.ruleId is null',
                    values: {},
                });
            } else {
                querys.push({
                    query: 'recorded.ruleId = :ruleId',
                    values: {
                        ruleId: option.ruleId,
                    },
                });
            }
        }

        // channel id
        if (typeof option.channelId !== 'undefined') {
            querys.push({
                query: 'recorded.channelId = :channelId',
                values: {
                    channelId: option.channelId,
                },
            });
        }

        // genre
        if (typeof option.genre !== 'undefined') {
            querys.push({
                query: '(genre1 = :genre or genre2 = :genre or genre3 = :genre)',
                values: {
                    genre: option.genre,
                },
            });
        }

        // keyword
        if (typeof option.keyword !== 'undefined') {
            const keywords = StrUtil.toHalf(option.keyword).split(/ /);
            const like = this.op.getLikeStr(false);
            const valueBaseName = 'keyword';

            const nameAnd: string[] = [];
            const descriptionAnd: string[] = [];
            const values: any = {};
            keywords.forEach((str, i) => {
                str = `%${str}%`;

                // value
                const valueName = `${valueBaseName}Name${i}`;
                values[valueName] = str;

                // name
                nameAnd.push(`halfWidthName ${like} :${valueName}`);
                // description
                descriptionAnd.push(`halfWidthDescription ${like} :${valueName}`);
            });

            const or: string[] = [];
            if (nameAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(nameAnd)})`);
            }
            if (descriptionAnd.length > 0) {
                or.push(`(${DBUtil.createAndQuery(descriptionAnd)})`);
            }

            querys.push({
                query: DBUtil.createOrQuery(or),
                values: values,
            });
        }

        // recorded startAt
        if (typeof option.recordedStartAt !== 'undefined') {
            querys.push({
                query: 'recorded.startAt >= :recordedStartAt',
                values: {
                    recordedStartAt: option.recordedStartAt,
                },
            });
        }

        if (typeof option.recordedEndAt !== 'undefined') {
            querys.push({
                query: 'recorded.startAt < :recordedEndAt',
                values: {
                    recordedEndAt: option.recordedEndAt,
                },
            });
        }

        // video file type
        if (typeof option.searchVideoFiles !== 'undefined' && option.searchVideoFiles.length > 0) {
            const values: any = {};
            const existsSelectedFiles: string[] = [];
            const selectedFileConditionsForOnly: string[] = [];

            option.searchVideoFiles.forEach((file, index) => {
                const typeKey = `searchVideoFileType${index.toString(10)}`;
                const nameKey = `searchVideoFileName${index.toString(10)}`;
                const selectedFileAlias = `searchVideoFile${index.toString(10)}`;
                const selectedFileConditions = [
                    `${selectedFileAlias}.recordedId = recorded.id`,
                    `${selectedFileAlias}.type = :${typeKey}`,
                ];
                const selectedFileConditionsForOnlyItem = [`otherVideoFile.type = :${typeKey}`];
                values[typeKey] = file.type;

                if (typeof file.name === 'string') {
                    selectedFileConditions.push(`${selectedFileAlias}.name = :${nameKey}`);
                    selectedFileConditionsForOnlyItem.push(`otherVideoFile.name = :${nameKey}`);
                    values[nameKey] = file.name;
                }

                existsSelectedFiles.push(
                    `exists (select 1 from video_file ${selectedFileAlias} where ${selectedFileConditions.join(' and ')})`,
                );
                selectedFileConditionsForOnly.push(`(${selectedFileConditionsForOnlyItem.join(' and ')})`);
            });

            const existsSelectedFile = existsSelectedFiles.join(' and ');
            const existsOtherFile =
                'exists (select 1 from video_file otherVideoFile where otherVideoFile.recordedId = recorded.id ' +
                'and not (' +
                selectedFileConditionsForOnly.join(' or ') +
                '))';

            querys.push({
                query:
                    option.encodeModeMatch === 'only'
                        ? existsSelectedFile + ' and not ' + existsOtherFile
                        : existsSelectedFile,
                values,
            });
        }

        if (option.hasDrop === true) {
            needsDropLogFilter = true;
            querys.push({
                query: 'dropLogFilter.dropCnt > 0',
                values: {},
            });
        }

        if (option.hasError === true) {
            needsDropLogFilter = true;
            querys.push({
                query: 'dropLogFilter.errorCnt > 0',
                values: {},
            });
        }

        if (option.hasScrambling === true) {
            needsDropLogFilter = true;
            querys.push({
                query: 'dropLogFilter.scramblingCnt > 0',
                values: {},
            });
        }

        // オリジナルファイルだけを抽出する
        if (columnOption.isNeedVideoFiles === true && !!option.hasOriginalFile === true) {
            querys.push({
                query: 'videoFiles.type <> :type',
                values: {
                    type: 'encoded',
                },
            });
        }

        if (needsDropLogFilter === true) {
            queryBuilder = queryBuilder.leftJoin('recorded.dropLogFile', 'dropLogFilter');
        }

        // where セット
        for (const q of querys) {
            queryBuilder = queryBuilder.andWhere(q.query, q.values);
        }

        // offset
        if (typeof option.offset !== 'undefined') {
            queryBuilder.skip(option.offset);
        }

        // limit
        if (typeof option.limit !== 'undefined') {
            queryBuilder.take(option.limit);
        }

        // order by
        queryBuilder = queryBuilder.orderBy('recorded.startAt', option.isReverse ? 'ASC' : 'DESC');

        // videoFiles
        if (columnOption.isNeedVideoFiles === true) {
            queryBuilder = queryBuilder.leftJoinAndSelect('recorded.videoFiles', 'videoFiles');
        }

        if (!!option.hasOriginalFile === false) {
            // thumbnails
            if (columnOption.isNeedThumbnails === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.thumbnails', 'thumbnails');
            }

            // dropLogFile
            if (columnOption.isNeedsDropLog === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile');
            }

            // tags
            if (columnOption.isNeedTags === true) {
                queryBuilder = queryBuilder.leftJoinAndSelect('recorded.tags', 'tags');
            }

            return await this.promieRetry.run(() => {
                return queryBuilder.getManyAndCount();
            });
        } else {
            // option.hasOriginalFile が有効な場合は エンコード済みビデオを取得できないので id を指定して再取得する
            const [records, total] = await this.promieRetry.run(() => {
                return queryBuilder.getManyAndCount();
            });

            const recordedIds = records.map(r => {
                return r.id;
            });

            const result = await this.promieRetry.run(() => {
                return this.findIds(recordedIds, columnOption, option.isReverse);
            });

            return [result, total];
        }
    }

    /**
     * channelIdのリストを返す
     * @return Promise<apid.RecordedChannelListItem[]>
     */
    public async findChannelList(): Promise<apid.RecordedChannelListItem[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .select('count(*) as cnt, channelId')
            .groupBy('channelId');

        return await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });
    }

    /**
     * genreのリストを返す
     * @return Promise<apid.RecordedGenreListItem[]>
     */
    public async findGenreList(): Promise<apid.RecordedGenreListItem[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = await connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .select('count(*) as cnt, genre1 as genre')
            .where({ genre1: Not(IsNull()) })
            .groupBy('genre');

        return await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });
    }

    public async findEncodedNameList(): Promise<string[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(VideoFile)
            .createQueryBuilder('videoFile')
            .select('videoFile.name', 'name')
            .where('videoFile.type = :type', {
                type: 'encoded',
            })
            .groupBy('videoFile.name')
            .orderBy('videoFile.name', 'ASC');

        const result = await this.promieRetry.run(() => {
            return queryBuilder.getRawMany();
        });

        return result
            .map(item => item.name)
            .filter((name): name is string => typeof name === 'string' && name.length > 0);
    }

    /**
     * 一番古い番組を返す
     * @return Promise<Recorded | null>
     */
    public async findOld(): Promise<Recorded | null> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({
                isProtected: false,
            })
            .orderBy('recorded.startAt', 'ASC')
            .orderBy('recorded.id', 'ASC')
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');
        const result = await this.promieRetry.run(() => {
            return queryBuilder.getOne();
        });

        return typeof result === 'undefined' ? null : result;
    }

    /**
     * 指定した reserveId の録画を返す
     * @param reserveId: apid.ReserveId
     * @return Promise<Recorded[]>
     */
    public async findReserveId(reserveId: apid.ReserveId): Promise<Recorded[]> {
        const connection = await this.op.getConnection();

        const queryBuilder = connection
            .getRepository(Recorded)
            .createQueryBuilder('recorded')
            .where({ reserveId: reserveId })
            .leftJoinAndSelect('recorded.videoFiles', 'videoFiles')
            .leftJoinAndSelect('recorded.thumbnails', 'thumbnails')
            .leftJoinAndSelect('recorded.dropLogFile', 'dropLogFile')
            .leftJoinAndSelect('recorded.tags', 'tags');

        return await this.promieRetry.run(() => {
            return queryBuilder.getMany();
        });
    }
}
