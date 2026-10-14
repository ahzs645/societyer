import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { Link } from "react-router-dom";
import { Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Banner } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Toggle } from "../../../components/Controls";
import { useConfirm } from "../../../components/Modal";
import { useToast } from "../../../components/Toast";
import { centsToDollarInput } from "../../../lib/format";
import { formatMoney, parseMoneyInput } from "../../../lib/money";
import { APPROVER_ROLES, approvalRuleWarnings, validateApprovalRules, type ApprovalRule } from "../../../../shared/expenseApprovals";
import { RulesChangeControl } from "./RulesChangeControl";
import type { ApprovalQueue } from "./types";

type RuleDraft = {
  key: string;
  minAmount: string;
  requiredApprovals: number;
  approverRoles: string[];
  approverUserIds: string[];
  blockSelfApproval: boolean;
  enabled: boolean;
  label?: string;
};

let nextKey = 1;
const toDraft = (rule: ApprovalRule): RuleDraft => ({
  key: `r${nextKey++}`,
  minAmount: centsToDollarInput(rule.minAmountCents),
  requiredApprovals: rule.requiredApprovals,
  approverRoles: rule.approverRoles ?? [],
  approverUserIds: rule.approverUserIds ?? [],
  blockSelfApproval: rule.blockSelfApproval !== false,
  enabled: rule.enabled !== false,
  label: rule.label,
});
const toRule = (draft: RuleDraft): ApprovalRule => ({
  minAmountCents: Math.abs(parseMoneyInput(draft.minAmount) ?? Number.NaN),
  requiredApprovals: draft.requiredApprovals,
  approverRoles: draft.approverRoles,
  approverUserIds: draft.approverUserIds,
  blockSelfApproval: draft.blockSelfApproval,
  enabled: draft.enabled,
  label: draft.label,
});

const describeTiers = (rules: ApprovalRule[]) =>
  rules.map((rule) => `${formatMoney(rule.minAmountCents)}+ → ${rule.requiredApprovals}`).join(", ");

/** Ordered threshold rules: "Claims of $X or more need N approvals from …". */
export function ApprovalRulesEditor({ queue, societyId, canWrite }: { queue: ApprovalQueue; societyId: string; canWrite: boolean }) {
  const save = useMutation(api.expenseReports.saveApprovalRules);
  const confirm = useConfirm();
  const toast = useToast();
  const [drafts, setDrafts] = useState<RuleDraft[]>(() => queue.policy.rules.map(toDraft));
  const [dirty, setDirty] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  const policyKey = JSON.stringify(queue.policy.rules);
  useEffect(() => {
    if (!dirty) setDrafts(queue.policy.rules.map(toDraft));
    // Only resync when the stored policy changes and there are no local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [policyKey]);

  const sorted = useMemo(
    () => [...drafts].sort((a, b) => (parseMoneyInput(a.minAmount) ?? 0) - (parseMoneyInput(b.minAmount) ?? 0)),
    [drafts],
  );
  // Soft overlap and duplicate-threshold warnings, live as the rules are edited.
  const warningsByKey = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const warning of approvalRuleWarnings(sorted.map(toRule))) {
      const key = sorted[warning.index]?.key;
      if (key) map.set(key, [...(map.get(key) ?? []), warning.message]);
    }
    return map;
  }, [sorted]);
  // While a change waits for a second approver the rules are read-only (the server refuses edits too).
  const pendingChange = queue.changeControl.pending;
  const editable = canWrite && !pendingChange;
  const needsSecondApprover = queue.changeControl.enabled;

  const update = (key: string, patch: Partial<RuleDraft>) => {
    setDirty(true);
    setDrafts((current) => current.map((draft) => (draft.key === key ? { ...draft, ...patch } : draft)));
  };
  const toggleIn = (list: string[], value: string) => (list.includes(value) ? list.filter((item) => item !== value) : [...list, value]);

  const persist = async (rules: ApprovalRule[], message: string) => {
    try {
      const result: any = await save({
        societyId: societyId as any,
        rules: rules.map((rule) => ({
          minAmountCents: rule.minAmountCents,
          requiredApprovals: rule.requiredApprovals,
          approverRoles: rule.approverRoles,
          approverUserIds: rule.approverUserIds as any,
          blockSelfApproval: rule.blockSelfApproval,
          enabled: rule.enabled,
          label: rule.label,
        })),
      });
      setDirty(false);
      setErrors([]);
      if (result?.pending) {
        toast.info("Change sent for a second approval", "Another owner, admin or director must approve it before it takes effect.");
      } else {
        toast.success(message, "New approvals follow these rules; claims already approved keep their approval.");
      }
    } catch (error: any) {
      toast.error("Could not save approval rules", error?.message);
    }
  };

  const onSave = async () => {
    const rules = drafts.map(toRule);
    const problems = validateApprovalRules(rules);
    setErrors(problems);
    if (problems.length) return;
    await persist(rules, "Approval rules saved");
  };

  const sourceNote =
    queue.policy.source === "signing_authority"
      ? "These thresholds come from the signing-authority tiers in your governance registers until you save your own."
      : queue.policy.source === "default"
        ? "These are the built-in defaults. Save to make them your own."
        : null;
  // With the default approver access, directors (read-only finance) can't
  // approve even when a rule names them; say so next to the rules.
  const financeWritersOnly = queue.approverAccess.value === "finance_writers";
  const directorIds = new Set(queue.approvers.filter((person) => person.role === "Director").map((person) => person._id));
  const namesDirectors = financeWritersOnly && drafts.some((draft) => draft.approverRoles.includes("Director") || draft.approverUserIds.some((id) => directorIds.has(id)));
  const suggestedDiffers =queue.policy.signingAuthorityCount > 0 && describeTiers(queue.policy.suggested) !== describeTiers(queue.policy.rules);

  return (
    <div className="approval-rules">
      <RulesChangeControl queue={queue} societyId={societyId} />
      {pendingChange && (
        <Banner tone="warn" title="This rule has a pending change">
          The rules below stay as they are until {pendingChange.isMine ? "another owner, admin or director" : "someone other than " + pendingChange.proposedByName} approves or declines the proposed change.
        </Banner>
      )}
      {queue.policy.signingAuthorityCount > 0 && (
        <Banner tone="info" title="Signing authority">
          Your <Link to="/app/governance-registers">governance registers</Link> record signing-authority tiers
          ({describeTiers(queue.policy.suggested)} approvals).{" "}
          {suggestedDiffers && editable && (
            <button
              type="button"
              className="btn btn--sm"
              onClick={() => {
                setDirty(true);
                setDrafts(queue.policy.suggested.map(toDraft));
              }}
            >
              Use these thresholds
            </button>
          )}
        </Banner>
      )}
      {sourceNote && <p className="muted approval-rules__source">{sourceNote}</p>}

      <ol className="approval-rules__list">
        {sorted.map((draft, index) => (
          <li key={draft.key} className={`approval-rule${draft.enabled ? "" : " is-disabled"}`}>
            <div className="approval-rule__sentence">
              <span>Claims of</span>
              <input
                className="input input--sm approval-rule__amount"
                inputMode="decimal"
                aria-label={`Rule ${index + 1} threshold`}
                value={draft.minAmount}
                disabled={!editable}
                onChange={(event) => update(draft.key, { minAmount: event.target.value })}
              />
              <span>or more need</span>
              <Select
                size="sm"
                className="approval-rule__count"
                aria-label={`Rule ${index + 1} approvals required`}
                value={String(draft.requiredApprovals)}
                disabled={!editable}
                onChange={(value) => update(draft.key, { requiredApprovals: Number(value) })}
                options={[1, 2, 3, 4, 5].map((n) => ({ value: String(n), label: String(n) }))}
              />
              <span>approval{draft.requiredApprovals === 1 ? "" : "s"} from</span>
            </div>
            <div className="approval-rule__who" role="group" aria-label={`Rule ${index + 1} approvers`}>
              {APPROVER_ROLES.map((role) => (
                <button
                  key={role}
                  type="button"
                  className={`chip chip--regular chip--sm chip--interactive approval-rule__chip${draft.approverRoles.includes(role) ? " is-selected" : ""}`}
                  aria-pressed={draft.approverRoles.includes(role)}
                  disabled={!editable}
                  onClick={() => update(draft.key, { approverRoles: toggleIn(draft.approverRoles, role) })}
                >
                  {role}s
                </button>
              ))}
              {queue.approvers.map((person) => (
                <button
                  key={person._id}
                  type="button"
                  className={`chip chip--regular chip--sm chip--interactive approval-rule__chip${draft.approverUserIds.includes(person._id) ? " is-selected" : ""}`}
                  aria-pressed={draft.approverUserIds.includes(person._id)}
                  disabled={!editable}
                  onClick={() => update(draft.key, { approverUserIds: toggleIn(draft.approverUserIds, person._id) })}
                >
                  {person.name}
                </button>
              ))}
              {draft.approverRoles.length === 0 && draft.approverUserIds.length === 0 && (
                <span className="muted approval-rule__any">
                  {financeWritersOnly ? "Any owner or admin (finance edit access)" : "Any owner, admin or director"}
                </span>
              )}
            </div>
            {(warningsByKey.get(draft.key) ?? []).map((message) => (
              <p key={message} className="approval-rule__warning" role="note">{message}</p>
            ))}
            <div className="approval-rule__options">
              <label className="approval-rule__check">
                <input type="checkbox" checked={draft.blockSelfApproval} disabled={!editable} onChange={(event) => update(draft.key, { blockSelfApproval: event.target.checked })} />
                Requester can't approve their own claim
              </label>
              <Toggle size="sm" checked={draft.enabled} disabled={!editable} onChange={(enabled) => update(draft.key, { enabled })} label="On" />
              <button
                type="button"
                className="btn btn--ghost btn--sm btn--icon"
                aria-label={`Remove rule ${index + 1}`}
                disabled={!editable || drafts.length === 1}
                onClick={() => {
                  setDirty(true);
                  setDrafts((current) => current.filter((item) => item.key !== draft.key));
                }}
              >
                <Trash2 size={14} />
              </button>
            </div>
          </li>
        ))}
      </ol>

      {namesDirectors && (
        <p className="muted approval-rules__note">
          Directors named here can approve only when “Who can approve claims” is set to anyone named in an approval rule.
        </p>
      )}

      {errors.length > 0 && (
        <div className="rule-editor__errors" role="alert">
          {errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}

      <div className="approval-rules__footer">
        <button
          type="button"
          className="btn btn--ghost btn--sm"
          disabled={!editable || drafts.length >= 8}
          onClick={() => {
            setDirty(true);
            const top = Math.max(0, ...drafts.map((draft) => parseMoneyInput(draft.minAmount) ?? 0));
            setDrafts((current) => [
              ...current,
              toDraft({ minAmountCents: top ? top * 2 : 100_000, requiredApprovals: 2, approverRoles: [], approverUserIds: [], blockSelfApproval: true, enabled: true }),
            ]);
          }}
        >
          <Plus size={12} aria-hidden="true" /> Add threshold
        </button>
        <span className="approval-rules__spacer" />
        {queue.policy.source === "configured" && (
          <button
            type="button"
            className="btn btn--sm"
            disabled={!editable}
            onClick={async () => {
              const ok = await confirm({
                title: "Restore default approval rules?",
                message: queue.policy.signingAuthorityCount > 0
                  ? "Thresholds will follow the signing-authority tiers in your governance registers."
                  : "Claims of $0 or more need 1 approval; claims of $5,000 or more need 2.",
                confirmLabel: "Restore defaults",
              });
              if (ok) await persist([], "Default approval rules restored");
            }}
          >
            Restore defaults
          </button>
        )}
        {dirty && (
          <button type="button" className="btn btn--sm" onClick={() => { setDirty(false); setErrors([]); setDrafts(queue.policy.rules.map(toDraft)); }}>
            Discard changes
          </button>
        )}
        <button type="button" className="btn btn--accent btn--sm" disabled={!editable || !dirty} onClick={() => void onSave()}>
          {needsSecondApprover ? "Propose change" : "Save rules"}
        </button>
      </div>
      {!canWrite && <p className="muted">Only owners and admins can change approval rules.</p>}
    </div>
  );
}
