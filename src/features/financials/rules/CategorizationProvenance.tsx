import { useCallback, useRef, useState } from "react";
import { useMutation } from "convex/react";
import { useNavigate } from "react-router-dom";
import { Sparkles, Zap } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ViewportPopover } from "../../../components/ViewportPopover";
import { useToast } from "../../../components/Toast";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { formatDate } from "../../../lib/format";

export type ProvenanceTransaction = {
  _id: string;
  categorizedBy?: string | null;
  ruleId?: string | null;
  ruleApplication?: { ruleName?: string; appliedAtISO?: string } | null;
};

/**
 * How a transaction's category was set: a bolt for a categorisation rule, a
 * sparkle for a suggestion. Opens a small popover to edit the rule or remove
 * the rule's application. Renders nothing for manually categorised lines.
 */
export function CategorizationProvenance({ txn }: { txn: ProvenanceTransaction }) {
  const [open, setOpen] = useState(false);
  const anchorRef = useRef<HTMLButtonElement>(null);
  const close = useCallback(() => setOpen(false), []);
  const navigate = useNavigate();
  const toast = useToast();
  const { canWrite } = useFinancePermissions();
  const removeApplication = useMutation(api.transactionRules.removeApplication);

  if (txn.categorizedBy !== "rule" && txn.categorizedBy !== "suggestion") return null;
  const isRule = txn.categorizedBy === "rule";
  const ruleName = txn.ruleApplication?.ruleName ?? "a rule";
  const label = isRule ? `Categorised by rule: ${ruleName}` : "Suggested category";

  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        className={`provenance-icon provenance-icon--${isRule ? "rule" : "suggestion"}`}
        aria-label={label}
        aria-expanded={open}
        onClick={(event) => {
          event.stopPropagation();
          setOpen((value) => !value);
        }}
      >
        {isRule ? <Zap size={12} aria-hidden="true" /> : <Sparkles size={12} aria-hidden="true" />}
      </button>
      <ViewportPopover open={open} onClose={close} anchorRef={anchorRef} label={label} className="provenance-popover">
        <div onClick={(event) => event.stopPropagation()}>
          <div className="provenance-popover__eyebrow">{isRule ? "Applied by rule" : "Suggested"}</div>
          {isRule ? (
            <>
              <div className="provenance-popover__title">{ruleName}</div>
              {txn.ruleApplication?.appliedAtISO && (
                <div className="provenance-popover__meta">on {formatDate(txn.ruleApplication.appliedAtISO)}</div>
              )}
              <div className="provenance-popover__actions">
                {txn.ruleId && (
                  <button
                    type="button"
                    className="btn btn--sm"
                    onClick={() => {
                      close();
                      navigate(`/app/transaction-rules?rule=${encodeURIComponent(String(txn.ruleId))}`);
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
              </div>
            </>
          ) : (
            <p className="provenance-popover__meta">This category was suggested automatically. Edit the category to confirm or change it.</p>
          )}
        </div>
      </ViewportPopover>
    </>
  );
}
