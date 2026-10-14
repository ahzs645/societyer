import { useCallback, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { findPayeeAlias } from "../../../../shared/payeeAliases";
import { transactionPayee } from "../../../../shared/transactionRules";
import { useRulePromptAfterCategorise } from "../rules/useRulePrompt";
import { useRuleDrawerHost } from "./RuleDrawerHost";
import { TransactionDetailPanel, type PanelTransaction } from "./TransactionDetailPanel";
import { attentionReasons, categorizedByValue } from "./transactionAttention";
import { usePayeeAliases } from "./usePayeeAliases";
import { useTransactionBulkEdit } from "./useTransactionBulkEdit";

/** `?txn=<id>` (the panel's "Copy link") opens that transaction's panel. */
export const TRANSACTION_DEEP_LINK_PARAM = "txn";

/**
 * Everything the Financials transactions tab adds around its record table:
 * payee display names, the "Categorised by" and "Needs attention" values,
 * the in-place rule editor, the "create or update a rule?" prompt after a
 * manual category change, and the transaction detail panel.
 */
export function useTransactionsSurface({
  societyId,
  canWrite,
  transactions,
}: {
  societyId: string | undefined;
  canWrite: boolean;
  /** Raw rows from `financialHub.transactions`. */
  transactions: any[] | undefined;
}) {
  const ruleDrawer = useRuleDrawerHost(societyId, canWrite);
  const { aliases } = usePayeeAliases(societyId);
  const updateTransaction = useMutation(api.financialHub.updateTransaction);
  const runBulk = useTransactionBulkEdit(societyId);
  const promptAfterCategorise = useRulePromptAfterCategorise({
    transactions,
    workspace: ruleDrawer.api.workspace,
    openDraft: ruleDrawer.api.openDraft,
    editRule: ruleDrawer.api.editRule,
    canWrite,
  });

  // Copied links use `?txn=`; the record table opens panels from `?record=`.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedTxn = searchParams.get(TRANSACTION_DEEP_LINK_PARAM);
  useEffect(() => {
    if (!linkedTxn) return;
    const next = new URLSearchParams(searchParams);
    next.delete(TRANSACTION_DEEP_LINK_PARAM);
    next.set("tab", "transactions");
    next.set("record", linkedTxn);
    setSearchParams(next, { replace: true });
  }, [linkedTxn, searchParams, setSearchParams]);

  /** Adds `payeeName`, `categorizedBy` (with "imported") and `attention` to table rows. */
  const decorate = useCallback(
    <T extends Record<string, any>>(rows: T[]): T[] =>
      rows.map((row) => {
        const raw = transactionPayee(row as any);
        const alias = aliases.length ? findPayeeAlias(aliases, raw) : null;
        return {
          ...row,
          payeeName: alias?.displayName ?? raw,
          payeeRenamed: Boolean(alias),
          categorizedBy: categorizedByValue(row as any),
          attention: attentionReasons(row as any),
        };
      }),
    [aliases],
  );

  const handleUpdate = useCallback(
    async ({ recordId, fieldName, value }: { recordId: string; fieldName: string; value: unknown }) => {
      const previous = (transactions ?? []).find((row) => String(row._id) === String(recordId));
      await updateTransaction({ id: recordId as any, patch: { [fieldName]: value } as any });
      if (fieldName === "category" && previous) promptAfterCategorise(previous, value);
    },
    [promptAfterCategorise, transactions, updateTransaction],
  );

  const fundNames = useMemo(
    () => new Map((ruleDrawer.api.workspace?.fundRestrictions ?? []).map((fund) => [fund._id, fund.name])),
    [ruleDrawer.api.workspace?.fundRestrictions],
  );

  const renderSidePanel = useCallback(
    (records: readonly PanelTransaction[]) =>
      ({ record, onClose, onNavigate }: { record: any; onClose: () => void; onNavigate: (record: any) => void }) =>
        societyId ? (
          <TransactionDetailPanel
            record={record}
            records={records}
            aliases={aliases}
            societyId={societyId}
            canWrite={canWrite}
            fundName={record.fundRestrictionId ? fundNames.get(String(record.fundRestrictionId)) : undefined}
            onClose={onClose}
            onNavigate={onNavigate}
            onUpdate={(fieldName, value) => handleUpdate({ recordId: String(record._id), fieldName, value })}
            onMarkReviewed={() => runBulk([String(record._id)], { reviewed: true }, () => "Marked as reviewed")}
          />
        ) : null,
    [aliases, canWrite, fundNames, handleUpdate, runBulk, societyId],
  );

  return { ruleDrawer, aliases, decorate, handleUpdate, renderSidePanel };
}
