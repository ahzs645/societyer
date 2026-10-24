import { useState, type FormEvent } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../../../hooks/usePermissions";
import { Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { useToast } from "../../../components/Toast";
import { parseMoneyInput } from "../../../lib/money";
import { FieldRow, MoneyField, centsToInput } from "../../businessRegisters/formHelpers";
import {
  cleanStaffCostPlan,
  COMPENSATION_TYPES, COMPENSATION_LABELS,
  PAY_FREQUENCIES, PAY_FREQUENCY_LABELS,
  PLANNING_STATUSES, PLANNING_STATUS_LABELS,
  type StaffCostPlan,
} from "../../../../shared/costPlanning";

type EmployeeChoice = { _id: string; name: string; position?: string; startDate: string; endDate?: string; status?: string };
type EmployeePage = { page: EmployeeChoice[]; isDone: boolean; continueCursor: string | null };
type Draft = {
  name: string; employeeId: string; currency: string; startDate: string; endDate: string;
  status: StaffCostPlan["status"]; compensation: StaffCostPlan["compensation"];
  rate: string; hours: string; payFrequency: StaffCostPlan["payFrequency"]; payAnchorDate: string;
  vacation: string; employer: string; benefits: string; assumptionsConfirmed: boolean; notes: string;
};

function EmployeePicker({ societyId, value, disabled, onChange, onCopyDates }: {
  societyId: string; value: string; disabled: boolean;
  onChange: (employee: EmployeeChoice | null) => void;
  onCopyDates: (employee: EmployeeChoice) => void;
}) {
  const [cursor, setCursor] = useState<string | null>(null);
  const [prior, setPrior] = useState<EmployeeChoice[]>([]);
  const response = useQuery(api.costPlanning.sourcePage, { societyId, collection: "employees", cursor }) as EmployeePage | undefined;
  const choices = [...new Map([...prior, ...(response?.page ?? [])].map(employee => [employee._id, employee])).values()];
  const selected = choices.find(employee => employee._id === value);
  return <>
    <Field label="Linked employee" hint="Link an existing employee or plan a manual/vacant position. Compensation remains an editable forecast.">
      <select className="input" value={value} disabled={disabled} onChange={event => onChange(choices.find(employee => employee._id === event.target.value) ?? null)}>
        <option value="">Manual / vacant position</option>
        {value && !selected && <option value={value}>Saved employee link</option>}
        {choices.map(employee => <option key={employee._id} value={employee._id}>{employee.name}{employee.position ? ` · ${employee.position}` : ""}{employee.status && employee.status !== "active" ? ` (${employee.status})` : ""}</option>)}
      </select>
    </Field>
    {!response && <p className="muted" role="status">Loading employee choices…</p>}
    {response && !response.isDone && <button type="button" className="btn btn--sm" disabled={disabled} onClick={() => { setPrior(choices); setCursor(response.continueCursor); }}>Load more employees</button>}
    {selected && <button type="button" className="btn btn--sm" disabled={disabled} onClick={() => onCopyDates(selected)}>Use employee employment dates</button>}
  </>;
}

export function StaffCostForm({ societyId, currency, today, value, onSaved, onCancel }: {
  societyId: string; currency: string; today: string; value?: StaffCostPlan | null;
  onSaved: () => void; onCancel: () => void;
}) {
  const permissions = usePermissions(), save = useMutation(api.costPlanning.saveStaff), toast = useToast();
  const canWrite = permissions.loaded && permissions.can("financials:write");
  const canReadEmployees = permissions.loaded && permissions.can("employees:read");
  const [draft, setDraft] = useState<Draft>(() => ({
    name: value?.name ?? "", employeeId: value?.employeeId ?? "", currency: value?.currency ?? currency,
    startDate: value?.startDate ?? today, endDate: value?.endDate ?? "", status: value?.status ?? "planned",
    compensation: value?.compensation ?? "hourly", rate: centsToInput(value?.rateCents),
    hours: value?.hoursPerWeek === undefined ? "" : String(value.hoursPerWeek),
    payFrequency: value?.payFrequency ?? "biweekly", payAnchorDate: value?.payAnchorDate ?? today,
    vacation: value?.vacationPercent === undefined ? "" : String(value.vacationPercent),
    employer: value?.employerPercent === undefined ? "" : String(value.employerPercent),
    benefits: centsToInput(value?.monthlyBenefitsCents), assumptionsConfirmed: value?.assumptionsConfirmed ?? false,
    notes: value?.notes ?? "",
  }));
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const patch = (next: Partial<Draft>, changesAssumptions = true) => {
    setDraft(current => ({ ...current, ...next, ...(changesAssumptions ? { assumptionsConfirmed: false } : {}) }));
    setError("");
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canWrite || busy) return;
    setError(""); setBusy(true);
    try {
      const rateCents = parseMoneyInput(draft.rate);
      if (rateCents === undefined || !Number.isSafeInteger(rateCents) || rateCents < 0) throw new Error("Enter a valid wage or salary, including 0 for an unfilled estimate.");
      const monthlyBenefitsCents = draft.benefits.trim() ? parseMoneyInput(draft.benefits) : undefined;
      if (draft.benefits.trim() && (monthlyBenefitsCents === undefined || monthlyBenefitsCents < 0)) throw new Error("Enter monthly benefits as a non-negative amount.");
      if (draft.assumptionsConfirmed && [draft.vacation, draft.employer, draft.benefits].some(field => !field.trim())) throw new Error("Enter vacation, employer contributions and benefits before confirming. Enter 0 when an additional cost does not apply.");
      const fields = cleanStaffCostPlan({
        name: draft.name, ...(draft.employeeId ? { employeeId: draft.employeeId } : {}), currency: draft.currency,
        startDate: draft.startDate, ...(draft.endDate ? { endDate: draft.endDate } : {}), status: draft.status,
        compensation: draft.compensation, rateCents,
        ...(draft.compensation === "hourly" && draft.hours.trim() ? { hoursPerWeek: Number(draft.hours) } : {}),
        payFrequency: draft.payFrequency, payAnchorDate: draft.payAnchorDate,
        ...(draft.vacation.trim() ? { vacationPercent: Number(draft.vacation) } : {}),
        ...(draft.employer.trim() ? { employerPercent: Number(draft.employer) } : {}),
        ...(monthlyBenefitsCents !== undefined ? { monthlyBenefitsCents } : {}),
        assumptionsConfirmed: draft.assumptionsConfirmed, ...(draft.notes.trim() ? { notes: draft.notes } : {}),
      });
      await save({ societyId, ...(value?._id ? { id: value._id } : {}), fields });
      toast.success(value?._id ? "Staff cost updated" : "Staff cost saved");
      onSaved();
    } catch (failure) { setError(failure instanceof Error ? failure.message : "Could not save this staff cost."); }
    finally { setBusy(false); }
  };
  return <form className="form-stack" aria-label="Staff cost assumptions" onSubmit={submit}>
    {error && <p className="field__error" role="alert">{error}</p>}
    <p className="muted">Plan the employer cost of an existing staff member or a vacant position. Actual wages, deductions and net pay stay in your payroll records/provider.</p>
    <fieldset className="form-stack" disabled={!canWrite || busy} style={{ border: 0, padding: 0, margin: 0, minWidth: 0 }}>
      <Field label="Staff / position name" required><input className="input" value={draft.name} maxLength={200} onChange={event => patch({ name: event.target.value }, false)} /></Field>
      {canReadEmployees ? <EmployeePicker key={societyId} societyId={societyId} value={draft.employeeId} disabled={!canWrite || busy}
        onChange={employee => patch({ employeeId: employee?._id ?? "", ...(!draft.name.trim() && employee ? { name: employee.position ? `${employee.position} · ${employee.name}` : employee.name } : {}) })}
        onCopyDates={employee => patch({ startDate: employee.startDate, endDate: employee.endDate ?? "" })} />
        : <div><p className="muted">Employee access is required to choose a staff record. You can still plan a manual/vacant position{draft.employeeId ? ", or keep the existing employee link" : ""}.</p>{draft.employeeId && <button type="button" className="btn btn--sm" onClick={() => patch({ employeeId: "" })}>Use a manual position instead</button>}</div>}
      <FieldRow>
        <Field label="Employment start date" required><input className="input" type="date" value={draft.startDate} onChange={event => patch({ startDate: event.target.value })} /></Field>
        <Field label="Employment end date" hint="Optional. Earned amounts can be paid on a later scheduled pay date."><input className="input" type="date" min={draft.startDate} value={draft.endDate} onChange={event => patch({ endDate: event.target.value })} /></Field>
      </FieldRow>
      <FieldRow>
        <Field label="Staff cost currency" hint="Use the currency of this wage. The plan excludes other currencies without converting them."><input className="input" value={draft.currency} maxLength={3} onChange={event => patch({ currency: event.target.value.toUpperCase() })} /></Field>
        <Field label="Planning status"><select className="input" value={draft.status} onChange={event => patch({ status: event.target.value as Draft["status"] }, false)}>{PLANNING_STATUSES.map(status => <option key={status} value={status}>{PLANNING_STATUS_LABELS[status]}</option>)}</select></Field>
      </FieldRow>
      <FieldRow>
        <Field label="Compensation basis"><select className="input" value={draft.compensation} onChange={event => patch({ compensation: event.target.value as Draft["compensation"] })}>{COMPENSATION_TYPES.map(kind => <option key={kind} value={kind}>{COMPENSATION_LABELS[kind]}</option>)}</select></Field>
        <MoneyField label={`Rate (${draft.currency || currency})`} required value={draft.rate} onChange={rate => patch({ rate })} hint={draft.compensation === "hourly" ? "Hourly wage before additions." : draft.compensation === "monthly" ? "Monthly salary before additions." : "Annual salary before additions."} />
      </FieldRow>
      {draft.compensation === "hourly" && <Field label="Hours per week" hint="Earnings are spread over Monday–Friday. Blank hours are flagged as incomplete and excluded from the forecast."><input className="input" inputMode="decimal" value={draft.hours} onChange={event => patch({ hours: event.target.value })} /></Field>}
      <FieldRow>
        <Field label="Pay frequency"><select className="input" value={draft.payFrequency} onChange={event => patch({ payFrequency: event.target.value as Draft["payFrequency"] })}>{PAY_FREQUENCIES.map(frequency => <option key={frequency} value={frequency}>{PAY_FREQUENCY_LABELS[frequency]}</option>)}</select></Field>
        <Field label="First pay date" required hint={draft.payFrequency === "semimonthly" ? "Select the 15th or the last day of a month. The pay calendar includes only active employment dates." : "Use a known pay-calendar date; it may precede employment. Recurrences keep this anchor and include only active earnings. Dates before the first anchor are treated as catch-up earnings."}><input className="input" type="date" value={draft.payAnchorDate} onChange={event => patch({ payAnchorDate: event.target.value })} /></Field>
      </FieldRow>
      <section className="form-stack" aria-label="Employer cost additions">
        <h3>Employer cost assumptions</h3>
        <p className="muted">Enter the costs you reviewed for this position. No statutory rates are filled in. Use explicit 0 values when an addition does not apply.</p>
        <FieldRow>
          <Field label="Vacation pay (%)" hint="Added to gross earnings."><input className="input" inputMode="decimal" value={draft.vacation} placeholder="Not entered" onChange={event => patch({ vacation: event.target.value })} /></Field>
          <Field label="Employer contributions (%)" hint="Applied to gross earnings plus vacation pay; include the combined rate from your cost assumptions."><input className="input" inputMode="decimal" value={draft.employer} placeholder="Not entered" onChange={event => patch({ employer: event.target.value })} /></Field>
          <MoneyField label={`Monthly benefits (${draft.currency || currency})`} value={draft.benefits} onChange={benefits => patch({ benefits })} hint="Employer-paid benefits per month, prorated across active dates." />
        </FieldRow>
        <Checkbox label="I reviewed these staff cost assumptions" checked={draft.assumptionsConfirmed} onChange={assumptionsConfirmed => patch({ assumptionsConfirmed }, false)} />
        {!draft.assumptionsConfirmed && <p className="field__hint" role="status">You can save an unconfirmed estimate. The forecast will flag missing or unconfirmed assumptions for review.</p>}
      </section>
      <Field label="Staff cost notes"><textarea className="input textarea" rows={3} maxLength={4000} value={draft.notes} onChange={event => patch({ notes: event.target.value }, false)} placeholder="Rate source, hours, benefits assumptions or vacancy timing" /></Field>
    </fieldset>
    {!canWrite && <p className="muted">Finance write permission is required to save staff costs.</p>}
    <div className="btn-row"><button type="button" className="btn" disabled={busy} onClick={onCancel}>Cancel</button><button type="submit" className="btn btn--accent" disabled={!canWrite || busy}>{busy ? "Saving…" : "Save staff cost"}</button></div>
  </form>;
}
