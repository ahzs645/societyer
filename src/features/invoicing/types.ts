import type { InvoiceMoneyOptions } from "../../../shared/invoiceMoney";
import type { DocumentExtras } from "../../../shared/documentExtras";
import type { InvoiceTemplate, InvoicePriceList, RepairStatus } from "../../../shared/invoiceCommerce";
import type { CustomerSummary, InvoiceLine, InvoicePayment, InvoiceStatus, InvoiceTotals } from "../../../shared/invoicing";
import type { BooksStart, CategoryAccount, NeedsActionFlag } from "../../../shared/invoiceLedger";

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
  shipToName?: string;
  shipToAddress?: string;
  issueDate: string;
  terms: string;
  dueDate: string;
  reference?: string;
  documentTemplate?: InvoiceTemplate;
  money?: InvoiceMoneyOptions; documentExtras?: DocumentExtras;
  cashPaidCents?: number; creditCents?: number; writeOffCents?: number; refundCents?: number;
  fxRevaluations?: Array<{key:string;date:string;rateMicros:number;source?:string;invoiceBalanceCents:number;baseBalanceCents:number;adjustmentCents:number;journalEntryId?:string;reversedDate?:string;reversalJournalEntryId?:string}>;
  priceListId?: string;
  repairJobId?: string;
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
  journalEntryId?: string;
  reversalJournalEntryId?: string;
  /** Derived on read: why the invoice doesn't reconcile cleanly with the books. */
  needsAction: NeedsActionFlag[];
  ledger: InvoiceLedgerState;
};

export type InvoiceLedgerState = {
  state: "none" | "posted" | "ready" | "blocked";
  entryId?: string;
  reasons: string[];
  paymentsToPost: number;
};

export type CatalogItem = Partial<Pick<InvoiceLine, "taxMode" | "imageUrl" | "manufacturer" | "partNumber" | "upc" | "ean" | "isbn" | "customField" | "batchNumber" | "serialNumbers">> & {
  _id: string;
  name: string;
  description?: string;
  kind?: "item" | "service";
  sku?: string;
  unit?: string;
  currency?: string;
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
  shipToName?: string;
  shipToAddress?: string;
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
  releasedDate?: string;
  currency?: string;
  _id: string;
  date: string;
  amountCents: number;
  description?: string;
  counterparty?: string;
  category?: string;
  accountId?: string;
  accountLabel?: string;
  /** Matched to something other than an invoice; not offered for linking. */
  matchedElsewhere?: boolean;
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
  defaultTemplateId?: string;
  prefix: string;
  nextNumber: number;
  nextNumberPreview: string;
  defaultTerms: string;
  paymentInstructions?: string;
  defaultMemo?: string;
  replyToEmail?: string;
  receivableAccountId?: string;
  taxPayableAccountId?: string;
  defaultRevenueAccountId?: string;
  depositAccountId?: string;
  categoryAccounts?: CategoryAccount[];
};

export type LedgerAccountOption = { currency?: string; _id: string; label: string; accountType: string };

/** The books side of the workspace: mapping, choosable accounts and what blocks posting. */
export type InvoiceLedgerView = {
  workspaceCurrency: string;
  booksStart: BooksStart & { label: string | null };
  categories: string[];
  accounts: { revenue: LedgerAccountOption[]; receivable: LedgerAccountOption[]; taxPayable: LedgerAccountOption[]; deposit: LedgerAccountOption[] };
  defaults: { receivable: { _id: string; label: string } | null; taxPayable: { _id: string; label: string } | null; deposit: { _id: string; label: string } | null };
  foreignCurrency: { count: number; currencies: string[] };
  readyCount: number;
  blockedCount: number;
};

export type InvoicePostingPreview = {
  invoiceCount: number;
  invoiceCents: number;
  paymentCount: number;
  paymentCents: number;
  postedCount: number;
  blocked: Array<{ invoiceId: string; number: string; billToName: string; totalCents: number; reasons: string[] }>;
  workspaceCurrency: string;
  booksStart: string | null;
};

export type InvoiceOrganization = {
  name?: string;
  logoUrl?: string | null;
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
  templates?: Array<{ _id: string; config: InvoiceTemplate; active: boolean }>;
  priceLists?: InvoicePriceList[];
  repairJobs?: RepairJob[];
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
    needsActionCount: number;
  };
  ledger: InvoiceLedgerView;
};

export type InvoiceTab = "all" | "drafts" | "outstanding" | "overdue" | "paid" | "needs_action" | "recurring" | "customers" | "catalog" | "templates" | "price_lists" | "repairs" | "quotes" | "statements" | "automation";

export type RepairJob = {
  _id: string; number: string; partyKind: "member" | "organization" | "custom"; memberId?: string; counterpartyId?: string;
  billToName: string; billToEmail?: string; billToAddress?: string; asset: string; serialNumber?: string;
  problem: string; notes?: string; receivedDate: string; targetDate?: string; currency: string; status: RepairStatus;
  lines: InvoiceLine[]; totalCents: number; timeline: InvoiceTimelineEvent[]; invoice?: InvoiceRow | null;
};
