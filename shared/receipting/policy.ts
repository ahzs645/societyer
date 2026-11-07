import { isCalendarDate } from "../invoicing";
import { organizationTimeZone, type LegalEntityLike } from "../organizationDomain";

export const RECEIPT_RULE_VERSION = "CA-CRA-CASH-2026-11-07.1";
export type ReceiptDocumentKind = "acknowledgement" | "official_tax_receipt";
export type ReceiptIssueStatus = "prepared" | "issued";

export function receiptDateInOrganization(organization: LegalEntityLike & { timeZone?: string | null }, now = new Date()): string {
  const timeZone = organizationTimeZone(organization) || "UTC";
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const part = (type: string) => parts.find(value => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export interface ReceiptIssueInput {
  societyId: string;
  documentKind: ReceiptDocumentKind;
  idempotencyKey: string;
  /** Compatibility input only: an official number must match the reviewed registration. */
  charityNumber?: string;
  donorName: string;
  donorEmail?: string;
  donorAddress?: string;
  amountCents: number;
  eligibleAmountCents?: number;
  receivedOnISO: string;
  intendedIssueDate?: string;
  location: string;
  description?: string;
  isNonCash: boolean;
  appraiserName?: string;
  advantageAmountCents?: number;
  giftEligibilityConfirmed?: boolean;
  sourceAcknowledgementId?: string;
  replacesReceiptId?: string;
}

export function receiptText(value: unknown, label: string, max = 1000, required = false): string | undefined {
  if (value !== undefined && typeof value !== "string") throw new Error(`${label} must be text.`);
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new Error(`${label} is required.`);
  if (text.length > max) throw new Error(`${label} must be ${max} characters or fewer.`);
  return text || undefined;
}

export function validateReceiptInput(input: ReceiptIssueInput, currentDate: string) {
  if (input.documentKind !== "acknowledgement" && input.documentKind !== "official_tax_receipt") {
    throw new Error("Choose a donation acknowledgement or an official tax receipt.");
  }
  const official = input.documentKind === "official_tax_receipt";
  const idempotencyKey = receiptText(input.idempotencyKey, "Request identifier", 120, true)!;
  const donorName = receiptText(input.donorName, "Donor's full name", 250, true)!;
  const donorAddress = receiptText(input.donorAddress, "Donor address", 1500, official);
  const donorEmail = receiptText(input.donorEmail, "Donor email", 320);
  const location = receiptText(input.location, "Place of issue", 250, true)!;
  const description = receiptText(input.description, "Gift description", 2000);
  const appraiserName = receiptText(input.appraiserName, "Appraiser name", 250);
  if (!Number.isSafeInteger(input.amountCents) || input.amountCents <= 0) throw new Error("Gift amount must be a positive whole number of cents.");
  if (input.eligibleAmountCents !== undefined && (!Number.isSafeInteger(input.eligibleAmountCents) || input.eligibleAmountCents < 0 || input.eligibleAmountCents > input.amountCents)) throw new Error("Eligible amount must be between zero and the gift amount in whole cents.");
  if (!isCalendarDate(input.receivedOnISO) || input.receivedOnISO > currentDate) throw new Error("Choose a valid gift date that is not in the future.");
  const intendedIssueDate = input.intendedIssueDate || currentDate;
  if (!isCalendarDate(intendedIssueDate) || intendedIssueDate > currentDate || intendedIssueDate < input.receivedOnISO) throw new Error("Issue date must be a valid date on or after the gift date and no later than today.");
  if (official && intendedIssueDate !== currentDate) throw new Error("Prepare the official receipt with today's organization date. Reprepare a receipt whose intended issue date has changed.");
  if (typeof input.isNonCash !== "boolean") throw new Error("Confirm whether the gift was cash or non-cash.");
  if (input.advantageAmountCents !== undefined && (!Number.isSafeInteger(input.advantageAmountCents) || input.advantageAmountCents < 0)) throw new Error("Advantage amount must be a non-negative whole number of cents.");
  if (official) {
    if (input.isNonCash) throw new Error("Non-cash gifts require a separately reviewed receipting route. You can record an acknowledgement.");
    if (input.advantageAmountCents !== 0 || input.eligibleAmountCents !== input.amountCents) throw new Error("This official receipt route supports cash gifts with no donor advantage. Gifts with benefits or adjusted eligible amounts need review.");
    if (input.giftEligibilityConfirmed !== true) throw new Error("Confirm that this is an eligible voluntary gift, the donor identity is correct, and no advantage was provided.");
  }
  return {
    societyId: input.societyId,
    documentKind: input.documentKind,
    idempotencyKey,
    donorName,
    ...(donorEmail ? { donorEmail } : {}),
    ...(donorAddress ? { donorAddress } : {}),
    amountCents: input.amountCents,
    // Acknowledgements deliberately carry no tax-eligible amount.
    eligibleAmountCents: official ? input.amountCents : 0,
    receivedOnISO: input.receivedOnISO,
    intendedIssueDate,
    location,
    ...(description ? { description } : {}),
    isNonCash: input.isNonCash,
    ...(appraiserName ? { appraiserName } : {}),
    ...(official ? { advantageAmountCents: 0, giftEligibilityConfirmed: true } : {}),
    ...(input.sourceAcknowledgementId ? { sourceAcknowledgementId: input.sourceAcknowledgementId } : {}),
    ...(input.replacesReceiptId ? { replacesReceiptId: input.replacesReceiptId } : {}),
  };
}

/** Stable request identity excludes clocks and server-derived organization facts. */
export function receiptRequestFingerprint(input: ReceiptIssueInput): string {
  const fields: Array<keyof ReceiptIssueInput> = ["documentKind", "charityNumber", "donorName", "donorEmail", "donorAddress", "amountCents", "eligibleAmountCents", "receivedOnISO", "intendedIssueDate", "location", "description", "isNonCash", "appraiserName", "advantageAmountCents", "giftEligibilityConfirmed", "sourceAcknowledgementId", "replacesReceiptId"];
  return JSON.stringify(fields.map(field => [field, input[field] ?? null]));
}

export function receiptDocumentLabel(receipt: { documentKind?: string; issueStatus?: string; voidedAtISO?: string }) {
  if (receipt.voidedAtISO) return "Voided";
  if (!receipt.documentKind) return "Historical record · review needed";
  if (receipt.documentKind === "acknowledgement") return "Acknowledgement";
  return receipt.issueStatus === "issued" ? "Official receipt · signed issue recorded" : "Official receipt · awaiting signature";
}

/** One recorded contribution can have an acknowledgement and an official receipt.
 * Financial observations count the gift once, and never count voids or unsigned
 * preparations as separate money received. Historical kind-absent rows retain
 * their old observation semantics without gaining an eligibility endorsement.
 */
export function recordedDonationGifts<T extends { _id: string; giftRecordId?: string; sourceAcknowledgementId?: string; documentKind?: string; issueStatus?: string; voidedAtISO?: string }>(receipts: T[]): T[] {
  const gifts = new Map<string, T>();
  for (const receipt of receipts) {
    if (receipt.voidedAtISO || (receipt.documentKind === "official_tax_receipt" && receipt.issueStatus !== "issued")) continue;
    const identity = receipt.giftRecordId || receipt.sourceAcknowledgementId || receipt._id;
    const existing = gifts.get(identity);
    if (!existing || (existing.documentKind !== "acknowledgement" && receipt.documentKind === "acknowledgement")) gifts.set(identity, receipt);
  }
  return [...gifts.values()];
}
