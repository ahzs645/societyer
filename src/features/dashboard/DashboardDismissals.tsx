import { useCallback, useId, useRef, useState, type ReactNode } from "react";
import { useMutation } from "convex/react";
import { RotateCcw, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Modal, usePrompt } from "../../components/Modal";
import { Field } from "../../components/ui";
import { DatePicker } from "../../components/DatePicker";
import { RadioGroup } from "../../components/Controls";
import { useToast } from "../../components/Toast";
import { usePermissions } from "../../hooks/usePermissions";
import { useUndoableAction } from "../../hooks/useUndoableAction";
import { formatDate, relative } from "../../lib/format";
import { calendarDateKey } from "../../lib/calendarDates";
import type { DashboardItemAcknowledgement, DashboardItemDismissal, DashboardItemSnooze } from "../../../shared/dashboardDismissals";
import { REQUIREMENT_BASIS_LABEL, type RequirementBasis } from "../../../shared/dashboardFindingPolicy";

/**
 * Dismissing and acknowledging dashboard findings (compliance flags and
 * continuity checks). The server decides from each finding's requirement basis
 * (shared/dashboardFindingPolicy.ts): a recommendation at "warn" or "info" is
 * `dismissable` and may leave the dashboard for the whole workspace; a
 * statutory, bylaw or internal-policy finding is not, and can instead be
 * acknowledged, given a follow-up or snoozed ("Remind me later"), all of
 * which leave it on the dashboard and in every count. A snoozed requirement
 * sorts after the others, reads muted, and is left out of nudges.
 */

/** What a dismiss, acknowledge or restore needs to know about one item. */
export type DismissTarget = {
  /** Rule id (compliance flag) or check id (continuity). */
  id: string;
  level: string;
  /** Plain text naming the item, shown in the dialog. */
  text: string;
};

/** The policy fields the server puts on every finding. */
export type FindingPolicyFields = {
  level: string;
  requirementBasis?: RequirementBasis;
  dismissable?: boolean;
  dismissal?: DashboardItemDismissal;
  acknowledgement?: DashboardItemAcknowledgement;
  snooze?: DashboardItemSnooze;
  followUp?: { assignee?: string; dueDate?: string };
};

/** The item can be dismissed now: a recommendation that isn't dismissed yet. */
export function canDismissItem(item: Pick<FindingPolicyFields, "dismissable" | "dismissal">) {
  return Boolean(item.dismissable && !item.dismissal);
}

/**
 * The item stays until resolved, so it offers Acknowledge and a follow-up
 * instead of Dismiss. That includes a requirement's "info" note (the privacy
 * program marked documented with no review on record).
 */
export function isOutstandingRequirement(item: FindingPolicyFields) {
  return !item.dismissable && (item.level === "info" || item.level === "warn" || item.level === "err");
}

/** "Remind me later" applies to a requirement that would otherwise remind people (warn or err). */
export function canSnoozeItem(item: FindingPolicyFields) {
  return isOutstandingRequirement(item) && item.level !== "info";
}

export function useDashboardDismissals(societyId: string | undefined) {
  const { can } = usePermissions();
  const prompt = usePrompt();
  const toast = useToast();
  const undoable = useUndoableAction();
  const dismissItem = useMutation(api.dashboardRemediation.dismissItem);
  const acknowledgeItem = useMutation(api.dashboardRemediation.acknowledgeItem);
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
            It leaves the dashboard for everyone in this workspace. It comes back by itself if it changes, for example if it becomes more serious or affects other records, and you can restore it any time from Dismissed.
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
        reason: reason.trim() || undefined,
      }),
      undo: () => restoreNow(target),
      undoneMessage: "Recommendation restored",
    });
  }, [canDismiss, dismissItem, prompt, restoreNow, societyId, undoable]);

  const acknowledge = useCallback(async (target: DismissTarget) => {
    if (!societyId || !canDismiss) return;
    const note = await prompt({
      title: "Acknowledge this requirement?",
      message: (
        <>
          <p style={{ margin: "0 0 8px" }}>“{target.text}”</p>
          <p style={{ margin: 0 }}>
            This records that you've seen it. It stays on the dashboard and in the counts until it's resolved.
          </p>
        </>
      ),
      placeholder: "Note (optional)",
      confirmLabel: "Acknowledge",
    });
    if (note === null) return;
    await undoable({
      message: "Acknowledged",
      description: "It stays on the dashboard until it's resolved.",
      errorMessage: "Could not acknowledge the item",
      dedupeKey: `dashboard-acknowledge-${target.id}`,
      run: () => acknowledgeItem({
        societyId,
        ruleId: target.id,
        flagLevel: target.level,
        note: note.trim() || undefined,
      }),
      undo: () => restoreNow(target),
      undoneMessage: "Acknowledgement withdrawn",
    });
  }, [acknowledgeItem, canDismiss, prompt, restoreNow, societyId, undoable]);

  const restore = useCallback(async (target: DismissTarget) => {
    if (!societyId || !canDismiss) return;
    try {
      await restoreNow(target);
      toast.success("Recommendation restored");
    } catch (error) {
      toast.error("Could not restore the recommendation", error instanceof Error ? error.message : undefined);
    }
  }, [canDismiss, restoreNow, societyId, toast]);

  const withdrawAcknowledgement = useCallback(async (target: DismissTarget) => {
    if (!societyId || !canDismiss) return;
    try {
      await restoreNow(target);
      toast.success("Acknowledgement withdrawn");
    } catch (error) {
      toast.error("Could not withdraw the acknowledgement", error instanceof Error ? error.message : undefined);
    }
  }, [canDismiss, restoreNow, societyId, toast]);

  // "Assign follow-up" for items without a rule-specific review action
  // (continuity checks): the same review-task path, with an owner and date.
  const followUp = useFollowUpDialog();
  const askFollowUp = followUp.ask;
  const createReviewTask = useMutation(api.dashboardRemediation.createComplianceReviewTask);
  const assignFollowUp = useCallback(async (target: DismissTarget, evidenceRequired: string[] = []) => {
    if (!societyId || !canDismiss) return;
    const details = await askFollowUp(target);
    if (!details) return;
    try {
      const result = await createReviewTask({
        societyId,
        ruleId: target.id,
        flagLevel: target.level,
        flagText: target.text,
        evidenceRequired,
        ...details,
      });
      toast.success(followUpToast(result));
    } catch (error) {
      toast.error("Could not assign the follow-up", error instanceof Error ? error.message : undefined);
    }
  }, [askFollowUp, canDismiss, createReviewTask, societyId, toast]);

  const snoozing = useFindingSnooze(societyId, canDismiss);

  return {
    canDismiss,
    dismiss,
    restore,
    acknowledge,
    withdrawAcknowledgement,
    assignFollowUp,
    askFollowUp,
    snooze: snoozing.snooze,
    cancelSnooze: snoozing.cancelSnooze,
    /** Render once wherever the hook is used, for Assign follow-up and Remind me later. */
    dialogs: <>{followUp.dialog}{snoozing.dialog}</>,
  };
}

/**
 * "Remind me later" for a requirement (a dashboard finding or an obligation
 * occurrence): it stays listed and counted; only nudges skip it. The server
 * refuses recommendations and re-checks the level.
 */
export function useFindingSnooze(societyId: string | undefined, enabled: boolean) {
  const toast = useToast();
  const undoable = useUndoableAction();
  const snoozeDialog = useSnoozeDialog();
  const askSnooze = snoozeDialog.ask;
  const snoozeItem = useMutation(api.dashboardRemediation.snoozeItem);
  const cancelSnoozeItem = useMutation(api.dashboardRemediation.cancelSnooze);

  const snooze = useCallback(async (target: DismissTarget, flagText?: string) => {
    if (!societyId || !enabled) return;
    const untilISO = await askSnooze(target);
    if (!untilISO) return;
    await undoable({
      message: `Snoozed until ${formatDate(untilISO, "MMM d")}`,
      description: "It stays listed and in the counts.",
      errorMessage: "Could not snooze the reminder",
      dedupeKey: `snooze-${target.id}`,
      run: () => snoozeItem({ societyId, ruleId: target.id, flagLevel: target.level, flagText, untilISO }),
      undo: () => cancelSnoozeItem({ societyId, ruleId: target.id }),
      undoneMessage: "Snooze cancelled",
    });
  }, [askSnooze, cancelSnoozeItem, enabled, snoozeItem, societyId, undoable]);

  const cancelSnooze = useCallback(async (target: DismissTarget) => {
    if (!societyId || !enabled) return;
    try {
      await cancelSnoozeItem({ societyId, ruleId: target.id });
      toast.success("Snooze cancelled");
    } catch (error) {
      toast.error("Could not cancel the snooze", error instanceof Error ? error.message : undefined);
    }
  }, [cancelSnoozeItem, enabled, societyId, toast]);

  return { snooze, cancelSnooze, dialog: snoozeDialog.dialog };
}

/** The toast after Assign follow-up: a new task, a reassigned one, or one left as it was. */
export function followUpToast(result: { reused?: boolean; reassigned?: boolean } | null | undefined) {
  if (result?.reassigned) return "Follow-up reassigned";
  return result?.reused ? "Existing follow-up task kept" : "Follow-up assigned";
}

type DashboardDismissals = ReturnType<typeof useDashboardDismissals>;

/**
 * The attention actions a finding offers in its ⋯ menu or ⓘ popover:
 * Dismiss for a recommendation; Acknowledge (or Withdraw acknowledgement) and,
 * when asked, Assign follow-up for a requirement. Empty for people who may
 * not act on findings.
 */
export function findingAttentionActions(
  item: FindingPolicyFields,
  target: DismissTarget,
  dismissals: DashboardDismissals,
  { followUp = false, evidenceRequired }: { followUp?: boolean; evidenceRequired?: string[] } = {},
): { id: string; label: string; onSelect: () => void }[] {
  if (!dismissals.canDismiss) return [];
  if (canDismissItem(item)) return [{ id: "dismiss", label: "Dismiss", onSelect: () => void dismissals.dismiss(target) }];
  if (!isOutstandingRequirement(item)) return [];
  return [
    item.acknowledgement
      ? { id: "withdraw-acknowledgement", label: "Withdraw acknowledgement", onSelect: () => void dismissals.withdrawAcknowledgement(target) }
      : { id: "acknowledge", label: "Acknowledge", onSelect: () => void dismissals.acknowledge(target) },
    ...(followUp ? [{ id: "assign-follow-up", label: "Assign follow-up", onSelect: () => void dismissals.assignFollowUp(target, evidenceRequired) }] : []),
    ...(item.snooze
      ? [{ id: "cancel-snooze", label: "Cancel snooze", onSelect: () => void dismissals.cancelSnooze(target) }]
      : canSnoozeItem(item) ? [{ id: "snooze", label: "Remind me later", onSelect: () => void dismissals.snooze(target) }] : []),
  ];
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

/**
 * The quiet line under a finding: what it rests on ("Statutory requirement")
 * and who has acknowledged it or owns its follow-up. Nothing for a plain
 * recommendation.
 */
export function FindingStatusLine({ item, todayISO }: { item: FindingPolicyFields; todayISO?: string }) {
  const parts: ReactNode[] = [];
  if (showsBasis(item)) {
    parts.push(<span key="basis" className="finding-status__basis">{REQUIREMENT_BASIS_LABEL[item.requirementBasis]}</span>);
  }
  if (item.acknowledgement) parts.push(<span key="ack">{acknowledgementText(item.acknowledgement)}</span>);
  if (item.followUp) parts.push(<span key="follow-up">{followUpText(item.followUp, todayISO)}</span>);
  if (item.snooze) parts.push(<span key="snooze">{snoozeText(item.snooze, todayISO)}</span>);
  if (!parts.length) return null;
  return (
    <span className="finding-status" title={item.acknowledgement?.note ? `Note: ${item.acknowledgement.note}` : undefined}>
      {parts.flatMap((part, index) => (index ? [<span key={`sep-${index}`} aria-hidden="true"> · </span>, part] : [part]))}
    </span>
  );
}

function showsBasis(item: FindingPolicyFields): item is FindingPolicyFields & { requirementBasis: RequirementBasis } {
  return Boolean(item.requirementBasis && item.requirementBasis !== "recommendation" && item.level !== "ok");
}

/** True when FindingStatusLine has something to say for this item. */
export function hasFindingStatus(item: FindingPolicyFields) {
  return showsBasis(item) || Boolean(item.acknowledgement || item.followUp || item.snooze);
}

/** "Reminder snoozed until Dec 5 by Mina Patel". */
export function snoozeText(snooze: DashboardItemSnooze, todayISO?: string) {
  const sameYear = !todayISO || snooze.untilISO.slice(0, 4) === todayISO.slice(0, 4);
  const until = formatDate(snooze.untilISO, sameYear ? "MMM d" : "MMM d, yyyy");
  return `Reminder snoozed until ${until}${snooze.snoozedByName ? ` by ${snooze.snoozedByName}` : ""}`;
}

type SnoozeChoice = "week" | "month" | "date";

function addDaysKey(days: number, months = 0) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  date.setDate(date.getDate() + days);
  return calendarDateKey(date);
}

/**
 * "Remind me later": 1 week, 1 month, or a chosen date. Returns a function
 * that opens the dialog and resolves with the date (YYYY-MM-DD), or null when
 * cancelled, and the dialog element to render.
 */
export function useSnoozeDialog() {
  const [target, setTarget] = useState<DismissTarget | null>(null);
  const [choice, setChoice] = useState<SnoozeChoice>("week");
  const [date, setDate] = useState("");
  const resolver = useRef<((value: string | null) => void) | null>(null);

  const ask = useCallback((next: DismissTarget) => new Promise<string | null>((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setChoice("week");
    setDate("");
    setTarget(next);
  }), []);

  const close = (value: string | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setTarget(null);
  };

  const week = addDaysKey(7);
  const month = addDaysKey(0, 1);
  const chosen = choice === "week" ? week : choice === "month" ? month : date;
  const dialog = (
    <Modal
      open={Boolean(target)}
      onClose={() => close(null)}
      title="Remind me later"
      size="sm"
      footer={
        <>
          <button className="btn" type="button" onClick={() => close(null)}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={!chosen} onClick={() => close(chosen)}>
            Snooze
          </button>
        </>
      }
    >
      {target && <p className="muted" style={{ marginTop: 0 }}>“{target.text}” stays listed and in the counts. Reminders pause until then.</p>}
      <RadioGroup<SnoozeChoice>
        name="snooze-until"
        value={choice}
        onChange={setChoice}
        options={[
          { value: "week", label: "1 week", hint: formatDate(week, "EEE, MMM d") },
          { value: "month", label: "1 month", hint: formatDate(month, "EEE, MMM d") },
          { value: "date", label: "Until a date" },
        ]}
      />
      {choice === "date" && (
        <Field label="Remind me on">
          <DatePicker value={date} onChange={setDate} min={addDaysKey(1)} max={addDaysKey(365)} />
        </Field>
      )}
    </Modal>
  );

  return { ask, dialog };
}

/** "Acknowledged by Mina Patel · 2 days ago". */
export function acknowledgementText(acknowledgement: DashboardItemAcknowledgement) {
  const when = acknowledgement.acknowledgedAtISO ? relative(acknowledgement.acknowledgedAtISO) : "";
  return [
    "Acknowledged",
    acknowledgement.acknowledgedByName ? `by ${acknowledgement.acknowledgedByName}` : "",
    when && when !== "—" ? when : "",
  ].filter(Boolean).join(" ");
}

/** "Follow-up: Jordan Lee, due Dec 15". */
export function followUpText(followUp: { assignee?: string; dueDate?: string }, todayISO?: string) {
  const due = followUp.dueDate ? `due ${formatDate(followUp.dueDate, todayISO && followUp.dueDate.slice(0, 4) === todayISO.slice(0, 4) ? "MMM d" : "MMM d, yyyy")}` : "";
  return `Follow-up: ${[followUp.assignee, due].filter(Boolean).join(", ") || "assigned"}`;
}

export type FollowUpDetails = { assignee?: string; dueDate?: string };

/**
 * "Assign follow-up": who owns the next step and by when. Returns a function
 * that opens the dialog and resolves with the details (null when cancelled),
 * and the dialog element to render.
 */
export function useFollowUpDialog() {
  const [target, setTarget] = useState<DismissTarget | null>(null);
  const [assignee, setAssignee] = useState("");
  const [dueDate, setDueDate] = useState("");
  const resolver = useRef<((value: FollowUpDetails | null) => void) | null>(null);
  const ownerId = useId();

  const ask = useCallback((next: DismissTarget) => new Promise<FollowUpDetails | null>((resolve) => {
    resolver.current?.(null);
    resolver.current = resolve;
    setAssignee("");
    setDueDate("");
    setTarget(next);
  }), []);

  const close = (value: FollowUpDetails | null) => {
    resolver.current?.(value);
    resolver.current = null;
    setTarget(null);
  };

  const dialog = (
    <Modal
      open={Boolean(target)}
      onClose={() => close(null)}
      title="Assign follow-up"
      size="sm"
      footer={
        <>
          <button className="btn" type="button" onClick={() => close(null)}>Cancel</button>
          <button
            className="btn btn--accent"
            type="button"
            onClick={() => close({ assignee: assignee.trim() || undefined, dueDate: dueDate || undefined })}
          >
            Assign
          </button>
        </>
      }
    >
      {target && <p className="muted" style={{ marginTop: 0 }}>“{target.text}” stays on the dashboard until it's resolved.</p>}
      <Field label="Owner" id={ownerId}>
        <input id={ownerId} data-autofocus="" className="input" value={assignee} onChange={(event) => setAssignee(event.target.value)} placeholder="Name" />
      </Field>
      <Field label="Due date">
        <DatePicker value={dueDate} onChange={setDueDate} />
      </Field>
    </Modal>
  );

  return { ask, dialog };
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
