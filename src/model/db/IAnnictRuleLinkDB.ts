import AnnictRuleLink from '../../db/entities/AnnictRuleLink';

export interface LegacyAnnictRuleLink {
    ruleId: number;
    annictId: number;
    viewerProfileId?: number | null;
}

export default interface IAnnictRuleLinkDB {
    findAll(): Promise<AnnictRuleLink[]>;
    findRuleIds(ruleIds: number[]): Promise<AnnictRuleLink[]>;
    findRuleId(ruleId: number): Promise<AnnictRuleLink | null>;
    findWork(annictId: number, viewerProfileId?: number | null): Promise<AnnictRuleLink[]>;
    upsert(ruleId: number, annictId: number, viewerProfileId?: number | null): Promise<void>;
    insertLegacyIfMissing(links: LegacyAnnictRuleLink[]): Promise<number>;
    deleteRuleId(ruleId: number): Promise<void>;
    restore(links: LegacyAnnictRuleLink[], validRuleIds: number[]): Promise<void>;
}
