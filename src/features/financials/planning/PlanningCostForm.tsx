import { useState } from "react";
import { useMutation } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "../../../components/ui";
import { Select } from "../../../components/Select";
import { COST_CADENCES, COST_CADENCE_LABELS, PLANNING_STATUSES, PLANNING_STATUS_LABELS, defaultPlanningCost, validatePlanningCost, type PlanningCost } from "../../../../shared/costPlanning";
import { moneyInput, costFields, planningCents, planningError } from "./planningFormUtils";

export function PlanningCostForm({ societyId, currency, today, value, onSaved, onCancel }: { societyId: string; currency: string; today: string; value?: PlanningCost | null; onSaved: () => void; onCancel: () => void }) {
  const save = useMutation(api.costPlanning.saveCost);
  const [draft, setDraft] = useState(() => value ?? defaultPlanningCost(today, currency));
  const [amount, setAmount] = useState(moneyInput(draft.amountCents)), [error, setError] = useState(""), [busy, setBusy] = useState(false);
  const patch = (fields: Partial<PlanningCost>) => setDraft((old) => ({ ...old, ...fields }));
  const submit = async () => { setError(""); setBusy(true); try { const fields = costFields(validatePlanningCost({ ...draft, amountCents: planningCents(amount, "Cost amount") })); await save({ societyId, id: value?._id, fields }); onSaved(); } catch (cause) { setError(planningError(cause)); } finally { setBusy(false); } };
  return <form className="form-stack cost-planner" aria-label={value ? "Edit planning cost" : "Add planning cost"} onSubmit={(event) => { event.preventDefault(); void submit(); }}>
    <Field label="Cost name" required><input className="input" value={draft.name} maxLength={200} onChange={(event) => patch({ name: event.target.value })} /></Field>
    <div className="cost-planner__form-grid"><Field label="Category" required><input className="input" value={draft.category} maxLength={100} list="planning-cost-categories" onChange={(event) => patch({ category: event.target.value })} /><datalist id="planning-cost-categories"><option>Insurance</option><option>Software</option><option>Rent</option><option>Events</option><option>Supplies</option><option>Administration</option></datalist></Field><Field label="Cost currency"><input className="input" value={draft.currency} maxLength={3} onChange={(event) => patch({ currency: event.target.value.toUpperCase() })} /></Field><Field label="Cost amount" hint="Enter the full payment, including any nonrecoverable tax."><input className="input" inputMode="decimal" value={amount} onChange={(event) => setAmount(event.target.value)} /></Field><Field label="Recurrence"><Select value={draft.cadence} onChange={(cadence) => patch({ cadence })} options={COST_CADENCES.map((cadence) => ({ value: cadence, label: COST_CADENCE_LABELS[cadence] }))} /></Field><Field label="Coverage starts"><input className="input" type="date" value={draft.startDate} onChange={(event) => patch({ startDate: event.target.value })} /></Field><Field label="First payment / renewal date" hint="On or after coverage starts. Later renewals keep this original calendar day."><input className="input" type="date" value={draft.anchorDate} onChange={(event) => patch({ anchorDate: event.target.value })} /></Field><Field label="Cost ends" hint="Leave blank for ongoing costs."><input className="input" type="date" value={draft.endDate ?? ""} onChange={(event) => patch({ endDate: event.target.value || undefined })} /></Field><Field label="Cost status"><Select value={draft.status} onChange={(status) => patch({ status })} options={PLANNING_STATUSES.map((status) => ({ value: status, label: PLANNING_STATUS_LABELS[status] }))} /></Field></div>
    {draft.sourceKind !== "manual" && <p className="muted">Imported from {draft.sourceKind}. These saved planning assumptions stay editable and are not overwritten by later source changes.</p>}
    <Field label="Cost notes"><textarea className="input textarea" rows={3} maxLength={4000} value={draft.notes ?? ""} onChange={(event) => patch({ notes: event.target.value || undefined })} /></Field>
    <p className="muted">An annual renewal can be a full cash payment in one term while its allocated cost is spread over the covered days.</p>
    {error && <p className="field__error" role="alert">{error}</p>}<div className="cost-planner__actions"><button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button><button className="btn btn--accent" disabled={busy}>{busy ? "Saving…" : "Save cost"}</button></div>
  </form>;
}
