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
  /** The consent rule as a plain sentence, for banners. */
  consentRule: string;
  /** Sources for the consent rule. */
  consentCitationIds: readonly string[];
  /** The director-change filing duty as a plain sentence, for the director drawer. */
  directorChangeNote: string;
  citationIds: readonly string[];
};

/** Plain-language wording per governing-Act profile; the profile data stays the authority. */
const PLAIN_DIRECTOR_RULES: Record<string, { consentRule: string; changeSubtext: string; changeNote: string }> = {
  bc_society: {
    consentRule: 'Under the Societies Act, a director consents in writing, or by attending the meeting that elects or appoints them and not refusing.',
    changeSubtext: 'File with the registrar. Changes made at an AGM can go in the annual report instead.',
    changeNote: 'File director changes with the registrar promptly. Changes made at an AGM can be reported in the annual report instead.',
  },
  bc_company: {
    consentRule: 'Under the BC Business Corporations Act, a director consents in writing before or after appointment, by knowingly acting as a director, or by being present at the election and not refusing. Keep every written consent received.',
    changeSubtext: 'Within 15 days of a change in directors or a director’s prescribed address.',
    changeNote: 'File a notice of change of directors within 15 days of a change in directors or a director’s prescribed address.',
  },
  federal_cbca: {
    consentRule: 'Under the CBCA, a director who is present at the election and does not refuse has consented. One who is absent must consent in writing before or within ten days after the election, or act as a director under it.',
    changeSubtext: 'Within 15 days of a change in directors or of receiving a director’s new address.',
    changeNote: 'File director changes with Corporations Canada within 15 days. A director’s address change is due within 15 days after the corporation receives the director’s notice.',
  },
  ontario_obca: {
    consentRule: 'Under the Ontario Business Corporations Act, a director consents in writing before or within ten days after being elected or appointed. A later written consent can still make the appointment valid.',
    changeSubtext: 'Generally within 15 days, under the Corporations Information Act.',
    changeNote: 'File a notice of change under the Corporations Information Act, generally within 15 days of the change.',
  },
};

export function directorComplianceProfile(organization?: GovernanceOrganization | null): DirectorComplianceProfile {
  const profile = legalGovernanceProfile(organization);
  const fallback = directorGovernanceRule(homeJurisdictionCode(organization), organizationKind(organization), organization);
  const bcResidency = profile?.directors.residency === 'bc_ordinary' && !organization?.isMemberFunded;
  const canadian = profile?.directors.residency === 'canadian_25_percent';
  const minimum = minimumLegalDirectors(organization);
  const plain = profile ? PLAIN_DIRECTOR_RULES[profile.id] : undefined;
  const consentExplanation = profile?.directors.consent ?? 'Keep the consent or appointment evidence required by the governing Act.';
  return {
    subtitle: profile ? `${profile.name}: ${profile.directors.consent} ${profile.directors.caveat ?? ''}`.trim() : fallback.subtitle,
    activeDirectorsSubtext: minimum === undefined ? 'Review the governing Act and documents.' : `Statutory minimum ${minimum}; review any higher governing-document requirement.`,
    minimumActiveDirectors: minimum,
    residencyMetricLabel: canadian ? 'Resident Canadians' : bcResidency ? 'BC residents' : 'Director residency',
    residencyMetricSubtext: canadian ? 'At least 25%, or one where there are fewer than four directors. CBCA s. 105 has stricter sector exceptions.' : bcResidency ? 'At least one director ordinarily resident in BC.' : profile ? 'No general residency requirement under this profile.' : 'The applicable residency rule requires review.',
    directorChangeSubtext: plain?.changeSubtext ?? profile?.directors.changeFilingTiming ?? 'Review the governing Act and applicable registry notice.',
    directorChangeNote: plain?.changeNote ?? 'Check the governing Act for any filing needed when directors change.',
    directorChangeMetric: profile?.directors.changeFilingDays ? `${profile.directors.changeFilingDays}d` : profile?.id === 'bc_society' ? 'Promptly' : 'Review',
    requiresBcResidentDirector: bcResidency,
    showBcResidentField: bcResidency,
    showCanadianResidentField: canadian,
    consentExplanation,
    consentRule: plain?.consentRule ?? consentExplanation,
    consentCitationIds: profile?.directors.consentSourceIds ?? [],
    citationIds: profile?.id === 'bc_society' && organization?.isMemberFunded ? ['BC-SOC-MEMBER-FUNDED-DIRECTORS'] : profile?.directors.sourceIds ?? [],
  };
}
