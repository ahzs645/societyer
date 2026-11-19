import type { Permission } from "./functions/permissions";

export interface EvidenceField {
  key: string;
  label: string;
  type: string;
  required?: boolean;
  options?: string[];
  table?: string;
}

export interface EvidenceRegister {
  table: string;
  label: string;
  resource: "documents" | "directors" | "settings" | "agreements" | "financials" | "motions" | "filings";
  shares: boolean;
  fields: EvidenceField[];
}

export function registerPermission(register: EvidenceRegister, mode: "read" | "write"): Permission {
  return `${register.resource}:${mode}`;
}

export const businessRegisters: EvidenceRegister[] = [
  {
    table: "shareNotices", label: "Uncertificated share notices", resource: "documents", shares: true,
    fields: [
      { key: "transactionId", label: "Issuance or transfer", type: "reference", table: "rightsholdingTransfers", required: true },
      { key: "noticeNumber", label: "Notice number", type: "text", required: true },
      { key: "noticeDate", label: "Notice date", type: "date", required: true },
      { key: "sentOn", label: "Date sent", type: "date" },
      { key: "deliveryMethod", label: "Delivery method", type: "choice", options: ["Email", "Mail", "Hand delivery", "Other"] },
      { key: "signer", label: "Signing officer", type: "text" },
      { key: "restrictionLegend", label: "Transfer restrictions shown on notice", type: "text" },
      { key: "series", label: "Series as shown", type: "text" },
      { key: "resolutionId", label: "Authorizing resolution", type: "reference", table: "writtenResolutions" },
    ],
  },
  {
    table: "directorConsents", label: "Director consent history", resource: "directors", shares: false,
    fields: [
      { key: "directorId", label: "Director", type: "reference", table: "directors", required: true },
      { key: "scope", label: "Consent or acknowledgment", type: "choice", options: ["Consent to act", "Remote participation", "Qualification acknowledgment"], required: true },
      { key: "event", label: "Event", type: "choice", options: ["Given", "Withdrawn", "Corrected"], required: true },
      { key: "effectiveDate", label: "Effective date", type: "date", required: true },
      { key: "basis", label: "Basis", type: "choice", options: ["Written consent", "Meeting record", "Conduct", "Other"] },
      { key: "signedOn", label: "Signed on", type: "date" },
      { key: "receivedOn", label: "Received on", type: "date" },
      { key: "documentDate", label: "Document date", type: "date" },
      { key: "reviewStatus", label: "Evidence review", type: "choice", options: ["Awaiting review", "Reviewed", "Disputed"] },
    ],
  },
  {
    table: "businessChannels", label: "Business contact channels", resource: "settings", shares: false,
    fields: [
      { key: "channel", label: "Channel", type: "choice", options: ["Phone", "Voicemail", "Email", "Website"], required: true },
      { key: "value", label: "Contact value", type: "text", required: true },
      { key: "purpose", label: "Purpose", type: "text", required: true },
      { key: "visibility", label: "Intended audience", type: "choice", options: ["Internal", "Public", "Provider only"] },
      { key: "custodian", label: "Responsible person", type: "text" },
      { key: "provider", label: "Service provider", type: "text" },
      { key: "validFrom", label: "Effective from", type: "date" },
      { key: "validTo", label: "Effective through", type: "date" },
      { key: "brand", label: "Business or brand", type: "text" },
      { key: "primary", label: "Primary for this purpose", type: "choice", options: ["Yes", "No"] },
      { key: "verifiedOn", label: "Last confirmed", type: "date" },
    ],
  },
  {
    table: "mailboxServices", label: "PO box services", resource: "agreements", shares: false,
    fields: [
      { key: "addressId", label: "Mailing address", type: "reference", table: "organizationAddresses", required: true },
      { key: "agreementId", label: "Rental agreement", type: "reference", table: "agreements" },
      { key: "boxNumber", label: "Box number", type: "text", required: true },
      { key: "station", label: "Postal station", type: "text" },
      { key: "size", label: "Box size", type: "text" },
      { key: "renter", label: "Renter", type: "text" },
      { key: "pickup", label: "Authorized pickup people", type: "text" },
      { key: "custodian", label: "Key custodian", type: "text" },
      { key: "deposit", label: "Key deposit", type: "choice", options: ["Paid", "Required", "None", "Unknown"] },
      { key: "renewalDate", label: "Renewal date", type: "date" },
      { key: "rentalType", label: "Rental type", type: "text" },
      { key: "deliveryMode", label: "Delivery mode", type: "text" },
      { key: "depositAmount", label: "Key deposit amount", type: "money" },
      { key: "currency", label: "Deposit currency", type: "currency" },
    ],
  },
  {
    table: "bankRelationships", label: "Bank relationships", resource: "financials", shares: false,
    fields: [
      { key: "institution", label: "Institution", type: "text", required: true },
      { key: "accountId", label: "Linked account", type: "reference", table: "financialAccounts" },
      { key: "manager", label: "Manager or team", type: "text" },
      { key: "branch", label: "Responsibility transit", type: "text" },
      { key: "since", label: "Relationship since (as recorded)", type: "text" },
      { key: "contact", label: "Bank correspondence contact", type: "text" },
      { key: "language", label: "Correspondence language", type: "text" },
      { key: "asOf", label: "Profile date", type: "date" },
    ],
  },
  {
    table: "clientCardAccess", label: "Client card access", resource: "financials", shares: false,
    fields: [
      { key: "institution", label: "Issuer", type: "text", required: true },
      { key: "lastFour", label: "Last four digits", type: "last4", required: true },
      { key: "cardId", label: "Existing card", type: "reference", table: "corporateCards" },
      { key: "accountId", label: "Linked account", type: "reference", table: "financialAccounts" },
      { key: "cardType", label: "Card type", type: "choice", options: ["Client access", "Debit", "Deposit only", "Credit"], required: true },
      { key: "holder", label: "Assigned holder", type: "text" },
      { key: "issueNumber", label: "Issue number", type: "text" },
      { key: "accessRole", label: "Access granted", type: "text" },
      { key: "cashLimit", label: "Daily withdrawal limit", type: "money" },
      { key: "instantLimit", label: "Daily instant funds limit", type: "money" },
      { key: "purchaseLimit", label: "Daily purchase limit", type: "money" },
      { key: "paymentLimit", label: "Daily third-party payment limit", type: "money" },
      { key: "currency", label: "Limit currency", type: "currency" },
      { key: "limitGroup", label: "Shared limit group", type: "text" },
      { key: "asOf", label: "Effective date", type: "date" },
      { key: "cardStatus", label: "Card status", type: "choice", options: ["Active", "Replaced", "Closed", "Unknown"] },
    ],
  },
  {
    table: "governanceDecisions", label: "Governance decisions", resource: "motions", shares: false,
    fields: [
      { key: "resolutionId", label: "Written resolution", type: "reference", table: "writtenResolutions", required: true },
      { key: "scope", label: "Decision", type: "choice", options: ["Borrowing", "Guarantees", "Security", "Banking", "Document signing", "Auditor waiver", "Corporate seal", "Other"], required: true },
      { key: "authority", label: "Authorized roles or people", type: "text" },
      { key: "minimumSigners", label: "Minimum signers", type: "count" },
      { key: "exclusions", label: "Conditions or exclusions", type: "text" },
      { key: "sealStatus", label: "Seal status", type: "choice", options: ["Adopted", "Not adopted", "Unknown"] },
      { key: "effectiveDate", label: "Effective date", type: "date" },
      { key: "periodStart", label: "Financial period start", type: "date" },
      { key: "periodEnd", label: "Financial period end", type: "date" },
      { key: "consentReview", label: "Shareholder consent review", type: "choice", options: ["Awaiting review", "Reviewed", "Incomplete"] },
    ],
  },
  {
    table: "identifierDetails", label: "Identifier correspondence", resource: "settings", shares: false,
    fields: [
      { key: "identifierId", label: "Registered identifier", type: "reference", table: "organizationIdentifiers", required: true },
      { key: "authority", label: "Issuing authority", type: "text" },
      { key: "programCode", label: "Program code", type: "text" },
      { key: "addressId", label: "Correspondence address", type: "reference", table: "organizationAddresses" },
      { key: "accountLabel", label: "Account display name", type: "text" },
      { key: "language", label: "Correspondence language", type: "text" },
      { key: "notificationContact", label: "Notification contact", type: "text" },
      { key: "confirmedOn", label: "Confirmed on", type: "date" },
      { key: "effectiveTo", label: "Effective through", type: "date" },
    ],
  },
  {
    table: "recognitionDetails", label: "Filing and recognition", resource: "filings", shares: false,
    fields: [
      { key: "registrationId", label: "Registration", type: "reference", table: "organizationRegistrations", required: true },
      { key: "recognizedAt", label: "Recognition local date and time", type: "datetime-local", required: true },
      { key: "timeZone", label: "Time zone (e.g. America/Vancouver)", type: "zone", required: true },
      { key: "acceptedAt", label: "Filing accepted (local time)", type: "datetime-local" },
      { key: "completingParty", label: "Completing party", type: "text" },
      { key: "statementDate", label: "Statement date", type: "date" },
    ],
  },
  {
    table: "equitySubscriptions", label: "Share subscriptions", resource: "documents", shares: true,
    fields: [
      { key: "classId", label: "Share class", type: "reference", table: "rightsClasses", required: true },
      { key: "subscriber", label: "Subscriber", type: "text", required: true },
      { key: "quantity", label: "Shares subscribed", type: "count", required: true },
      { key: "aggregatePrice", label: "Aggregate subscription price", type: "money" },
      { key: "currency", label: "Currency", type: "currency" },
      { key: "subscribedOn", label: "Subscription date", type: "date", required: true },
      { key: "acceptedOn", label: "Acceptance date", type: "date" },
      { key: "payment", label: "Payment status", type: "choice", options: ["Unknown", "Outstanding", "Partially paid", "Paid"] },
      { key: "conditions", label: "Conditions", type: "text" },
      { key: "cancelledOn", label: "Cancellation date", type: "date" },
      { key: "transactionId", label: "Resulting issuance", type: "reference", table: "rightsholdingTransfers" },
    ],
  },
];
