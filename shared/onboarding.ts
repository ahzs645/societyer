import { getPathway } from "./pathways/registry";
import { isCorporation, type LegalEntityLike } from "./organizationDomain";

/** Setup answers describe plans or supplied records; they never establish legal evidence or access. */
export type OrganizationOnboardingAnswers = {
  version: 1;
  previousUse: "new" | "returning";
  organizationStage: "preparing" | "existing";
  pathwayKey: string;
  governanceStructure: "single_class" | "multiple_classes" | "needs_review";
  classDetails: string;
  governanceDocuments: "available" | "need_to_prepare" | "needs_review";
  peopleReadiness: "ready_to_add" | "add_later";
  operatingRegions: string;
};

export function readOnboardingAnswersJson(value: unknown, organization?: LegalEntityLike & Record<string, any>): OrganizationOnboardingAnswers | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 6000) throw new Error("Initial setup answers must be bounded JSON.");
  let answers: any;
  try { answers = JSON.parse(value); } catch { throw new Error("Initial setup answers could not be read."); }
  const fields = ["version", "previousUse", "organizationStage", "pathwayKey", "governanceStructure", "classDetails", "governanceDocuments", "peopleReadiness", "operatingRegions"];
  if (!answers || Array.isArray(answers) || typeof answers !== "object" || Object.keys(answers).some((key) => !fields.includes(key))) throw new Error("Unknown initial setup answers.");
  const choices: Record<string, string[]> = {
    previousUse: ["new", "returning"], organizationStage: ["preparing", "existing"],
    governanceStructure: ["single_class", "multiple_classes", "needs_review"],
    governanceDocuments: ["available", "need_to_prepare", "needs_review"], peopleReadiness: ["ready_to_add", "add_later"],
  };
  if (answers.version !== 1) throw new Error("Unsupported initial setup answer version.");
  for (const [key, options] of Object.entries(choices)) if (!options.includes(answers[key])) throw new Error(`Invalid setup answer: ${key}.`);
  for (const key of ["classDetails", "operatingRegions"]) if (typeof answers[key] !== "string" || answers[key].length > 2000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(answers[key])) throw new Error(`Invalid setup answer: ${key}.`);
  const pathway = typeof answers.pathwayKey === "string" ? getPathway(answers.pathwayKey) : undefined;
  if (!pathway && !(answers.pathwayKey === "custom_existing" && answers.organizationStage === "existing")) throw new Error("Choose a registered setup pathway or an existing manual organization.");
  if (organization) {
    if (pathway && (organization.jurisdictionCode !== pathway.setup.jurisdictionCode || organization.entityType !== pathway.setup.entityType || organization.actFormedUnder !== pathway.setup.actFormedUnder)) throw new Error("Initial setup pathway and organization legal identity disagree.");
    if (answers.organizationStage === "preparing" && (organization.formationStatus !== "preparing" || organization.organizationStatus !== "pre_incorporation")) throw new Error("Preparing incorporation must remain a pre-incorporation workspace.");
    if (answers.organizationStage === "existing" && organization.formationStatus !== "unverified_existing") throw new Error("Initial existing organization setup requires later certificate verification.");
  }
  return answers as OrganizationOnboardingAnswers;
}

export function onboardingGovernanceSummary(answers: OrganizationOnboardingAnswers, organization: LegalEntityLike): string {
  const noun = isCorporation(organization) ? "share" : "membership";
  const structure = answers.governanceStructure === "needs_review" ? "classification needs review" : answers.governanceStructure === "multiple_classes" ? `multiple ${noun} classes` : `one ${noun} class`;
  return `Initial setup: ${structure}${answers.classDetails.trim() ? `; supplied class notes: ${answers.classDetails.trim()}` : ""}. Documents: ${answers.governanceDocuments.replaceAll("_", " ")}. People: ${answers.peopleReadiness.replaceAll("_", " ")}.${answers.operatingRegions.trim() ? ` Operating regions: ${answers.operatingRegions.trim()}.` : ""} Review these answers against the governing documents before creating actual register entries or granting access.`;
}

export function validateInitialOrganizationProfile(form: Record<string, any>): void {
  if (!form.name?.trim()) throw new Error("Enter the legal or proposed organization name.");
  if (form.name.length > 300) throw new Error("Organization name must be 300 characters or fewer.");
  for (const key of ["officialEmail", "privacyOfficerEmail"]) if (form[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form[key])) throw new Error("Enter a valid email address, or leave it for later.");
  if (form.fiscalYearEnd && (!/^\d{2}-\d{2}$/.test(form.fiscalYearEnd) || Number.isNaN(Date.parse(`2000-${form.fiscalYearEnd}T00:00:00Z`)) || new Date(`2000-${form.fiscalYearEnd}T00:00:00Z`).toISOString().slice(5, 10) !== form.fiscalYearEnd)) throw new Error("Fiscal year end must be a valid MM-DD date.");
  if (form.incorporationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(form.incorporationDate) || Number.isNaN(Date.parse(form.incorporationDate)) || new Date(form.incorporationDate).toISOString().slice(0, 10) !== form.incorporationDate)) throw new Error("Incorporation date must be a valid YYYY-MM-DD date.");
}
