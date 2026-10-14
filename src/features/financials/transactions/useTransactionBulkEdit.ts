import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";

export type BulkTransactionPatch = { category?: string; fundRestrictionId?: string | null; reviewed?: boolean };

type BulkResult = { updated: number; skipped: number; previous: Array<{ id: string; values: Record<string, unknown> }> };

/**
 * Runs one bulk change on transactions and shows a toast with Undo. The
 * server returns each changed line's previous values (the same snapshot a
 * rule application keeps), and Undo puts exactly those back.
 */
export function useTransactionBulkEdit(societyId: string | undefined) {
  const bulkUpdate = useMutation(api.financialHub.bulkUpdateTransactions);
  const restore = useMutation(api.financialHub.restoreTransactions);
  const toast = useToast();

  return useCallback(
    async (ids: string[], patch: BulkTransactionPatch, describe: (count: number) => string) => {
      if (!societyId || ids.length === 0) return;
      try {
        const result = (await bulkUpdate({ societyId: societyId as any, ids: ids as any, patch: patch as any })) as BulkResult;
        if (result.updated === 0) {
          toast.info("Nothing changed", `The selected ${ids.length === 1 ? "transaction already has" : "transactions already have"} that value.`);
          return;
        }
        toast.success(describe(result.updated), {
          duration: 10_000,
          action: {
            label: "Undo",
            onClick: () => {
              void restore({ societyId: societyId as any, rows: result.previous as any })
                .then((undone: any) => toast.info(`Restored ${pluralize(undone?.restored ?? 0, "transaction")}`))
                .catch((error: any) => toast.error("Could not undo", error?.message));
            },
          },
        });
      } catch (error: any) {
        toast.error("Could not update the transactions", error?.message);
      }
    },
    [bulkUpdate, restore, societyId, toast],
  );
}
