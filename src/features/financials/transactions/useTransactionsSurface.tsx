import { useCallback, useEffect, useMemo } from "react";
import { useMutation } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { findPayeeAlias } from "../../../../shared/payeeAliases";
import { transactionPayee } from "../../../../shared/transactionRules";
import { useRulePromptAfterCategorise } from "../rules/useRulePrompt";
import { useRuleDrawerHost } from "./RuleDrawerHost";
import { TransactionDetailPanel, type PanelTransaction } from "./TransactionDetailPanel";
import { attentionReasons, categorizedByValue } from "../../../../shared/transactionAttention";
import { usePayeeAliases } from "./usePayeeAliases";
import { useTransactionBulkEdit } from "./useTransactionBulkEdit";
import { useTransactionInlineEdit } from "./useTransactionInlineEdit";
import { isSplitTransaction } from "../../../../shared/transactionLines";
import type { FinanceTagsApi } from "./useFinanceTags";
import type { ReviewSegment } from "./transactionFilters";

const EMPTY_ACCOUNTS: never[] = [];
const EMPTY_FUNDS: never[] = [];

/** `?transactionId=<id>` (the panel's "Copy link") opens that transaction's panel. */
export const TRANSACTION_DEEP_LINK_PARAM = "transactionId";
/** Links copied before `transactionId` used `?txn=`; they still open. */
const LEGACY_DEEP_LINK_PARAM = "txn";

/**
 * Everything the Financials transactions tab adds around its record table:
 * payee display names, the "Categorised by" and "Needs attention" values,
 * the in-place rule editor, the "create or update a rule?" prompt after a
 * manual category change, spreadsheet editing of the table's cells
 * (useTransactionInlineEdit), and the transaction detail panel.
 */
export function useTransactionsSurface({
  societyId,
  canWrite,
  transactions,
  tags,
  reviewSegment,
}: {
  societyId: string | undefined;
  canWrite: boolean;
  /** Raw rows from `financialHub.transactions`. */
  transactions: any[] | undefined;
  tags: FinanceTagsApi;
  reviewSegment: ReviewSegment;
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

  // Copied links use `?transactionId=`; the record table opens panels from
  // `?record=`. The review queue follows the linked row so it is in the table.
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedTxn = searchParams.get(TRANSACTION_DEEP_LINK_PARAM) ?? searchParams.get(LEGACY_DEEP_LINK_PARAM);
  useEffect(() => {
    if (!linkedTxn || transactions === undefined) return;
    const next = new URLSearchParams(searchParams);
    next.delete(TRANSACTION_DEEP_LINK_PARAM);
    next.delete(LEGACY_DEEP_LINK_PARAM);
    next.set("tab", "transactions");
    next.set("record", linkedTxn);
    const linked = transactions.find((row) => String(row._id) === linkedTxn);
    if (linked) {
      next.delete("method");
      next.delete("tag");
      if (linked.reviewedAtISO) next.set("review", "reviewed");
      else next.delete("review");
    }
    setSearchParams(next, { replace: true });
  }, [linkedTxn, searchParams, setSearchParams, transactions]);

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
      // Refuse by throwing, so the table rolls the cell back and says why
      // instead of showing a change that never happened.
      if (fieldName === "category" && previous && isSplitTransaction(previous)) {
        throw new Error("This transaction is split. Change the categories on its lines in the transaction panel.");
      }
      await updateTransaction({ id: recordId as any, patch: { [fieldName]: value } as any });
      if (fieldName === "category" && previous) promptAfterCategorise(previous, value);
    },
    [promptAfterCategorise, transactions, updateTransaction],
  );

  const { inlineEdit, accountLabels } = useTransactionInlineEdit({
    societyId,
    canWrite,
    transactions,
    accounts: ruleDrawer.api.workspace?.accounts ?? EMPTY_ACCOUNTS,
    funds: ruleDrawer.api.workspace?.fundRestrictions ?? EMPTY_FUNDS,
    onCategorised: promptAfterCategorise,
  });

  const fundNames = useMemo(
    () => new Map((ruleDrawer.api.workspace?.fundRestrictions ?? []).map((fund) => [fund._id, fund.name])),
    [ruleDrawer.api.workspace?.fundRestrictions],
  );

  // The panel and the rule editor share the docked inspector; the panel steps
  // aside while a rule is edited and comes back when the editor closes.
  const ruleEditorOpen = ruleDrawer.api.isOpen;
  const renderSidePanel = useCallback(
    (records: readonly PanelTransaction[]) =>
      ({ record, onClose, onNavigate }: { record: any; onClose: () => void; onNavigate: (record: any) => void }) =>
        societyId && !ruleEditorOpen ? (
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
            onSetReviewed={(reviewed) => runBulk([String(record._id)], { reviewed }, () => (reviewed ? "Marked as reviewed" : "Moved back to To review"))}
            tags={tags}
            reviewSegment={reviewSegment}
          />
        ) : null,
    [aliases, canWrite, fundNames, handleUpdate, reviewSegment, runBulk, ruleEditorOpen, societyId, tags],
  );

  return { ruleDrawer, aliases, decorate, handleUpdate, renderSidePanel, inlineEdit, accountLabels, fundNames };
}
