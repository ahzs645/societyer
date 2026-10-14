import { useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Zap } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useConfirm } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { findMatchingRule, isUncategorized } from "../../../../shared/transactionRules";
import { pluralize } from "../../../lib/format";
import type { RulesWorkspace } from "./types";
import { useUndoRuleBatch } from "./useUndoRuleBatch";

/**
 * Strip for the Financials transactions tab: how many uncategorised lines
 * the rules would categorise, an "Apply rules" action with a preview and an
 * Undo toast, and a link to manage rules.
 */
export function TransactionRulesBar({ societyId }: { societyId: string }) {
  const workspace = useQuery(api.transactionRules.workspace, { societyId: societyId as any }) as RulesWorkspace | undefined;
  const applyRules = useMutation(api.transactionRules.applyToUncategorized);
  const confirm = useConfirm();
  const toast = useToast();
  const undoToast = useUndoRuleBatch(societyId);
  const { canWrite } = useFinancePermissions();
  const [busy, setBusy] = useState(false);
  if (!workspace) return null;

  const pending = workspace.pendingMatches;
  const activeRules = workspace.rules.filter((rule) => rule.enabled).length;

  const apply = async () => {
    const byRule = new Map<string, { name: string; count: number }>();
    for (const txn of workspace.transactions) {
      if (!isUncategorized(txn)) continue;
      const rule = findMatchingRule(workspace.rules, txn);
      if (!rule) continue;
      const entry = byRule.get(rule._id) ?? { name: rule.name, count: 0 };
      entry.count += 1;
      byRule.set(rule._id, entry);
    }
    const ok = await confirm({
      title: `Apply rules to ${pluralize(pending, "transaction")}?`,
      message: (
        <div>
          <p>These uncategorised transactions match a rule:</p>
          <ul className="rules-apply-preview">
            {[...byRule.values()].map((entry) => (
              <li key={entry.name}><strong>{entry.count}</strong> by {entry.name}</li>
            ))}
          </ul>
          <p className="muted">You can undo this right after.</p>
        </div>
      ),
      confirmLabel: "Apply rules",
    });
    if (!ok) return;
    setBusy(true);
    try {
      const result = await applyRules({ societyId: societyId as any });
      undoToast(result);
    } catch (error: any) {
      toast.error("Could not apply rules", error?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="rules-bar" role="region" aria-label="Categorisation rules">
      <Zap size={14} aria-hidden="true" className="rules-bar__icon" />
      <div className="rules-bar__text">
        {activeRules === 0 ? (
          <span>No categorisation rules yet. Rules categorise recurring payees on import.</span>
        ) : pending > 0 ? (
          <span><strong>{pluralize(pending, "uncategorised transaction")}</strong> {pending === 1 ? "matches" : "match"} your rules.</span>
        ) : (
          <span>{pluralize(workspace.uncategorizedCount, "uncategorised transaction")}; none match your {pluralize(activeRules, "active rule")}.</span>
        )}
      </div>
      <div className="rules-bar__actions">
        <Link className="btn btn--ghost btn--sm" to="/app/transaction-rules">{activeRules === 0 ? "Create a rule" : "Manage rules"}</Link>
        {activeRules > 0 && (
          <button type="button" className="btn btn--sm btn--accent" disabled={!canWrite || busy || pending === 0} onClick={() => void apply()}>
            Apply rules to uncategorised
          </button>
        )}
      </div>
    </div>
  );
}
