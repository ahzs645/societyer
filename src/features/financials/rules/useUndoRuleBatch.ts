import { useCallback } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { useToast } from "../../../components/Toast";
import { pluralize } from "../../../lib/format";

/** Shows a success toast for a rule application with an Undo action that restores every line in the batch. */
export function useUndoRuleBatch(societyId: string | undefined) {
  const undoBatch = useMutation(api.transactionRules.undoBatch);
  const toast = useToast();
  return useCallback(
    (result: { batchId: string; applied: number }, title?: string) => {
      toast.success(title ?? `Categorised ${pluralize(result.applied, "transaction")}`, {
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
