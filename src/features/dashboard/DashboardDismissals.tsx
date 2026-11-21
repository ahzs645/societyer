import { useCallback, useId, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { RotateCcw, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePrompt } from "../../components/Modal";
import { useToast } from "../../components/Toast";
import { usePermissions } from "../../hooks/usePermissions";
import { useUndoableAction } from "../../hooks/useUndoableAction";
import { formatDate, relative } from "../../lib/format";
import type { DashboardItemDismissal } from "../../../shared/dashboardDismissals";

/**
 * Dismissing dashboard recommendations: compliance flags and continuity
 * checks at "warn" or "info" that the server marks `dismissable`. A dismissal
 * applies to the whole workspace and lasts while the item keeps the level it
 * was dismissed at (shared/dashboardDismissals.ts). Requirements ("err") and
 * filings are never dismissable.
 */

/** What a dismiss or restore needs to know about one item. */
export type DismissTarget = {
  /** Rule id (compliance flag) or check id (continuity). */
  id: string;
  level: string;
  /** Plain text naming the item, kept on the record and in the activity log. */
  text: string;
};

/** The item can be dismissed now: a recommendation that isn't dismissed yet. */
export function canDismissItem(item: { dismissable?: boolean; dismissal?: DashboardItemDismissal }) {
  return Boolean(item.dismissable && !item.dismissal);
}

export function useDashboardDismissals(societyId: string | undefined) {
  const { can } = usePermissions();
  const prompt = usePrompt();
  const toast = useToast();
  const undoable = useUndoableAction();
  const dismissItem = useMutation(api.dashboardRemediation.dismissItem);
  const restoreItem = useMutation(api.dashboardRemediation.restoreItem);
  // The same permission that gates the remediation actions on these rows.
  const canDismiss = Boolean(societyId) && can("deadlines:write");

  const restoreNow = useCallback(
    (target: DismissTarget) => (societyId ? restoreItem({ societyId, ruleId: target.id }) : undefined),
    [restoreItem, societyId],
  );

  const dismiss = useCallback(async (target: DismissTarget) => {
    if (!societyId || !canDismiss) return;
    const reason = await prompt({
      title: "Dismiss this recommendation?",
      message: (
        <>
          <p style={{ margin: "0 0 8px" }}>“{target.text}”</p>
          <p style={{ margin: 0 }}>
            It leaves the dashboard for everyone in this workspace. It comes back by itself if its severity changes, for example if it becomes a requirement, and you can restore it any time from Dismissed.
          </p>
        </>
      ),
      placeholder: "Reason (optional)",
      confirmLabel: "Dismiss",
    });
    if (reason === null) return;
    await undoable({
      message: "Recommendation dismissed",
      description: "Find it under Dismissed at the foot of the card.",
      errorMessage: "Could not dismiss the recommendation",
      dedupeKey: `dashboard-dismiss-${target.id}`,
      run: () => dismissItem({
        societyId,
        ruleId: target.id,
        flagLevel: target.level,
        flagText: target.text,
        reason: reason.trim() || undefined,
      }),
      undo: () => restoreNow(target),
      undoneMessage: "Recommendation restored",
    });
  }, [canDismiss, dismissItem, prompt, restoreNow, societyId, undoable]);

  const restore = useCallback(async (target: DismissTarget) => {
    if (!societyId || !canDismiss) return;
    try {
      await restoreNow(target);
      toast.success("Recommendation restored");
    } catch (error) {
      toast.error("Could not restore the recommendation", error instanceof Error ? error.message : undefined);
    }
  }, [canDismiss, restoreNow, societyId, toast]);

  return { canDismiss, dismiss, restore };
}

/** A small ghost × for a row that has no ⋯ menu to hold "Dismiss". */
export function DismissButton({ label, onDismiss }: { label: string; onDismiss: () => void }) {
  return (
    <button
      type="button"
      className="btn btn--ghost btn--sm btn--icon dashboard-dismiss"
      aria-label={`Dismiss: ${label}`}
      title="Dismiss"
      onClick={onDismiss}
    >
      <X size={14} aria-hidden="true" />
    </button>
  );
}

export type DismissedEntry = DismissTarget & {
  /** How the item reads in the list (defaults to `text`). */
  label?: ReactNode;
  dismissal: DashboardItemDismissal;
};

/**
 * The quiet "Dismissed (n)" footer link and, when opened, the dismissed
 * items with who dismissed them, when and why, each with Restore for people
 * who may dismiss. Renders nothing when nothing is dismissed.
 */
export function DismissedItems({
  items,
  canRestore,
  onRestore,
  className = "",
}: {
  items: DismissedEntry[];
  canRestore: boolean;
  onRestore: (item: DismissedEntry) => void;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const listId = useId();
  if (!items.length) return null;
  return (
    <div className={`dashboard-dismissed${className ? ` ${className}` : ""}`}>
      <button
        type="button"
        className="dashboard-dismissed__toggle"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => setOpen((value) => !value)}
      >
        {open ? "Hide dismissed" : `Dismissed (${items.length})`}
      </button>
      {open && (
        <ul className="dashboard-dismissed__list" id={listId}>
          {items.map((item) => (
            <li key={item.id} className="dashboard-dismissed__item">
              <div className="dashboard-dismissed__text">
                <span>{item.label ?? item.text}</span>
                <span className="dashboard-dismissed__meta">{dismissalMeta(item.dismissal)}</span>
              </div>
              {canRestore && (
                <button type="button" className="btn-action" onClick={() => onRestore(item)}>
                  <RotateCcw size={12} aria-hidden="true" /> Restore
                </button>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function dismissalMeta(dismissal: DashboardItemDismissal) {
  const when = dismissal.dismissedAtISO ? relative(dismissal.dismissedAtISO) : "";
  const byWhen = [
    "Dismissed",
    dismissal.dismissedByName ? `by ${dismissal.dismissedByName}` : "",
    when && when !== "—" ? when : "",
  ].filter(Boolean).join(" ");
  return (
    <>
      <span title={dismissal.dismissedAtISO ? formatDate(dismissal.dismissedAtISO, "MMM d, yyyy h:mm a") : undefined}>{byWhen}</span>
      {dismissal.reason && <> · {dismissal.reason}</>}
    </>
  );
}
