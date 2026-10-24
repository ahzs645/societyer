import { useEffect, useState } from "react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field, InspectorNote } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { useToast } from "../../components/Toast";
import { REMITTANCE_CADENCES, REMITTANCE_CADENCE_LABEL, REMITTANCE_DUE_RULES, REMITTANCE_DUE_RULE_LABEL, REMITTER_TYPES, REMITTER_TYPE_LABEL, WORKERS_COMP_CADENCES, WORKERS_COMP_CADENCE_LABEL, WORKERS_COMP_PROVIDERS } from "../../../shared/businessRegisters";
import { FieldRow } from "./formHelpers";
import type { PayrollSettings } from "./types";
function errorMessage(error: unknown) { return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/, "").split("\n")[0] : "Something went wrong."; }

export function PayrollSettingsDrawer({ open, onClose, societyId, settings, canWrite }: { open: boolean; onClose: () => void; societyId: string; settings: PayrollSettings; canWrite: boolean }) {
  const toast = useToast();
  const save = usePermissionedMutation(api.payroll.saveSettings, canWrite);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({
      remitterType: settings.remitterType ?? "regular",
      province: settings.province || "BC",
      cadence: settings.cadence ?? "monthly",
      dueRule: settings.dueRule ?? "day_of_next_month",
      dueValue: settings.dueValue ? String(settings.dueValue) : "",
      remittanceEffectiveFrom: "",
      remittanceNoticeReference: "",
      payrollAccountNumber: settings.payrollAccountNumber ?? "",
      providerName: settings.providerName ?? "",
      workersCompProvider: settings.workersCompProvider ?? "",
      workersCompAccount: settings.workersCompAccount ?? "",
      workersCompCadence: settings.workersCompCadence ?? "",
      workersCompFirstDueDate: settings.workersCompFirstDueDate ?? "",
    });
  }, [open, settings]);
  const regular = form.remitterType !== "accelerated";
  const scheduleChanged = form.remitterType !== (settings.remitterType || "regular") || form.remitterType === "accelerated" && (form.cadence !== (settings.cadence || "monthly") || form.dueRule !== (settings.dueRule || "day_of_next_month") || Number(form.dueValue) !== Number(settings.dueValue));
  const submit = async () => {
    setBusy(true);
    try {
      await save({
        societyId,
        remitterType: form.remitterType,
        province: form.province || "BC",
        cadence: regular ? undefined : form.cadence,
        dueRule: regular ? undefined : form.dueRule,
        dueValue: regular ? undefined : Number(form.dueValue),
        remittanceEffectiveFrom: scheduleChanged ? form.remittanceEffectiveFrom || undefined : undefined,
        remittanceNoticeReference: scheduleChanged ? form.remittanceNoticeReference || undefined : undefined,
        payrollAccountNumber: form.payrollAccountNumber || undefined,
        providerName: form.providerName || undefined,
        workersCompProvider: form.workersCompProvider || undefined,
        workersCompAccount: form.workersCompAccount || undefined,
        workersCompCadence: form.workersCompCadence || undefined,
        workersCompFirstDueDate: form.workersCompCadence ? form.workersCompFirstDueDate || undefined : undefined,
      });
      toast.success("Payroll settings saved", "Remittance due dates and deadlines were recalculated.");
      onClose();
    } catch (error) {
      toast.error("Couldn't save the settings", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Payroll settings"
      footer={
        <>
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>
          {canWrite && <button className="btn btn--accent" onClick={submit} disabled={busy || scheduleChanged && (!form.remittanceEffectiveFrom || !form.remittanceNoticeReference?.trim())}>Save</button>}
        </>
      }
    >
      <section className="register-section">
        <h3 className="register-section__title">CRA remittances</h3>
        <Field label="Remitter type">
          <Select value={form.remitterType ?? "regular"} onChange={(remitterType) => setForm({ ...form, remitterType })} options={REMITTER_TYPES.map((value) => ({ value, label: REMITTER_TYPE_LABEL[value] }))} disabled={!canWrite} />
        </Field>
        <p className="register-hint">Reviewed holiday calendar: B.C. statutory dates plus CRA federal public holidays. Other provincial calendars are not selected by this register.</p>
        {scheduleChanged && <InspectorNote title="Record the actual CRA transition"><FieldRow><Field label="Remitter change effective from" required hint="Use the payment-date effective date on the CRA notice."><DatePicker value={form.remittanceEffectiveFrom || ""} onChange={(remittanceEffectiveFrom) => setForm({ ...form, remittanceEffectiveFrom })} disabled={!canWrite} /></Field><Field label="CRA notice / account reference" required><input className="input" value={form.remittanceNoticeReference || ""} onChange={(event) => setForm({ ...form, remittanceNoticeReference: event.target.value })} disabled={!canWrite} /></Field></FieldRow><p>Earlier pay dates retain their recorded schedule. Paid and partially paid obligations retain their period and due date.</p></InspectorNote>}
        {settings.remittanceScheduleHistory?.length ? <details><summary>Recorded remitter changes ({settings.remittanceScheduleHistory.length})</summary><ul>{settings.remittanceScheduleHistory.map((change) => <li key={change.effectiveFrom}>{change.effectiveFrom}: {REMITTER_TYPE_LABEL[change.remitterType as keyof typeof REMITTER_TYPE_LABEL] || change.remitterType} — {change.noticeReference}</li>)}</ul></details> : null}
        {form.remitterType === "quarterly" && settings.remitterType === "quarterly" && settings.dueRule && <p className="register-hint">Your existing custom quarterly cadence and due rule remain recorded for compatibility.</p>}
        {regular ? (
          <p className="register-hint">{form.remitterType === "accelerated_threshold_2" ? "Four windows (1–7, 8–14, 15–21 and 22–month end); payment is due three CRA working days after each window." : form.remitterType === "accelerated_threshold_1" ? "Pay dates 1–15 are due the 25th; pay dates 16–month end are due the 10th of the next month." : form.remitterType === "quarterly" ? "Calendar-quarter deductions are due the 15th of the following month." : "Deductions are due on the 15th of the month after the employees are paid."} Weekends and CRA-recognized holidays, including B.C. Family Day, move deadlines to the next business day.</p>
        ) : (
          <>
            <InspectorNote tone="warn" title="Use the schedule on your CRA notice">
              Use this custom schedule only for an existing CRA-approved arrangement. Standard regular, quarterly and accelerated threshold schedules are calculated automatically.
            </InspectorNote>
            <FieldRow>
              <Field label="Remit">
                <Select value={form.cadence ?? "monthly"} onChange={(cadence) => setForm({ ...form, cadence })} options={REMITTANCE_CADENCES.map((value) => ({ value, label: REMITTANCE_CADENCE_LABEL[value] }))} disabled={!canWrite} />
              </Field>
              <Field label="Due">
                <Select value={form.dueRule ?? "day_of_next_month"} onChange={(dueRule) => setForm({ ...form, dueRule })} options={REMITTANCE_DUE_RULES.map((value) => ({ value, label: REMITTANCE_DUE_RULE_LABEL[value] }))} disabled={!canWrite} />
              </Field>
              <Field label={form.dueRule === "days_after_period_end" ? "Days" : "Day"} required>
                <input className="input" inputMode="numeric" value={form.dueValue ?? ""} onChange={(event) => setForm({ ...form, dueValue: event.target.value.replace(/\D/g, "").slice(0, 3) })} disabled={!canWrite} />
              </Field>
            </FieldRow>
          </>
        )}
        <FieldRow>
          <Field label="CRA payroll account" hint="The RP program account number."><input className="input" value={form.payrollAccountNumber ?? ""} onChange={(event) => setForm({ ...form, payrollAccountNumber: event.target.value })} disabled={!canWrite} /></Field>
          <Field label="Payroll provider"><input className="input" value={form.providerName ?? ""} onChange={(event) => setForm({ ...form, providerName: event.target.value })} disabled={!canWrite} /></Field>
        </FieldRow>
      </section>
      <section className="register-section">
        <h3 className="register-section__title">Workers' compensation (optional)</h3>
        <FieldRow>
          <Field label="Board">
            <Select value={form.workersCompProvider ?? ""} onChange={(workersCompProvider) => setForm({ ...form, workersCompProvider })} options={WORKERS_COMP_PROVIDERS.map((value) => ({ value, label: value }))} clearable clearLabel="None" disabled={!canWrite} />
          </Field>
          <Field label="Account"><input className="input" value={form.workersCompAccount ?? ""} onChange={(event) => setForm({ ...form, workersCompAccount: event.target.value })} disabled={!canWrite} /></Field>
        </FieldRow>
        <FieldRow>
          <Field label="Report and pay">
            <Select value={form.workersCompCadence ?? ""} onChange={(workersCompCadence) => setForm({ ...form, workersCompCadence })} options={WORKERS_COMP_CADENCES.map((value) => ({ value, label: WORKERS_COMP_CADENCE_LABEL[value] }))} clearable clearLabel="No reminder" disabled={!canWrite} />
          </Field>
          {form.workersCompCadence && <Field label="Next due" required><DatePicker value={form.workersCompFirstDueDate ?? ""} onChange={(workersCompFirstDueDate) => setForm({ ...form, workersCompFirstDueDate })} disabled={!canWrite} /></Field>}
        </FieldRow>
        <p className="register-hint">The reminder goes on the Deadlines page. Completing it there brings up the next one.</p>
      </section>
    </Drawer>
  );
}
