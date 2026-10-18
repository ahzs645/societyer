import { useMemo } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../../../convex/_generated/dataModel";

export type LinkOption = { value: string; label: string };

type NamedRow = { _id: string; name?: string | null };
type GrantRow = { _id: string; title?: string | null };

function toOptions<T extends { _id: string }>(rows: readonly T[] | undefined, label: (row: T) => string | null | undefined): LinkOption[] {
  return (rows ?? []).map((row) => ({ value: String(row._id), label: label(row) || "Untitled" }));
}

/**
 * Fund restrictions, counterparties and grants a journal line can be tagged
 * with: options for the lines grid and labels for the entry drawer.
 */
export function useJournalLinkOptions(societyId: Id<"societies"> | undefined) {
  const args = societyId ? { societyId } : "skip";
  const funds = useQuery(api.accounting.fundRestrictions, args) as NamedRow[] | undefined;
  const counterparties = useQuery(api.accounting.counterparties, args) as NamedRow[] | undefined;
  const grants = useQuery(api.grants.list, args) as GrantRow[] | undefined;
  return useMemo(() => {
    const fundRestrictions = toOptions(funds, (row) => row.name);
    const counterpartyOptions = toOptions(counterparties, (row) => row.name);
    const grantOptions = toOptions(grants, (row) => row.title);
    const labels = (options: LinkOption[]) => new Map(options.map((option) => [option.value, option.label]));
    return {
      fundRestrictions,
      counterparties: counterpartyOptions,
      grants: grantOptions,
      fundLabel: labels(fundRestrictions),
      counterpartyLabel: labels(counterpartyOptions),
      grantLabel: labels(grantOptions),
    };
  }, [funds, counterparties, grants]);
}

export type JournalLinkOptions = ReturnType<typeof useJournalLinkOptions>;
