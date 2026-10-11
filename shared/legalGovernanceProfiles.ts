import { canonicalizeJurisdictionCode, homeJurisdictionCode, organizationEntityType, isMemberBasedCorporation, type LegalEntityLike } from './organizationDomain';
import type { LegalGovernanceProfile } from './legalGovernanceTypes';
import { BC_SOCIETY_LEGAL_PROFILE } from './societyLegalProfile';
import { CORPORATE_LEGAL_PROFILES } from './corporateLegalProfiles';

export type GovernanceOrganization = LegalEntityLike & {
  isMemberFunded?: boolean; distributing?: boolean; solicitingPublicBenefit?: boolean;
  legalSubtype?: string | null; incorporationDate?: string; fiscalYearEnd?: string;
};
/** Explicit Act wins over a province label. Unknown/custom Acts never inherit the local company Act. */
export function createLegalProfileRegistry(profiles: readonly LegalGovernanceProfile[]) {
  const byAct = new Map<string, LegalGovernanceProfile>();
  const byId = new Map<string, LegalGovernanceProfile>();
  for (const profile of profiles) {
    if (byId.has(profile.id)) throw new Error(`Duplicate legal profile: ${profile.id}`);
    byId.set(profile.id, profile);
    for (const act of profile.actKeys) {
      if (byAct.has(act.toLowerCase())) throw new Error(`Duplicate governing Act alias: ${act}`);
      byAct.set(act.toLowerCase(), profile);
    }
  }
  return {
    profiles,
    get(id: string) { return byId.get(id); },
    resolve(organization?: GovernanceOrganization | null): LegalGovernanceProfile | undefined {
      if (!organization) return undefined;
      if (isMemberBasedCorporation(organization)) return undefined;
      const act = organization.actFormedUnder?.trim().toLowerCase();
      const jurisdiction = canonicalizeJurisdictionCode(homeJurisdictionCode(organization));
      // An absent jurisdiction can support the established legacy default or
      // an explicit Act. A recorded "unknown" is an affirmative review state
      // and must not be replaced by a BC fallback or an inferred Act profile.
      const hasDeclaredJurisdiction = [organization.jurisdictionCode, organization.homeJurisdictionCode, organization.homeJurisdiction, organization.jurisdiction]
        .some(value => typeof value === 'string' && value.trim().length > 0);
      if (jurisdiction === 'unknown' && hasDeclaredJurisdiction) return undefined;
      const entity = organizationEntityType(organization).toLowerCase();
      if (act) {
        const profile = byAct.get(act);
        const matchesJurisdiction = profile && (jurisdiction === 'unknown' || jurisdiction === profile.jurisdictionCode ||
          (profile.id === 'ontario_obca' && jurisdiction === 'CA-ON') ||
          (profile.id === 'federal_cbca' && jurisdiction === 'CA-FED'));
        if (!profile || !matchesJurisdiction) return undefined;
        if (entity === 'society' && profile.kind === 'corporation') return undefined;
        if (entity === 'corporation__business_' && profile.kind === 'society') return undefined;
        return profile;
      }
      const legacy = !organization.entityType && !organization.kind && !organization.organizationKind;
      if ((entity === 'society' || legacy) && ['unknown', 'CA-BC'].includes(jurisdiction)) return byId.get('bc_society');
      if (entity === 'corporation__business_') {
        return profiles.find(p => p.kind === 'corporation' && p.jurisdictionCode === jurisdiction && ['bc_company', 'federal_cbca', 'ontario_obca'].includes(p.id));
      }
      return undefined;
    },
  };
}
export const LEGAL_GOVERNANCE_PROFILES: readonly LegalGovernanceProfile[] = [BC_SOCIETY_LEGAL_PROFILE, ...CORPORATE_LEGAL_PROFILES];
export const legalProfileRegistry = createLegalProfileRegistry(LEGAL_GOVERNANCE_PROFILES);
export const legalGovernanceProfile = (organization?: GovernanceOrganization | null) => {
  const profile = legalProfileRegistry.resolve(organization);
  return profile?.confidence === 'verified_core' ? profile : undefined;
};

export function minimumLegalDirectors(organization?: GovernanceOrganization | null): number | undefined {
  const profile = legalGovernanceProfile(organization);
  if (!profile) return undefined;
  if (profile.id === 'bc_society' && organization?.isMemberFunded) return profile.directors.memberFundedMinimum ?? 1;
  if (profile.id === 'bc_company' && ['community_contribution_company', 'ccc'].includes(String(organization?.legalSubtype))) return 3;
  return organization?.distributing && profile.directors.publicMinimum ? profile.directors.publicMinimum : profile.directors.minimum;
}
export function requiredResidentCanadianDirectors(totalDirectors: number): number {
  return totalDirectors > 0 ? Math.max(1, Math.ceil(totalDirectors / 4)) : 1;
}
/** Reviewed departures from the default written route. Neither is ever applied silently. */
export type WrittenResolutionOptions = {
  /** Societies Act s. 1 (c) definitions: bylaws authorize member voting by mail or electronic means. */
  route?: 'written_consent' | 'mail_electronic_vote';
  /** A bylaw/articles threshold below unanimity for directors' written consent. */
  directorsOverride?: { numerator: number; denominator: number };
};
export type WrittenResolutionRoute = NonNullable<WrittenResolutionOptions['route']>;
export function validDirectorsOverride(value?: { numerator: number; denominator: number }) {
  return !!value && Number.isSafeInteger(value.numerator) && Number.isSafeInteger(value.denominator) &&
    value.numerator >= 1 && value.denominator <= 100 && value.numerator < value.denominator;
}
export function writtenResolutionRule(organization: GovernanceOrganization | null | undefined, kind: 'Ordinary' | 'Special', body: 'members' | 'shareholders' | 'directors' = 'members', options: WrittenResolutionOptions = {}) {
  const profile = legalGovernanceProfile(organization);
  if (!profile) return undefined;
  const r = profile.resolutions;
  if (options.route === 'mail_electronic_vote') {
    // The (c) route counts votes cast; it exists only where the profile records it.
    const vote = r.memberMailElectronicVote;
    if (!vote || body !== 'members') return undefined;
    const threshold = kind === 'Special' ? vote.special : vote.ordinary;
    return { ...threshold, unit: 'people' as const, basis: 'votes_cast' as const, unanimous: false, route: 'mail_electronic_vote' as const,
      sourceIds: vote.sourceIds, caveat: vote.provision, noticeBusinessDays: undefined, usesSpecialMajority: false, override: undefined };
  }
  if (body === 'directors' && options.directorsOverride) {
    const override = r.directorsWrittenOverride;
    if (!override || !validDirectorsOverride(options.directorsOverride)) return undefined;
    return { numerator: options.directorsOverride.numerator, denominator: options.directorsOverride.denominator, strict: false,
      unit: 'people' as const, basis: 'eligible' as const, unanimous: false, route: 'written_consent' as const,
      sourceIds: override.sourceIds, caveat: override.provision, noticeBusinessDays: undefined, usesSpecialMajority: false,
      override: 'directors_governing_instrument' as const };
  }
  const unanimous = body === 'directors' || kind === 'Special' ||
    (r.ordinaryWrittenNumerator === r.ordinaryWrittenDenominator && !r.ordinaryWrittenStrict) ||
    (r.ordinaryWrittenNonPublicOnly && organization?.distributing !== false);
  return {
    numerator: unanimous ? 1 : r.ordinaryWrittenNumerator,
    denominator: unanimous ? 1 : r.ordinaryWrittenDenominator,
    strict: unanimous ? false : r.ordinaryWrittenStrict,
    unit: body === 'shareholders' && !unanimous ? r.ordinaryWrittenDenominatorBasis ?? 'votes' : 'people' as const,
    basis: 'eligible' as const,
    unanimous,
    route: 'written_consent' as const,
    sourceIds: r.sourceIds,
    caveat: r.caveat,
    noticeBusinessDays: !unanimous ? r.ordinaryWrittenNoticeBusinessDays : undefined,
    usesSpecialMajority: !unanimous && r.ordinaryWrittenUsesSpecialMajority,
    override: undefined,
  };
}
export function requiredWrittenConsents(total: number, rule: { numerator: number; denominator: number; strict: boolean }): number {
  if (!Number.isSafeInteger(total) || total < 1 || !Number.isSafeInteger(rule.numerator) || !Number.isSafeInteger(rule.denominator) || rule.numerator < 1 || rule.denominator < 1) return 0;
  const product = BigInt(total) * BigInt(rule.numerator);
  const denominator = BigInt(rule.denominator);
  const required = rule.strict ? product / denominator + 1n : (product + denominator - 1n) / denominator;
  return required <= BigInt(Number.MAX_SAFE_INTEGER) ? Number(required) : 0;
}
