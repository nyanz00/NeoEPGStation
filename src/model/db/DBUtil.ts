namespace DBUtil {
    export interface Pagination {
        offset?: number;
        limit?: number;
    }

    /**
     * Resolve pagination for the configured database. MySQL requires LIMIT when
     * OFFSET is present, while a zero limit means "unlimited" in the API.
     */
    export const resolvePagination = (
        offset: number | undefined,
        limit: number | undefined,
        databaseType: string,
    ): Pagination => {
        const pagination: Pagination = {};

        if (typeof offset !== 'undefined') {
            pagination.offset = offset;
        }

        if (typeof limit !== 'undefined' && limit > 0) {
            pagination.limit = limit;
        } else if (typeof offset !== 'undefined' && databaseType === 'mysql') {
            // MySQL does not accept OFFSET without LIMIT. Keep this above the
            // practical row counts while staying within signed 32-bit range.
            pagination.limit = 2147483647;
        }

        return pagination;
    };

    /**
     * and query 作成
     * @param strs: string[]
     * @return string
     */
    export const createAndQuery = (strs: string[]): string => {
        if (strs.length === 0) {
            return '';
        }

        let str = '';
        for (let i = 0; i < strs.length; i++) {
            str += i === strs.length - 1 ? `(${strs[i]})` : `(${strs[i]}) and `;
        }

        return `(${str})`;
    };

    /**
     * or query 作成
     * @param strs: string[]
     * @return string
     */
    export const createOrQuery = (strs: string[]): string => {
        let str = '';
        for (let i = 0; i < strs.length; i++) {
            str += i === strs.length - 1 ? `(${strs[i]})` : `(${strs[i]}) or`;
        }

        return `(${str})`;
    };
}

export default DBUtil;
