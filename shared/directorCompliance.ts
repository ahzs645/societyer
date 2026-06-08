import { homeJurisdictionCode, organizationKind, type LegalEntityLike } from "./organizationDomain";
import { directorGovernanceRule } from "./directorRules";
import { jurisdictionDisplayCopy } from "./jurisdictionWorkspace";

export type DirectorComplianceProfile = {
  subtitle: string;
  activeDirectorsSubtext: string;
  residencyMetricLabel: string;
  residencyMetricSubtext: string;
  directorChangeSubtext: string;
  minimumActiveDirectors?: number;
  requiresBcResidentDirector: boolean;
  showBcResidentField: boolean;
};

export function directorComplianceProfile(organization?: LegalEntityLike | null): DirectorComplianceProfile {
  const display = jurisdictionDisplayCopy(organization?.jurisdictionCode);
  const rule = directorGovernanceRule(homeJurisdictionCode(organization), organizationKind(organization));
  return {
    subtitle: rule.subtitle,
    activeDirectorsSubtext: rule.activeDirectorsSubtext,
    residencyMetricLabel: display.directorResidencyLabel,
    residencyMetricSubtext: display.directorResidencySubtext,
    directorChangeSubtext: display.directorChangeSubtext,
    minimumActiveDirectors: rule.minimumActiveDirectors,
    requiresBcResidentDirector: rule.requiresResidentDirector,
    showBcResidentField: rule.trackResidentDirectorField,
  };
}
