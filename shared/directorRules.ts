import { canonicalizeJurisdictionCode, type OrganizationKind } from './organizationDomain';
import { legalGovernanceProfile, minimumLegalDirectors, type GovernanceOrganization } from './legalGovernanceProfiles';

/** Compatibility view of the central legal profiles. Add a governing Act to
 * that registry rather than creating another jurisdiction-specific rules map. */
export type DirectorGovernanceRule = {
  minimumActiveDirectors?: number;
  requiresResidentDirector: boolean;
  trackResidentDirectorField: boolean;
  /** A boolean cannot express the federal percentage or its sector exceptions. */
  residentDirectorRule: 'bc_ordinary' | 'canadian_25_percent' | 'none' | 'review_required';
  subtitle: string;
  activeDirectorsSubtext: string;
  sourceIds: readonly string[];
};

/** Pass the actual organization when available so custom Acts and subtypes do
 * not inherit a province's ordinary-company or regular-society assumptions. */
export function directorGovernanceRule(
  jurisdictionCode: string | null | undefined,
  kind: OrganizationKind,
  organization?: GovernanceOrganization | null,
): DirectorGovernanceRule {
  const entity: GovernanceOrganization = organization ?? {
    jurisdictionCode: canonicalizeJurisdictionCode(jurisdictionCode),
    entityType: kind === 'corporation' ? 'corporation__business_' : kind === 'society' ? 'society' : 'custom',
    kind,
  };
  const profile = legalGovernanceProfile(entity);
  if (!profile) return {
    requiresResidentDirector: false,
    trackResidentDirectorField: false,
    residentDirectorRule: 'review_required',
    subtitle: `Director or governing-person register for this ${kind === 'corporation' ? 'corporation' : 'organization'}. Review the governing Act, formation documents, consents and registry notices.`,
    activeDirectorsSubtext: 'Review the governing Act and documents.',
    sourceIds: [],
  };
  const memberFunded = profile.id === 'bc_society' && entity.isMemberFunded;
  const residency = memberFunded ? 'none' : profile.directors.residency;
  const minimum = minimumLegalDirectors(entity);
  return {
    minimumActiveDirectors: minimum,
    requiresResidentDirector: residency !== 'none',
    trackResidentDirectorField: residency !== 'none',
    residentDirectorRule: residency,
    subtitle: `${profile.name}: ${profile.directors.consent} ${profile.directors.caveat ?? ''}`.trim(),
    activeDirectorsSubtext: `Statutory minimum ${minimum}; review any higher governing-document requirement.`,
    sourceIds: memberFunded ? ['BC-SOC-MEMBER-FUNDED-DIRECTORS'] : profile.directors.sourceIds,
  };
}
