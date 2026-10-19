import type { BankAccountKind, BankAccountSource, BankAccountStatus, BankAccountTab } from "../../../../shared/bankAccounts";

/** One row of bankAccounts.overview. */
export type BankAccountRow = {
  _id: string;
  name: string;
  code?: string;
  accountType: string;
  kind: BankAccountKind;
  kindLabel: string;
  currency: string;
  isRestricted: boolean;
  institution?: string;
  lastFour?: string;
  source: BankAccountSource;
  sourceLabel: string;
  status: BankAccountStatus;
  statusLabel: string;
  statusReasons: string[];
  connectionId?: string;
  connectionStatus?: string;
  canSync: boolean;
  lastSyncAtISO?: string;
  lastActivityDate?: string;
  transactionCount: number;
  balanceCents: number;
  openingBalanceCents?: number;
  openingDate?: string;
  ledgerAccount: { _id: string; label: string; isSelf: boolean } | null;
  reconciledThrough?: string;
  archived: boolean;
  archivedAtISO?: string;
};

export type BankAccountsOverview = {
  rows: BankAccountRow[];
  counts: Record<BankAccountTab, number>;
  archivedCount: number;
  totalBalanceCents: number;
  ledgerOptions: Array<{ _id: string; label: string; accountType: string; inUse: boolean }>;
  usedCodes: string[];
  waveConnection: { _id: string; status: string; lastSyncAtISO?: string; lastError?: string; demo: boolean; accountLabel?: string } | null;
};

export function errorMessage(error: unknown): string | undefined {
  return error instanceof Error && error.message ? error.message : undefined;
}
