import { getPathway } from "../../shared/pathways/registry";
import { canonicalizeJurisdictionCode } from "../../shared/organizationDomain";

/**
 * "Try another organization type" in the demo banner.
 *
 * The bundled demo seeds one rich workspace (a BC society). The other entity
 * kinds are created on demand through the same `society.createWorkspace`
 * mutation the guided setup uses, as an existing organization of that kind
 * with sample identity details, then selected. A second visit switches to the
 * workspace already created instead of making another.
 */
export type DemoPersona = {
  key: "bc_society" | "bc_company" | "federal_cbca" | "ontario_obca";
  label: string;
  hint: string;
  /** Sample identity for a workspace created for this persona. */
  sample: { name: string; incorporationNumber: string; incorporationDate: string; fiscalYearEnd: string };
};

export const DEMO_PERSONAS: DemoPersona[] = [
  {
    key: "bc_society",
    label: "BC society",
    hint: "Nonprofit under the Societies Act",
    sample: { name: "Riverside Community Society", incorporationNumber: "S0012345", incorporationDate: "2012-05-14", fiscalYearEnd: "03-31" },
  },
  {
    key: "bc_company",
    label: "BC company",
    hint: "Business Corporations Act (BC)",
    sample: { name: "Cedar Demo Holdings Ltd.", incorporationNumber: "BC1234567", incorporationDate: "2019-02-01", fiscalYearEnd: "12-31" },
  },
  {
    key: "federal_cbca",
    label: "Federal CBCA corporation",
    hint: "Canada Business Corporations Act",
    sample: { name: "Maple Demo Federal Inc.", incorporationNumber: "1234567-8", incorporationDate: "2020-09-15", fiscalYearEnd: "12-31" },
  },
  {
    key: "ontario_obca",
    label: "Ontario OBCA corporation",
    hint: "Business Corporations Act (Ontario)",
    sample: { name: "Lakeshore Demo Ontario Inc.", incorporationNumber: "1000123456", incorporationDate: "2018-06-30", fiscalYearEnd: "06-30" },
  },
];

type OrganizationLike = { jurisdictionCode?: string; homeJurisdictionCode?: string; entityType?: string };

/** Which persona an existing workspace already represents, if any. */
export function personaForOrganization(organization: OrganizationLike | null | undefined): DemoPersona["key"] | null {
  if (!organization) return null;
  const code = canonicalizeJurisdictionCode(organization.homeJurisdictionCode || organization.jurisdictionCode || "");
  const corporate = String(organization.entityType ?? "").includes("corporation");
  const society = String(organization.entityType ?? "").includes("society");
  if (society && code === "CA-BC") return "bc_society";
  if (!corporate) return null;
  if (code === "CA-BC") return "bc_company";
  if (code === "CA-FED-CBCA") return "federal_cbca";
  if (code === "CA-ON-OBCA") return "ontario_obca";
  return null;
}

/** The createWorkspace arguments for a persona, matching what guided setup sends. */
export function demoPersonaWorkspaceValues(persona: DemoPersona) {
  const pathway = getPathway(persona.key);
  if (!pathway) throw new Error(`No setup pathway for ${persona.label}.`);
  const answers = {
    version: 1,
    previousUse: "new",
    organizationStage: "existing",
    pathwayKey: persona.key,
    governanceStructure: "needs_review",
    classDetails: "",
    governanceDocuments: "needs_review",
    peopleReadiness: "add_later",
    operatingRegions: "",
  };
  return {
    name: persona.sample.name,
    incorporationNumber: persona.sample.incorporationNumber,
    incorporationDate: persona.sample.incorporationDate,
    fiscalYearEnd: persona.sample.fiscalYearEnd,
    jurisdictionCode: pathway.setup.jurisdictionCode,
    entityType: pathway.setup.entityType,
    actFormedUnder: pathway.setup.actFormedUnder,
    legalSubtype: pathway.eligibility.subtypes[0] ?? "other",
    isMemberFunded: false,
    isCharity: false,
    numbered: false,
    distributing: false,
    formationStatus: "unverified_existing",
    organizationStatus: "active",
    craBnStatus: "unknown",
    craRcStatus: "unknown",
    gstHstStatus: "unknown",
    payrollStatus: "unknown",
    charityStatus: "unknown",
    onboardingAnswersJson: JSON.stringify(answers),
  };
}
