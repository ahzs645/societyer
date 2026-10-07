/**
 * Record validation shared by the portable write handlers and the forms that
 * call them. Each validator returns field-keyed messages so a form can show
 * inline errors before it submits; `assertValid` turns the same result into
 * the server-side error, so an empty or invalid payload is rejected on every
 * runtime even when a client skips the form check.
 *
 * Rules are deliberately about record integrity (required identity fields,
 * well-formed dates and emails, non-negative money, no duplicate or
 * overlapping rows), not policy. Keep them dependency-free.
 */

export type FieldErrors = Record<string, string>;

/** Throw the first few messages as one error. No-op when there are none. */
export function assertValid(errors: FieldErrors, label?: string): void {
  const messages = Object.values(errors);
  if (messages.length === 0) return;
  const head = label ? `${label}: ` : "";
  throw new Error(`${head}${messages.slice(0, 3).join(" ")}`);
}

export function hasErrors(errors: FieldErrors): boolean {
  return Object.keys(errors).length > 0;
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function present(value: unknown): boolean {
  return value !== undefined && value !== null && !(typeof value === "string" && value.trim() === "");
}

// Permissive on purpose: accepts single-label hosts ("owner@local") used by
// local workspaces, but rejects text without exactly one "@" or with spaces.
const EMAIL_PATTERN = /^[^\s@]+@[^\s@.]+(?:\.[^\s@.]+)*$/;

export function isValidEmail(value: unknown): boolean {
  return typeof value === "string" && EMAIL_PATTERN.test(value.trim());
}

/** Split an address list ("a@x.org, b@y.org; c@z.org") into trimmed parts. */
export function splitEmailList(value: unknown): string[] {
  return text(value).split(/[,;]/).map((part) => part.trim()).filter(Boolean);
}

export function isIsoDate(value: unknown): boolean {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = Date.parse(`${value}T00:00:00Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value;
}

/** Accepts "YYYY-MM-DD" or a full ISO timestamp. */
function isDateLike(value: unknown): boolean {
  if (typeof value !== "string") return false;
  if (isIsoDate(value)) return true;
  return /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}

function checkMoney(errors: FieldErrors, field: string, value: unknown, label: string) {
  if (value === undefined || value === null) return;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    errors[field] = `${label} must be a number.`;
  } else if (value < 0) {
    errors[field] = `${label} cannot be negative.`;
  }
}

function checkRequired(errors: FieldErrors, field: string, value: unknown, message: string) {
  if (!present(value)) errors[field] = message;
}

function checkDateRange(errors: FieldErrors, start: unknown, end: unknown, endField: string, message: string) {
  if (typeof start === "string" && typeof end === "string" && start && end && isDateLike(start) && isDateLike(end) && end.slice(0, 10) < start.slice(0, 10)) {
    errors[endField] = message;
  }
}

// ---------------------------------------------------------------- grants ---

export function validateGrantInput(input: Record<string, any>, options: { partial?: boolean } = {}): FieldErrors {
  const errors: FieldErrors = {};
  if (!options.partial || "title" in input) checkRequired(errors, "title", input.title, "Enter a grant title.");
  if (!options.partial || "funder" in input) checkRequired(errors, "funder", input.funder, "Enter the funder.");
  if (input.fitScore !== undefined && input.fitScore !== null) {
    if (typeof input.fitScore !== "number" || !Number.isFinite(input.fitScore) || input.fitScore < 0 || input.fitScore > 100) {
      errors.fitScore = "Fit score must be between 0 and 100.";
    }
  }
  checkMoney(errors, "amountRequestedCents", input.amountRequestedCents, "Requested amount");
  checkMoney(errors, "amountAwardedCents", input.amountAwardedCents, "Awarded amount");
  for (const field of ["applicationDueDate", "startDate", "endDate"] as const) {
    if (present(input[field]) && !isDateLike(input[field])) errors[field] = "Enter a valid date.";
  }
  checkDateRange(errors, input.startDate, input.endDate, "endDate", "The end date must be on or after the start date.");
  return errors;
}

export function validateGrantTransactionInput(input: Record<string, any>): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "grantId", input.grantId, "Choose a grant.");
  if (!isIsoDate(input.date)) errors.date = "Enter a valid date.";
  if (typeof input.amountCents !== "number" || !Number.isFinite(input.amountCents) || input.amountCents <= 0) {
    errors.amountCents = "Enter an amount greater than zero.";
  }
  checkRequired(errors, "description", input.description, "Describe the ledger entry.");
  return errors;
}

export function validateGrantReportInput(input: Record<string, any>): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "grantId", input.grantId, "Choose a grant.");
  checkRequired(errors, "title", input.title, "Enter a report title.");
  if (!isDateLike(input.dueAtISO)) errors.dueAtISO = "Enter a valid due date.";
  checkMoney(errors, "spendingToDateCents", input.spendingToDateCents, "Spending to date");
  return errors;
}

// ------------------------------------------------------------- insurance ---

export function validateInsurancePolicyInput(input: Record<string, any>, options: { partial?: boolean } = {}): FieldErrors {
  const errors: FieldErrors = {};
  const need = (field: string) => !options.partial || field in input;
  if (need("kind")) checkRequired(errors, "kind", input.kind, "Choose the coverage type.");
  if (need("insurer")) checkRequired(errors, "insurer", input.insurer, "Enter the insurer.");
  if (need("policyNumber")) checkRequired(errors, "policyNumber", input.policyNumber, "Enter the policy number.");
  if (need("startDate") && !isDateLike(input.startDate)) errors.startDate = "Enter a valid start date.";
  if (need("renewalDate") && !isDateLike(input.renewalDate)) errors.renewalDate = "Enter a valid renewal date.";
  if (present(input.endDate) && !isDateLike(input.endDate)) errors.endDate = "Enter a valid end date.";
  checkDateRange(errors, input.startDate, input.endDate, "endDate", "The end date must be on or after the start date.");
  checkMoney(errors, "coverageCents", input.coverageCents, "Coverage");
  checkMoney(errors, "premiumCents", input.premiumCents, "Premium");
  checkMoney(errors, "policyFeeCents", input.policyFeeCents, "Policy fee");
  checkMoney(errors, "totalCostCents", input.totalCostCents, "Total cost");
  checkMoney(errors, "deductibleCents", input.deductibleCents, "Deductible");
  return errors;
}

// ------------------------------------------------------------- documents ---

export function validateDocumentInput(input: Record<string, any>): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "title", input.title, "Enter a document title.");
  checkRequired(errors, "category", input.category, "Choose a category.");
  if (input.retentionYears !== undefined && input.retentionYears !== null) {
    if (typeof input.retentionYears !== "number" || !Number.isFinite(input.retentionYears) || input.retentionYears < 0) {
      errors.retentionYears = "Retention years cannot be negative.";
    }
  }
  return errors;
}

// ----------------------------------------------------------------- users ---

export function validateWorkspaceUserInput(
  input: { email?: unknown; displayName?: unknown },
  existing: Array<{ _id: string; email?: string }> = [],
  selfId?: string,
): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "displayName", input.displayName, "Enter the person's name.");
  const email = text(input.email).toLowerCase();
  if (!email) {
    errors.email = "Enter an email address.";
  } else if (!isValidEmail(email)) {
    errors.email = "Enter a valid email address.";
  } else if (existing.some((user) => String(user._id) !== String(selfId ?? "") && text(user.email).toLowerCase() === email)) {
    errors.email = "Another workspace user already uses this email.";
  }
  return errors;
}

// ---------------------------------------------------------------- outbox ---

/**
 * Outbox email. A draft may be incomplete (it is work in progress) but must
 * have a subject or a recipient, and any address it has must be valid. An
 * email that is ready to send needs recipients, a subject and a body.
 */
export function validateOutboxEmailInput(input: Record<string, any>): FieldErrors {
  const errors: FieldErrors = {};
  const draft = (input.status ?? "draft") === "draft";
  const recipients = splitEmailList(input.to);
  if (recipients.some((address) => !isValidEmail(address))) errors.to = "Every recipient must be a valid email address.";
  else if (recipients.length === 0 && !draft) errors.to = "Add at least one recipient.";
  for (const field of ["cc", "bcc"] as const) {
    const list = splitEmailList(input[field]);
    if (list.some((address) => !isValidEmail(address))) errors[field] = `Every ${field.toUpperCase()} address must be a valid email address.`;
  }
  if (present(input.fromEmail) && !isValidEmail(input.fromEmail)) errors.fromEmail = "Enter a valid sender email.";
  if (present(input.replyTo) && !isValidEmail(input.replyTo)) errors.replyTo = "Enter a valid reply-to email.";
  if (draft) {
    if (!present(input.subject) && recipients.length === 0 && !errors.to) {
      errors.subject = "Add a subject or a recipient before saving the draft.";
    }
  } else {
    checkRequired(errors, "subject", input.subject, "Enter a subject.");
    checkRequired(errors, "body", input.body, "Write the message body.");
  }
  return errors;
}

// -------------------------------------------------------- fiscal periods ---

export type FiscalPeriodLike = {
  _id?: string;
  fiscalYear?: string;
  periodLabel?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
};

export function validateFiscalPeriodInput(
  input: FiscalPeriodLike,
  existing: FiscalPeriodLike[] = [],
  selfId?: string,
): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "fiscalYear", input.fiscalYear, "Enter the fiscal year.");
  checkRequired(errors, "periodLabel", input.periodLabel, "Enter a period label.");
  if (!isIsoDate(input.startDate)) errors.startDate = "Enter a valid start date.";
  if (!isIsoDate(input.endDate)) errors.endDate = "Enter a valid end date.";
  if (!errors.startDate && !errors.endDate && String(input.endDate) < String(input.startDate)) {
    errors.endDate = "The end date must be on or after the start date.";
  }
  if (!errors.startDate && !errors.endDate) {
    const overlap = existing.find((period) =>
      String(period._id ?? "") !== String(selfId ?? "") &&
      period.status !== "archived" &&
      isIsoDate(period.startDate) && isIsoDate(period.endDate) &&
      String(period.startDate) <= String(input.endDate) &&
      String(input.startDate) <= String(period.endDate));
    if (overlap) {
      errors.startDate = `These dates overlap "${overlap.periodLabel || overlap.fiscalYear}" (${overlap.startDate} to ${overlap.endDate}).`;
    }
  }
  return errors;
}

// ---------------------------------------------------------- budget lines ---

export type BudgetLineLike = {
  _id?: string;
  fiscalYear?: string;
  category?: string;
  programCode?: string;
  plannedCents?: number;
};

export function budgetLineKey(row: BudgetLineLike): string {
  return [text(row.fiscalYear), text(row.category).toLowerCase(), text(row.programCode).toLowerCase()].join("|");
}

export function validateBudgetLineInput(
  input: BudgetLineLike,
  existing: BudgetLineLike[] = [],
  selfId?: string,
): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "fiscalYear", input.fiscalYear, "Choose a fiscal year.");
  checkRequired(errors, "category", input.category, "Enter a budget category.");
  if (typeof input.plannedCents !== "number" || !Number.isFinite(input.plannedCents)) {
    errors.plannedCents = "Enter a planned amount.";
  } else if (input.plannedCents < 0) {
    errors.plannedCents = "Planned amounts cannot be negative.";
  }
  if (!errors.category && !errors.fiscalYear) {
    const key = budgetLineKey(input);
    const duplicate = existing.find((row) => String(row._id ?? "") !== String(selfId ?? "") && budgetLineKey(row) === key);
    if (duplicate) {
      errors.category = `"${text(duplicate.category)}" already has a budget line for ${text(input.fiscalYear)}${text(input.programCode) ? ` (${text(input.programCode)})` : ""}. Edit that line instead.`;
    }
  }
  return errors;
}

// ---------------------------------------------------------------- assets ---

export function validateAssetEventInput(event: Record<string, any>): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "eventType", event.eventType, "Choose what happened.");
  if (event.eventType === "checkout" || event.eventType === "transfer") {
    checkRequired(errors, "toCustodianName", event.toCustodianName, "Name the new custodian.");
  }
  if (event.eventType === "checkin") {
    checkRequired(errors, "location", event.location, "Enter where the asset was returned.");
  }
  if (present(event.expectedReturnDate) && !isDateLike(event.expectedReturnDate)) {
    errors.expectedReturnDate = "Enter a valid return date.";
  }
  return errors;
}

export function validateAssetMaintenanceInput(input: Record<string, any>): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "title", input.title, "Enter what maintenance is due.");
  checkRequired(errors, "kind", input.kind, "Choose the maintenance type.");
  if (!isDateLike(input.dueDate)) errors.dueDate = "Enter a valid due date.";
  return errors;
}

export function validateAssetDisposalInput(input: Record<string, any>): FieldErrors {
  const errors: FieldErrors = {};
  if (!isDateLike(input.disposedAt)) errors.disposedAt = "Enter the disposal date.";
  checkRequired(errors, "disposalMethod", input.disposalMethod, "Choose how the asset was disposed of.");
  checkRequired(errors, "disposalReason", input.disposalReason, "Record why the asset was disposed of.");
  checkMoney(errors, "disposalValueCents", input.disposalValueCents, "Disposal value");
  return errors;
}

// -------------------------------------------------------- access custody ---

export function validateAccessCustodyInput(input: Record<string, any>, options: { partial?: boolean } = {}): FieldErrors {
  const errors: FieldErrors = {};
  const need = (field: string) => !options.partial || field in input;
  if (need("name")) checkRequired(errors, "name", input.name, "Name the access record.");
  if (need("service")) checkRequired(errors, "service", input.service, "Enter the service or system.");
  if (need("credentialType")) checkRequired(errors, "credentialType", input.credentialType, "Choose the credential type.");
  for (const field of ["custodianEmail", "backupCustodianEmail"] as const) {
    if (present(input[field]) && !isValidEmail(input[field])) errors[field] = "Enter a valid email address.";
  }
  return errors;
}

// ---------------------------------------------------------- counterparty ---

export function validateCounterpartyInput(input: Record<string, any>): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, "name", input.name, "Enter the counterparty name.");
  if (present(input.email) && !isValidEmail(input.email)) errors.email = "Enter a valid email address.";
  return errors;
}

// ------------------------------------------------------------ workflows ---

export function validateNamedRecordInput(input: Record<string, any>, field: string, message: string): FieldErrors {
  const errors: FieldErrors = {};
  checkRequired(errors, field, input[field], message);
  return errors;
}
