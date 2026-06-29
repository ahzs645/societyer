export type JournalLineInput = {
  amountCents: number;
  side: string;
};

export function validateBalancedJournalLines(lines: JournalLineInput[]) {
  if (lines.length < 2) throw new Error("A journal entry needs at least two lines.");
  let debitCents = 0;
  let creditCents = 0;
  for (const line of lines) {
    if (line.amountCents <= 0) throw new Error("Journal line amounts must be positive cents.");
    if (line.side === "debit") debitCents += line.amountCents;
    else if (line.side === "credit") creditCents += line.amountCents;
    else throw new Error("Journal line side must be debit or credit.");
  }
  if (debitCents !== creditCents) throw new Error("Journal entry is not balanced.");
  return { debitCents, creditCents };
}

export function transactionBackfillSides(amountCents: number) {
  const absoluteAmountCents = Math.abs(amountCents);
  if (absoluteAmountCents <= 0) throw new Error("Financial transaction amount must be non-zero.");
  return amountCents >= 0
    ? {
        cashSide: "debit" as const,
        offsetSide: "credit" as const,
        absoluteAmountCents,
        offsetKind: "income" as const,
      }
    : {
        cashSide: "credit" as const,
        offsetSide: "debit" as const,
        absoluteAmountCents,
        offsetKind: "expense" as const,
      };
}
