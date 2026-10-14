import { useEffect, useMemo, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Badge } from "../../../components/ui";
import { RadioGroup } from "../../../components/Controls";
import { useToast } from "../../../components/Toast";
import { centsToDollarInput, formatDate } from "../../../lib/format";
import { parseMoneyInput } from "../../../lib/money";
import {
  SUGGESTED_CLAIM_POLICY,
  validateClaimPolicy,
  type ClaimPolicyEnforcement,
  type ExpenseClaimPolicy,
} from "../../../../shared/expensePolicy";
import type { ApprovalQueue } from "./types";

type Draft = {
  receiptOn: boolean;
  receipt: string;
  noteOn: boolean;
  note: string;
  ageOn: boolean;
  age: string;
  enforcement: ClaimPolicyEnforcement;
};

// Whole-dollar thresholds read better without cents.
const dollarsInput = (cents: number) => (cents % 100 === 0 ? String(cents / 100) : centsToDollarInput(cents));

const toDraft = (policy: ExpenseClaimPolicy): Draft => ({
  receiptOn: policy.receiptOverCents !== null,
  receipt: dollarsInput(policy.receiptOverCents ?? SUGGESTED_CLAIM_POLICY.receiptOverCents),
  noteOn: policy.noteOverCents !== null,
  note: dollarsInput(policy.noteOverCents ?? SUGGESTED_CLAIM_POLICY.noteOverCents),
  ageOn: policy.maxAgeDays !== null,
  age: String(policy.maxAgeDays ?? SUGGESTED_CLAIM_POLICY.maxAgeDays),
  enforcement: policy.enforcement,
});

const toPolicy = (draft: Draft): ExpenseClaimPolicy => ({
  receiptOverCents: draft.receiptOn ? Math.abs(parseMoneyInput(draft.receipt) ?? Number.NaN) : null,
  noteOverCents: draft.noteOn ? Math.abs(parseMoneyInput(draft.note) ?? Number.NaN) : null,
  maxAgeDays: draft.ageOn ? Number(draft.age) : null,
  enforcement: draft.enforcement,
});

const ENFORCEMENT_OPTIONS: { value: ClaimPolicyEnforcement; label: string; hint: string }[] = [
  { value: "warn", label: "Warn approvers", hint: "The claim goes ahead with a flag approvers can see. Requesters can still explain why." },
  { value: "block", label: "Block submission", hint: "The claim can't be submitted until it meets the policy or the requester asks for an exception with a reason." },
];

/**
 * Sentence-style expense-claim policy: receipt and note thresholds and a
 * submission window, warning approvers or blocking submission. The server
 * applies it whenever a claim is submitted.
 */
export function ClaimPolicyCard({ queue, societyId }: { queue: ApprovalQueue; societyId: string }) {
  const save = useMutation(api.expenseReports.saveClaimPolicy);
  const toast = useToast();
  const stored = queue.claimPolicy;
  const storedKey = JSON.stringify([stored.receiptOverCents, stored.noteOverCents, stored.maxAgeDays, stored.enforcement]);
  const [draft, setDraft] = useState<Draft>(() => toDraft(stored));
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState<string[]>([]);
  useEffect(() => {
    if (!dirty) setDraft(toDraft(stored));
    // Resync only when the stored policy changes and there are no local edits.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storedKey]);

  const canChange = stored.canChange;
  const update = (patch: Partial<Draft>) => {
    setDirty(true);
    setErrors([]);
    setDraft((current) => ({ ...current, ...patch }));
  };
  const policy = useMemo(() => toPolicy(draft), [draft]);

  const onSave = async () => {
    const problems = validateClaimPolicy(policy);
    setErrors(problems);
    if (problems.length) return;
    setBusy(true);
    try {
      await save({
        societyId: societyId as any,
        receiptOverCents: policy.receiptOverCents ?? undefined,
        noteOverCents: policy.noteOverCents ?? undefined,
        maxAgeDays: policy.maxAgeDays ?? undefined,
        enforcement: policy.enforcement,
      });
      setDirty(false);
      toast.success("Claim policy saved", policy.enforcement === "block" ? "Claims that miss it now need an exception to be submitted." : "Claims that miss it are flagged for approvers.");
    } catch (error: any) {
      toast.error("Could not save the claim policy", error?.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card claim-policy" aria-labelledby="claim-policy-title">
      <div className="card__head">
        <div>
          <h2 id="claim-policy-title" className="card__title">Claim policy</h2>
          <span className="card__subtitle">Checked every time someone submits an expense claim, here or from the Treasurer dashboard.</span>
        </div>
        {stored.isActive ? (
          <Badge tone={stored.enforcement === "block" ? "warn" : "info"}>{stored.enforcement === "block" ? "Blocks submission" : "Warns approvers"}</Badge>
        ) : (
          <Badge>Off</Badge>
        )}
      </div>
      <div className="card__body claim-policy__body">
        <fieldset className="claim-policy__rules" disabled={!canChange || busy}>
          <legend className="sr-only">Policy checks</legend>
          <PolicyLine
            on={draft.receiptOn}
            onToggle={(receiptOn) => update({ receiptOn })}
            toggleLabel="Require a receipt"
          >
            <span>Claims over</span>
            <MoneyInput value={draft.receipt} disabled={!draft.receiptOn} label="Receipt threshold" onChange={(receipt) => update({ receipt })} />
            <span>need a receipt</span>
          </PolicyLine>
          <PolicyLine on={draft.noteOn} onToggle={(noteOn) => update({ noteOn })} toggleLabel="Require a note">
            <span>Claims over</span>
            <MoneyInput value={draft.note} disabled={!draft.noteOn} label="Note threshold" onChange={(note) => update({ note })} />
            <span>need a note explaining the expense</span>
          </PolicyLine>
          <PolicyLine on={draft.ageOn} onToggle={(ageOn) => update({ ageOn })} toggleLabel="Require timely submission">
            <span>Submit within</span>
            <input
              className="input input--sm claim-policy__days"
              type="number"
              inputMode="numeric"
              min={1}
              max={730}
              aria-label="Days allowed after the expense"
              value={draft.age}
              disabled={!draft.ageOn}
              onChange={(event) => update({ age: event.target.value })}
            />
            <span>days of the expense</span>
          </PolicyLine>
        </fieldset>

        <fieldset className="claim-policy__enforcement" disabled={!canChange || busy}>
          <legend className="claim-policy__legend">When a claim misses the policy</legend>
          <RadioGroup<ClaimPolicyEnforcement>
            name="claim-policy-enforcement"
            value={draft.enforcement}
            onChange={(enforcement) => update({ enforcement })}
            options={ENFORCEMENT_OPTIONS.map((option) => ({ ...option, disabled: !canChange }))}
          />
        </fieldset>

        {errors.length > 0 && (
          <div className="rule-editor__errors" role="alert">
            {errors.map((error) => <div key={error}>{error}</div>)}
          </div>
        )}

        <div className="claim-policy__footer">
          <p className="muted claim-policy__meta">
            {!canChange && "Only people with finance edit access can change the claim policy. "}
            {stored.updatedByName && stored.updatedAtISO ? `Last changed by ${stored.updatedByName} on ${formatDate(stored.updatedAtISO)}.` : !stored.isSaved ? "No claim policy yet: every claim can be submitted as is." : null}
          </p>
          {dirty && (
            <button type="button" className="btn btn--sm" disabled={busy} onClick={() => { setDirty(false); setErrors([]); setDraft(toDraft(stored)); }}>
              Discard changes
            </button>
          )}
          <button type="button" className="btn btn--accent btn--sm" disabled={!canChange || !dirty || busy} onClick={() => void onSave()}>
            Save policy
          </button>
        </div>
      </div>
    </section>
  );
}

function PolicyLine({ on, onToggle, toggleLabel, children }: { on: boolean; onToggle: (on: boolean) => void; toggleLabel: string; children: React.ReactNode }) {
  return (
    <div className={`claim-policy__line${on ? "" : " is-off"}`}>
      <input type="checkbox" className="claim-policy__check" aria-label={toggleLabel} checked={on} onChange={(event) => onToggle(event.target.checked)} />
      <div className="claim-policy__sentence">{children}</div>
    </div>
  );
}

function MoneyInput({ value, onChange, disabled, label }: { value: string; onChange: (value: string) => void; disabled?: boolean; label: string }) {
  return (
    <span className="claim-policy__money">
      <span className="claim-policy__currency" aria-hidden="true">$</span>
      <input
        className="input input--sm claim-policy__amount"
        inputMode="decimal"
        aria-label={label}
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </span>
  );
}
