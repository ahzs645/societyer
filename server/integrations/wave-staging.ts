export function waveTransactionsImportBundle(runnerOutput: any, normalized: any) {
  const businessId = String(runnerOutput?.businessId ?? "unknown");
  return {
    metadata: {
      createdFrom: "Wave browser connector",
      sourceSystem: "wave",
      importedFrom: "Wave browser connector",
      businessId,
      profileKey: runnerOutput?.profileKey,
      stagedAtISO: new Date().toISOString(),
    },
    sources: [
      {
        externalSystem: "wave",
        externalId: `wave:business:${businessId}`,
        title: `Wave browser export ${businessId}`,
        category: "Financial records",
        notes: "Transactions staged from a user-authorized Wave browser connector run.",
        tags: ["wave", "browser-connector", "finance"],
      },
    ],
    transactionCandidates: arrayOf(normalized?.transactions).map((transaction: any, index: number) => ({
      transactionDate: transaction.date,
      importGroupKey: `wave:${businessId}`,
      periodLabel: String(transaction.date ?? "").slice(0, 7),
      sourcePage: "Wave browser connector",
      rowOrder: index + 1,
      description: transaction.description,
      amountCents: transaction.amountCents,
      accountName: accountNameForWaveTransaction(transaction, normalized?.accounts),
      counterparty: transaction.counterparty,
      category: transaction.category,
      status: "NeedsReview",
      sensitivity: "restricted",
      confidence: "browser-connector",
      sourceExternalIds: [
        transaction.externalId ? `wave:transaction:${transaction.externalId}` : undefined,
        transaction.accountExternalId ? `wave:account:${transaction.accountExternalId}` : undefined,
      ].filter(Boolean),
      notes: "Review staged Wave transaction before applying to finance records.",
    })),
  };
}

function accountNameForWaveTransaction(transaction: any, accounts: any[]) {
  const account = arrayOf(accounts).find((item: any) => item.externalId === transaction.accountExternalId);
  return transaction.accountName ?? account?.name;
}

function arrayOf(value: any): any[] {
  return Array.isArray(value) ? value : [];
}
