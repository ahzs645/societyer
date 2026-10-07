/** Per-class records other than minutes (design §4.3). Each is a tree of FieldValues. */
import { z } from "zod";
import { fieldValue, FvBoolean, FvDate, FvMoney, FvNumber, FvPersonRef, FvString, Locator, RECORD_STATUSES } from "./common";

export const AgendaRecord = z.object({
  body: FvString,
  date: FvDate,
  startTime: FvString.optional(),
  location: FvString.optional(),
  items: z.array(z.object({
    number: FvString.optional(),
    title: FvString,
    presenter: FvString.optional(),
    timeAllotted: FvString.optional(),
    motionProposed: FvString.optional(),
    attachmentRef: FvString.optional(),
    /** Consent-agenda style "Receive", "Approve", "For information". */
    groupAction: FvString.optional(),
  })),
  /** Packages are split: each embedded document is re-classified separately. */
  embeddedDocuments: z.array(z.object({ docClass: z.string(), title: FvString.optional(), blockStart: z.number().int(), blockEnd: z.number().int() })).optional(),
});

export const AgmMaterialRecord = z.object({
  kind: fieldValue(z.enum(["notice", "script", "package", "report", "unknown"])),
  fiscalYear: FvString.optional(),
  noticeDate: FvDate.optional(),
  noticeMethod: FvString.optional(),
  agendaItems: z.array(FvString),
  /** Always proposed, never carried: scripts and notices are not records of decisions. */
  proposedResolutions: z.array(FvString),
  electionSlate: z.array(FvPersonRef).optional(),
  financialStatementsPresented: FvString.optional(),
  auditorOrReviewEngagement: FvString.optional(),
});

export const PolicyRecord = z.object({
  title: FvString,
  kind: fieldValue(z.enum(["bylaws", "constitution", "policy", "terms_of_reference", "procedure", "unknown"])),
  versionLabel: FvString.optional(),
  effectiveDate: FvDate.optional(),
  adoptedAt: FvString.optional().describe("Reference to the adopting motion or special resolution"),
  status: fieldValue(z.enum(["draft", "adopted", "filed", "superseded", "unknown"])),
  clauses: z.array(z.object({ number: FvString.optional(), heading: FvString.optional(), text: z.array(Locator) })),
  rules: z.object({
    quorum: FvString.optional(),
    noticeDays: FvNumber.optional(),
    agmFrequency: FvString.optional(),
    agmMaxMonthsBetween: FvNumber.optional(),
    proxiesAllowed: FvBoolean.optional(),
    directorCountMin: FvNumber.optional(),
    directorCountMax: FvNumber.optional(),
    directorTerm: FvString.optional(),
    signingTiers: z.array(FvString).optional(),
  }).optional(),
});

export const RosterRecord = z.object({
  kind: fieldValue(z.enum(["director_consent", "proxy", "roster", "appointment", "resignation"])),
  entries: z.array(z.object({
    person: FvPersonRef,
    organisationRepresented: FvString.optional(),
    seat: FvString.optional(),
    role: FvString.optional(),
    termStart: FvDate.optional(),
    termEnd: FvDate.optional(),
    signedDate: FvDate.optional(),
    proxyHolder: FvPersonRef.optional(),
    meetingRef: FvString.optional(),
  })),
});

export const FinancialStatementRecord = z.object({
  statementType: fieldValue(z.enum(["income_statement", "balance_sheet", "cash_flow", "budget", "notes", "combined", "unknown"])),
  periodStart: FvDate.optional(),
  periodEnd: FvDate,
  fiscalYearEnd: FvString.optional(),
  versionLabel: fieldValue(z.enum(["draft", "revised", "approved", "audited", "reviewed", "unknown"])),
  currency: FvString.optional(),
  lines: z.array(z.object({ account: FvString.optional(), label: FvString, amount: FvMoney, column: fieldValue(z.enum(["actual", "budget", "prior", "variance", "unknown"])) })),
  totals: z.array(z.object({ label: FvString, amount: FvMoney, arithmeticCheck: fieldValue(z.enum(["ok", "mismatch", "not_checked"])).optional() })),
  approvedAtMeetingRef: FvString.optional(),
});

export const InsuranceRecord = z.object({
  insurer: FvString,
  broker: FvString.optional(),
  policyNumber: FvString.optional(),
  termStart: FvDate.optional(),
  termEnd: FvDate.optional(),
  coverages: z.array(z.object({ type: FvString, limit: FvMoney.optional(), deductible: FvMoney.optional() })),
  premium: FvMoney.optional(),
  fees: FvMoney.optional(),
  endorsements: z.array(FvString).optional(),
});

export const AgreementRecord = z.object({
  kind: fieldValue(z.enum(["agreement", "contract", "grant", "mou", "funding_letter", "unknown"])),
  title: FvString.optional(),
  parties: z.array(FvString),
  effective: FvDate.optional(),
  expiry: FvDate.optional(),
  amount: FvMoney.optional(),
  deliverables: z.array(FvString),
  reportingDue: z.array(FvDate),
  signatories: z.array(FvPersonRef),
  status: fieldValue(z.enum(["draft", "signed", "expired", "unknown"])),
  relatedMotionRef: FvString.optional(),
});

export const RegistryFilingRecord = z.object({
  filingType: fieldValue(z.enum(["annual_report", "statement_of_directors", "transition", "change_of_address", "bylaw_amendment", "other"])),
  period: FvString.optional(),
  filedDate: FvDate.optional(),
  confirmationNumber: FvString.optional(),
  directorsListed: z.array(FvPersonRef),
});

export const CorrespondenceRecord = z.object({
  from: FvString.optional(),
  to: z.array(FvString),
  date: FvDate.optional(),
  subject: FvString.optional(),
  /** Evidence-only by default: never full bodies in shared views. */
  summary: FvString.optional(),
  decisionsOrCommitments: z.array(FvString),
  attachments: z.array(FvString),
});

export const InvoiceRecord = z.object({
  vendor: FvString,
  date: FvDate,
  amount: FvMoney,
  gst: FvMoney.optional(),
  account: FvString.optional(),
  paymentRef: FvString.optional(),
});

export const ClassificationRecord = z.object({
  docClass: FvString,
  organisationOwner: FvString.optional(),
  body: FvString.optional(),
  date: FvDate.optional(),
  recordStatus: fieldValue(z.enum(RECORD_STATUSES)),
  rationale: z.string().optional(),
});
