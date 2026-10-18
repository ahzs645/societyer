/**
 * Line items on a bank transaction: pure helpers shared by the portable
 * handlers, the static demo, the gate scripts and the transaction panel.
 *
 * Every bank transaction is a small journal entry. With no `lines` (or one),
 * the transaction has a single line that mirrors its `category`,
 * `accountingAccountId`, `fundRestrictionId` and `tagIds`, which is how every
 * row was stored before splits existed, so rules, imports and old rows keep
 * working unchanged. Two or more `lines` are a split: each line has its own
 * amount (signed like the transaction, summing to it exactly), category or
 * ledger account, fund, memo and tags. The top-level fields then summarise
 * the largest line so budgets and lists that read `category` still see one.
 *
 * Tags: at most one tag per tag group on a line.
 *
 * Pure TypeScript: no Convex, DOM or Node imports.
 */

export type TransactionLine = {
  id: string;
  /** Signed integer cents, like the transaction (money out is negative). */
  amountCents: number;
  category?: string;
  accountingAccountId?: string;
  fundRestrictionId?: string;
  memo?: string;
  tagIds?: string[];
};

export type LineTransaction = {
  amountCents: number;
  category?: string | null;
  accountingAccountId?: string | null;
  fundRestrictionId?: string | null;
  tagIds?: readonly string[] | null;
  lines?: readonly TransactionLine[] | null;
};

/** Most lines one transaction may be split into. */
export const MAX_TRANSACTION_LINES = 50;

/** The id the single, implicit line of an unsplit transaction gets. */
export const SINGLE_LINE_ID = "line-1";

export function isSplitTransaction(txn: Pick<LineTransaction, "lines">): boolean {
  return Array.isArray(txn.lines) && txn.lines.length > 1;
}

/** "Split (3)" for a split transaction, else undefined. */
export function splitLabel(txn: Pick<LineTransaction, "lines">): string | undefined {
  return isSplitTransaction(txn) ? `Split (${txn.lines!.length})` : undefined;
}

function cleanTagIds(tagIds: readonly string[] | null | undefined): string[] | undefined {
  const unique = [...new Set((tagIds ?? []).map(String).filter(Boolean))];
  return unique.length ? unique : undefined;
}

/**
 * The lines a transaction posts: its split lines, or one line built from the
 * top-level fields.
 */
export function transactionLines(txn: LineTransaction): TransactionLine[] {
  if (isSplitTransaction(txn)) {
    return txn.lines!.map((line) => ({ ...line, tagIds: cleanTagIds(line.tagIds) }));
  }
  const only = txn.lines?.[0];
  return [
    {
      id: only?.id ?? SINGLE_LINE_ID,
      amountCents: txn.amountCents,
      category: txn.category ?? undefined,
      accountingAccountId: txn.accountingAccountId ?? undefined,
      fundRestrictionId: txn.fundRestrictionId ?? undefined,
      memo: only?.memo,
      tagIds: cleanTagIds(txn.tagIds),
    },
  ];
}

/** Every tag on the transaction (any line), without duplicates. */
export function transactionTagIds(txn: LineTransaction): string[] {
  return [...new Set(transactionLines(txn).flatMap((line) => line.tagIds ?? []))];
}

export function linesTotalCents(lines: readonly Pick<TransactionLine, "amountCents">[]): number {
  return lines.reduce((sum, line) => sum + (Number.isFinite(line.amountCents) ? Math.round(line.amountCents) : 0), 0);
}

/** What is left to allocate: the transaction amount minus the lines' total. */
export function linesRemainderCents(amountCents: number, lines: readonly Pick<TransactionLine, "amountCents">[]): number {
  return Math.round(amountCents) - linesTotalCents(lines);
}

/**
 * `count` integer amounts that sum to `amountCents`, as equal as possible;
 * leftover cents go to the first lines ($100.00 in three: 33.34, 33.33, 33.33).
 */
export function splitEvenlyCents(amountCents: number, count: number): number[] {
  const n = Math.max(1, Math.floor(count));
  const total = Math.round(amountCents);
  const sign = total < 0 ? -1 : 1;
  const magnitude = Math.abs(total);
  const base = Math.floor(magnitude / n);
  const extra = magnitude - base * n;
  return Array.from({ length: n }, (_, index) => sign * (base + (index < extra ? 1 : 0)));
}

/** The lines with their amounts split evenly across the transaction amount. */
export function withEvenSplit<T extends Pick<TransactionLine, "amountCents">>(amountCents: number, lines: readonly T[]): T[] {
  const amounts = splitEvenlyCents(amountCents, lines.length);
  return lines.map((line, index) => ({ ...line, amountCents: amounts[index] }));
}

/** The lines with the remainder added to the line at `index`. */
export function withRemainderOn<T extends Pick<TransactionLine, "amountCents">>(amountCents: number, lines: readonly T[], index: number): T[] {
  const remainder = linesRemainderCents(amountCents, lines);
  return lines.map((line, at) => (at === index ? { ...line, amountCents: Math.round(line.amountCents) + remainder } : line));
}

/**
 * `tagIds` with `tagId` assigned, replacing any other tag from the same group
 * (one tag per group). `groupOf` maps a tag id to its group id.
 */
export function withTagAssigned(tagIds: readonly string[] | undefined, tagId: string, groupOf: (tagId: string) => string | undefined): string[] {
  const group = groupOf(tagId);
  const kept = (tagIds ?? []).filter((id) => id !== tagId && (group === undefined || groupOf(id) !== group));
  return [...kept, tagId];
}

/** `tagIds` without any tag from `groupId`. */
export function withoutTagGroup(tagIds: readonly string[] | undefined, groupId: string, groupOf: (tagId: string) => string | undefined): string[] {
  return (tagIds ?? []).filter((id) => groupOf(id) !== groupId);
}

/**
 * Problems with one line's tags: a tag `groupOf` doesn't know (removed, or
 * from another organization) or two tags from one group. Shared by
 * transaction lines and bill lines (shared/bills.ts).
 */
export function lineTagProblems(label: string, tagIds: readonly string[] | undefined, groupOf: (tagId: string) => string | undefined): string[] {
  const problems: string[] = [];
  const seen = new Map<string, string>();
  for (const tagId of tagIds ?? []) {
    const group = groupOf(tagId);
    if (!group) {
      problems.push(`${label} has a tag that no longer exists.`);
      continue;
    }
    if (seen.has(group)) problems.push(`${label} has two tags from the same group; choose one.`);
    seen.set(group, tagId);
  }
  return problems;
}

export type LineValidationOptions = {
  /** Tag id → group id; unknown tags are reported. */
  groupOf?: (tagId: string) => string | undefined;
};

/**
 * Problems with a set of lines for a transaction of `amountCents`, as
 * sentences for the person editing them. Empty when the lines can be saved.
 */
export function validateTransactionLines(
  amountCents: number,
  lines: readonly TransactionLine[],
  options: LineValidationOptions = {},
): string[] {
  const errors: string[] = [];
  if (lines.length === 0) errors.push("A transaction needs at least one line.");
  if (lines.length > MAX_TRANSACTION_LINES) errors.push(`Split a transaction into at most ${MAX_TRANSACTION_LINES} lines.`);
  const ids = new Set<string>();
  lines.forEach((line, index) => {
    const label = `Line ${index + 1}`;
    if (!String(line.id ?? "").trim() || ids.has(line.id)) errors.push(`${label} needs a unique id.`);
    ids.add(line.id);
    if (!Number.isSafeInteger(line.amountCents)) errors.push(`${label}: the amount must be whole cents.`);
    else if (lines.length > 1 && line.amountCents === 0) errors.push(`${label} needs an amount.`);
    if ((line.memo ?? "").length > 500) errors.push(`${label}: keep the memo under 500 characters.`);
    if (options.groupOf) errors.push(...lineTagProblems(label, line.tagIds, options.groupOf));
  });
  if (lines.length > 0 && lines.every((line) => Number.isSafeInteger(line.amountCents))) {
    const remainder = linesRemainderCents(amountCents, lines);
    if (remainder !== 0) {
      // Unallocated when the lines fall short of the amount in its own direction.
      const short = Math.sign(remainder) === Math.sign(amountCents);
      errors.push(`The lines must add up to the transaction amount (${short ? "unallocated" : "over by"} ${formatCentsPlain(Math.abs(remainder))}).`);
    }
  }
  return errors;
}

function formatCentsPlain(cents: number): string {
  return `$${(cents / 100).toLocaleString("en-CA", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** The line whose fields summarise a split (largest amount; the first on a tie). */
export function primaryLine(lines: readonly TransactionLine[]): TransactionLine | undefined {
  let best: TransactionLine | undefined;
  for (const line of lines) if (!best || Math.abs(line.amountCents) > Math.abs(best.amountCents)) best = line;
  return best;
}

/**
 * The stored fields for a set of lines: a single line is folded back into
 * the top-level fields (no `lines`), a split keeps `lines` and summarises
 * the largest line on top.
 */
export function storedLineFields(lines: readonly TransactionLine[]): {
  lines: TransactionLine[] | undefined;
  category: string | undefined;
  accountingAccountId: string | undefined;
  fundRestrictionId: string | undefined;
  tagIds: string[] | undefined;
} {
  const cleaned = lines.map((line) => ({
    id: String(line.id),
    amountCents: Math.round(line.amountCents),
    ...(line.category?.trim() ? { category: line.category.trim() } : {}),
    ...(line.accountingAccountId ? { accountingAccountId: String(line.accountingAccountId) } : {}),
    ...(line.fundRestrictionId ? { fundRestrictionId: String(line.fundRestrictionId) } : {}),
    ...(line.memo?.trim() ? { memo: line.memo.trim() } : {}),
    ...(cleanTagIds(line.tagIds) ? { tagIds: cleanTagIds(line.tagIds) } : {}),
  }));
  if (cleaned.length <= 1) {
    const only = cleaned[0];
    return {
      lines: undefined,
      category: only?.category,
      accountingAccountId: only?.accountingAccountId,
      fundRestrictionId: only?.fundRestrictionId,
      tagIds: only?.tagIds,
    };
  }
  const primary = primaryLine(cleaned);
  return {
    lines: cleaned,
    category: primary?.category,
    accountingAccountId: primary?.accountingAccountId,
    fundRestrictionId: primary?.fundRestrictionId,
    tagIds: undefined,
  };
}

/** Each category's share of the transaction (split lines counted separately). */
export function categoryAmounts(txn: LineTransaction): Array<{ category: string | undefined; amountCents: number }> {
  return transactionLines(txn).map((line) => ({ category: line.category, amountCents: line.amountCents }));
}

/** Whether any line of the transaction carries `tagId`. */
export function transactionHasTag(txn: LineTransaction, tagId: string): boolean {
  return transactionLines(txn).some((line) => (line.tagIds ?? []).includes(tagId));
}

/** Money in, money out and net change over a set of transactions. */
export function moneyFlowSummary(rows: readonly Pick<LineTransaction, "amountCents">[]): { inCents: number; outCents: number; netCents: number; count: number } {
  let inCents = 0;
  let outCents = 0;
  for (const row of rows) {
    const amount = Math.round(Number(row.amountCents) || 0);
    if (amount > 0) inCents += amount;
    else outCents += amount;
  }
  return { inCents, outCents, netCents: inCents + outCents, count: rows.length };
}
