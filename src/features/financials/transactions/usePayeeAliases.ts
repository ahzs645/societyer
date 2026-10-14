import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { PayeeAliasMatchType } from "../../../../shared/payeeAliases";

export type PayeeAliasRow = {
  _id: string;
  match: string;
  matchType: PayeeAliasMatchType;
  displayName: string;
  updatedAtISO?: string;
};

const EMPTY: PayeeAliasRow[] = [];

/** The organization's payee rename rules (empty while loading). */
export function usePayeeAliases(societyId: string | undefined): { aliases: PayeeAliasRow[]; loaded: boolean } {
  const rows = useQuery(api.payeeAliases.list, societyId ? { societyId: societyId as any } : "skip") as PayeeAliasRow[] | undefined;
  return useMemo(() => ({ aliases: rows ?? EMPTY, loaded: rows !== undefined }), [rows]);
}
