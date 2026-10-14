import type { CustomerSummary, InvoiceLine, InvoicePayment, InvoiceStatus, InvoiceTotals } from "../../../shared/invoicing";

export type InvoicePaymentView = InvoicePayment & {
  recordedByName?: string;
  transaction?: { _id: string; date: string; description?: string; amountCents: number };
};

export type InvoiceTimelineEvent = { atISO: string; kind: string; label: string; actorName?: string; amountCents?: number };

export type InvoiceRow = {
  _id: string;
  societyId: string;
  sequence: number;
  number: string;
  status: InvoiceStatus;
  lifecycle: "draft" | "sent" | "void";
  partyKind: "member" | "organization" | "custom";
  memberId?: string;
  counterpartyId?: string;
  billToName: string;
  billToEmail?: string;
  billToAddress?: string;
  issueDate: string;
  terms: string;
  dueDate: string;
  reference?: string;
  currency: string;
  lines: InvoiceLine[];
  discount?: { kind: "percent" | "amount"; value: number };
  memo?: string;
  totals: InvoiceTotals;
  totalCents: number;
  paidCents: number;
  balanceCents: number;
  daysOverdue: number;
  payments: InvoicePaymentView[];
  timeline: InvoiceTimelineEvent[];
  seriesId?: string;
  seriesName?: string;
  source?: string;
  subscriptionId?: string;
  duesBatch?: string;
  sentAtISO?: string;
  lastReminderAtISO?: string;
  voidedAtISO?: string;
  voidReason?: string;
};

export type CatalogItem = {
  _id: string;
  name: string;
  description?: string;
  unitPriceCents: number;
  taxRatePercent?: number;
  taxLabel?: string;
  category?: string;
  accountingAccountId?: string;
  active: boolean;
};

export type InvoiceSeriesRow = {
  _id: string;
  name: string;
  frequency: string;
  startDate: string;
  nextIssueDate?: string;
  endKind: string;
  endAfterCount?: number;
  endDate?: string;
  issuedCount: number;
  autoSend: boolean;
  status: "active" | "paused" | "ended";
  partyKind: string;
  memberId?: string;
  counterpartyId?: string;
  billToName: string;
  billToEmail?: string;
  billToAddress?: string;
  terms: string;
  reference?: string;
  currency: string;
  lines: InvoiceLine[];
  discount?: { kind: "percent" | "amount"; value: number };
  memo?: string;
  totalCents: number;
  invoiceCount: number;
  outstandingCents: number;
  lastInvoiceId?: string;
  due: boolean;
};

export type MoneyInTransaction = {
  _id: string;
  date: string;
  amountCents: number;
  description?: string;
  counterparty?: string;
  category?: string;
  linkedInvoiceId?: string;
  linkedInvoiceNumber?: string;
};

export type DuesCandidate = {
  subscriptionId: string;
  memberId?: string;
  name: string;
  email?: string;
  planName: string;
  priceCents: number;
  currency: string;
  renewalDate: string;
  existingInvoiceId?: string;
  existingInvoiceNumber?: string;
};

export type InvoiceSettings = {
  _id?: string;
  prefix: string;
  nextNumber: number;
  nextNumberPreview: string;
  defaultTerms: string;
  paymentInstructions?: string;
  defaultMemo?: string;
  replyToEmail?: string;
};

export type InvoiceOrganization = {
  name?: string;
  entityType?: string;
  address?: string;
  registrationNumber?: string;
  email?: string;
  gstNumber?: string;
};

export type PartyOption = { _id: string; name: string; email?: string; address?: string; membershipClass?: string; status?: string; kind?: string };

export type InvoiceWorkspace = {
  today: string;
  settings: InvoiceSettings;
  organization: InvoiceOrganization;
  invoices: InvoiceRow[];
  catalog: CatalogItem[];
  series: InvoiceSeriesRow[];
  parties: { members: PartyOption[]; organizations: PartyOption[] };
  customers: CustomerSummary[];
  transactions: MoneyInTransaction[];
  plans: Array<{ _id: string; name: string; priceCents: number; interval: string; membershipClass?: string; currency?: string }>;
  duesCandidates: DuesCandidate[];
  summary: {
    outstandingCents: number;
    outstandingCount: number;
    overdueCents: number;
    overdueCount: number;
    paidLast30Cents: number;
    paidLast30Count: number;
    draftCents: number;
    draftCount: number;
  };
};

export type InvoiceTab = "all" | "drafts" | "outstanding" | "overdue" | "paid" | "recurring" | "customers" | "catalog";
