import { useCallback, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { PenLine, Sparkles, Zap } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ViewportPopover } from "../../../components/ViewportPopover";
import { useToast } from "../../../components/Toast";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { formatDate } from "../../../lib/format";
import { useRuleDrawer } from "../transactions/RuleDrawerHost";
import { draftFromTransaction } from "./draftFromTransaction";

export type ProvenanceTransaction = {
  _id: string;
  categorizedBy?: string | null;
  ruleId?: string | null;
  ruleApplication?: { ruleName?: string; appliedAtISO?: string } | null;
  category?: string | null;
  description?: string | null;
  counterparty?: string | null;
  amountCents?: number;
};

type Method = "rule" | "suggestion" | "manual";

const METHOD_LABEL: Record<Method, string> = {
  rule: "Applied by rule",
  suggestion: "Suggested",
  manual: "Manually categorised",
};

/**
 * How a transaction's category was set: a bolt for a categorisation rule, a
 * sparkle for a suggestion, a pen for a hand-picked category. The popover
 * edits or deletes the rule in place (when the page hosts the rule editor),
 * removes the rule's application, or turns a manual category into a rule.
 * Renders nothing for imported or uncategorised lines.
 */
export function CategorizationProvenance({ txn }: { txn: ProvenanceTransaction }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const navigate = useNavigate();
  const toast = useToast();
  const drawer = useRuleDrawer();
  const { canWrite } = useFinancePermissions();
  const removeApplication = useMutation(api.transactionRules.removeApplication);

  const method = txn.categorizedBy === "rule" || txn.categorizedBy === "suggestion" || txn.categorizedBy === "manual" ? (txn.categorizedBy as Method) : null;
  if (!method) return null;
  const isRule = method === "rule";
  const ruleName = txn.ruleApplication?.ruleName ?? "a rule";
  const label = isRule ? `Categorised by rule: ${ruleName}` : method === "suggestion" ? "Suggested category" : "Manually categorised";
  // A rule restored with Undo comes back under a new id; find it by name then.
  const hostedRule = isRule && drawer?.workspace
    ? drawer.workspace.rules.find((rule) => rule._id === String(txn.ruleId ?? "")) ??
      drawer.workspace.rules.find((rule) => rule.name === txn.ruleApplication?.ruleName)
    : undefined;
  const ruleId = hostedRule?._id ?? (txn.ruleId ? String(txn.ruleId) : null);
  // In place when the page hosts the editor and the rule still exists.
  const ruleInPlace = Boolean(hostedRule);
  const canCreateRule = Boolean(drawer && canWrite && txn.category && typeof txn.amountCents === "number");

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`provenance-icon provenance-icon--${method}`}
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {isRule ? <Zap size={12} aria-hidden="true" /> : method === "suggestion" ? <Sparkles size={12} aria-hidden="true" /> : <PenLine size={12} aria-hidden="true" />}
      </button>
      <ViewportPopover open={open} onClose={close} anchorRef={anchorRef} label={label} className="provenance-popover">
        <div onClick={(event) => event.stopPropagation()}>
          <div className="provenance-popover__eyebrow">{METHOD_LABEL[method]}</div>
          {isRule ? (
            <>
              <div className="provenance-popover__title">{ruleName}</div>
              {txn.ruleApplication?.appliedAtISO && (
                <div className="provenance-popover__meta">on {formatDate(txn.ruleApplication.appliedAtISO)}</div>
              )}
              {ruleId && drawer && !ruleInPlace && drawer.workspace && (
                <div className="provenance-popover__meta">That rule has since been deleted.</div>
              )}
              <div className="provenance-popover__actions">
                {ruleId && (ruleInPlace || !drawer) && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      close();
                      if (drawer && ruleInPlace) drawer.editRule(ruleId);
                      else navigate(`/app/transaction-rules?rule=${encodeURIComponent(ruleId)}`);
                    }}
                  >
                    Edit rule
                  </button>
                )}
                <button
                  type="button"
                  className="btn btn--ghost btn--sm"
                  disabled={!canWrite}
                  onClick={async () => {
                    close();
                    try {
                      await removeApplication({ txnId: txn._id as any });
                      toast.success("Rule application removed", "The previous category was restored.");
                    } catch (error: any) {
                      toast.error("Could not remove the rule application", error?.message);
                    }
                  }}
                >
                  Remove rule application
                </button>
                {ruleId && ruleInPlace && drawer && (
                  <button
                    type="button"
                    className="btn btn--ghost btn--sm provenance-popover__danger"
                    disabled={!canWrite}
                    onClick={() => {
                      close();
                      void drawer.deleteRule(ruleId);
                    }}
                  >
                    Delete rule
                  </button>
                )}
              </div>
            </>
          ) : method === "suggestion" ? (
            <p className="provenance-popover__meta">This category was suggested automatically. Edit the category to confirm or change it.</p>
          ) : (
            <>
              <p className="provenance-popover__meta">Someone picked this category by hand. A hand-picked category always wins over a rule.</p>
              {canCreateRule && (
                <div className="provenance-popover__actions">
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      close();
                      drawer?.openDraft(draftFromTransaction({ ...txn, amountCents: txn.amountCents ?? 0 }, txn.category ?? undefined));
                    }}
                  >
                    Create a rule like this
                  </button>
                </div>
              )}
            </>
          )}
        </div>
      </ViewportPopover>
    </>
  );
}
