import { useEffect, useState, useCallback } from "react";
import { useConvex } from "convex/react";
import { api } from "@/lib/convexApi";
import type { LedgerSetInput } from "../../../../shared/booksReports";
import type { CommerceSourcePage, CommerceSourceTable } from "../../../../shared/commerceReports";
export type CompleteBooks = Pick<LedgerSetInput, "accounts" | "entries" | "lines"> & { counterpartyNames: Map<string, string>; loadedAtISO: string; budgets: Record<string, any>[] };
/** Keep one complete source snapshot for statements, charts, drilldowns and every export. */
export function useCompleteBooks(societyId: string, enabled = true) {
  const client = useConvex(), [revision, setRevision] = useState(0), [books, setBooks] = useState<CompleteBooks>(), [progress, setProgress] = useState(0), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false;
    setBooks(undefined); setProgress(0); setError("");
    if (!societyId || !enabled) return () => { cancelled = true; };
    const run = async () => {
      const sources: Partial<Record<CommerceSourceTable, Record<string, any>[]>> = {};
      for (const sourceTable of ["financialAccounts", "journalEntries", "journalLines", "accountingCounterparties", "budgets"] as const) {
        const rows: Record<string, any>[] = []; let cursor: string | null = null; const seen = new Set<string>();
        do { if (cancelled) return; const page = await client.query(api.commerceReports.sourcePage, { societyId, source: "ledger", sourceTable, cursor, pageSize: 200 }) as CommerceSourcePage; rows.push(...page.page); if (!cancelled) setProgress((count) => count + page.page.length); if (page.isDone) break; if (!page.continueCursor || seen.has(page.continueCursor)) throw new Error("Ledger pagination did not advance."); seen.add(page.continueCursor); cursor = page.continueCursor; } while (true);
        sources[sourceTable] = rows;
      }
      if (!cancelled) setBooks({ accounts: sources.financialAccounts as CompleteBooks["accounts"], entries: sources.journalEntries as CompleteBooks["entries"], lines: sources.journalLines as CompleteBooks["lines"], budgets: sources.budgets ?? [], counterpartyNames: new Map(sources.accountingCounterparties!.map((row) => [row._id, row.name])), loadedAtISO: new Date().toISOString() });
    };
    void run().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load the complete ledger."); });
    return () => { cancelled = true; };
  }, [client, societyId, enabled, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { books, progress, error, refresh };
}
