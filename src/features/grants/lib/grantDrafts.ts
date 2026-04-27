import { centsToDollarInput, dollarInputToCents } from "../../../lib/format";

export type GrantRequirementStatus = "Needed" | "Requested" | "Ready" | "Attached" | "Waived";

export type GrantRequirement = {
  id: string;
  category: string;
  label: string;
  status: GrantRequirementStatus;
  dueDate?: string;
  documentId?: string;
  notes?: string;
  sourceUrl?: string;
  documentUrl?: string;
  formNumber?: string;
};

type GrantUseOfFundsLine = {
  label: string;
  amountCents?: number;
  notes?: string;
};

type GrantTimelineEvent = {
  label: string;
  date: string;
  status?: string;
  notes?: string;
};

type GrantComplianceFlag = {
  label: string;
  status: string;
  notes?: string;
  requirementId?: string;
};

type GrantNextStep = {
  id: string;
  label: string;
  status: string;
  priority: string;
  dueHint?: string;
  source?: string;
  sourceUrl?: string;
  actionLabel?: string;
  actionUrl?: string;
  reason?: string;
};

type GrantContact = {
  role: string;
  name?: string;
  organization?: string;
  email?: string;
  phone?: string;
  notes?: string;
};

type GrantAnswerLibraryItem = {
  section: string;
  title: string;
  body: string;
};

export type RequirementTemplateKey = "core" | "bcGaming" | "canadaSummerJobs";

export const REQUIREMENT_STATUSES: GrantRequirementStatus[] = [
  "Needed",
  "Requested",
  "Ready",
  "Attached",
  "Waived",
];

export const GRANT_REQUIREMENT_TEMPLATES: Record<
  RequirementTemplateKey,
  { label: string; items: Omit<GrantRequirement, "status">[] }
> = {
  core: {
    label: "Core",
    items: [
      { id: "core-opportunity-fit", category: "Prospect", label: "Eligibility and fit confirmed" },
      { id: "core-owner", category: "Ownership", label: "Board owner and internal reviewer assigned" },
      { id: "core-budget", category: "Finance", label: "Requested amount and budget notes prepared" },
      { id: "core-application-draft", category: "Application", label: "Application narrative drafted" },
      { id: "core-submission-confirmation", category: "Submission", label: "Submission confirmation saved" },
      { id: "core-reporting-calendar", category: "Post-award", label: "Reporting deadlines added" },
    ],
  },
  bcGaming: {
    label: "BC Gaming",
    items: [
      { id: "bc-bylaws", category: "Organization", label: "Certified constitution and bylaws attached" },
      { id: "bc-board-list", category: "Governance", label: "Board list and officer details ready" },
      { id: "bc-agm-minutes", category: "Governance", label: "AGM minutes with board election evidence attached" },
      { id: "bc-org-financials", category: "Finance", label: "Prior-year financial statements and current budget attached" },
      { id: "bc-gaming-account", category: "Finance", label: "Gaming account evidence reviewed" },
      { id: "bc-program-description", category: "Program", label: "Program description and community benefit narrative ready" },
      { id: "bc-program-financials", category: "Program", label: "Program actuals or simplified financials attached" },
      { id: "bc-program-budget", category: "Program", label: "Program budget attached when required" },
      { id: "bc-inkind", category: "Program", label: "In-kind contribution summary attached when claimed" },
      { id: "bc-officers", category: "Submission", label: "Two officers, submitter, contact, and delivery emails confirmed" },
      { id: "bc-confirmation", category: "Submission", label: "Application ID and confirmation PDF saved" },
      { id: "bc-summary-report", category: "Post-award", label: "Gaming Account Summary Report deadline tracked" },
    ],
  },
  canadaSummerJobs: {
    label: "Canada Summer Jobs",
    items: [
      { id: "csj-gcos-authority", category: "Access", label: "GCOS access and primary officer authority confirmed" },
      { id: "csj-org-profile", category: "Organization", label: "Legal name, CRA/business number, mandate, and address ready" },
      { id: "csj-project-dates", category: "Project", label: "Project title, start date, end date, and location confirmed" },
      { id: "csj-job-details", category: "Project", label: "Job activities, supervision, and youth employment details prepared" },
      { id: "csj-wage-budget", category: "Finance", label: "Wage, hours, and requested contribution calculated" },
      { id: "csj-contacts", category: "Contacts", label: "Primary and secondary contacts confirmed" },
      { id: "csj-attestation", category: "Submission", label: "Privacy, attestation, and signatory details reviewed" },
      { id: "csj-confirmation", category: "Submission", label: "Submission confirmation saved" },
    ],
  },
};

export function optionalString(value: unknown) {
  const text = String(value ?? "").trim();
  return text ? text : undefined;
}

function optionalNumber(value: unknown) {
  if (value === "" || value === undefined || value === null) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

export function cleanStringList(value: unknown) {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => String(item ?? "").trim())
    .filter(Boolean);
}

function splitStringList(value: unknown) {
  if (Array.isArray(value)) return cleanStringList(value);
  return Array.from(
    new Set(
      String(value ?? "")
        .split(",")
        .map((item) => item.trim())
        .filter(Boolean),
    ),
  );
}

export function asUseOfFunds(value: unknown): GrantUseOfFundsLine[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    label: String(item?.label ?? ""),
    amountCents: optionalNumber(item?.amountCents),
    notes: optionalString(item?.notes),
  }));
}

function sanitizeUseOfFunds(value: unknown) {
  return asUseOfFunds(value).filter((item) => item.label.trim());
}

export function asTimelineEvents(value: unknown): GrantTimelineEvent[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    label: String(item?.label ?? ""),
    date: String(item?.date ?? ""),
    status: optionalString(item?.status),
    notes: optionalString(item?.notes),
  }));
}

function sanitizeTimelineEvents(value: unknown) {
  return asTimelineEvents(value).filter((item) => item.label.trim() && item.date.trim());
}

export function asComplianceFlags(value: unknown): GrantComplianceFlag[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    label: String(item?.label ?? ""),
    status: String(item?.status ?? "Info"),
    notes: optionalString(item?.notes),
    requirementId: optionalString(item?.requirementId),
  }));
}

function sanitizeComplianceFlags(value: unknown) {
  return asComplianceFlags(value).filter((item) => item.label.trim());
}

export function asNextSteps(value: unknown): GrantNextStep[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any, index) => ({
    id: optionalString(item?.id) ?? `next-step-${index + 1}`,
    label: String(item?.label ?? ""),
    status: String(item?.status ?? "Open"),
    priority: String(item?.priority ?? "Medium"),
    dueHint: optionalString(item?.dueHint),
    source: optionalString(item?.source),
    sourceUrl: optionalString(item?.sourceUrl),
    actionLabel: optionalString(item?.actionLabel),
    actionUrl: optionalString(item?.actionUrl),
    reason: optionalString(item?.reason),
  }));
}

function sanitizeNextSteps(value: unknown) {
  return asNextSteps(value).filter((item) => item.label.trim());
}

export function asContacts(value: unknown): GrantContact[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    role: optionalString(item?.role) ?? "Contact",
    name: optionalString(item?.name),
    organization: optionalString(item?.organization),
    email: optionalString(item?.email),
    phone: optionalString(item?.phone),
    notes: optionalString(item?.notes),
  }));
}

function sanitizeContacts(value: unknown) {
  return asContacts(value).filter((item) =>
    [item.role, item.name, item.organization, item.email, item.phone, item.notes]
      .some((part) => String(part ?? "").trim()),
  );
}

export function asAnswerLibrary(value: unknown): GrantAnswerLibraryItem[] {
  if (!Array.isArray(value)) return [];
  return value.map((item: any) => ({
    section: String(item?.section ?? "Application answer"),
    title: String(item?.title ?? ""),
    body: String(item?.body ?? ""),
  }));
}

function sanitizeAnswerLibrary(value: unknown) {
  return asAnswerLibrary(value).filter((item) => item.title.trim() && item.body.trim());
}

export function asRequirements(value: unknown): GrantRequirement[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item: any) => ({
      id: String(item?.id ?? `custom-${Date.now()}`),
      category: String(item?.category ?? "Custom"),
      label: String(item?.label ?? ""),
      status: REQUIREMENT_STATUSES.includes(item?.status) ? item.status : "Needed",
      dueDate: optionalString(item?.dueDate),
      documentId: optionalString(item?.documentId),
      notes: optionalString(item?.notes),
      sourceUrl: optionalString(item?.sourceUrl),
      documentUrl: optionalString(item?.documentUrl),
      formNumber: optionalString(item?.formNumber),
    }));
}

function sanitizeRequirements(value: unknown) {
  return asRequirements(value).filter((item) => item.label.trim());
}

export function mergeTemplateRequirements(
  current: GrantRequirement[] | undefined,
  templateKey: RequirementTemplateKey,
) {
  const existing = new Map(asRequirements(current).map((item) => [item.id, item]));
  for (const item of GRANT_REQUIREMENT_TEMPLATES[templateKey].items) {
    if (!existing.has(item.id)) {
      existing.set(item.id, { ...item, status: "Needed" });
    }
  }
  return Array.from(existing.values());
}

export function requirementSummary(requirements: GrantRequirement[] | undefined) {
  const rows = asRequirements(requirements);
  const complete = rows.filter((row) =>
    ["Ready", "Attached", "Waived"].includes(row.status),
  ).length;
  const attached = rows.filter((row) => row.documentId).length;
  const total = rows.length;
  return {
    total,
    complete,
    attached,
    percent: total > 0 ? Math.round((complete / total) * 100) : 0,
  };
}

export function requirementStatusTone(status: GrantRequirementStatus): "success" | "warn" | "info" {
  if (status === "Attached" || status === "Ready" || status === "Waived") return "success";
  if (status === "Requested") return "warn";
  return "info";
}

function grantRiskFlags(draft: any) {
  const flags = new Set(splitStringList(draft.riskFlagsInput ?? draft.riskFlags));
  if (draft.sensitivity === "restricted") flags.add("restricted");
  if ((draft.confidence ?? "") === "Review") flags.add("needs review");
  return Array.from(flags);
}

export function buildGrantPayload(draft: any, societyId: any, actingUserId: any) {
  return {
    id: draft.id,
    societyId,
    committeeId: draft.committeeId || undefined,
    boardOwnerUserId: draft.boardOwnerUserId || undefined,
    linkedFinancialAccountId: draft.linkedFinancialAccountId || undefined,
    opportunityUrl: optionalString(draft.opportunityUrl),
    opportunityType: optionalString(draft.opportunityType),
    priority: optionalString(draft.priority),
    fitScore: optionalNumber(draft.fitScore),
    nextAction: optionalString(draft.nextAction),
    publicDescription: optionalString(draft.publicDescription),
    allowPublicApplications: !!draft.allowPublicApplications,
    applicationInstructions: optionalString(draft.applicationInstructions),
    requirements: sanitizeRequirements(draft.requirements),
    confirmationCode: optionalString(draft.confirmationCode),
    sourcePath: optionalString(draft.sourcePath),
    sourceImportedAtISO: optionalString(draft.sourceImportedAtISO),
    sourceFileCount: optionalNumber(draft.sourceFileCount),
    sourceDocumentIds: cleanStringList(draft.sourceDocumentIds) as any,
    sourceExternalIds: splitStringList(draft.sourceExternalIdsInput ?? draft.sourceExternalIds),
    confidence: optionalString(draft.confidence),
    sensitivity: optionalString(draft.sensitivity),
    riskFlags: grantRiskFlags(draft),
    sourceNotes: optionalString(draft.sourceNotes),
    keyFacts: cleanStringList(draft.keyFacts),
    useOfFunds: sanitizeUseOfFunds(draft.useOfFunds),
    timelineEvents: sanitizeTimelineEvents(draft.timelineEvents),
    complianceFlags: sanitizeComplianceFlags(draft.complianceFlags),
    nextSteps: sanitizeNextSteps(draft.nextSteps),
    contacts: sanitizeContacts(draft.contacts),
    answerLibrary: sanitizeAnswerLibrary(draft.answerLibrary),
    title: draft.title,
    funder: draft.funder,
    program: optionalString(draft.program),
    status: draft.status,
    amountRequestedCents: dollarInputToCents(draft.amountRequestedDollars),
    amountAwardedCents: dollarInputToCents(draft.amountAwardedDollars),
    restrictedPurpose: optionalString(draft.restrictedPurpose),
    applicationDueDate: optionalString(draft.applicationDueDate),
    submittedAtISO: optionalString(draft.submittedAtISO),
    decisionAtISO: optionalString(draft.decisionAtISO),
    startDate: optionalString(draft.startDate),
    endDate: optionalString(draft.endDate),
    nextReportDueAtISO: optionalString(draft.nextReportDueAtISO),
    notes: optionalString(draft.notes),
    actingUserId,
  };
}

export function newGrantDraft(societyId: any) {
  return {
    societyId,
    title: "",
    funder: "",
    program: "",
    status: "Prospecting",
    opportunityType: "Government",
    priority: "Medium",
    fitScore: "",
    nextAction: "",
    opportunityUrl: "",
    applicationDueDate: new Date().toISOString().slice(0, 10),
    allowPublicApplications: false,
    sourceDocumentIds: [],
    sourceExternalIdsInput: "",
    confidence: "",
    sensitivity: "",
    riskFlagsInput: "",
    requirements: [],
    keyFacts: [],
    useOfFunds: [],
    timelineEvents: [],
    complianceFlags: [],
    nextSteps: [],
    contacts: [],
    answerLibrary: [],
  };
}

export function grantToDraft(row: any) {
  return {
    ...row,
    id: row._id,
    fitScore: row.fitScore ?? "",
    sourceDocumentIds: cleanStringList(row.sourceDocumentIds),
    sourceExternalIdsInput: (row.sourceExternalIds ?? []).join(", "),
    confidence: row.confidence ?? "",
    sensitivity: row.sensitivity ?? "",
    riskFlagsInput: (row.riskFlags ?? []).join(", "),
    amountRequestedDollars: centsToDollarInput(row.amountRequestedCents),
    amountAwardedDollars: centsToDollarInput(row.amountAwardedCents),
    requirements: asRequirements(row.requirements),
    keyFacts: cleanStringList(row.keyFacts),
    useOfFunds: asUseOfFunds(row.useOfFunds),
    timelineEvents: asTimelineEvents(row.timelineEvents),
    complianceFlags: asComplianceFlags(row.complianceFlags),
    nextSteps: asNextSteps(row.nextSteps),
    contacts: asContacts(row.contacts),
    answerLibrary: asAnswerLibrary(row.answerLibrary),
  };
}

export function buildReportPayload(draft: any, societyId: any, actingUserId: any) {
  return {
    id: draft.id,
    societyId,
    grantId: draft.grantId,
    title: draft.title,
    dueAtISO: draft.dueAtISO,
    submittedAtISO: optionalString(draft.submittedAtISO),
    status: draft.status,
    spendingToDateCents: dollarInputToCents(draft.spendingToDateDollars),
    outcomeSummary: optionalString(draft.outcomeSummary),
    documentId: draft.documentId || undefined,
    submittedByUserId: draft.submittedAtISO ? actingUserId : undefined,
    notes: optionalString(draft.notes),
    actingUserId,
  };
}

export function buildTransactionPayload(draft: any, societyId: any, actingUserId: any) {
  return {
    id: draft.id,
    societyId,
    grantId: draft.grantId,
    financialTransactionId: draft.financialTransactionId || undefined,
    documentId: draft.documentId || undefined,
    date: draft.date,
    direction: draft.direction,
    amountCents: dollarInputToCents(draft.amountDollars) ?? 0,
    description: draft.description,
    notes: optionalString(draft.notes),
    actingUserId,
  };
}
