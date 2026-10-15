import { getPathway } from "./pathways/registry";
import { isCorporation, type LegalEntityLike } from "./organizationDomain";
import { ANOTHER_ACT_VALUE, ENTITY_KIND_ENTITY_TYPES, OTHER_ACT_NAME_MAX, RECORDS_ONLY_PATHWAY_KEY, incorporationActById, incorporationActTitle } from "./incorporationActs";

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
  /** Catalogue id of the chosen Act (shared/incorporationActs.ts). Absent on older answers. */
  incorporationActId?: string;
  /** The Act's name when "Another Act" was chosen. */
  otherActName?: string;
};

export function readOnboardingAnswersJson(value: unknown, organization?: LegalEntityLike & Record<string, any>): OrganizationOnboardingAnswers | undefined {
  if (value === undefined || value === "") return undefined;
  if (typeof value !== "string" || value.length > 6000) throw new Error("Initial setup answers must be bounded JSON.");
  let answers: any;
  try { answers = JSON.parse(value); } catch { throw new Error("Initial setup answers could not be read."); }
  const fields = ["version", "previousUse", "organizationStage", "pathwayKey", "governanceStructure", "classDetails", "governanceDocuments", "peopleReadiness", "operatingRegions", "incorporationActId", "otherActName"];
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
  const recordsOnly = answers.pathwayKey === RECORDS_ONLY_PATHWAY_KEY;
  if (!pathway && !recordsOnly && !(answers.pathwayKey === "custom_existing" && answers.organizationStage === "existing")) throw new Error("Choose a registered setup pathway, a listed Act, or an existing manual organization.");
  // The chosen Act, when recorded, must be the catalogue entry the pathway key stands for.
  const act = answers.incorporationActId === undefined ? undefined : incorporationActById(typeof answers.incorporationActId === "string" ? answers.incorporationActId : "");
  if (answers.incorporationActId !== undefined && !act) throw new Error("Unknown governing Act in the setup answers.");
  if (recordsOnly && !act) throw new Error("Records-only setup must name the governing Act.");
  if (act && (act.support === "full" ? act.pathwayKey !== answers.pathwayKey : !recordsOnly)) throw new Error("Initial setup pathway and governing Act disagree.");
  const another = act?.actFormedUnder === ANOTHER_ACT_VALUE;
  if (answers.otherActName !== undefined && (!another || typeof answers.otherActName !== "string" || answers.otherActName.length > OTHER_ACT_NAME_MAX || /[\u0000-\u001f]/.test(answers.otherActName))) throw new Error("Invalid setup answer: otherActName.");
  if (another && !answers.otherActName?.trim()) throw new Error("Enter the name of the governing Act.");
  if (organization) {
    if (pathway && (organization.jurisdictionCode !== pathway.setup.jurisdictionCode || organization.entityType !== pathway.setup.entityType || organization.actFormedUnder !== pathway.setup.actFormedUnder)) throw new Error("Initial setup pathway and organization legal identity disagree.");
    if (act && (organization.jurisdictionCode !== act.jurisdictionCode || organization.actFormedUnder !== act.actFormedUnder || !act.entityKinds.some((kind) => ENTITY_KIND_ENTITY_TYPES[kind] === organization.entityType))) throw new Error("Initial setup Act and organization legal identity disagree.");
    if (answers.organizationStage === "preparing" && (organization.formationStatus !== "preparing" || organization.organizationStatus !== "pre_incorporation")) throw new Error("Preparing incorporation must remain a pre-incorporation workspace.");
    if (answers.organizationStage === "existing" && organization.formationStatus !== "unverified_existing") throw new Error("Initial existing organization setup requires later certificate verification.");
  }
  return answers as OrganizationOnboardingAnswers;
}

export function onboardingGovernanceSummary(answers: OrganizationOnboardingAnswers, organization: LegalEntityLike): string {
  const noun = isCorporation(organization) ? "share" : "membership";
  const structure = answers.governanceStructure === "needs_review" ? "classification needs review" : answers.governanceStructure === "multiple_classes" ? `multiple ${noun} classes` : `one ${noun} class`;
  const act = incorporationActById(answers.incorporationActId);
  const actNote = act?.actFormedUnder === ANOTHER_ACT_VALUE ? ` Governing Act named at setup: ${incorporationActTitle(act, answers.otherActName)}.` : "";
  return `Initial setup: ${structure}${answers.classDetails.trim() ? `; supplied class notes: ${answers.classDetails.trim()}` : ""}.${actNote} Documents: ${answers.governanceDocuments.replaceAll("_", " ")}. People: ${answers.peopleReadiness.replaceAll("_", " ")}.${answers.operatingRegions.trim() ? ` Operating regions: ${answers.operatingRegions.trim()}.` : ""} Review these answers against the governing documents before creating actual register entries or granting access.`;
}

/** One saved setup answer in plain language, e.g. { label: "Documents", value: "you'll draft them here" }. */
export type OnboardingAnswerLine = { label: string; value: string };

/** Shown under the saved answers wherever they are listed. */
export const ONBOARDING_ANSWERS_FOOTER = "These are the answers you gave when you created the workspace. Check them against your documents.";

/**
 * The answers saved at creation, in plain language for the setup view and the
 * setup task. Never shows raw option values ("needs_review", "add_later").
 */
export function describeOnboardingAnswers(answers: OrganizationOnboardingAnswers | null | undefined, organization: LegalEntityLike): OnboardingAnswerLine[] {
  if (!answers) return [];
  const shares = isCorporation(organization);
  const classDetails = answers.classDetails.trim();
  const structure = answers.governanceStructure === "needs_review" ? "not decided yet"
    : answers.governanceStructure === "multiple_classes" ? (shares ? "several classes of shares" : "several membership classes")
    : (shares ? "one class of shares" : "one membership class");
  const lines: OnboardingAnswerLine[] = [
    { label: shares ? "Share classes" : "Membership classes", value: classDetails ? `${structure} (${classDetails})` : structure },
    { label: "Documents", value: answers.governanceDocuments === "need_to_prepare" ? "you'll draft them here" : answers.governanceDocuments === "available" ? "you have signed copies to upload" : "you need to find or check them" },
    { label: "People", value: answers.peopleReadiness === "ready_to_add" ? "details ready to enter" : "you'll add them later" },
  ];
  if (answers.operatingRegions.trim()) lines.push({ label: "Where you'll operate", value: answers.operatingRegions.trim() });
  const act = incorporationActById(answers.incorporationActId);
  if (act?.actFormedUnder === ANOTHER_ACT_VALUE) lines.push({ label: "Governing Act", value: incorporationActTitle(act, answers.otherActName) });
  return lines;
}

/** `describeOnboardingAnswers` as "Label: value" sentences. */
export function onboardingAnswerSentences(answers: OrganizationOnboardingAnswers | null | undefined, organization: LegalEntityLike): string[] {
  return describeOnboardingAnswers(answers, organization).map((line) => `${line.label}: ${line.value}`);
}

export function validateInitialOrganizationProfile(form: Record<string, any>): void {
  if (!form.name?.trim()) throw new Error("Enter the legal or proposed organization name.");
  if (form.name.length > 300) throw new Error("Organization name must be 300 characters or fewer.");
  for (const key of ["officialEmail", "privacyOfficerEmail"]) if (form[key] && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(form[key])) throw new Error("Enter a valid email address, or leave it for later.");
  if (form.fiscalYearEnd && (!/^\d{2}-\d{2}$/.test(form.fiscalYearEnd) || Number.isNaN(Date.parse(`2000-${form.fiscalYearEnd}T00:00:00Z`)) || new Date(`2000-${form.fiscalYearEnd}T00:00:00Z`).toISOString().slice(5, 10) !== form.fiscalYearEnd)) throw new Error("Fiscal year end must be a valid MM-DD date.");
  if (form.incorporationDate && (!/^\d{4}-\d{2}-\d{2}$/.test(form.incorporationDate) || Number.isNaN(Date.parse(form.incorporationDate)) || new Date(form.incorporationDate).toISOString().slice(0, 10) !== form.incorporationDate)) throw new Error("Incorporation date must be a valid YYYY-MM-DD date.");
}
