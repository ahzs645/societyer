import { homeJurisdictionCode, organizationKind, type LegalEntityLike } from './organizationDomain';
import { directorGovernanceRule } from './directorRules';
import { legalGovernanceProfile, minimumLegalDirectors, type GovernanceOrganization } from './legalGovernanceProfiles';

export type DirectorComplianceProfile = {
  subtitle: string;
  activeDirectorsSubtext: string;
  residencyMetricLabel: string;
  residencyMetricSubtext: string;
  directorChangeSubtext: string;
  directorChangeMetric: string;
  minimumActiveDirectors?: number;
  requiresBcResidentDirector: boolean;
  showBcResidentField: boolean;
  showCanadianResidentField: boolean;
  consentExplanation: string;
  citationIds: readonly string[];
};
export function directorComplianceProfile(organization?: GovernanceOrganization | null): DirectorComplianceProfile {
  const profile = legalGovernanceProfile(organization);
  const fallback = directorGovernanceRule(homeJurisdictionCode(organization), organizationKind(organization), organization);
  const bcResidency = profile?.directors.residency === 'bc_ordinary' && !organization?.isMemberFunded;
  const canadian = profile?.directors.residency === 'canadian_25_percent';
  const minimum = minimumLegalDirectors(organization);
  return {
    subtitle: profile ? `${profile.name}: ${profile.directors.consent} ${profile.directors.caveat ?? ''}`.trim() : fallback.subtitle,
    activeDirectorsSubtext: minimum === undefined ? 'Review the governing Act and documents.' : `Statutory minimum ${minimum}; review any higher governing-document requirement.`,
    minimumActiveDirectors: minimum,
    residencyMetricLabel: canadian ? 'Resident Canadians' : bcResidency ? 'BC residents' : 'Director residency',
    residencyMetricSubtext: canadian ? 'At least 25%, or one where there are fewer than four directors. CBCA s. 105 has stricter sector exceptions.' : bcResidency ? 'At least one director ordinarily resident in BC.' : profile ? 'No general residency requirement under this profile.' : 'The applicable residency rule requires review.',
    directorChangeSubtext: profile?.directors.changeFilingTiming ?? 'Review the governing Act and applicable registry notice.',
    directorChangeMetric: profile?.directors.changeFilingDays ? `${profile.directors.changeFilingDays}d` : profile?.id === 'bc_society' ? 'Promptly' : 'Review',
    requiresBcResidentDirector: bcResidency,
    showBcResidentField: bcResidency,
    showCanadianResidentField: canadian,
    consentExplanation: profile?.directors.consent ?? 'Keep the consent or appointment evidence required by the governing Act.',
    citationIds: profile?.id === 'bc_society' && organization?.isMemberFunded ? ['BC-SOC-MEMBER-FUNDED-DIRECTORS'] : profile?.directors.sourceIds ?? [],
  };
}
