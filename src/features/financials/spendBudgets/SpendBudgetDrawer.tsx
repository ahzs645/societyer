import { useEffect, useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Drawer, Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { Segmented } from "../../../components/primitives";
import { DatePicker } from "../../../components/DatePicker";
import { useToast } from "../../../components/Toast";
import { centsToDollarInput } from "../../../lib/format";
import { parseMoneyInput } from "../../../lib/money";
import { todayDateOnly } from "../../../../shared/dateOnly";
import { SPEND_BUDGET_CYCLES, SPEND_BUDGET_CYCLE_LABELS, validateSpendBudget, type SpendBudgetCycle } from "../../../../shared/spendBudgets";
import { errorMessage } from "../banking/types";
import type { SpendBudgetRow, SpendBudgetsData } from "./types";

type Draft = { name: string; limit: string; cycle: SpendBudgetCycle; startDate: string; endDate: string; committeeId: string; memberUserIds: string[]; notes: string };

const toDraft = (row: SpendBudgetRow | null): Draft => ({
  name: row?.name ?? "",
  limit: row ? centsToDollarInput(row.limitCents) : "",
  cycle: row?.cycle ?? "monthly",
  startDate: row?.startDate ?? `${todayDateOnly().slice(0, 7)}-01`,
  endDate: row?.endDate ?? "",
  committeeId: row?.committeeId ?? "",
  memberUserIds: row?.memberUserIds ?? [],
  notes: row?.notes ?? "",
});

/** Create or edit a spend budget: limit, cycle, active dates and who may charge it. */
export function SpendBudgetDrawer({
  open,
  budget,
  societyId,
  data,
  onClose,
}: {
  open: boolean;
  budget: SpendBudgetRow | null;
  societyId: string;
  data: SpendBudgetsData | undefined;
  onClose: () => void;
}) {
  const upsert = useMutation(api.spendBudgets.upsert);
  const toast = useToast();
  const [draft, setDraft] = useState<Draft>(() => toDraft(budget));
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  // Reset when the drawer opens or switches budget, not on every live update of the row.
  useEffect(() => {
    if (open) {
      setDraft(toDraft(budget));
      setErrors([]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, budget?._id]);
  const set = (patch: Partial<Draft>) => {
    setErrors([]);
    setDraft((current) => ({ ...current, ...patch }));
  };

  const save = async () => {
    const limitCents = Math.abs(parseMoneyInput(draft.limit) ?? Number.NaN);
    const input = {
      name: draft.name.trim(),
      limitCents,
      cycle: draft.cycle,
      startDate: draft.startDate,
      endDate: draft.endDate || undefined,
      committeeId: draft.committeeId || undefined,
      memberUserIds: draft.memberUserIds,
      notes: draft.notes.trim() || undefined,
    };
    const problems = validateSpendBudget(input);
    setErrors(problems);
    if (problems.length) return;
    setBusy(true);
    try {
      await upsert({ id: budget?._id, societyId, ...input });
      toast.success(budget ? "Spend budget saved" : "Spend budget created");
      onClose();
    } catch (error: unknown) {
      toast.error("Could not save the spend budget", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const users = data?.users ?? [];
  const available = users.filter((user) => !draft.memberUserIds.includes(user._id));
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={budget ? "Edit spend budget" : "New spend budget"}
      className="spend-budget-drawer"
      footer={
        <>
          <button className="btn" type="button" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" type="button" disabled={busy} onClick={() => void save()}>{budget ? "Save" : "Create budget"}</button>
        </>
      }
    >
      <Field label="Name" required>
        <input className="input" value={draft.name} placeholder="e.g. Events committee supplies" onChange={(event) => set({ name: event.target.value })} />
      </Field>
      <div className="bank-account-drawer__row">
        <Field label="Spend limit" required hint={draft.cycle === "once" ? "For the whole active period." : `Each ${draft.cycle === "weekly" ? "week" : draft.cycle === "monthly" ? "month" : "quarter"}.`}>
          <input className="input" inputMode="decimal" placeholder="$0.00" value={draft.limit} onChange={(event) => set({ limit: event.target.value })} />
        </Field>
        <Field label="Resets">
          <Segmented<SpendBudgetCycle> value={draft.cycle} onChange={(cycle) => set({ cycle })} items={SPEND_BUDGET_CYCLES.map((id) => ({ id, label: SPEND_BUDGET_CYCLE_LABELS[id] }))} />
        </Field>
      </div>
      <div className="bank-account-drawer__row">
        <Field label="Starts" required>
          <DatePicker value={draft.startDate} onChange={(startDate) => set({ startDate })} clearable={false} />
        </Field>
        <Field label="Ends" hint={draft.cycle === "once" ? "Required for a one-time budget." : "Optional"}>
          <DatePicker value={draft.endDate} onChange={(endDate) => set({ endDate })} min={draft.startDate || undefined} />
        </Field>
      </div>
      <Field label="Committee" hint="Its members can charge claims to the budget.">
        <Select
          value={draft.committeeId}
          onChange={(committeeId) => set({ committeeId })}
          clearable
          clearLabel="No committee"
          placeholder="No committee"
          options={(data?.committees ?? []).map((committee) => ({ value: committee._id, label: committee.name }))}
        />
      </Field>
      <Field label="People" hint="Named people can charge it too, with or without a committee.">
        <div className="spend-budget-drawer__people">
          {draft.memberUserIds.map((id) => (
            <span key={id} className="spend-budget-drawer__person">
              {users.find((user) => user._id === id)?.name ?? "Former member"}
              <button type="button" className="btn btn--ghost btn--icon btn--sm" aria-label="Remove" onClick={() => set({ memberUserIds: draft.memberUserIds.filter((value) => value !== id) })}>×</button>
            </span>
          ))}
          {available.length > 0 && (
            <Select
              size="sm"
              value=""
              searchable
              placeholder="Add a person"
              onChange={(id) => set({ memberUserIds: [...draft.memberUserIds, id] })}
              options={available.map((user) => ({ value: user._id, label: user.name }))}
            />
          )}
        </div>
      </Field>
      <Field label="Notes" hint="Optional. What the budget covers.">
        <textarea className="input" rows={3} value={draft.notes} onChange={(event) => set({ notes: event.target.value })} />
      </Field>
      {errors.length > 0 && (
        <div className="rule-editor__errors" role="alert">
          {errors.map((error) => <div key={error}>{error}</div>)}
        </div>
      )}
    </Drawer>
  );
}
