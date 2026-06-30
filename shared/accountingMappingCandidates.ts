/**
 * PURE accounting-provider mapping-candidate helpers.
 *
 * These build `AccountMappingCandidate` rows from imported/Wave transaction
 * metadata. They are pure (no network, no `ctx`) so portable handlers under
 * shared/functions can depend on them without importing upward into convex/.
 * The Wave network adapter (convex/providers/accounting.ts) re-exports these.
 */

export type AccountingProvider = "wave" | "ledgersmb" | "csv" | "browser" | "societyer";

export type AccountMappingCandidate = {
  provider: AccountingProvider;
  externalAccountId?: string;
  externalAccountCode?: string;
  externalAccountName?: string;
  externalCategory?: string;
  confidence?: "high" | "medium" | "low";
  notes?: string;
};

export type WaveAccount = {
  externalId: string;
  name: string;
  currency: string;
  accountType: "Bank" | "Credit" | "Income" | "Expense" | "Asset" | "Liability" | "Equity";
  balanceCents: number;
  isRestricted: boolean;
  restrictedPurpose?: string;
};

export type WaveTransaction = {
  externalId: string;
  accountExternalId: string;
  date: string;
  description: string;
  amountCents: number;
  category?: string;
  counterparty?: string;
};

export function normalizeAccountingProvider(value: unknown): AccountingProvider {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("wave")) return "wave";
  if (text.includes("ledgersmb") || text.includes("ledger-smb")) return "ledgersmb";
  if (text.includes("browser")) return "browser";
  if (text.includes("csv") || text.includes("spreadsheet")) return "csv";
  if (text.includes("societyer")) return "societyer";
  return "csv";
}

export function uniqueMappingCandidates(rows: Array<AccountMappingCandidate | undefined>) {
  const seen = new Set<string>();
  const result: AccountMappingCandidate[] = [];
  for (const row of rows) {
    if (!row?.externalAccountName && !row?.externalAccountId && !row?.externalAccountCode && !row?.externalCategory) continue;
    const key = [
      row.provider,
      row.externalAccountId ?? "",
      row.externalAccountCode ?? "",
      row.externalAccountName ?? "",
      row.externalCategory ?? "",
    ].join("::").toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(row);
  }
  return result;
}

export function waveAccountMappingCandidate(account: WaveAccount): AccountMappingCandidate {
  return {
    provider: "wave",
    externalAccountId: account.externalId,
    externalAccountName: account.name,
    externalCategory: account.accountType,
    confidence: account.externalId ? "high" : "medium",
    notes: account.restrictedPurpose,
  };
}

export function waveTransactionMappingCandidates(transaction: WaveTransaction): AccountMappingCandidate[] {
  return uniqueMappingCandidates([
    {
      provider: "wave",
      externalAccountId: transaction.accountExternalId,
      externalAccountName: transaction.accountExternalId,
      confidence: transaction.accountExternalId ? "high" : "low",
      notes: "Wave transaction source account.",
    },
    transaction.category
      ? {
          provider: "wave",
          externalAccountName: transaction.category,
          externalCategory: transaction.category,
          confidence: "medium",
          notes: "Wave transaction category.",
        }
      : undefined,
  ]);
}

export function transactionImportMappingCandidates(input: {
  sourceSystem?: string;
  accountName?: string;
  accountExternalId?: string;
  accountCode?: string;
  category?: string;
}): AccountMappingCandidate[] {
  const provider = normalizeAccountingProvider(input.sourceSystem);
  return uniqueMappingCandidates([
    input.accountName || input.accountExternalId || input.accountCode
      ? {
          provider,
          externalAccountId: input.accountExternalId,
          externalAccountCode: input.accountCode,
          externalAccountName: input.accountName ?? input.accountExternalId ?? input.accountCode,
          confidence: input.accountExternalId || input.accountCode ? "high" : "medium",
          notes: "Imported transaction account.",
        }
      : undefined,
    input.category
      ? {
          provider,
          externalAccountName: input.category,
          externalCategory: input.category,
          confidence: "medium",
          notes: "Imported transaction category.",
        }
      : undefined,
  ]);
}
