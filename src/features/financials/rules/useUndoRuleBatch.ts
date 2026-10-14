import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";
import type { ApplyRulesResult } from "./types";

/** "Skipped Grant fund spending: the fund was archived." for rules that need attention. */
export function skippedRulesNote(result: Pick<ApplyRulesResult, "skippedRules">): string | undefined {
  const skipped = result.skippedRules ?? [];
  if (skipped.length === 0) return undefined;
  if (skipped.length === 1) return `Skipped ${skipped[0].name}: ${skipped[0].problem}.`;
  return `Skipped ${pluralize(skipped.length, "rule")} that need attention: ${skipped.map((rule) => rule.name).join(", ")}.`;
}

/** Shows a success toast for a rule application with an Undo action that restores every line in the batch. */
export function useUndoRuleBatch(societyId: string | undefined) {
  const undoBatch = useMutation(api.transactionRules.undoBatch);
  const toast = useToast();
  return useCallback(
    (result: Pick<ApplyRulesResult, "batchId" | "applied" | "skippedRules">, title?: string) => {
      toast.success(title ?? `Categorised ${pluralize(result.applied, "transaction")}`, {
        description: skippedRulesNote(result),
        duration: 10_000,
        action: {
          label: "Undo",
          onClick: () => {
            if (!societyId) return;
            void undoBatch({ societyId: societyId as any, batch: result.batchId })
              .then((undone: any) => toast.info(`Restored ${pluralize(undone?.restored ?? 0, "transaction")}`))
              .catch((error: any) => toast.error("Could not undo", error?.message));
          },
        },
      });
    },
    [societyId, toast, undoBatch],
  );
}
