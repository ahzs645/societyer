import {
  payrollDate,
  payrollInteger,
  payrollObject,
  payrollText,
} from "./payrollCalculationValidation";

export const REMITTANCE_CHANNELS = [
  "cra_myba_pad",
  "financial_institution",
  "third_party",
] as const;
export type RemittanceChannel = (typeof REMITTANCE_CHANNELS)[number];
export const REMITTANCE_CHANNEL_LABELS: Record<RemittanceChannel, string> = {
  cra_myba_pad: "CRA My Business Account PAD",
  financial_institution: "Financial institution bill payment",
  third_party: "Approved third-party service",
};
export type RemittancePlanStatus =
  | "draft"
  | "approved"
  | "exported"
  | "manual_submitted"
  | "settled"
  | "rejected";
export type RemittancePlanFields = {
  obligationId: string;
  bankAccountId: string;
  amountCents: number;
  scheduledDate: string;
  channel: RemittanceChannel;
  destinationReference: string;
  liabilityAccountId?: string;
  employerExpenseAccountId?: string;
  notes?: string;
};
export type RemittanceReadinessFields = {
  rpRegistrationConfirmed: boolean;
  remitterCategoryConfirmed: boolean;
  mandateConfirmed: boolean;
  mandateReference?: string;
  providerName?: string;
  providerContractReference?: string;
  credentialVaultItemId?: string;
  approvalPolicyReference?: string;
  leadBusinessDays: number;
  cutoffLocalTime?: string;
  timezone: string;
  statusWebhookConfirmed: boolean;
  retryPolicyReference?: string;
};
export const REMITTANCE_COMPONENTS = [
  "cppEmployeeCents",
  "cpp2EmployeeCents",
  "eiEmployeeCents",
  "incomeTaxCents",
  "cppEmployerCents",
  "cpp2EmployerCents",
  "eiEmployerCents",
] as const;
export type RemittanceComponents = Record<
  (typeof REMITTANCE_COMPONENTS)[number],
  number
>;
export type RemittanceSource = {
  obligationId: string;
  periodStart: string;
  periodEnd: string;
  dueDate?: string;
  amountDueCents: number;
  paidCents: number;
  outstandingCents: number;
  payrollAccountNumber: string;
  remitterType: string;
  components: RemittanceComponents;
  payRunIds: string[];
  sourceFingerprint: string;
  warnings: string[];
};
export type RemittanceAudit = {
  action: string;
  atISO: string;
  actorUserId: string;
  reference?: string;
};
export type RemittancePlan = RemittancePlanFields & {
  _id: string;
  societyId: string;
  version: number;
  status: RemittancePlanStatus;
  source: RemittanceSource;
  sourceFingerprint: string;
  history: RemittanceAudit[];
  revisions: Array<{
    version: number;
    fields: RemittancePlanFields;
    sourceFingerprint: string;
  }>;
  createdAtISO: string;
  updatedAtISO: string;
  approvedAtISO?: string;
  approvedByUserId?: string;
  submissionReference?: string;
};
export type RemittanceSettlementFields = {
  date: string;
  amountCents: number;
  evidence: string;
  destinationConfirmed: boolean;
  idempotencyKey: string;
  transactionId?: string;
  craConfirmationNumber?: string;
  postToLedger: boolean;
};
export type RemittanceSettlement = {
  _id: string;
  societyId: string;
  planId: string;
  obligationId: string;
  bankAccountId: string;
  date: string;
  amountCents: number;
  evidence: string;
  transactionId?: string;
  craConfirmationNumber?: string;
  idempotencyKey: string;
  destinationReference: string;
  payrollAccountNumber: string;
  journalEntryIds: string[];
  createdAtISO: string;
  createdByUserId: string;
};
export type RemittanceReadiness = {
  fields: RemittanceReadinessFields;
  automationAvailable: false;
  manualPreparationReady: boolean;
  gaps: string[];
  explanation: string;
};
export const REMITTANCE_OFFICIAL_SOURCES = [
  {
    label: "CRA pre-authorized debit in My Business Account",
    url: "https://www.canada.ca/en/revenue-agency/services/about-canada-revenue-agency-cra/pay-authorized-debit.html",
  },
  {
    label: "Pay through a Canadian financial institution",
    url: "https://www.canada.ca/en/revenue-agency/services/about-canada-revenue-agency-cra/pay-online-banking.html",
  },
  {
    label: "Pay through a third-party service provider",
    url: "https://www.canada.ca/en/revenue-agency/services/about-canada-revenue-agency-cra/pay-credit-card.html",
  },
  {
    label: "CRA EDI trading-partner onboarding and testing",
    url: "https://www.canada.ca/en/revenue-agency/services/about-canada-revenue-agency-cra/third-party-service-providers-cra.html",
  },
  {
    label: "Payroll remittance due dates",
    url: "https://www.canada.ca/en/revenue-agency/services/tax/businesses/topics/payroll/remitting-source-deductions/how-when-remit-due-dates.html",
  },
];
export function cleanRemittanceRp(raw: unknown) {
  const value =
    typeof raw === "string" ? raw.replace(/\s/g, "").toUpperCase() : "";
  if (!/^\d{9}RP\d{4}$/.test(value))
    throw new Error(
      "Save the exact CRA payroll program account (9-digit business number + RP + 4 digits) in payroll register settings.",
    );
  return value;
}
export function maskRemittanceRp(raw: string) {
  return `${raw.slice(0, 3)}••••••${raw.slice(-6)}`;
}
function optionalText(raw: unknown, name: string, max = 500) {
  return payrollText(raw, name, max, true) || undefined;
}
export function cleanRemittancePlan(raw: unknown): RemittancePlanFields {
  const r = payrollObject(raw);
  if (!REMITTANCE_CHANNELS.includes(r.channel))
    throw new Error("Choose a supported manual payment channel.");
  const amountCents = payrollInteger(r.amountCents, "Remittance amount cents");
  if (!amountCents)
    throw new Error("The payment plan amount must be greater than zero.");
  return {
    obligationId: payrollText(r.obligationId, "Obligation", 200),
    bankAccountId: payrollText(r.bankAccountId, "Bank account", 200),
    amountCents,
    scheduledDate: payrollDate(r.scheduledDate, "Intended payment date"),
    channel: r.channel,
    destinationReference: payrollText(
      r.destinationReference,
      "CRA destination/payee reference",
      500,
    ),
    ...(r.liabilityAccountId
      ? {
          liabilityAccountId: payrollText(
            r.liabilityAccountId,
            "Source-deductions liability",
            200,
          ),
        }
      : {}),
    ...(r.employerExpenseAccountId
      ? {
          employerExpenseAccountId: payrollText(
            r.employerExpenseAccountId,
            "Employer contributions expense",
            200,
          ),
        }
      : {}),
    ...(r.notes?.trim() ? { notes: optionalText(r.notes, "Notes", 2000) } : {}),
  };
}
export function cleanRemittanceReadiness(
  raw: unknown,
): RemittanceReadinessFields {
  const r = payrollObject(raw);
  for (const field of [
    "rpRegistrationConfirmed",
    "remitterCategoryConfirmed",
    "mandateConfirmed",
    "statusWebhookConfirmed",
  ])
    if (typeof r[field] !== "boolean")
      throw new Error(`Confirm ${field} explicitly.`);
  const leadBusinessDays = payrollInteger(
      r.leadBusinessDays,
      "Lead business days",
      30,
    ),
    timezone = payrollText(r.timezone, "Payment timezone", 100);
  try {
    new Intl.DateTimeFormat("en", { timeZone: timezone }).format();
  } catch {
    throw new Error("Choose a valid payment timezone.");
  }
  if (
    r.cutoffLocalTime &&
    !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(r.cutoffLocalTime)
  )
    throw new Error("Cutoff must use 24-hour HH:MM.");
  const result: RemittanceReadinessFields = {
    rpRegistrationConfirmed: r.rpRegistrationConfirmed,
    remitterCategoryConfirmed: r.remitterCategoryConfirmed,
    mandateConfirmed: r.mandateConfirmed,
    statusWebhookConfirmed: r.statusWebhookConfirmed,
    leadBusinessDays,
    timezone,
  };
  for (const key of [
    "mandateReference",
    "providerName",
    "providerContractReference",
    "credentialVaultItemId",
    "approvalPolicyReference",
    "cutoffLocalTime",
    "retryPolicyReference",
  ] as const) {
    const value = optionalText(r[key], key);
    if (value) result[key] = value;
  }
  if (result.mandateConfirmed && !result.mandateReference)
    throw new Error(
      "Retain the actual mandate reference when confirming a mandate.",
    );
  return result;
}
export function remittanceReadiness(
  fields: RemittanceReadinessFields,
): RemittanceReadiness {
  const gaps: string[] = [];
  if (!fields.rpRegistrationConfirmed)
    gaps.push("Confirm the registered CRA RP account.");
  if (!fields.remitterCategoryConfirmed)
    gaps.push(
      "Confirm the CRA-assigned remitter category and effective schedule.",
    );
  if (!fields.mandateConfirmed)
    gaps.push("Obtain and retain the actual bank or service mandate.");
  if (!fields.providerContractReference)
    gaps.push(
      "Agree an actual supported payment-service contract; CRA My Business Account PAD is configured in CRA, not through a public Societyer bank API.",
    );
  if (!fields.credentialVaultItemId)
    gaps.push(
      "Provision service credentials in the secure vault, never in notes.",
    );
  if (!fields.approvalPolicyReference)
    gaps.push("Document approval authority and release controls.");
  if (!fields.cutoffLocalTime)
    gaps.push("Review service cutoff, timezone and processing lead time.");
  if (!fields.statusWebhookConfirmed)
    gaps.push(
      "Verify authenticated payment-status callbacks or reconciliation polling.",
    );
  if (!fields.retryPolicyReference)
    gaps.push(
      "Document idempotent retries, rejection handling and audit retention.",
    );
  gaps.push(
    "A verified production payment connector is not installed. Societyer cannot initiate CRA PAD or debit a bank account.",
  );
  return {
    fields,
    automationAvailable: false,
    manualPreparationReady:
      fields.rpRegistrationConfirmed && fields.remitterCategoryConfirmed,
    gaps,
    explanation:
      "Preparation, review, exports and reminders do not initiate a payment. Submit through CRA, your financial institution or an approved service; reconcile actual bank settlement or a CRA receipt separately.",
  };
}
export function remittanceInstructions(
  plan: RemittancePlan,
  settledCents = 0,
  sourceBankName = plan.bankAccountId,
) {
  const remainingCents = plan.amountCents - settledCents;
  if (
    !Number.isSafeInteger(settledCents) ||
    settledCents < 0 ||
    remainingCents <= 0
  )
    throw new Error(
      "Only a positive unpaid plan commitment can be exported as payment instructions.",
    );
  return [
    "CRA PAYROLL REMITTANCE — PREPARED INSTRUCTIONS ONLY",
    "No payment has been initiated or confirmed by this export.",
    `Plan: ${plan._id} / version ${plan.version}`,
    `Status: ${plan.status}`,
    `CRA payroll account: ${plan.source.payrollAccountNumber}`,
    `Period: ${plan.source.periodStart} to ${plan.source.periodEnd}`,
    `Amount: CAD ${(remainingCents / 100).toFixed(2)}`,
    `Original approved plan: CAD ${(plan.amountCents / 100).toFixed(2)}`,
    `Recorded actual settlements: CAD ${(settledCents / 100).toFixed(2)}`,
    "The amount above is only the remaining unpaid plan commitment; verify any external pending submission before releasing another payment.",
    `Due date: ${plan.source.dueDate ?? "Unconfirmed"}`,
    `Intended payment date: ${plan.scheduledDate}`,
    `Channel: ${REMITTANCE_CHANNEL_LABELS[plan.channel]}`,
    `Destination/payee: ${plan.destinationReference}`,
    `Source bank: ${sourceBankName}`,
    `Approval: ${plan.approvedAtISO ?? "Not approved"}`,
    `Source fingerprint: ${plan.sourceFingerprint}`,
    "Reconcile an actual posted bank outflow or CRA payment confirmation before marking the obligation paid.",
    ...REMITTANCE_OFFICIAL_SOURCES.map((s) => `${s.label}: ${s.url}`),
  ].join("\n");
}
