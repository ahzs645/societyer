import type { PeriodStatus } from "../../../../shared/reconciliationPeriods";

export type ReconAccount = {
  _id: string;
  name: string;
  code?: string;
  accountType?: string;
  currency: string;
  balanceCents: number;
  hasActivity: boolean;
  transactionCount: number;
  periodCount: number;
  latestStatus?: PeriodStatus;
  latestEndDate?: string;
  lastReconciledThrough?: string;
  openPeriodId?: string;
  outOfBalanceCount: number;
  nextStartDate?: string;
  nextBeginningBalanceCents?: number;
  needsOpeningBalance: boolean;
} & ReconAccountExtras;

export type ReconPeriod = {
  _id: string;
  accountId: string;
  accountName: string;
  startDate: string;
  endDate: string;
  openingBalanceCents?: number;
  endingBalanceCents: number;
  statementDocumentId?: string;
  status: string;
  effectiveStatus: PeriodStatus;
  completedAtISO?: string;
  completedByName?: string;
  outOfBalanceAtISO?: string;
  notes?: string;
  beginningBalanceCents: number;
  clearedDepositsCents: number;
  clearedPaymentsCents: number;
  clearedBalanceCents: number;
  differenceCents: number;
  clearedCount: number;
  unclearedCount: number;
  transactionCount: number;
  transactionIds: string[];
};

export type ReconPeriodsData = { accounts: ReconAccount[]; periods: ReconPeriod[] };

/** reconciliation.periods account rows also carry the Accounts page's opening balance. */
export type ReconAccountExtras = {
  suggestedOpeningBalanceCents?: number;
  suggestedStartDate?: string;
  archived?: boolean;
};

export type MonthStatusRow = {
  month: string;
  kind: "reconciled" | "in_progress" | "not_started" | "difference" | "upcoming";
  label: string;
  differenceCents?: number;
  auto?: boolean;
  periodId?: string;
  transactionCount: number;
};

export type MonthLine = {
  _id: string;
  date: string;
  description: string;
  counterparty?: string;
  amountCents: number;
  balanceCents: number;
  reconciled: boolean;
  matchedKind?: string;
  reconciliationNote?: string;
  ledgerLabel?: string;
  hasReceipt: boolean;
};

export type MonthDetail = {
  month: string;
  start: string;
  end: string;
  openingBalanceCents: number;
  feedEndingBalanceCents: number;
  lines: MonthLine[];
  period: {
    _id: string;
    startDate: string;
    endDate: string;
    status: string;
    effectiveStatus: PeriodStatus;
    beginningBalanceCents: number;
    clearedBalanceCents: number;
    endingBalanceCents: number;
    differenceCents: number;
    clearedCount: number;
    transactionCount: number;
    unclearedCount: number;
    completedAtISO?: string;
    completedByName?: string;
  } | null;
  statementDocument: { _id: string; title: string; fileName?: string } | null;
  autoReconcile: { ready: boolean; projectedDifferenceCents: number; toClearIds: string[]; blockingCount: number; reason?: string } | null;
};

export type AccountMonthsData = {
  account: { _id: string; name: string; code?: string; currency: string };
  year: number;
  years: number[];
  months: MonthStatusRow[];
  currentBalanceCents: number;
  detail: MonthDetail | null;
};
