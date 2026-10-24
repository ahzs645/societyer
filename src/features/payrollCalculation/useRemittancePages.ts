import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
export function useRemittancePages(
  societyId: string,
  collection:
    | "banks"
    | "liabilities"
    | "expenses"
    | "credentials"
    | "transactions",
  bankAccountId?: string,
  enabled = true,
) {
  const [cursor, setCursor] = useState<string | null>(null),
    [pages, setPages] = useState<Record<string, any[]>>({});
  const value = useQuery(
    api.payrollRemittance.workspace,
    enabled
      ? {
          societyId,
          collection,
          cursor,
          ...(bankAccountId ? { bankAccountId } : {}),
        }
      : "skip",
  );
  useEffect(() => {
    if (value) setPages((old) => ({ ...old, [cursor ?? "first"]: value.rows }));
  }, [cursor, value]);
  const rows = useMemo(() => {
    const distinct = new Map<string, any>();
    for (const page of Object.values(pages))
      for (const row of page) distinct.set(row._id, row);
    return [...distinct.values()];
  }, [pages]);
  const loadMore = useCallback(() => {
    if (value && !value.isDone) setCursor(value.continueCursor);
  }, [value]);
  return {
    rows,
    loading: value === undefined,
    hasMore: value && !value.isDone,
    loadMore,
  };
}
