import { legalGovernanceProfile, type GovernanceOrganization } from "../legalGovernanceProfiles";
import { isCorporation, isMemberBasedCorporation } from "../organizationDomain";
import type { EvidenceRegister } from "../businessEvidence";
import { bcCompanyAllows, bcCompanyEvidence } from "./bcCompany";

type Source = { text: string; citation: string; url: string };
interface EvidenceRules {
  sources: Partial<Record<string, Source[]>>;
  allows?: (table: string, subtype?: string | null) => boolean;
}

const profiles: Record<string, EvidenceRules> = {
  bc_company: { sources: bcCompanyEvidence, allows: bcCompanyAllows },
};

export function evidenceRules(org: GovernanceOrganization, register: EvidenceRegister) {
  const profile = profiles[legalGovernanceProfile(org)?.id ?? ""];
  const shareCompany = isCorporation(org) && !isMemberBasedCorporation(org);
  return {
    available: (!register.shares || shareCompany) && (profile?.allows?.(register.table, org.legalSubtype) ?? true),
    sources: profile?.sources[register.table] ?? [],
  };
}
