/** Per-class records other than minutes (design §4.3). Each is a tree of FieldValues.
 *
 * Contract note: these schemas are read by the review UI (intake:* API) and by
 * stored extractions. Changes are ADDITIVE ONLY: new fields are optional and
 * existing fields keep their type, so older extractions still validate. */
import { z } from "zod";
import { fieldValue, FvBoolean, FvDate, FvMoney, FvNumber, FvPersonRef, FvString, Locator, RECORD_STATUSES } from "./common";

/** Agenda / package requested action (A9 `agendaItems.requestedAction`). */
export const REQUESTED_ACTIONS = ["approve", "receive", "discuss", "decide", "information", "none"] as const;
export const CONSENT_OUTCOMES = ["received", "pending", "deferred", "excluded"] as const;
export const RESOLUTION_KINDS = ["special", "ordinary", "unknown"] as const;

/** A part of a package (agenda, embedded minutes, reports, statements …), split by block range. */
export const EmbeddedDocument = z.object({
  docClass: z.string(),
  title: FvString.optional(),
  blockStart: z.number().int(),
  blockEnd: z.number().int(),
  /** Added by the package splitter: date and body the part is about, the agenda item it belongs to. */
  date: FvDate.optional(),
  bodyLabel: z.string().optional(),
  itemRef: z.string().optional(),
  classConfidence: z.number().min(0).max(1).optional(),
});

export const ProposedResolution = fieldValue(z.object({ text: z.string(), kind: z.enum(RESOLUTION_KINDS) }));

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
    /** Normalised requested action (A9). */
    requestedAction: fieldValue(z.enum(REQUESTED_ACTIONS)).optional(),
    /** Item belongs to the consent agenda (A9 `agendaItems.consent`). */
    consent: FvBoolean.optional(),
    /** Clock time printed next to the item ("5:05"), as written. */
    scheduledTime: FvString.optional(),
    depth: z.number().int().min(0).max(3).optional(),
  })),
  /** Packages are split: each embedded document is re-classified separately. */
  embeddedDocuments: z.array(EmbeddedDocument).optional(),
  // -- additive (WP-L) --
  title: FvString.optional(),
  bodyLabel: FvString.optional(),
  kind: fieldValue(z.enum(["agenda", "business_agenda", "consent_agenda", "package", "agm_agenda", "unknown"])).optional(),
  recordStatus: fieldValue(z.enum(RECORD_STATUSES)).optional(),
  endTime: FvString.optional(),
  electronic: FvBoolean.optional(),
  /** Consent-agenda receipts: reports or another body's minutes taken as read (A10 outcome `received`). Never adoption. */
  consentItems: z.array(z.object({
    title: FvString,
    itemNumber: FvString.optional(),
    presenter: FvString.optional(),
    outcome: fieldValue(z.enum(CONSENT_OUTCOMES)),
    /** Index into embeddedDocuments when the received document is inside the package. */
    embeddedIndex: z.number().int().optional(),
  })).optional(),
  /** "Notice of special resolution" text in an agenda: proposed, never carried. */
  proposedResolutions: z.array(ProposedResolution).optional(),
  nextMeetings: z.array(fieldValue(z.object({ date: z.string().optional(), time: z.string().optional(), body: z.string().optional(), text: z.string() }))).optional(),
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
  // -- additive (WP-L) --
  meetingDate: FvDate.optional(),
  startTime: FvString.optional(),
  location: FvString.optional(),
  bodyLabel: FvString.optional(),
  /** Typed view of proposedResolutions (special vs ordinary); status is always "proposed". */
  resolutions: z.array(ProposedResolution).optional(),
  embeddedDocuments: z.array(EmbeddedDocument).optional(),
});

export const BODY_QUORUM_BODIES = ["general", "board", "committee"] as const;
export const QUORUM_TYPES = ["fixed", "percentage", "all_members", "majority"] as const;

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
    // -- additive (WP-L): typed rules for bylawRuleSets --
    bodyQuorumRules: z.array(z.object({
      body: fieldValue(z.enum(BODY_QUORUM_BODIES)),
      committeeName: z.string().optional(),
      quorumType: fieldValue(z.enum(QUORUM_TYPES)),
      quorumValue: FvNumber.optional(),
      quorumMinimumCount: FvNumber.optional(),
    })).optional(),
    noticeMaxDays: FvNumber.optional(),
    proxyHolderMustBeMember: FvBoolean.optional(),
    proxyLimitPerHolder: FvNumber.optional(),
    directorTermYears: FvNumber.optional(),
    electronicMeetings: FvBoolean.optional(),
    specialResolutionThresholdPct: FvNumber.optional(),
    signingTiersDetail: z.array(z.object({
      text: FvString,
      minCents: z.number().int().optional(),
      maxCents: z.number().int().optional(),
      signaturesRequired: z.number().int().min(1).max(10),
      roles: z.array(z.string()).optional(),
    })).optional(),
    fiscalYearEnd: FvString.optional(),
  }).optional(),
  // -- additive (WP-L) --
  organizationName: FvString.optional(),
  adoptedDate: FvDate.optional(),
  reviewDate: FvDate.optional(),
  policyNumber: FvString.optional(),
  /** The body a terms of reference governs ("Operations Committee"). */
  governsBody: FvString.optional(),
  /** Third-party instrument (e.g. a municipal bylaw kept as reference), not the organization's own rules. */
  external: FvBoolean.optional(),
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
    // -- additive (WP-L) --
    /** representative | alternate | proxy | director | officer | staff | member */
    representativeType: FvString.optional(),
    consentGiven: FvBoolean.optional(),
    meetingDate: FvDate.optional(),
  })),
  // -- additive (WP-L) --
  /** A blank form (template) carries no facts. */
  blankForm: FvBoolean.optional(),
  asOfDate: FvDate.optional(),
  organizationName: FvString.optional(),
});

export const FinancialStatementRecord = z.object({
  statementType: fieldValue(z.enum(["income_statement", "balance_sheet", "cash_flow", "budget", "notes", "combined", "unknown"])),
  periodStart: FvDate.optional(),
  periodEnd: FvDate,
  fiscalYearEnd: FvString.optional(),
  versionLabel: fieldValue(z.enum(["draft", "revised", "approved", "audited", "reviewed", "unknown"])),
  currency: FvString.optional(),
  lines: z.array(z.object({
    account: FvString.optional(), label: FvString, amount: FvMoney, column: fieldValue(z.enum(["actual", "budget", "prior", "variance", "unknown"])),
    // -- additive (WP-L) --
    section: z.string().optional(),
    isTotal: z.boolean().optional(),
  })),
  totals: z.array(z.object({ label: FvString, amount: FvMoney, arithmeticCheck: fieldValue(z.enum(["ok", "mismatch", "not_checked"])).optional() })),
  approvedAtMeetingRef: FvString.optional(),
  // -- additive (WP-L) --
  title: FvString.optional(),
  organizationName: FvString.optional(),
  /** Detected change of fiscal year end against other statements in the run (e.g. 31 Jul → 31 Dec). */
  fiscalYearEndChange: FvString.optional(),
  programCode: FvString.optional(),
  /** Labels the statement mislabels (title says balance sheet, lines are revenue/expense). */
  titleConflict: FvString.optional(),
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
  // -- additive (WP-L) --
  kind: fieldValue(z.enum(["directors_officers", "general_liability", "errors_omissions", "property", "cyber", "other"])).optional(),
  documentType: fieldValue(z.enum(["policy", "renewal", "certificate", "endorsement", "invoice", "questionnaire", "unknown"])).optional(),
  insured: FvString.optional(),
  additionalInsureds: z.array(FvString).optional(),
  totalCost: FvMoney.optional(),
  /** Explicit reviewed status for promotion: never Active by default; Lapsed when the term has ended. */
  proposedStatus: fieldValue(z.enum(["NeedsReview", "Lapsed"])).optional(),
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
  // -- additive (WP-L) --
  agreementNumber: FvString.optional(),
  funder: FvString.optional(),
  program: FvString.optional(),
  purpose: FvString.optional(),
  /** application / proposal / award / report: where a grant sits in its lifecycle. */
  grantStage: fieldValue(z.enum(["application", "proposal", "award", "agreement", "report", "unknown"])).optional(),
  amountRequested: FvMoney.optional(),
  paymentSchedule: z.array(z.object({ text: FvString, amount: FvMoney.optional(), due: FvDate.optional() })).optional(),
  reportingRequirements: z.array(z.object({ text: FvString, due: FvDate.optional() })).optional(),
});

export const RegistryFilingRecord = z.object({
  filingType: fieldValue(z.enum(["annual_report", "statement_of_directors", "transition", "change_of_address", "bylaw_amendment", "other", "change_of_directors"])),
  period: FvString.optional(),
  filedDate: FvDate.optional(),
  confirmationNumber: FvString.optional(),
  directorsListed: z.array(FvPersonRef),
  // -- additive (WP-L) --
  organizationName: FvString.optional(),
  incorporationNumber: FvString.optional(),
  agmDate: FvDate.optional(),
  feePaid: FvMoney.optional(),
  /** filed (registry confirmation/receipt), draft (unsigned form) or unknown. */
  filingStatus: fieldValue(z.enum(["filed", "draft", "unknown"])).optional(),
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
  // -- additive (WP-L) --
  kind: fieldValue(z.enum(["email", "letter", "memo", "unknown"])).optional(),
  cc: z.array(FvString).optional(),
  /** Personal contact details were seen and are withheld from shared views. */
  personalDataWithheld: z.boolean().optional(),
});

export const InvoiceRecord = z.object({
  vendor: FvString,
  date: FvDate,
  amount: FvMoney,
  gst: FvMoney.optional(),
  account: FvString.optional(),
  paymentRef: FvString.optional(),
  // -- additive (WP-L) --
  invoiceNumber: FvString.optional(),
  billTo: FvString.optional(),
  /** payable (issued to the organization), receivable (issued by it) or receipt. */
  direction: fieldValue(z.enum(["payable", "receivable", "receipt", "unknown"])).optional(),
  subtotal: FvMoney.optional(),
  dueDate: FvDate.optional(),
  lineItems: z.array(z.object({ description: FvString, amount: FvMoney.optional() })).optional(),
});

export const ClassificationRecord = z.object({
  docClass: FvString,
  organisationOwner: FvString.optional(),
  body: FvString.optional(),
  date: FvDate.optional(),
  recordStatus: fieldValue(z.enum(RECORD_STATUSES)),
  rationale: z.string().optional(),
});
