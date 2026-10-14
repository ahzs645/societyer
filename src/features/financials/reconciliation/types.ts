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
};

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
