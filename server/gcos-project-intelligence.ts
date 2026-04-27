type GcosNextStep = {
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

type GcosRequirement = {
  id: string;
  category: string;
  label: string;
  status: string;
  dueDate?: string;
  notes?: string;
  sourceUrl?: string;
  documentUrl?: string;
  formNumber?: string;
};

type GcosTimelineEvent = {
  label: string;
  date: string;
  status?: string;
  notes?: string;
};

type GcosComplianceFlag = {
  label: string;
  status: string;
  notes?: string;
  requirementId?: string;
};

type GcosUseOfFundsLine = {
  label: string;
  amountCents?: number;
  notes?: string;
};

const EMP5616_DETAIL_URL = "https://catalogue.servicecanada.gc.ca/content/EForms/en/Detail.html?Form=EMP5616";
const EMP5616_FORM_URL = "https://catalogue.servicecanada.gc.ca/content/EForms/en/CallForm.html?Lang=en&PDF=ESDC-EMP5616.pdf";
const GCOS_EED_ADD_URL = "https://srv136.services.gc.ca/OSR/pro/EED/EED/Add";

export type GcosProjectIntelligence = {
  nextAction?: string;
  nextSteps: GcosNextStep[];
  requirements: GcosRequirement[];
  timelineEvents: GcosTimelineEvent[];
  complianceFlags: GcosComplianceFlag[];
  useOfFunds: GcosUseOfFundsLine[];
  keyFacts: string[];
  nextReportDueAtISO?: string;
};

export function deriveGcosProjectIntelligence(snapshot: any, normalizedGrant: any = {}): GcosProjectIntelligence {
  const structured = snapshot?.structured ?? {};
  const projectId = stringValue(snapshot?.projectId);
  const programCode = stringValue(snapshot?.programCode);
  const projectNumber = stringValue(normalizedGrant?.confirmationCode ?? structured.projectInformation?.projectNumber);
  const startDate = dateValue(normalizedGrant?.startDate ?? structured.projectInformation?.startDate);
  const endDate = dateValue(normalizedGrant?.endDate ?? structured.projectInformation?.endDate);
  const requested = numberValue(normalizedGrant?.amountRequestedCents);
  const awarded = numberValue(normalizedGrant?.amountAwardedCents);
  const appliedWeeks = numberFromText(structured.appliedJob?.weeksRequested);
  const approvedWeeks = numberFromText(structured.approvedJob?.weeksApproved);
  const approvedParticipants = numberFromText(structured.approvedJob?.participantsApproved);
  const hasAgreement = /final agreement|signed/i.test(String(structured.agreement?.status ?? snapshot?.agreement?.text ?? ""));
  const directDepositSubmitted = /Direct Deposit[^]*?Submitted on/i.test(String(snapshot?.manage?.text ?? ""));
  const eedHasEntries = Boolean(structured.eed?.hasEntries);
  const documentsAvailable = Boolean(structured.documents?.hasEntries) || /Supporting Documents/i.test(String(snapshot?.manage?.text ?? ""));
  const paymentAvailable = /View Payment Claim and Activity Report/i.test(String(snapshot?.manage?.text ?? ""));

  const requirements: GcosRequirement[] = [
    {
      id: "gcos-application-submitted",
      category: "GCOS",
      label: "Application submitted in GCOS",
      status: "Attached",
      notes: projectNumber ? `Project number ${projectNumber}` : undefined,
    },
    {
      id: "gcos-agreement-finalized",
      category: "Agreement",
      label: "Agreement finalized or signed",
      status: hasAgreement ? "Ready" : "Needed",
      notes: structured.agreement?.status,
    },
    {
      id: "gcos-direct-deposit-submitted",
      category: "Finance",
      label: "Direct deposit submitted",
      status: directDepositSubmitted ? "Ready" : "Needed",
      notes: "Banking values are not imported into Societyer.",
    },
    {
      id: "gcos-approved-job-reviewed",
      category: "Award",
      label: "Approved job details reviewed",
      status: structured.approvedJob?.title ? "Ready" : "Needed",
      notes: approvedParticipants ? `${approvedParticipants} approved participant${approvedParticipants === 1 ? "" : "s"}` : undefined,
    },
    {
      id: "gcos-eed-records",
      category: "Post-award",
      label: "Employer and Employee Declaration records added",
      status: eedHasEntries ? "Ready" : "Needed",
      notes: !eedHasEntries && approvedParticipants
        ? `GCOS currently shows 0 EED entries for ${approvedParticipants} approved participant${approvedParticipants === 1 ? "" : "s"}.`
        : undefined,
    },
    {
      id: "gcos-emp5616-consent",
      category: "Post-award",
      label: "Employee Consent Form (EMP5616) completed and retained",
      status: eedHasEntries ? "Ready" : "Needed",
      dueDate: startDate && !eedHasEntries ? addDays(startDate, 7) : undefined,
      formNumber: "EMP5616",
      sourceUrl: EMP5616_DETAIL_URL,
      documentUrl: EMP5616_FORM_URL,
      notes: "Required before submitting each online Employer and Employee Declaration. Keep signed consent on file; do not import SIN or other sensitive participant identifiers into Societyer.",
    },
    {
      id: "gcos-payment-claim-activity-report",
      category: "Post-award",
      label: "Payment Claim and Activity Report tracked",
      status: paymentAvailable ? "Requested" : "Needed",
      notes: endDate ? "Usually handled after payroll/activity evidence is available." : undefined,
    },
    {
      id: "gcos-supporting-documents",
      category: "Evidence",
      label: "Supporting documents monitored",
      status: documentsAvailable ? "Requested" : "Needed",
      notes: "Use when Service Canada requests additional evidence.",
    },
  ];

  const nextSteps: GcosNextStep[] = [];
  if (!eedHasEntries && approvedParticipants && approvedParticipants > 0) {
    nextSteps.push({
      id: "gcos-prepare-eed",
      label: "Prepare Employer and Employee Declarations",
      status: "Needs action",
      priority: "High",
      dueHint: "Within 7 days of the beginning of CSJ-funded employment.",
      source: "GCOS Employer and Employee Declaration",
      sourceUrl: EMP5616_DETAIL_URL,
      actionLabel: "Add EED records in GCOS",
      actionUrl: GCOS_EED_ADD_URL,
      reason: `GCOS shows 0 EED records and the approved job has ${approvedParticipants} participant${approvedParticipants === 1 ? "" : "s"}.`,
    });
    nextSteps.push({
      id: "gcos-complete-emp5616",
      label: "Collect signed Employee Consent Form (EMP5616)",
      status: "Needs action",
      priority: "High",
      dueHint: "Before each employee declaration is submitted in GCOS.",
      source: "Service Canada Forms Catalogue",
      sourceUrl: EMP5616_DETAIL_URL,
      actionLabel: "Open EMP5616 form",
      actionUrl: EMP5616_FORM_URL,
      reason: "The youth participant must complete the consent form before their information is submitted to ESDC. Link the Societyer employee first, then use their non-sensitive profile details to prepare the package.",
    });
  }
  if (awarded != null && requested != null && awarded !== requested) {
    nextSteps.push({
      id: "gcos-review-award-delta",
      label: "Review approved budget against the original application",
      status: "Review",
      priority: "Medium",
      source: "GCOS Approved Job Details",
      actionLabel: "Update internal budget",
      reason: `ESDC approved ${moneyText(awarded)} against ${moneyText(requested)} requested.`,
    });
  }
  if (paymentAvailable) {
    nextSteps.push({
      id: "gcos-plan-payment-claim",
      label: "Plan Payment Claim and Activity Report evidence",
      status: "Upcoming",
      priority: "Medium",
      dueHint: "No later than 30 days after the last employee completes employment.",
      source: "GCOS Manage",
      actionLabel: "Track payroll and activity evidence",
      reason: "GCOS exposes the payment claim and activity report module for this project.",
    });
  }

  const timelineEvents: GcosTimelineEvent[] = [
    startDate ? { label: "Project start", date: startDate, status: "Scheduled" } : undefined,
    endDate ? { label: "Project end", date: endDate, status: "Scheduled" } : undefined,
    startDate && !eedHasEntries ? {
      label: "EED records expected",
      date: addDays(startDate, 7),
      status: "Due",
      notes: "Derived from approval correspondence guidance: within 7 days of CSJ-funded employment starting.",
    } : undefined,
    endDate && paymentAvailable ? {
      label: "Payment claim/activity report target",
      date: addDays(endDate, 30),
      status: "Due",
      notes: "Derived from GCOS correspondence guidance: no later than 30 days after the last employee completes employment.",
    } : undefined,
  ].filter(Boolean) as GcosTimelineEvent[];

  const complianceFlags: GcosComplianceFlag[] = [
    {
      label: "Sensitive fields excluded",
      status: "Complete",
      notes: "SIN, bank account numbers, and void-cheque document contents are intentionally not exported.",
    },
    {
      label: "GCOS source requires review",
      status: "Review",
      notes: "Imported values are parsed from authenticated GCOS HTML and should be checked before reporting or signing.",
    },
    !eedHasEntries && approvedParticipants ? {
      label: "EED records missing",
      status: "Needed",
      requirementId: "gcos-eed-records",
      notes: `${approvedParticipants} approved participant${approvedParticipants === 1 ? "" : "s"} but no EED entries exported.`,
    } : undefined,
  ].filter(Boolean) as GcosComplianceFlag[];

  const useOfFunds: GcosUseOfFundsLine[] = [
    awarded != null ? {
      label: structured.approvedJob?.title ? `Approved ESDC contribution: ${structured.approvedJob.title}` : "Approved ESDC contribution",
      amountCents: awarded,
      notes: approvedWeeks ? `${approvedWeeks} approved week${approvedWeeks === 1 ? "" : "s"}` : undefined,
    } : undefined,
  ].filter(Boolean) as GcosUseOfFundsLine[];

  const keyFacts = [
    projectNumber ? `Project number: ${projectNumber}` : undefined,
    projectId ? `GCOS project ID: ${projectId}` : undefined,
    programCode ? `Program code: ${programCode}` : undefined,
    awarded != null && requested != null ? `Approved/requested delta: ${moneyText(awarded - requested)}` : undefined,
    approvedParticipants ? `Approved participants: ${approvedParticipants}` : undefined,
    approvedWeeks ? `Approved weeks: ${approvedWeeks}` : undefined,
    appliedWeeks && approvedWeeks && appliedWeeks !== approvedWeeks ? `Requested weeks changed from ${appliedWeeks} to ${approvedWeeks}` : undefined,
  ].filter(Boolean) as string[];

  return {
    nextAction: nextSteps[0]?.label,
    nextSteps,
    requirements,
    timelineEvents,
    complianceFlags,
    useOfFunds,
    keyFacts,
    nextReportDueAtISO: endDate && paymentAvailable ? addDays(endDate, 30) : undefined,
  };
}

function stringValue(value: unknown) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function numberFromText(value: unknown) {
  const match = String(value ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return match ? Number(match[0]) : undefined;
}

function dateValue(value: unknown) {
  const text = String(value ?? "");
  const iso = text.match(/\b(20\d{2}-\d{2}-\d{2})\b/)?.[1];
  if (iso) return iso;
  const parsed = Date.parse(text);
  return Number.isNaN(parsed) ? undefined : new Date(parsed).toISOString().slice(0, 10);
}

function addDays(date: string, days: number) {
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

function moneyText(cents: number) {
  const sign = cents < 0 ? "-" : "";
  return `${sign}$${(Math.abs(cents) / 100).toLocaleString("en-CA", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}
