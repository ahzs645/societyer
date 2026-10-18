import type { SpendBudgetCycle, SpendBudgetStatus } from "../../../../shared/spendBudgets";

export type SpendBudgetRow = {
  _id: string;
  name: string;
  limitCents: number;
  currency: string;
  cycle: SpendBudgetCycle;
  cycleLabel: string;
  startDate: string;
  endDate?: string;
  status: SpendBudgetStatus;
  statusLabel: string;
  archived: boolean;
  committeeId?: string;
  committeeName?: string;
  memberUserIds: string[];
  memberNames: string[];
  notes?: string;
  spend: {
    window: { start: string; end: string };
    spentCents: number;
    remainingCents: number;
    percentSpent: number;
    overLimit: boolean;
    entryCount: number;
    bySource: { claim: number; transaction: number };
  };
  claims: Array<{ _id: string; title: string; claimantName: string; amountCents: number; status: string; incurredAtISO: string; claimType?: string }>;
  canCharge: boolean;
};

export type SpendBudgetsData = {
  rows: SpendBudgetRow[];
  summary: { activeCount: number; upcomingCount: number; limitCents: number; spentCents: number; remainingCents: number; overLimitCount: number };
  committees: Array<{ _id: string; name: string }>;
  users: Array<{ _id: string; name: string }>;
};

/** spendBudgets.optionsForClaim */
export type ClaimBudgetOption = {
  _id: string;
  name: string;
  cycleLabel: string;
  limitCents: number;
  window: { start: string; end: string };
  spentCents: number;
  remainingCents: number;
  remainingAfterCents: number;
  exceeds: boolean;
};
