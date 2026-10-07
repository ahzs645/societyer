/**
 * Agreements register kernel (schema finding A5): vocabulary, validation,
 * status derivation, renewal and obligation dates, the signing-authority tier
 * check and continuity gaps. Pure and dependency-free (apart from the signing
 * tier helper) so the portable handlers, the import/intake staging, the UI and
 * the gate scripts all apply the same rules.
 *
 * Status is never assumed: a record is `active` only when a person (or a
 * source that says so) set it; `expired` is derived from the end date; an
 * imported or converted agreement without evidence stays `draft` / `unknown`
 * with review status `NeedsReview`.
 */

import { signingTierForAmount, type SigningAuthorityTier } from "./signingAuthorityTiers";

export const AGREEMENT_KINDS = [
  "service", "funding", "lease", "consulting", "MOU", "partnership", "employment", "licence", "data_sharing", "other",
] as const;
export type AgreementKind = (typeof AGREEMENT_KINDS)[number];

export const AGREEMENT_KIND_LABELS: Record<AgreementKind, string> = {
  service: "Service",
  funding: "Funding",
  lease: "Lease",
  consulting: "Consulting",
  MOU: "MOU",
  partnership: "Partnership",
  employment: "Employment",
  licence: "Licence",
  data_sharing: "Data sharing",
  other: "Other",
};

export const AGREEMENT_STATUSES = ["draft", "negotiating", "active", "expired", "terminated", "superseded", "unknown"] as const;
export type AgreementStatus = (typeof AGREEMENT_STATUSES)[number];

export const AGREEMENT_STATUS_LABELS: Record<AgreementStatus, string> = {
  draft: "Draft",
  negotiating: "Negotiating",
  active: "Active",
  expired: "Expired",
  terminated: "Terminated",
  superseded: "Superseded",
  unknown: "Unknown",
};

/** Statuses after which an agreement creates no further obligations. */
export const CLOSED_AGREEMENT_STATUSES: ReadonlySet<string> = new Set(["expired", "terminated", "superseded"]);

export const PARTY_ROLES = ["us", "counterparty", "funder", "guarantor", "other"] as const;
export type PartyRole = (typeof PARTY_ROLES)[number];
export const PARTY_ROLE_LABELS: Record<PartyRole, string> = {
  us: "Our organization",
  counterparty: "Counterparty",
  funder: "Funder",
  guarantor: "Guarantor",
  other: "Other",
};
/** Roles that count as "the other side" of an agreement. */
export const COUNTERPARTY_ROLES: ReadonlySet<string> = new Set(["counterparty", "funder"]);

export const DELIVERABLE_STATUSES = ["not_started", "in_progress", "submitted", "accepted", "waived"] as const;
export type DeliverableStatus = (typeof DELIVERABLE_STATUSES)[number];
export const DELIVERABLE_STATUS_LABELS: Record<DeliverableStatus, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  submitted: "Submitted",
  accepted: "Accepted",
  waived: "Waived",
};
/** Deliverable / report statuses that discharge the obligation. */
export const DONE_OBLIGATION_STATUSES: ReadonlySet<string> = new Set(["submitted", "accepted", "waived"]);

export const REPORTING_RECURRENCES = ["once", "monthly", "quarterly", "semiannual", "annual"] as const;
export type ReportingRecurrence = (typeof REPORTING_RECURRENCES)[number];
export const REPORTING_RECURRENCE_LABELS: Record<ReportingRecurrence, string> = {
  once: "Once",
  monthly: "Monthly",
  quarterly: "Quarterly",
  semiannual: "Every 6 months",
  annual: "Annual",
};

export const RENEWAL_DECISIONS = ["undecided", "renew", "renegotiate", "let_expire", "terminate"] as const;
export type RenewalDecision = (typeof RENEWAL_DECISIONS)[number];
export const RENEWAL_DECISION_LABELS: Record<RenewalDecision, string> = {
  undecided: "Undecided",
  renew: "Renew",
  renegotiate: "Renegotiate",
  let_expire: "Let it expire",
  terminate: "Terminate",
};

export const AGREEMENT_REVIEW_STATUSES = ["NeedsReview", "Verified", "Rejected"] as const;

/** Days ahead the register and dashboard treat as "expiring soon". */
export const EXPIRING_WINDOW_DAYS = 90;

export type AgreementParty = { name: string; role: string; organizationName?: string; directoryPersonId?: string; contact?: string; notes?: string };
export type AgreementSignatory = { name: string; title?: string; directoryPersonId?: string; signedAtISO?: string };
export type AgreementDeliverable = { id: string; text: string; dueDate?: string; owner?: string; ownerPersonId?: string; status?: string; completedAtISO?: string; notes?: string };
export type AgreementReporting = { id: string; text: string; dueDate?: string; recurrence?: string; recipient?: string; status?: string; submittedAtISO?: string; notes?: string };
export type AgreementPayment = { label: string; dueDate?: string; amountCents?: number; status?: string };

/** The fields the kernel reads. Rows carry more. */
export type AgreementLike = {
  _id?: string;
  title?: string;
  kind?: string;
  status?: string;
  parties?: AgreementParty[];
  ourSignatories?: AgreementSignatory[];
  counterpartySignatories?: AgreementSignatory[];
  effectiveDate?: string;
  endDate?: string;
  signedDate?: string;
  autoRenew?: boolean;
  renewalTermMonths?: number;
  renewalNoticeDays?: number;
  terminationNoticeDays?: number;
  valueCents?: number;
  currency?: string;
  paymentSchedule?: AgreementPayment[];
  deliverables?: AgreementDeliverable[];
  reportingObligations?: AgreementReporting[];
  renewalDecision?: { decision?: string; decidedAtISO?: string; notes?: string; motionId?: string };
  renewalOfId?: string;
  supersedesId?: string;
  supersededById?: string;
  approvedAtMeetingId?: string;
  approvalMotionId?: string;
  terminatedAtISO?: string;
  reviewStatus?: string;
};

export type FieldErrors = Record<string, string>;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

export function isIsoDay(value: unknown): value is string {
  if (typeof value !== "string" || !ISO_DAY.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d;
}

/** Calendar-day arithmetic on YYYY-MM-DD (UTC, so the result never depends on the machine's zone). */
export function addDaysIso(day: string, days: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

export function addMonthsIso(day: string, months: number): string {
  const [y, m, d] = day.split("-").map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  return new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth(), Math.min(d, last))).toISOString().slice(0, 10);
}

export function daysBetweenIso(from: string, to: string): number {
  const utc = (day: string) => {
    const [y, m, d] = day.split("-").map(Number);
    return Date.UTC(y, m - 1, d);
  };
  return Math.round((utc(to) - utc(from)) / 86_400_000);
}

const text = (value: unknown) => (typeof value === "string" ? value.trim() : "");
const present = (value: unknown) => value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");

export function isAgreementKind(value: unknown): value is AgreementKind {
  return typeof value === "string" && (AGREEMENT_KINDS as readonly string[]).includes(value);
}
export function isAgreementStatus(value: unknown): value is AgreementStatus {
  return typeof value === "string" && (AGREEMENT_STATUSES as readonly string[]).includes(value);
}

/** The agreement has at least one counterparty or funder party with a name. */
export function hasCounterparty(parties: readonly AgreementParty[] | undefined): boolean {
  return (parties ?? []).some((party) => COUNTERPARTY_ROLES.has(String(party?.role)) && text(party?.name));
}

/** The counterparty names shown in lists ("Acme Ltd; City of Example"). */
export function counterpartyNames(parties: readonly AgreementParty[] | undefined): string[] {
  return (parties ?? []).filter((party) => party && party.role !== "us" && text(party.name)).map((party) => text(party.name));
}

/**
 * Field-keyed validation. `partial` validates only the fields present (an edit
 * of one field). `requireCounterparty` (default true on a full record) is
 * relaxed for imported/converted drafts whose source names no party: those are
 * flagged for review instead of being rejected.
 */
export function validateAgreementInput(
  input: Record<string, any>,
  options: { partial?: boolean; requireCounterparty?: boolean; existing?: AgreementLike } = {},
): FieldErrors {
  const errors: FieldErrors = {};
  const partial = Boolean(options.partial);
  const has = (key: string) => Object.prototype.hasOwnProperty.call(input, key);
  const merged: Record<string, any> = { ...(options.existing ?? {}), ...input };
  if (!partial || has("title")) {
    if (!text(input.title)) errors.title = "Give the agreement a title.";
    else if (text(input.title).length > 300) errors.title = "Keep the title under 300 characters.";
  }
  if ((!partial || has("kind")) && present(input.kind) && !isAgreementKind(input.kind)) errors.kind = "Choose a kind from the list.";
  if ((!partial || has("status")) && present(input.status) && !isAgreementStatus(input.status)) errors.status = "Choose a status from the list.";
  for (const key of ["effectiveDate", "endDate", "signedDate", "terminatedAtISO"]) {
    if (has(key) && present(input[key]) && !isIsoDay(input[key])) errors[key] = "Use a date (YYYY-MM-DD).";
  }
  if (!errors.effectiveDate && !errors.endDate && isIsoDay(merged.effectiveDate) && isIsoDay(merged.endDate) && merged.endDate < merged.effectiveDate && (has("effectiveDate") || has("endDate") || !partial)) {
    errors.endDate = "The end date must be on or after the effective date.";
  }
  if (has("valueCents") && present(input.valueCents)) {
    const value = Number(input.valueCents);
    if (!Number.isFinite(value) || value < 0) errors.valueCents = "The value cannot be negative.";
    else if (!Number.isInteger(value)) errors.valueCents = "Enter the value in whole cents.";
  }
  for (const key of ["renewalNoticeDays", "terminationNoticeDays", "renewalTermMonths"]) {
    if (has(key) && present(input[key])) {
      const value = Number(input[key]);
      if (!Number.isInteger(value) || value < 0) errors[key] = "Use a whole number of zero or more.";
      else if (value > 3650) errors[key] = "That is more than ten years.";
    }
  }
  if (has("currency") && present(input.currency) && !/^[A-Z]{3}$/.test(text(input.currency))) errors.currency = "Use a three-letter currency code such as CAD.";
  if (has("parties") || !partial) {
    const parties: any[] = Array.isArray(input.parties) ? input.parties : [];
    parties.forEach((party, index) => {
      if (!text(party?.name)) errors[`parties.${index}.name`] = "Each party needs a name.";
      if (!(PARTY_ROLES as readonly string[]).includes(String(party?.role))) errors[`parties.${index}.role`] = "Choose the party's role.";
    });
    if ((options.requireCounterparty ?? true) && !hasCounterparty(parties)) errors.parties = "Add at least one counterparty or funder.";
  }
  if (has("paymentSchedule") && Array.isArray(input.paymentSchedule)) {
    input.paymentSchedule.forEach((row: any, index: number) => {
      if (present(row?.amountCents) && (!Number.isFinite(Number(row.amountCents)) || Number(row.amountCents) < 0)) errors[`paymentSchedule.${index}.amountCents`] = "Payment amounts cannot be negative.";
      if (present(row?.dueDate) && !isIsoDay(row.dueDate)) errors[`paymentSchedule.${index}.dueDate`] = "Use a date (YYYY-MM-DD).";
    });
  }
  for (const key of ["deliverables", "reportingObligations"] as const) {
    if (!has(key) || !Array.isArray(input[key])) continue;
    input[key].forEach((row: any, index: number) => {
      if (!text(row?.text)) errors[`${key}.${index}.text`] = key === "deliverables" ? "Describe each deliverable." : "Describe each reporting obligation.";
      if (present(row?.dueDate) && !isIsoDay(row.dueDate)) errors[`${key}.${index}.dueDate`] = "Use a date (YYYY-MM-DD).";
      if (present(row?.status) && !(DELIVERABLE_STATUSES as readonly string[]).includes(String(row.status))) errors[`${key}.${index}.status`] = "Choose a status from the list.";
      if (key === "reportingObligations" && present(row?.recurrence) && !(REPORTING_RECURRENCES as readonly string[]).includes(String(row.recurrence))) errors[`${key}.${index}.recurrence`] = "Choose how often the report is due.";
    });
  }
  if (has("renewalDecision") && input.renewalDecision && !(RENEWAL_DECISIONS as readonly string[]).includes(String(input.renewalDecision.decision))) errors.renewalDecision = "Choose a renewal decision.";
  return errors;
}

export function assertAgreementValid(errors: FieldErrors): void {
  const messages = [...new Set(Object.values(errors))];
  if (messages.length) throw new Error(`Agreement: ${messages.slice(0, 3).join(" ")}`);
}

/**
 * The end of the term that is current on `today`. With auto-renewal the term
 * rolls forward by `renewalTermMonths` (default 12) until it covers today.
 */
export function currentTermEnd(agreement: AgreementLike, today: string): string | undefined {
  const end = agreement.endDate;
  if (!isIsoDay(end)) return undefined;
  if (!agreement.autoRenew || end >= today) return end;
  const months = agreement.renewalTermMonths && agreement.renewalTermMonths > 0 ? agreement.renewalTermMonths : 12;
  let next = end;
  for (let guard = 0; next < today && guard < 600; guard += 1) next = addMonthsIso(next, months);
  return next;
}

/**
 * The status to show. Only the end date changes a stored status: an `active`
 * or `unknown` agreement whose (non-renewing) term ended is `expired`. Nothing
 * becomes `active` here; that needs evidence a person records.
 */
export function deriveAgreementStatus(agreement: AgreementLike, today: string): AgreementStatus {
  const stored = isAgreementStatus(agreement.status) ? agreement.status : "unknown";
  if (stored === "terminated" || stored === "superseded" || stored === "expired") return stored;
  if (agreement.supersededById) return "superseded";
  if ((stored === "active" || stored === "unknown") && isIsoDay(agreement.endDate) && agreement.endDate < today && !agreement.autoRenew) return "expired";
  return stored;
}

/** Last day to give renewal (or non-renewal) notice for the current term. */
export function renewalNoticeDate(agreement: AgreementLike, today: string): string | undefined {
  const end = currentTermEnd(agreement, today);
  if (!end || agreement.renewalNoticeDays === undefined || agreement.renewalNoticeDays === null) return undefined;
  return addDaysIso(end, -Math.max(0, Number(agreement.renewalNoticeDays) || 0));
}

/** The date the register shows as "renewal due": the notice date when there is one, else the term end. */
export function renewalDueDate(agreement: AgreementLike, today: string): string | undefined {
  return renewalNoticeDate(agreement, today) ?? currentTermEnd(agreement, today);
}

export function isExpiringWithin(agreement: AgreementLike, today: string, days = EXPIRING_WINDOW_DAYS): boolean {
  const status = deriveAgreementStatus(agreement, today);
  if (CLOSED_AGREEMENT_STATUSES.has(status)) return false;
  const end = currentTermEnd(agreement, today);
  return Boolean(end && end >= today && daysBetweenIso(today, end) <= days);
}

/** True once a renewal decision (or a successor version) exists. */
export function hasRenewalDecision(agreement: AgreementLike): boolean {
  if (agreement.supersededById) return true;
  const decision = agreement.renewalDecision?.decision;
  return Boolean(decision && decision !== "undecided");
}

/* ----------------------------- obligations ----------------------------- */

export type AgreementObligation = {
  /** Stable key per agreement + obligation, used to keep generated deadlines in sync. */
  sourceKey: string;
  title: string;
  dueDate: string;
  category: "Agreement deliverable" | "Agreement reporting" | "Agreement renewal" | "Agreement";
  description?: string;
  recurrence?: string;
};

const DEADLINE_RECURRENCE: Record<string, string | undefined> = { monthly: "Monthly", quarterly: "Quarterly", annual: "Annual" };

/**
 * Deadlines an agreement implies: deliverable and report due dates, the
 * renewal-notice date and the end of the term. A closed agreement implies
 * none. An unreviewed draft only implies future dates, so converting old
 * contracts never floods the deadline list with historical rows; an active
 * agreement keeps its past-due obligations (they are overdue).
 */
export function agreementObligations(agreement: AgreementLike, today: string): AgreementObligation[] {
  const status = deriveAgreementStatus(agreement, today);
  if (CLOSED_AGREEMENT_STATUSES.has(status)) return [];
  const includePast = status === "active";
  const keep = (date: string | undefined): date is string => isIsoDay(date) && (includePast || date >= today);
  const title = text(agreement.title) || "Agreement";
  const short = title.length > 120 ? `${title.slice(0, 117)}…` : title;
  const out: AgreementObligation[] = [];
  for (const deliverable of agreement.deliverables ?? []) {
    if (!keep(deliverable.dueDate) || DONE_OBLIGATION_STATUSES.has(String(deliverable.status))) continue;
    out.push({ sourceKey: `deliverable:${deliverable.id}`, title: `Deliverable due — ${short}`, dueDate: deliverable.dueDate, category: "Agreement deliverable", description: [text(deliverable.text), deliverable.owner ? `Owner: ${deliverable.owner}` : ""].filter(Boolean).join("\n").slice(0, 1000) });
  }
  for (const report of agreement.reportingObligations ?? []) {
    if (!keep(report.dueDate) || DONE_OBLIGATION_STATUSES.has(String(report.status))) continue;
    const recurrence = DEADLINE_RECURRENCE[String(report.recurrence ?? "")];
    out.push({ sourceKey: `report:${report.id}`, title: `Report due — ${short}`, dueDate: report.dueDate, category: "Agreement reporting", description: [text(report.text), report.recipient ? `To: ${report.recipient}` : ""].filter(Boolean).join("\n").slice(0, 1000), ...(recurrence ? { recurrence } : {}) });
  }
  const end = currentTermEnd(agreement, today);
  const notice = renewalNoticeDate(agreement, today);
  if (!hasRenewalDecision(agreement)) {
    if (notice && keep(notice)) out.push({ sourceKey: `renewal-notice:${end}`, title: `Renewal notice due — ${short}`, dueDate: notice, category: "Agreement renewal", description: `Give notice ${agreement.renewalNoticeDays} days before the term ends on ${end}${agreement.autoRenew ? " (it renews automatically unless notice is given)" : ""}.` });
  }
  if (end && keep(end) && !agreement.supersededById) out.push({ sourceKey: `term-end:${end}`, title: `Agreement ends — ${short}`, dueDate: end, category: "Agreement", description: agreement.autoRenew ? "End of the current term; the agreement renews automatically." : "End of the term." });
  return out;
}

/* ------------------------- signing authority ------------------------- */

export type SigningAuthorityRow = {
  personName?: string;
  roleTitle?: string;
  directoryPersonId?: string;
  authorityType?: string;
  tiers?: SigningAuthorityTier[];
  effectiveDate?: string;
  endDate?: string;
  status?: string;
};

export type SigningCheck = {
  /** ok: satisfied; warning: not satisfied; no_value: no amount to check; no_tiers: no tiers on record. */
  status: "ok" | "warning" | "no_value" | "no_tiers";
  tier?: SigningAuthorityTier;
  signaturesRequired?: number;
  signatures: number;
  boardApprovalRequired: boolean;
  issues: string[];
};

const nameKey = (value: unknown) => String(value ?? "").toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

function tierNeedsBoard(tier: SigningAuthorityTier): boolean {
  return (tier.roles ?? []).some((role) => /\bboard\b/i.test(role)) || /\bboard (?:approval|resolution|motion)\b|\bapproved by the board\b/i.test(tier.notes ?? "");
}

/**
 * Compare the agreement's value with the signing-authority tiers (A17) in
 * force on its signing or effective date: enough of our signatories, named
 * signatories who hold signing authority, roles the tier names, and a board
 * approval (authorizing motion or meeting) when the tier calls for one.
 */
export function signingAuthorityCheck(agreement: AgreementLike, authorities: readonly SigningAuthorityRow[], today: string): SigningCheck {
  const signatories = (agreement.ourSignatories ?? []).filter((row) => text(row?.name) || row?.directoryPersonId);
  const base: SigningCheck = { status: "no_value", signatures: signatories.length, boardApprovalRequired: false, issues: [] };
  if (typeof agreement.valueCents !== "number" || !Number.isFinite(agreement.valueCents)) return base;
  const asOf = [agreement.signedDate, agreement.effectiveDate, today].find(isIsoDay)!;
  const inForce = authorities.filter((row) => {
    if (row.status && /^(?:inactive|revoked|ended|removed|archived)$/i.test(row.status)) return false;
    if (isIsoDay(row.effectiveDate) && row.effectiveDate > asOf) return false;
    if (isIsoDay(row.endDate) && row.endDate < asOf) return false;
    return true;
  });
  const tiers = inForce.flatMap((row) => row.tiers ?? []);
  if (!tiers.length) return { ...base, status: "no_tiers", issues: ["No signing-authority tiers are on record; add them under Signing authorities to check this agreement."] };
  // Tiers are recorded per person; the strictest tier for the amount governs.
  const matching = inForce.map((row) => signingTierForAmount(row.tiers, agreement.valueCents!)).filter((tier): tier is SigningAuthorityTier => Boolean(tier));
  const tier = matching.sort((a, b) => b.signaturesRequired - a.signaturesRequired || Number(tierNeedsBoard(b)) - Number(tierNeedsBoard(a)))[0];
  if (!tier) return { ...base, status: "warning", issues: ["No signing tier covers this amount; confirm who may sign it."] };
  const issues: string[] = [];
  if (signatories.length < tier.signaturesRequired) issues.push(`${tier.signaturesRequired} signature${tier.signaturesRequired === 1 ? "" : "s"} required for this amount; ${signatories.length} recorded.`);
  const authorized = new Set(inForce.map((row) => row.directoryPersonId).filter(Boolean).map(String));
  const authorizedNames = new Set(inForce.map((row) => nameKey(row.personName)).filter(Boolean));
  const unauthorized = signatories.filter((row) => !(row.directoryPersonId && authorized.has(String(row.directoryPersonId))) && !authorizedNames.has(nameKey(row.name)));
  if (unauthorized.length) issues.push(`Not on the signing-authority register: ${unauthorized.map((row) => row.name || "unnamed signatory").join(", ")}.`);
  const roles = (tier.roles ?? []).filter((role) => !/\bboard\b/i.test(role));
  if (roles.length) {
    const titles = signatories.map((row) => nameKey(row.title));
    const roleTitles = new Map(inForce.map((row) => [nameKey(row.personName), nameKey(row.roleTitle)]));
    const held = signatories.map((row, index) => titles[index] || roleTitles.get(nameKey(row.name)) || "");
    if (!roles.some((role) => held.some((title) => title.includes(nameKey(role))))) issues.push(`This tier expects a signatory holding: ${roles.join(" or ")}.`);
  }
  const boardApprovalRequired = tierNeedsBoard(tier);
  if (boardApprovalRequired && !agreement.approvalMotionId && !agreement.approvedAtMeetingId) issues.push("This amount needs board approval; link the authorizing motion.");
  return { status: issues.length ? "warning" : "ok", tier, signaturesRequired: tier.signaturesRequired, signatures: signatories.length, boardApprovalRequired, issues };
}

/* --------------------------- continuity gaps --------------------------- */

export type AgreementGap = {
  key: string;
  kind: "agreement_renewal" | "funder_report";
  agreementId: string;
  agreementTitle: string;
  title: string;
  dueDate: string;
  severity: "practice";
  note: string;
};

/**
 * Record gaps from agreements: agreements whose term ends within the window
 * (or ended in the last 180 days) with no renewal decision, and reporting
 * obligations past due with no submission recorded. Drafts nobody reviewed
 * are skipped: their dates are not yet confirmed.
 */
export function agreementGaps(agreements: readonly AgreementLike[], today: string, windowDays = EXPIRING_WINDOW_DAYS): AgreementGap[] {
  const out: AgreementGap[] = [];
  for (const agreement of agreements) {
    // Rejected records and drafts nobody has reviewed yet (imports, conversions) have unconfirmed dates.
    if (agreement.reviewStatus === "Rejected" || agreement.reviewStatus === "NeedsReview") continue;
    const status = deriveAgreementStatus(agreement, today);
    if (status === "terminated" || status === "superseded" || status === "draft" || status === "negotiating") continue;
    const id = String(agreement._id ?? "");
    const title = text(agreement.title) || "Agreement";
    const end = currentTermEnd(agreement, today);
    const lookahead = Math.max(windowDays, Number(agreement.renewalNoticeDays ?? 0) || 0);
    if (end && !hasRenewalDecision(agreement) && !agreement.autoRenew) {
      const days = daysBetweenIso(today, end);
      if (days <= lookahead && days >= -180) {
        out.push({ key: `agreement:${id}:renewal:${end}`, kind: "agreement_renewal", agreementId: id, agreementTitle: title, title: days >= 0 ? "Expiring without a renewal decision" : "Expired without a renewal decision", dueDate: renewalNoticeDate(agreement, today) ?? end, severity: "practice", note: days >= 0 ? `Ends ${end} (in ${days} day${days === 1 ? "" : "s"}); record whether it will be renewed, renegotiated or left to expire.` : `Ended ${end}; record whether it was renewed or left to expire.` });
      }
    }
    if (status === "active" || status === "expired" || status === "unknown") {
      for (const report of agreement.reportingObligations ?? []) {
        if (!isIsoDay(report.dueDate) || report.dueDate >= today || DONE_OBLIGATION_STATUSES.has(String(report.status))) continue;
        out.push({ key: `agreement:${id}:report:${report.id}`, kind: "funder_report", agreementId: id, agreementTitle: title, title: "Report overdue", dueDate: report.dueDate, severity: "practice", note: `${text(report.text).slice(0, 160) || "Report"} was due ${report.dueDate}; mark it submitted or waived.` });
      }
    }
  }
  return out.sort((a, b) => a.dueDate.localeCompare(b.dueDate));
}

/* ----------------------------- intake mapping ----------------------------- */

/** Kind from the extractor's kind and the document title. */
export function inferAgreementKind(sourceKind: unknown, title: unknown): AgreementKind {
  const t = String(title ?? "").toLowerCase();
  if (/memorandum of understanding|\bmou\b|letter of (?:understanding|intent)/.test(t) || sourceKind === "mou") return "MOU";
  if (/\blease\b|\brental\b|\btenancy\b/.test(t)) return "lease";
  if (/data[- ]sharing|information[- ]sharing|\bisa\b|\bdsa\b/.test(t)) return "data_sharing";
  if (/\blicen[cs]e\b/.test(t)) return "licence";
  if (/employment|\bemployee\b|job offer|offer of employment/.test(t)) return "employment";
  if (/consult/.test(t)) return "consulting";
  if (/partnership|collaboration|joint venture/.test(t)) return "partnership";
  if (/funding|contribution|grant\b|transfer payment/.test(t) || sourceKind === "grant" || sourceKind === "funding_letter") return "funding";
  if (/service|contract|\bgsa\b|services/.test(t) || sourceKind === "contract") return "service";
  return "other";
}

/** Role of a party name: our organization when it matches the workspace name. */
export function partyRoleFor(name: string, organizationName: string | undefined, kind: AgreementKind): PartyRole {
  const org = nameKey(organizationName);
  const key = nameKey(name);
  if (org && key && (key.includes(org) || org.includes(key) || acronym(organizationName) === key.replace(/ /g, ""))) return "us";
  return kind === "funding" ? "funder" : "counterparty";
}

function acronym(value: unknown): string {
  return String(value ?? "").split(/[^A-Za-z]+/).filter((word) => word.length > 2 || /^[A-Z]/.test(word)).map((word) => word[0]).join("").toLowerCase();
}

/** Deterministic id for a nested row (deliverable, report) derived from its source. */
export function obligationRowId(prefix: string, index: number, salt = ""): string {
  const hash = [...`${salt}|${index}`].reduce((acc, char) => (acc * 31 + char.charCodeAt(0)) >>> 0, 7).toString(36);
  return `${prefix}-${index + 1}-${hash}`;
}

/**
 * Bundle payload (`agreements` key) from an agreement extraction. Values with
 * `status: "not_stated"` are ignored. Every payload is a draft for review:
 * status `draft` (or `expired` when a signed term already ended), review
 * status `NeedsReview`. Used by the intake bundle, intake promotion and the
 * gap conversion so all three produce the same record.
 */
export function agreementPayloadFromExtraction(
  record: Record<string, any>,
  options: { fileKey: string; fileName?: string; organizationName?: string; asOfISO: string },
): Record<string, any> {
  const val = (field: any) => (field && field.status !== "not_stated" ? field.value : undefined);
  const day = (field: any): string | undefined => {
    const value = val(field);
    const iso = typeof value === "string" ? value : value?.iso;
    return isIsoDay(iso) ? iso : undefined;
  };
  // A label the extractor kept with the title ("Title: …", "Re: …") is not part of the name.
  const title = String(val(record.title) ?? options.fileName?.replace(/\.[a-z0-9]+$/i, "") ?? "Agreement").replace(/\s+/g, " ").trim().replace(/^(?:title|re|subject|project title)\s*:\s*/i, "").slice(0, 200) || "Agreement";
  const kind = inferAgreementKind(val(record.kind), `${title} ${options.fileName ?? ""}`);
  const names = (record.parties ?? []).map(val).filter((name: unknown): name is string => typeof name === "string" && name.trim().length > 1);
  const funder = val(record.funder);
  const parties = [...new Set<string>(names)].map((name) => ({ name, role: partyRoleFor(name, options.organizationName, kind) }));
  if (typeof funder === "string" && funder.trim() && !parties.some((party) => nameKey(party.name) === nameKey(funder))) parties.push({ name: funder.trim(), role: "funder" });
  const signatories = (record.signatories ?? []).map(val).filter((row: any) => row?.nameAsWritten);
  const ours: any[] = [], theirs: any[] = [];
  for (const row of signatories) {
    const entry = { name: String(row.resolvedName ?? row.nameAsWritten), ...(row.role ? { title: String(row.role) } : {}) };
    const affiliation = String(row.affiliation ?? "");
    if (affiliation && options.organizationName && partyRoleFor(affiliation, options.organizationName, kind) === "us") ours.push(entry);
    else if (affiliation) theirs.push(entry);
    else ours.push(entry); // unknown side: listed as ours for review (most signature blocks in an organization's archive are its own copy)
  }
  const effectiveDate = day(record.effective);
  let endDate = day(record.expiry);
  if (effectiveDate && endDate && endDate < effectiveDate) endDate = undefined;
  const amount = val(record.amount);
  const sourceStatus = val(record.status);
  const status = endDate && endDate < options.asOfISO && sourceStatus === "signed" ? "expired" : sourceStatus === "expired" ? "expired" : "draft";
  const reporting = (record.reportingRequirements ?? []).slice(0, 30).map((item: any, index: number) => ({
    id: obligationRowId("report", index, `${options.fileKey}|${String(val(item.text) ?? "")}`),
    text: String(val(item.text) ?? "Report").replace(/\s+/g, " ").trim().slice(0, 500),
    ...(day(item.due) ? { dueDate: day(item.due) } : {}),
    status: "not_started",
  }));
  const deliverables = (record.deliverables ?? []).map(val).filter((item: unknown) => typeof item === "string" && item.trim()).slice(0, 40).map((item: string, index: number) => ({
    id: obligationRowId("deliverable", index, `${options.fileKey}|${item}`),
    text: item.replace(/\s+/g, " ").trim().slice(0, 500),
    status: "not_started",
  }));
  const payments = (record.paymentSchedule ?? []).slice(0, 30).map((item: any) => ({
    label: String(val(item.text) ?? "Payment").replace(/\s+/g, " ").trim().slice(0, 200),
    ...(day(item.due) ? { dueDate: day(item.due) } : {}),
    ...(typeof val(item.amount)?.amountCents === "number" ? { amountCents: val(item.amount).amountCents } : {}),
  }));
  const notes = [
    "Draft created from a source document; confirm parties, dates and status before marking it active.",
    sourceStatus === "signed" ? "The source shows signature evidence." : sourceStatus === "draft" ? "The source is marked as a draft." : "",
    !parties.some((party) => COUNTERPARTY_ROLES.has(party.role)) ? "No counterparty was recognised in the source." : "",
  ].filter(Boolean).join(" ");
  return {
    title,
    kind,
    status,
    ...(val(record.agreementNumber) ? { agreementNumber: String(val(record.agreementNumber)).slice(0, 80) } : {}),
    ...(val(record.purpose) ? { summary: String(val(record.purpose)).slice(0, 1000) } : {}),
    parties,
    ...(ours.length ? { ourSignatories: ours } : {}),
    ...(theirs.length ? { counterpartySignatories: theirs } : {}),
    ...(effectiveDate ? { effectiveDate } : {}),
    ...(endDate ? { endDate } : {}),
    ...(typeof amount?.amountCents === "number" && amount.amountCents >= 0 ? { valueCents: amount.amountCents, currency: /^[A-Z]{3}$/.test(String(amount.currency ?? "")) ? String(amount.currency) : "CAD" } : {}),
    ...(payments.length ? { paymentSchedule: payments } : {}),
    ...(deliverables.length ? { deliverables } : {}),
    ...(reporting.length ? { reportingObligations: reporting } : {}),
    sourceExternalIds: [options.fileKey],
    confidence: "Review",
    reviewStatus: "NeedsReview",
    notes,
  };
}
