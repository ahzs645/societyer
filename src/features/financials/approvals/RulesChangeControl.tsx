import { useState } from "react";
import { useMutation } from "convex/react";
import { Check, Minus, Plus, Undo2, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "../../../components/ui";
import { Toggle } from "../../../components/Controls";
import { useConfirm, usePrompt } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { formatDateTime } from "../../../lib/format";
import type { ApprovalQueue, PendingPolicyChange } from "./types";

/**
 * "Changes to approval rules need a second approver": the setting, and the
 * pending change (a diff) that another owner, admin or director approves.
 * The server refuses rule edits while a change is pending.
 */
export function RulesChangeControl({ queue, societyId }: { queue: ApprovalQueue; societyId: string }) {
  const setControl = useMutation(api.expenseReports.setRulesChangeControl);
  const confirm = useConfirm();
  const toast = useToast();
  const [busy, setBusy] = useState(false);
  const { enabled, canChange, pending } = queue.changeControl;

  const toggle = async (next: boolean) => {
    if (busy) return;
    if (!next) {
      const ok = await confirm({
        title: "Turn off second-approver review?",
        message: "Turning this off is itself a change: another owner, admin or director has to approve it first.",
        confirmLabel: "Ask to turn off",
      });
      if (!ok) return;
    }
    setBusy(true);
    try {
      const result: any = await setControl({ societyId: societyId as any, enabled: next });
      if (result?.pending) toast.info("Waiting for a second approver", "Review stays on until someone else approves turning it off.");
      else toast.success(next ? "Rule changes now need a second approver" : "Second-approver review is off");
    } catch (error: any) {
      toast.error("Could not change the setting", error?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="change-control">
      <div className="change-control__setting">
        <Toggle
          checked={enabled}
          disabled={!canChange || busy || Boolean(pending)}
          onChange={(next) => void toggle(next)}
          label="Changes to approval rules need a second approver"
          hint="Saving creates a proposed change. Another owner, admin or director approves it before it takes effect."
        />
      </div>
      {pending && <PendingChange change={pending} />}
    </div>
  );
}

function PendingChange({ change }: { change: PendingPolicyChange }) {
  const decidePolicyChange = useMutation(api.expenseReports.decidePolicyChange);
  const prompt = usePrompt();
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const act = async (decision: "approve" | "decline" | "withdraw") => {
    let reason: string | undefined;
    if (decision === "decline") {
      const text = await prompt({ title: "Decline this change", message: `Tell ${change.proposedByName} why.`, placeholder: "Reason (optional)", multiline: true, confirmLabel: "Decline change" });
      if (text === null) return;
      reason = text || undefined;
    }
    setBusy(true);
    try {
      await decidePolicyChange({ id: change._id as any, decision, reason });
      toast.success(decision === "approve" ? "Change approved and applied" : decision === "decline" ? "Change declined" : "Change withdrawn");
    } catch (error: any) {
      toast.error("Could not record the decision", error?.message);
    } finally {
      setBusy(false);
    }
  };

  const title = change.kind === "change_control_off"
    ? "Proposed: turn off second-approver review"
    : change.restoresDefaults
      ? "Proposed: restore the default approval rules"
      : "Proposed change to the approval rules";

  return (
    <section className="pending-change" aria-labelledby={`pending-${change._id}`}>
      <div className="pending-change__head">
        <div>
          <h3 id={`pending-${change._id}`} className="pending-change__title">{title}</h3>
          <span className="muted pending-change__meta">{change.proposedByName}{change.isMine ? " (you)" : ""} · {formatDateTime(change.createdAtISO)}</span>
        </div>
        <Badge tone="warn">Waiting for approval</Badge>
      </div>
      {change.diff.length > 0 && (
        <ul className="pending-change__diff" aria-label="What changes">
          {change.diff.map((line) => (
            <li key={`${line.kind}-${line.thresholdCents}`} className={`pending-change__line pending-change__line--${line.kind}`}>
              {line.kind === "added" && (
                <><Plus size={12} aria-hidden="true" /><span className="sr-only">Added: </span><span>{line.after}</span></>
              )}
              {line.kind === "removed" && (
                <><Minus size={12} aria-hidden="true" /><span className="sr-only">Removed: </span><del>{line.before}</del></>
              )}
              {line.kind === "changed" && (
                <span className="pending-change__changed">
                  <span className="pending-change__before"><Minus size={12} aria-hidden="true" /><span className="sr-only">Was: </span><del>{line.before}</del></span>
                  <span className="pending-change__after"><Plus size={12} aria-hidden="true" /><span className="sr-only">Becomes: </span>{line.after}</span>
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {change.kind === "rules" && change.diff.length === 0 && <p className="muted">The proposed rules match the current ones.</p>}
      {!change.canDecide && change.cannotDecideReason && <p className="muted pending-change__why">{change.cannotDecideReason}</p>}
      <div className="pending-change__actions">
        {change.isMine && (
          <button type="button" className="btn btn--sm" disabled={busy} onClick={() => void act("withdraw")}>
            <Undo2 size={12} aria-hidden="true" /> Withdraw
          </button>
        )}
        {!change.isMine && (
          <>
            <button type="button" className="btn btn--sm btn--danger" disabled={busy || !change.canDecide} onClick={() => void act("decline")}>
              <X size={12} aria-hidden="true" /> Decline
            </button>
            <button type="button" className="btn btn--sm btn--accent" disabled={busy || !change.canDecide} title={change.cannotDecideReason} onClick={() => void act("approve")}>
              <Check size={12} aria-hidden="true" /> Approve change
            </button>
          </>
        )}
      </div>
    </section>
  );
}
