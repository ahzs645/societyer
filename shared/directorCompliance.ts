import { isBcSociety, isCorporation, type LegalEntityLike } from "./organizationDomain";
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
  if (isBcSociety(organization)) {
    return {
      subtitle:
        "Register of directors under BC Societies Act s.20. Section 40 requires at least 3 directors and at least 1 BC resident unless the s.197 member-funded exception applies.",
      activeDirectorsSubtext: "Minimum 3 for regular societies.",
      residencyMetricLabel: display.directorResidencyLabel,
      residencyMetricSubtext: display.directorResidencySubtext,
      directorChangeSubtext: display.directorChangeSubtext,
      minimumActiveDirectors: 3,
      requiresBcResidentDirector: true,
      showBcResidentField: true,
    };
  }

  if (isCorporation(organization)) {
    return {
      subtitle:
        "Director register for the corporation workspace. Review the governing statute, articles, by-laws, consents, and registry notices for each change.",
      activeDirectorsSubtext: "Review governing statute, articles, and by-laws.",
      residencyMetricLabel: display.directorResidencyLabel,
      residencyMetricSubtext: display.directorResidencySubtext,
      directorChangeSubtext: display.directorChangeSubtext,
      requiresBcResidentDirector: false,
      showBcResidentField: false,
    };
  }

  return {
    subtitle:
      "Director or governing-person register for this organization. Review the governing statute, formation documents, consents, and registry notices for each change.",
    activeDirectorsSubtext: "Review governing documents and applicable law.",
    residencyMetricLabel: display.directorResidencyLabel,
    residencyMetricSubtext: display.directorResidencySubtext,
    directorChangeSubtext: display.directorChangeSubtext,
    requiresBcResidentDirector: false,
    showBcResidentField: false,
  };
}
