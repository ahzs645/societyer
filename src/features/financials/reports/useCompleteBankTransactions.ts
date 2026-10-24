import { useEffect, useState, useCallback } from "react";
import { useConvex } from "convex/react";
import { api } from "@/lib/convexApi";
import type { CommerceSourcePage } from "../../../../shared/commerceReports";
/** Complete paginated transaction history. Consumers share one snapshot for graphs and export. */
export function useCompleteBankTransactions(societyId?: string, enabled = true) {
  const client = useConvex(), [revision, setRevision] = useState(0), [transactions, setTransactions] = useState<Record<string, any>[]>(), [progress, setProgress] = useState(0), [error, setError] = useState("");
  useEffect(() => {
    let cancelled = false; setTransactions(undefined); setProgress(0); setError("");
    if (!societyId || !enabled) return () => { cancelled = true; };
    const run = async () => { const rows: Record<string, any>[] = []; let cursor: string | null = null; const seen = new Set<string>(); do { if (cancelled) return; const page = await client.query(api.commerceReports.sourcePage, { societyId, sourceTable: "financialTransactions", cursor, pageSize: 200 }) as CommerceSourcePage; rows.push(...page.page); if (!cancelled) setProgress(rows.length); if (page.isDone) break; if (!page.continueCursor || seen.has(page.continueCursor)) throw new Error("Transaction pagination did not advance."); seen.add(page.continueCursor); cursor = page.continueCursor; } while (true); if (!cancelled) setTransactions(rows.sort((a, b) => String(b.date).localeCompare(String(a.date)) || String(a._id).localeCompare(String(b._id)))); };
    void run().catch((cause) => { if (!cancelled) setError(cause instanceof Error ? cause.message : "Could not load transaction history."); });
    return () => { cancelled = true; };
  }, [client, societyId, enabled, revision]);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);
  return { transactions, progress, error, refresh };
}
