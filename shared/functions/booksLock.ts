/**
 * Books settings lookups shared by every journal write path: the close (lock)
 * date that refuses posting, editing or voiding entries dated on or before it,
 * and the accounting basis reports default to.
 *
 * The close date is a hard lock: unlike a closed fiscal period, which a
 * director can still post an approved adjustment into, nothing dated on or
 * before it can change until an admin moves the date in Books settings.
 */
import type { PortableDoc, PortableQueryCtx } from "../portable/ctx";
import { closedBooksError, type AccountingBasis } from "../booksReports";

export type BooksSettingsDoc = PortableDoc & {
  societyId: string;
  booksStartDate?: string;
  accountingBasis?: string;
  closeDate?: string;
  closeDateSetAtISO?: string;
  closeDateSetByUserId?: string;
  createdAtISO: string;
  updatedAtISO: string;
};

export async function booksSettingsRow(ctx: PortableQueryCtx, societyId: string): Promise<BooksSettingsDoc | null> {
  const rows = await ctx.db
    .query<BooksSettingsDoc>("booksSettings")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  return rows.sort((a, b) => String(b.updatedAtISO ?? "").localeCompare(String(a.updatedAtISO ?? "")))[0] ?? null;
}

export async function booksCloseDate(ctx: PortableQueryCtx, societyId: string): Promise<string | null> {
  return (await booksSettingsRow(ctx, societyId))?.closeDate ?? null;
}

export async function booksAccountingBasis(ctx: PortableQueryCtx, societyId: string): Promise<AccountingBasis> {
  return (await booksSettingsRow(ctx, societyId))?.accountingBasis === "cash" ? "cash" : "accrual";
}

/** Throws the closed-books refusal when any of `dates` is on or before the close date. */
export async function assertBooksOpen(ctx: PortableQueryCtx, societyId: string, dates: Array<string | null | undefined>, action?: string) {
  const error = closedBooksError(await booksCloseDate(ctx, societyId), dates, action);
  if (error) throw new Error(error);
}
