/**
 * Review priority for import candidates (finding D-08).
 *
 * Stored risk flags were produced by keyword matching over boilerplate notes,
 * so every PGAIR candidate carried "restricted" + "needs review" and the flags
 * could not separate anything. The review queue derives its own risk from what
 * matters to a reviewer:
 *   - legal weight of the record kind (minutes, motions, bylaws, financial
 *     statements, directors and insurance outrank a plain source file),
 *   - required facts that are missing (meeting date, outcome, fiscal period,
 *     policy number, person, source date, readable text),
 *   - restricted content stated by the source itself (a sensitivity field,
 *     "confidential", payroll, banking or SIN in the title/path),
 *   - duplicate source files staged more than once.
 * Pure; used by `importSessions:reviewQueue` and the gate.
 */

export type ReviewRiskLevel = "high" | "medium" | "low";
export type LegalWeight = "high" | "medium" | "low";

const HIGH_WEIGHT_KINDS = new Set([
  "meetingMinutes", "motion", "bylawAmendment", "bylawRuleSet", "financialStatement", "financialStatementImport",
  "boardTerm", "boardRoleAssignment", "boardRoleChange", "director", "signingAuthority", "policy", "insurancePolicy",
  "filing", "member", "conflict", "proxy", "organizationRegistration", "roleHolder", "rightsholdingTransfer",
  "shareCertificate", "dividend", "constatingEvent",
]);
const MEDIUM_WEIGHT_KINDS = new Set([
  "meetingAttendance", "motionEvidence", "budget", "budgetSnapshot", "operatingBudget", "treasurerReport", "grant",
  "grantReport", "committee", "committeeMember", "deadline", "commitment", "fundingSource", "organizationSeat",
  "organizationAddress", "organizationIdentifier", "employee", "volunteer", "pipaTraining", "task", "transactionCandidate",
  "minuteBookItem", "secretVaultItem", "legalTemplate", "generatedLegalDocument",
]);
const WEIGHTY_TARGETS = /(meeting|minute|motion|financ|statement|polic|insurance|director|bylaw|filing|member)/i;

export function legalWeightFor(recordKind: string, targetModule?: string): LegalWeight {
  if (HIGH_WEIGHT_KINDS.has(recordKind)) return "high";
  if (MEDIUM_WEIGHT_KINDS.has(recordKind)) return "medium";
  if ((recordKind === "documentCandidate" || recordKind === "source") && WEIGHTY_TARGETS.test(String(targetModule ?? ""))) return "medium";
  return "low";
}

function text(value: unknown) {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function needsValue(value: unknown) {
  const t = text(value);
  return !t || /^(needs review|unknown|tbd|n\/a|-)$/i.test(t);
}

function hasDateLike(value: unknown) {
  return /\d{4}/.test(text(value));
}

/** Missing facts a reviewer must supply before the record can be trusted. */
export function missingFactsFor(recordKind: string, payload: Record<string, any> = {}, title = ""): string[] {
  const missing: string[] = [];
  const dateIn = (...values: unknown[]) => values.some(hasDateLike);
  switch (recordKind) {
    case "meetingMinutes":
      if (!dateIn(payload.meetingDate, payload.heldAt, payload.scheduledAt)) missing.push("meeting date");
      if (!(Array.isArray(payload.attendees) && payload.attendees.length) && !(Array.isArray(payload.detailedAttendance) && payload.detailedAttendance.length)) missing.push("attendance");
      break;
    case "motion":
      if (!dateIn(payload.meetingDate)) missing.push("meeting date");
      if (needsValue(payload.motionText) && needsValue(payload.text)) missing.push("motion wording");
      if (needsValue(payload.outcome)) missing.push("outcome");
      break;
    case "financialStatement":
    case "financialStatementImport":
    case "budget":
    case "budgetSnapshot":
    case "treasurerReport":
      if (!dateIn(payload.fiscalYear, payload.periodEnd, payload.periodLabel, payload.reportDate, payload.sourceDate)) missing.push("fiscal period");
      if ([payload.revenueCents, payload.expensesCents, payload.totalIncomeCents, payload.totalExpenseCents, payload.netAssetsCents, payload.cashBalanceCents].every((value) => value == null)
        && !(Array.isArray(payload.lines) && payload.lines.length)) missing.push("amounts");
      break;
    case "insurancePolicy":
      if (needsValue(payload.policyNumber)) missing.push("policy number");
      if (needsValue(payload.insurer)) missing.push("insurer");
      if (!dateIn(payload.startDate, payload.endDate, payload.renewalDate, payload.policyTermLabel)) missing.push("policy term");
      break;
    case "boardTerm":
    case "boardRoleAssignment":
    case "boardRoleChange":
    case "director":
    case "signingAuthority":
      if (needsValue(payload.personName) && needsValue(payload.name) && needsValue(payload.firstName)) missing.push("person");
      if (!dateIn(payload.startDate, payload.effectiveDate, payload.termStart, payload.date)) missing.push("effective date");
      break;
    case "policy":
    case "bylawAmendment":
      if (!dateIn(payload.adoptedAt, payload.effectiveDate, payload.filedAtISO, payload.sourceDate, payload.adoptedAtMeetingDate, title)) missing.push("adoption date");
      break;
    case "source":
    case "documentCandidate": {
      if (!dateIn(payload.sourceDate, payload.created, payload.date, payload.documentDate, title, payload.fileName)) missing.push("source date");
      const extracted = text(payload.extractedText);
      if (!extracted) missing.push("readable text");
      else if (extracted.replace(/\s+/g, "").length < 80) missing.push("readable text (very short — scan or OCR?)");
      break;
    }
    default:
      break;
  }
  return missing;
}

const RESTRICTED_SOURCE = /\b(confidential|payroll|salary|salaries|sin\b|social insurance|bank account|void cheque|direct deposit|password|credential|recovery key|medical|disciplinary|personnel file)\b/i;

export function restrictedReasonFor(payload: Record<string, any> = {}, title = "") {
  if (String(payload.sensitivity ?? "").toLowerCase() === "restricted") return "marked restricted at source";
  const haystack = [title, payload.title, payload.fileName, payload.localPath, payload.path, payload.category]
    .map(text)
    .join(" ")
    .concat(" ", text(payload.notes).match(/Original folder path:\s*(.+)/i)?.[1] ?? "");
  const match = haystack.match(RESTRICTED_SOURCE);
  return match ? `mentions "${match[1].toLowerCase()}"` : undefined;
}

const STORED_FLAG_LABELS: Record<string, string> = {
  cleanup: "source mentions OCR, duplicate or date cleanup",
  validation: "failed an import validation check",
};

/** Stored flags that still carry information (not the uniform keyword ones), in words. */
export function meaningfulStoredFlags(flags: unknown): string[] {
  if (!Array.isArray(flags)) return [];
  return flags.map(String).filter((flag) => flag !== "needs review" && flag !== "restricted").map((flag) => STORED_FLAG_LABELS[flag] ?? flag);
}

export type ReviewRisk = {
  level: ReviewRiskLevel;
  score: number;
  legalWeight: LegalWeight;
  reasons: string[];
  missing: string[];
  restricted?: string;
};

export function deriveReviewRisk(record: {
  recordKind: string;
  targetModule?: string;
  title?: string;
  payload?: Record<string, any>;
  riskFlags?: unknown;
  confidence?: string;
}, context: { duplicateCount?: number } = {}): ReviewRisk {
  const payload = record.payload ?? {};
  const legalWeight = legalWeightFor(record.recordKind, record.targetModule);
  const missing = missingFactsFor(record.recordKind, payload, record.title ?? "");
  const restricted = restrictedReasonFor(payload, record.title ?? "");
  const stored = meaningfulStoredFlags(record.riskFlags);
  const reasons: string[] = [];
  let score = legalWeight === "high" ? 3 : legalWeight === "medium" ? 2 : 1;
  if (legalWeight !== "low") reasons.push(legalWeight === "high" ? "legal record" : "governance or finance record");
  for (const fact of missing) reasons.push(`missing ${fact}`);
  score += Math.min(missing.length, 3);
  if (restricted) { reasons.push(`restricted: ${restricted}`); score += 1; }
  for (const flag of stored) {
    if (!reasons.includes(flag)) reasons.push(flag);
    score += flag === STORED_FLAG_LABELS.cleanup ? 0 : 1;
  }
  const confidence = String(record.confidence ?? payload.confidence ?? "").toLowerCase();
  if (confidence === "high") score -= 1;
  if ((context.duplicateCount ?? 1) > 1) reasons.push(`same file staged ${context.duplicateCount}×`);
  const level: ReviewRiskLevel = score >= 5 ? "high" : score >= 3 ? "medium" : "low";
  return { level, score, legalWeight, reasons, missing, restricted };
}

export const REVIEW_RISK_LABELS: Record<ReviewRiskLevel, string> = {
  high: "High priority",
  medium: "Medium",
  low: "Low",
};
