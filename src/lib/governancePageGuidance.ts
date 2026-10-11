import { legalGovernanceProfile } from "../../shared/legalGovernanceProfiles";
import { legalSourceById } from "../../shared/legalSources";
import type { LegalEntityLike } from "../../shared/organizationDomain";
import { citationIdsForOrganization } from "./regulatoryCitations";

export type GovernanceGuidanceTopic = "conflicts" | "auditors" | "court_orders" | "qualifications";

/** Page presentation maps to shared legal sources; new profiles extend this data
 * without changing each register's UI. A missing profile means review, not zero duties. */
const PAGE_SOURCES: Record<string, Record<GovernanceGuidanceTopic, readonly string[]>> = {
  bc_society: {
    conflicts: ["BC-SOC-CONFLICTS", "BC-SOC-SENIOR-MANAGER-CONFLICTS"],
    auditors: ["BC-SOC-AUDITOR"],
    court_orders: ["BC-SOC-RECORDS", "BC-SOC-RETENTION"],
    qualifications: ["BC-SOC-DIRECTOR-QUALIFICATIONS", "BC-SOC-DIRECTORS-BC-RESIDENT"],
  },
  bc_company: {
    conflicts: ["BC-BCA-CONFLICTS"], auditors: ["BC-BCA-AUDITOR-WAIVER", "BC-BCA-AUDITOR-APPOINTMENT"],
    court_orders: ["BC-BCA-RECORDS"], qualifications: ["BC-BCA-DIRECTOR-QUALIFICATIONS", "BC-BCA-DIRECTORS-MIN"],
  },
  federal_cbca: {
    conflicts: ["CBCA-CONFLICTS"], auditors: ["CBCA-AUDITOR-WAIVER", "CBCA-AUDITOR-APPOINTMENT"],
    court_orders: ["CBCA-RECORDS"], qualifications: ["CBCA-DIRECTOR-QUALIFICATIONS", "CBCA-DIRECTORS-MIN"],
  },
  ontario_obca: {
    conflicts: ["OBCA-CONFLICTS"], auditors: ["OBCA-AUDITOR-WAIVER", "OBCA-AUDITOR-APPOINTMENT"],
    court_orders: ["OBCA-RECORDS"], qualifications: ["OBCA-DIRECTOR-QUALIFICATIONS", "OBCA-DIRECTORS-MIN"],
  },
};

export function governancePageGuidance(organization: LegalEntityLike | null | undefined, topic: GovernanceGuidanceTopic) {
  const profile = legalGovernanceProfile(organization);
  const ids = profile ? PAGE_SOURCES[profile.id]?.[topic] ?? [] : [];
  const scoped = citationIdsForOrganization(ids, organization);
  return {
    profile,
    sources: scoped.map((id) => {
      const source = legalSourceById.get(id);
      if (!source) throw new Error(`Missing legal source for ${topic}: ${id}`);
      return source;
    }),
  };
}
