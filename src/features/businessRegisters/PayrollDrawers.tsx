import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field, InspectorNote } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Checkbox } from "../../components/Controls";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate, pluralize } from "../../lib/format";
import {
  REMITTANCE_CADENCES,
  REMITTANCE_CADENCE_LABEL,
  REMITTANCE_DUE_RULES,
  REMITTANCE_DUE_RULE_LABEL,
  REMITTER_TYPES,
  REMITTER_TYPE_LABEL,
  ROE_REASONS,
  ROE_STATUS_LABEL,
  SLIP_STATUS_LABEL,
  SLIP_TYPES,
  SLIP_TYPE_LABEL,
  WORKERS_COMP_CADENCES,
  WORKERS_COMP_CADENCE_LABEL,
  WORKERS_COMP_PROVIDERS,
  REMITTANCE_STATUS_LABEL,
  monthEnd,
  monthStart,
  parsePayrollCsv,
  payRunDifferenceCents,
  remittableCents,
  slipFilingDeadline,
  type PayrollCsvResult,
} from "../../../shared/businessRegisters";
import { centsToInput, FieldRow, inputToCents, MoneyField } from "./formHelpers";
import type { PayRunRow, PayrollEmployee, PayrollSettings, RemittanceRow, RoeRow, SlipRow } from "./types";

const AMOUNT_FIELDS = [
  ["grossCents", "Gross pay"],
  ["cppEmployeeCents", "CPP withheld"],
  ["eiEmployeeCents", "EI withheld"],
  ["incomeTaxCents", "Income tax withheld"],
  ["otherDeductionsCents", "Other deductions"],
  ["netCents", "Net pay"],
  ["cppEmployerCents", "Employer CPP"],
  ["eiEmployerCents", "Employer EI"],
] as const;

type AmountKey = (typeof AMOUNT_FIELDS)[number][0];
type LineDraft = { employeeId?: string; employeeName: string; gross: string; cpp: string; ei: string; tax: string };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/, "").split("\n")[0] : "Something went wrong.";
}

/* ------------------------------------------------------------------ pay run */

export function PayRunDrawer({
  open,
  onClose,
  societyId,
  run,
  employees,
  canWrite,
  today,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  run: PayRunRow | null;
  employees: PayrollEmployee[] | null;
  canWrite: boolean;
  today: string;
}) {
  const toast = useToast();
  const save = usePermissionedMutation(api.payroll.savePayRun, canWrite);
  const remove = usePermissionedMutation(api.payroll.removePayRun, canWrite);
  const [period, setPeriod] = useState({ periodStart: "", periodEnd: "", payDate: "" });
  const [amounts, setAmounts] = useState<Record<AmountKey, string>>({} as Record<AmountKey, string>);
  const [byEmployee, setByEmployee] = useState(false);
  const [lines, setLines] = useState<LineDraft[]>([]);
  const [notes, setNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const activeEmployees = useMemo(() => (employees ?? []).filter((employee) => employee.active), [employees]);

  useEffect(() => {
    if (!open) return;
    if (run) {
      setPeriod({ periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate });
      setAmounts(Object.fromEntries(AMOUNT_FIELDS.map(([key]) => [key, centsToInput((run as any)[key] ?? 0)])) as Record<AmountKey, string>);
      setByEmployee(false);
      setLines([]);
      setNotes(run.notes ?? "");
    } else {
      const start = today.slice(8) > "15" ? `${today.slice(0, 7)}-16` : monthStart(today);
      setPeriod({ periodStart: start, periodEnd: start.endsWith("-16") ? monthEnd(today) : `${today.slice(0, 7)}-15`, payDate: today });
      setAmounts(Object.fromEntries(AMOUNT_FIELDS.map(([key]) => [key, ""])) as Record<AmountKey, string>);
      setByEmployee(activeEmployees.length > 0);
      setLines(activeEmployees.map((employee) => ({ employeeId: employee._id, employeeName: employee.name, gross: "", cpp: "", ei: "", tax: "" })));
      setNotes("");
    }
  }, [open, run, today, activeEmployees]);

  const lineTotals = useMemo(() => {
    const parsed = lines.map((line) => {
      const gross = inputToCents(line.gross) ?? 0;
      const cpp = inputToCents(line.cpp) ?? 0;
      const ei = inputToCents(line.ei) ?? 0;
      const tax = inputToCents(line.tax) ?? 0;
      return {
        employeeId: line.employeeId,
        employeeName: line.employeeName,
        grossCents: gross,
        cppEmployeeCents: cpp,
        eiEmployeeCents: ei,
        incomeTaxCents: tax,
        cppEmployerCents: cpp,
        eiEmployerCents: Math.round(ei * 1.4),
        netCents: gross - cpp - ei - tax,
      };
    }).filter((line) => line.grossCents > 0);
    const sum = (key: keyof (typeof parsed)[number]) => parsed.reduce((total, line) => total + Number(line[key] ?? 0), 0);
    return {
      lines: parsed,
      grossCents: sum("grossCents"),
      cppEmployeeCents: sum("cppEmployeeCents"),
      eiEmployeeCents: sum("eiEmployeeCents"),
      incomeTaxCents: sum("incomeTaxCents"),
      otherDeductionsCents: 0,
      cppEmployerCents: sum("cppEmployerCents"),
      eiEmployerCents: sum("eiEmployerCents"),
      netCents: sum("netCents"),
    };
  }, [lines]);

  const totals = byEmployee
    ? lineTotals
    : (Object.fromEntries(AMOUNT_FIELDS.map(([key]) => [key, inputToCents(amounts[key]) ?? 0])) as Record<AmountKey, number>);
  const difference = payRunDifferenceCents(totals);
  const owed = remittableCents(totals);

  const submit = async () => {
    if (!canWrite) return;
    setBusy(true);
    try {
      await save({
        ...(run ? { id: run._id } : {}),
        societyId,
        ...period,
        ...(byEmployee
          ? { lines: lineTotals.lines.map((line) => (line.employeeId ? line : { ...line, employeeId: undefined })) }
          : Object.fromEntries(AMOUNT_FIELDS.map(([key]) => [key, totals[key]]))),
        notes: notes || undefined,
      });
      toast.success(run ? "Pay run saved" : "Pay run added", "Remittances and deadlines are up to date.");
      onClose();
    } catch (error) {
      toast.error("Couldn't save the pay run", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  const del = async () => {
    if (!run || !canWrite) return;
    setBusy(true);
    try {
      await remove({ id: run._id });
      toast.success("Pay run removed");
      onClose();
    } catch (error) {
      toast.error("Couldn't remove the pay run", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={run ? "Pay run" : "New pay run"}
      size="wide"
      footer={
        <>
          {run && canWrite && <button className="btn btn--ghost btn--danger-text" onClick={del} disabled={busy}>Remove</button>}
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>
          {canWrite && <button className="btn btn--accent" onClick={submit} disabled={busy}>Save</button>}
        </>
      }
    >
      <InspectorNote title="Records only">
        Run payroll with your provider. Record each run here so remittances, year-end slips and deadlines follow from it.
      </InspectorNote>
      <FieldRow>
        <Field label="Period start" required><DatePicker value={period.periodStart} onChange={(value) => setPeriod({ ...period, periodStart: value })} disabled={!canWrite} /></Field>
        <Field label="Period end" required><DatePicker value={period.periodEnd} onChange={(value) => setPeriod({ ...period, periodEnd: value })} disabled={!canWrite} /></Field>
        <Field label="Pay date" required hint="Decides the remittance month."><DatePicker value={period.payDate} onChange={(value) => setPeriod({ ...period, payDate: value })} disabled={!canWrite} /></Field>
      </FieldRow>

      {!run && activeEmployees.length > 0 && (
        <Checkbox checked={byEmployee} onChange={setByEmployee} label="Enter amounts by employee" hint="Needed to prepare T4 slips from the pay runs." disabled={!canWrite} />
      )}

      {run && run.lines.length > 0 && (
        <section className="register-section">
          <h3 className="register-section__title">By employee</h3>
          <div className="register-lines" role="table" aria-label="Pay run lines">
            <div className="register-lines__row register-lines__row--head" role="row">
              <span role="columnheader">Employee</span>
              <span role="columnheader" className="num">Gross</span>
              <span role="columnheader" className="num">Deductions</span>
              <span role="columnheader" className="num">Net</span>
            </div>
            {run.lines.map((line, index) => (
              <div className="register-lines__row" role="row" key={`${line.employeeName}-${index}`}>
                <span role="cell">{line.employeeName}</span>
                <span role="cell" className="num"><Money cents={line.grossCents} /></span>
                <span role="cell" className="num"><Money cents={line.cppEmployeeCents + line.eiEmployeeCents + line.incomeTaxCents + (line.otherDeductionsCents ?? 0)} /></span>
                <span role="cell" className="num"><Money cents={line.netCents} /></span>
              </div>
            ))}
          </div>
          <p className="register-hint">Imported lines are kept as the provider sent them. Edit the totals below if the provider corrected the run.</p>
        </section>
      )}

      {byEmployee ? (
        <section className="register-section">
          <h3 className="register-section__title">By employee</h3>
          {lines.map((line, index) => (
            <fieldset className="register-employee" key={line.employeeId ?? index}>
              <legend>{line.employeeName}</legend>
              <FieldRow>
                <MoneyField label="Gross pay" value={line.gross} onChange={(value) => setLines(lines.map((row, i) => (i === index ? { ...row, gross: value } : row)))} disabled={!canWrite} />
                <MoneyField label="CPP" value={line.cpp} onChange={(value) => setLines(lines.map((row, i) => (i === index ? { ...row, cpp: value } : row)))} disabled={!canWrite} />
                <MoneyField label="EI" value={line.ei} onChange={(value) => setLines(lines.map((row, i) => (i === index ? { ...row, ei: value } : row)))} disabled={!canWrite} />
                <MoneyField label="Income tax" value={line.tax} onChange={(value) => setLines(lines.map((row, i) => (i === index ? { ...row, tax: value } : row)))} disabled={!canWrite} />
              </FieldRow>
            </fieldset>
          ))}
          <p className="register-hint">Employer CPP matches the employee's; employer EI is 1.4 times the employee's. Net pay is gross less the deductions.</p>
        </section>
      ) : (
        <section className="register-section">
          <h3 className="register-section__title">Run totals</h3>
          <div className="register-money-grid">
            {AMOUNT_FIELDS.map(([key, label]) => (
              <MoneyField key={key} label={label} value={amounts[key] ?? ""} onChange={(value) => setAmounts({ ...amounts, [key]: value })} disabled={!canWrite} />
            ))}
          </div>
        </section>
      )}

      <dl className="register-summary">
        <div><dt>Gross pay</dt><dd><Money cents={totals.grossCents} /></dd></div>
        <div><dt>Net pay</dt><dd><Money cents={totals.netCents} /></dd></div>
        <div><dt>Owed to the CRA</dt><dd><Money cents={owed} /></dd></div>
      </dl>
      {difference !== 0 && totals.grossCents > 0 && (
        <InspectorNote tone="warn" title="The amounts don't add up">
          Gross pay less the deductions is <Money cents={totals.netCents + difference} />, but net pay is <Money cents={totals.netCents} />. Check the provider's register before saving.
        </InspectorNote>
      )}
      <Field label="Notes"><textarea className="textarea" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canWrite} /></Field>
      {run?.transactionId && <p className="register-hint">Matched to the net-pay line in the bank feed.</p>}
    </Drawer>
  );
}

/* --------------------------------------------------------------- remittance */

export function RemittanceDrawer({ open, onClose, remittance, canWrite, today }: { open: boolean; onClose: () => void; remittance: RemittanceRow | null; canWrite: boolean; today: string }) {
  const toast = useToast();
  const record = usePermissionedMutation(api.payroll.recordRemittance, canWrite);
  const [form, setForm] = useState({ paid: "", paidOn: "", confirmationNumber: "", notes: "" });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open || !remittance) return;
    setForm({
      paid: centsToInput(remittance.paidCents ?? remittance.amountDueCents),
      paidOn: remittance.paidOn ?? today,
      confirmationNumber: remittance.confirmationNumber ?? "",
      notes: remittance.notes ?? "",
    });
  }, [open, remittance, today]);
  if (!remittance) return null;

  const submit = async (clear = false) => {
    setBusy(true);
    try {
      await record(clear ? { id: remittance._id, clear: true } : {
        id: remittance._id,
        paidCents: inputToCents(form.paid) ?? 0,
        paidOn: form.paidOn,
        confirmationNumber: form.confirmationNumber || undefined,
        notes: form.notes || undefined,
      });
      toast.success(clear ? "Payment cleared" : "Remittance recorded", clear ? undefined : "Its deadline is marked complete.");
      onClose();
    } catch (error) {
      toast.error("Couldn't record the remittance", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={`Remittance for ${remittance.period}`}
      footer={
        <>
          {canWrite && remittance.paidOn && <button className="btn btn--ghost" onClick={() => submit(true)} disabled={busy}>Clear payment</button>}
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>
          {canWrite && <button className="btn btn--accent" onClick={() => submit(false)} disabled={busy}>Record payment</button>}
        </>
      }
    >
      <dl className="register-summary">
        <div><dt>Amount due</dt><dd><Money cents={remittance.amountDueCents} /></dd></div>
        <div><dt>Due</dt><dd>{remittance.dueDate ? formatDate(remittance.dueDate) : "Set the schedule"}</dd></div>
        <div><dt>Status</dt><dd>{REMITTANCE_STATUS_LABEL[remittance.status]}</dd></div>
        <div><dt>Pay runs</dt><dd>{remittance.payRunCount}</dd></div>
      </dl>
      <InspectorNote title="Pay the CRA outside Societyer">
        Make the payment through your bank or CRA My Business Account, then record it here with the confirmation number.
      </InspectorNote>
      <FieldRow>
        <MoneyField label="Amount paid" value={form.paid} onChange={(paid) => setForm({ ...form, paid })} disabled={!canWrite} />
        <Field label="Paid on"><DatePicker value={form.paidOn} onChange={(paidOn) => setForm({ ...form, paidOn })} disabled={!canWrite} /></Field>
      </FieldRow>
      <Field label="Confirmation number"><input className="input" value={form.confirmationNumber} onChange={(event) => setForm({ ...form, confirmationNumber: event.target.value })} disabled={!canWrite} /></Field>
      <Field label="Notes"><textarea className="textarea" rows={2} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} disabled={!canWrite} /></Field>
      {remittance.transactionId && <p className="register-hint">Matched to the CRA payment in the bank feed.</p>}
    </Drawer>
  );
}

/* --------------------------------------------------------------------- slip */

export function SlipDrawer({
  open,
  onClose,
  societyId,
  slip,
  employees,
  canWrite,
  defaultYear,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  slip: SlipRow | null;
  employees: PayrollEmployee[] | null;
  canWrite: boolean;
  defaultYear: number;
}) {
  const toast = useToast();
  const save = usePermissionedMutation(api.payroll.saveSlip, canWrite);
  const remove = usePermissionedMutation(api.payroll.removeSlip, canWrite);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({
      year: String(slip?.year ?? defaultYear),
      slipType: slip?.slipType ?? "T4",
      employeeId: slip?.employeeId ?? "",
      recipientName: slip?.recipientName ?? "",
      income: centsToInput(slip?.employmentIncomeCents),
      cpp: centsToInput(slip?.cppCents),
      ei: centsToInput(slip?.eiCents),
      tax: centsToInput(slip?.incomeTaxCents),
      status: slip?.status ?? "draft",
      issuedOn: slip?.issuedOn ?? "",
      filedOn: slip?.filedOn ?? "",
      confirmationNumber: slip?.confirmationNumber ?? "",
      notes: slip?.notes ?? "",
    });
  }, [open, slip, defaultYear]);

  const year = Number(form.year) || defaultYear;
  const submit = async () => {
    setBusy(true);
    try {
      const employee = (employees ?? []).find((row) => row._id === form.employeeId);
      await save({
        ...(slip ? { id: slip._id } : {}),
        societyId,
        year,
        slipType: form.slipType,
        employeeId: form.employeeId || undefined,
        recipientName: form.recipientName || employee?.name || "",
        employmentIncomeCents: inputToCents(form.income) ?? 0,
        cppCents: inputToCents(form.cpp) ?? 0,
        eiCents: inputToCents(form.ei) ?? 0,
        incomeTaxCents: inputToCents(form.tax) ?? 0,
        status: form.status,
        issuedOn: form.issuedOn || undefined,
        filedOn: form.status === "filed" ? form.filedOn || undefined : undefined,
        confirmationNumber: form.confirmationNumber || undefined,
        notes: form.notes || undefined,
      });
      toast.success(slip ? "Slip saved" : "Slip added");
      onClose();
    } catch (error) {
      toast.error("Couldn't save the slip", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!slip) return;
    setBusy(true);
    try {
      await remove({ id: slip._id });
      toast.success("Slip removed");
      onClose();
    } catch (error) {
      toast.error("Couldn't remove the slip", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={slip ? `${slip.slipType} for ${slip.recipientName}` : "New slip"}
      footer={
        <>
          {slip && canWrite && <button className="btn btn--ghost btn--danger-text" onClick={del} disabled={busy}>Remove</button>}
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>
          {canWrite && <button className="btn btn--accent" onClick={submit} disabled={busy}>Save</button>}
        </>
      }
    >
      <InspectorNote title={`Due ${formatDate(slipFilingDeadline(year))}`}>
        Slips and the summary for {year} are due on the last day of February {year + 1}. File them with your payroll provider or the CRA, then mark them filed here.
      </InspectorNote>
      <FieldRow>
        <Field label="Tax year"><input className="input" inputMode="numeric" value={form.year ?? ""} onChange={(event) => setForm({ ...form, year: event.target.value.replace(/\D/g, "").slice(0, 4) })} disabled={!canWrite} /></Field>
        <Field label="Slip">
          <Select value={form.slipType ?? "T4"} onChange={(slipType) => setForm({ ...form, slipType })} options={SLIP_TYPES.map((value) => ({ value, label: SLIP_TYPE_LABEL[value] }))} disabled={!canWrite} />
        </Field>
      </FieldRow>
      {employees && employees.length > 0 ? (
        <Field label="Employee">
          <Select
            value={form.employeeId ?? ""}
            onChange={(employeeId) => setForm({ ...form, employeeId, recipientName: employees.find((row) => row._id === employeeId)?.name ?? form.recipientName })}
            options={employees.map((employee) => ({ value: employee._id, label: employee.name }))}
            clearable
            clearLabel="Someone else"
            disabled={!canWrite}
          />
        </Field>
      ) : null}
      {!form.employeeId && (
        <Field label="Recipient" required><input className="input" value={form.recipientName ?? ""} onChange={(event) => setForm({ ...form, recipientName: event.target.value })} disabled={!canWrite} /></Field>
      )}
      <div className="register-money-grid">
        <MoneyField label={form.slipType === "T4A" ? "Income" : "Employment income"} value={form.income ?? ""} onChange={(income) => setForm({ ...form, income })} disabled={!canWrite} />
        <MoneyField label="CPP" value={form.cpp ?? ""} onChange={(cpp) => setForm({ ...form, cpp })} disabled={!canWrite} />
        <MoneyField label="EI" value={form.ei ?? ""} onChange={(ei) => setForm({ ...form, ei })} disabled={!canWrite} />
        <MoneyField label="Income tax" value={form.tax ?? ""} onChange={(tax) => setForm({ ...form, tax })} disabled={!canWrite} />
      </div>
      <FieldRow>
        <Field label="Status">
          <Select value={form.status ?? "draft"} onChange={(status) => setForm({ ...form, status })} options={Object.entries(SLIP_STATUS_LABEL).map(([value, label]) => ({ value, label }))} disabled={!canWrite} />
        </Field>
        <Field label="Given to recipient"><DatePicker value={form.issuedOn ?? ""} onChange={(issuedOn) => setForm({ ...form, issuedOn })} disabled={!canWrite} /></Field>
        {form.status === "filed" && <Field label="Filed on"><DatePicker value={form.filedOn ?? ""} onChange={(filedOn) => setForm({ ...form, filedOn })} disabled={!canWrite} /></Field>}
      </FieldRow>
      <Field label="Confirmation number"><input className="input" value={form.confirmationNumber ?? ""} onChange={(event) => setForm({ ...form, confirmationNumber: event.target.value })} disabled={!canWrite} /></Field>
      <Field label="Notes"><textarea className="textarea" rows={2} value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} disabled={!canWrite} /></Field>
    </Drawer>
  );
}

/* --------------------------------------------------------------------- ROE */

export function RoeDrawer({
  open,
  onClose,
  societyId,
  roe,
  employees,
  canWrite,
}: {
  open: boolean;
  onClose: () => void;
  societyId: string;
  roe: RoeRow | null;
  employees: PayrollEmployee[] | null;
  canWrite: boolean;
}) {
  const toast = useToast();
  const save = usePermissionedMutation(api.payroll.saveRoe, canWrite);
  const remove = usePermissionedMutation(api.payroll.removeRoe, canWrite);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({
      employeeId: roe?.employeeId ?? "",
      employeeName: roe?.employeeName ?? "",
      reasonCode: roe?.reasonCode ?? "E",
      lastDayPaid: roe?.lastDayPaid ?? "",
      dueDate: roe?.dueDate ?? "",
      status: roe?.status ?? "to_issue",
      issuedOn: roe?.issuedOn ?? "",
      serialNumber: roe?.serialNumber ?? "",
      notes: roe?.notes ?? "",
    });
  }, [open, roe]);

  const submit = async () => {
    setBusy(true);
    try {
      await save({
        ...(roe ? { id: roe._id } : {}),
        societyId,
        employeeId: form.employeeId || undefined,
        employeeName: form.employeeId ? undefined : form.employeeName || undefined,
        reasonCode: form.reasonCode,
        lastDayPaid: form.lastDayPaid,
        dueDate: form.dueDate || undefined,
        status: form.status,
        issuedOn: form.status === "issued" ? form.issuedOn || undefined : undefined,
        serialNumber: form.serialNumber || undefined,
        notes: form.notes || undefined,
      });
      toast.success(roe ? "Record of employment saved" : "Record of employment added");
      onClose();
    } catch (error) {
      toast.error("Couldn't save the record of employment", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };
  const del = async () => {
    if (!roe) return;
    setBusy(true);
    try {
      await remove({ id: roe._id });
      toast.success("Record of employment removed");
      onClose();
    } catch (error) {
      toast.error("Couldn't remove it", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title={roe ? `Record of employment: ${roe.employeeName}` : "New record of employment"}
      footer={
        <>
          {roe && canWrite && <button className="btn btn--ghost btn--danger-text" onClick={del} disabled={busy}>Remove</button>}
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>
          {canWrite && <button className="btn btn--accent" onClick={submit} disabled={busy}>Save</button>}
        </>
      }
    >
      <InspectorNote title="Issued through Service Canada">
        Issue the record of employment through ROE Web or your payroll provider. Enter the date it is due so it shows on the Deadlines page.
      </InspectorNote>
      {employees && employees.length > 0 ? (
        <Field label="Employee" required>
          <Select value={form.employeeId ?? ""} onChange={(employeeId) => setForm({ ...form, employeeId })} options={employees.map((employee) => ({ value: employee._id, label: employee.name }))} clearable clearLabel="Someone not listed" disabled={!canWrite} />
        </Field>
      ) : null}
      {!form.employeeId && <Field label="Employee name" required><input className="input" value={form.employeeName ?? ""} onChange={(event) => setForm({ ...form, employeeName: event.target.value })} disabled={!canWrite} /></Field>}
      <Field label="Reason">
        <Select value={form.reasonCode ?? "E"} onChange={(reasonCode) => setForm({ ...form, reasonCode })} options={ROE_REASONS.map((reason) => ({ value: reason.value, label: reason.label }))} disabled={!canWrite} />
      </Field>
      <FieldRow>
        <Field label="Last day paid" required><DatePicker value={form.lastDayPaid ?? ""} onChange={(lastDayPaid) => setForm({ ...form, lastDayPaid })} disabled={!canWrite} /></Field>
        <Field label="Due" hint="Goes on the Deadlines page."><DatePicker value={form.dueDate ?? ""} onChange={(dueDate) => setForm({ ...form, dueDate })} disabled={!canWrite} /></Field>
      </FieldRow>
      <FieldRow>
        <Field label="Status">
          <Select value={form.status ?? "to_issue"} onChange={(status) => setForm({ ...form, status })} options={Object.entries(ROE_STATUS_LABEL).map(([value, label]) => ({ value, label }))} disabled={!canWrite} />
        </Field>
        {form.status === "issued" && <Field label="Issued on" required><DatePicker value={form.issuedOn ?? ""} onChange={(issuedOn) => setForm({ ...form, issuedOn })} disabled={!canWrite} /></Field>}
      </FieldRow>
      <Field label="Serial number"><input className="input" value={form.serialNumber ?? ""} onChange={(event) => setForm({ ...form, serialNumber: event.target.value })} disabled={!canWrite} /></Field>
      <Field label="Notes"><textarea className="textarea" rows={2} value={form.notes ?? ""} onChange={(event) => setForm({ ...form, notes: event.target.value })} disabled={!canWrite} /></Field>
    </Drawer>
  );
}

/* ----------------------------------------------------------------- settings */

export function PayrollSettingsDrawer({ open, onClose, societyId, settings, canWrite }: { open: boolean; onClose: () => void; societyId: string; settings: PayrollSettings; canWrite: boolean }) {
  const toast = useToast();
  const save = usePermissionedMutation(api.payroll.saveSettings, canWrite);
  const [form, setForm] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setForm({
      remitterType: settings.remitterType ?? "regular",
      cadence: settings.cadence ?? "monthly",
      dueRule: settings.dueRule ?? "day_of_next_month",
      dueValue: settings.dueValue ? String(settings.dueValue) : "",
      payrollAccountNumber: settings.payrollAccountNumber ?? "",
      providerName: settings.providerName ?? "",
      workersCompProvider: settings.workersCompProvider ?? "",
      workersCompAccount: settings.workersCompAccount ?? "",
      workersCompCadence: settings.workersCompCadence ?? "",
      workersCompFirstDueDate: settings.workersCompFirstDueDate ?? "",
    });
  }, [open, settings]);
  const regular = form.remitterType === "regular";
  const submit = async () => {
    setBusy(true);
    try {
      await save({
        societyId,
        remitterType: form.remitterType,
        cadence: regular ? undefined : form.cadence,
        dueRule: regular ? undefined : form.dueRule,
        dueValue: regular ? undefined : Number(form.dueValue),
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
          {canWrite && <button className="btn btn--accent" onClick={submit} disabled={busy}>Save</button>}
        </>
      }
    >
      <section className="register-section">
        <h3 className="register-section__title">CRA remittances</h3>
        <Field label="Remitter type">
          <Select value={form.remitterType ?? "regular"} onChange={(remitterType) => setForm({ ...form, remitterType })} options={REMITTER_TYPES.map((value) => ({ value, label: REMITTER_TYPE_LABEL[value] }))} disabled={!canWrite} />
        </Field>
        {regular ? (
          <p className="register-hint">Deductions are due on the 15th of the month after the employees are paid.</p>
        ) : (
          <>
            <InspectorNote tone="warn" title="Use the schedule on your CRA notice">
              Quarterly and accelerated remitters have their own periods and due dates. Enter them as the CRA gave them to you; Societyer doesn't work them out.
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

/* ------------------------------------------------------------------ import */

const SAMPLE_CSV = [
  "Period start,Period end,Pay date,Employee,Gross,CPP,EI,Income tax,Net",
  "2026-01-01,2026-01-15,2026-01-15,Sample Employee,2500.00,141.80,40.75,312.40,2005.05",
].join("\n");

export function PayrollImportDrawer({ open, onClose, societyId, canWrite, defaultProvider }: { open: boolean; onClose: () => void; societyId: string; canWrite: boolean; defaultProvider?: string }) {
  const toast = useToast();
  const importRuns = usePermissionedMutation(api.payroll.importPayRuns, canWrite);
  const [result, setResult] = useState<PayrollCsvResult | null>(null);
  const [fileName, setFileName] = useState("");
  const [provider, setProvider] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    setResult(null);
    setFileName("");
    setProvider(defaultProvider ?? "");
  }, [open, defaultProvider]);

  const read = async (file: File | undefined) => {
    if (!file) return;
    setFileName(file.name);
    setResult(parsePayrollCsv(await file.text()));
  };
  const sampleHref = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`, []);
  const submit = async () => {
    if (!result?.runs.length) return;
    setBusy(true);
    try {
      const outcome = await importRuns({
        societyId,
        providerName: provider || undefined,
        runs: result.runs.map((run) => ({
          periodStart: run.periodStart,
          periodEnd: run.periodEnd,
          payDate: run.payDate,
          grossCents: run.grossCents,
          cppEmployeeCents: run.cppEmployeeCents,
          eiEmployeeCents: run.eiEmployeeCents,
          incomeTaxCents: run.incomeTaxCents,
          otherDeductionsCents: run.otherDeductionsCents,
          cppEmployerCents: run.cppEmployerCents,
          eiEmployerCents: run.eiEmployerCents,
          netCents: run.netCents,
          lines: run.lines.length
            ? run.lines.map((line) => ({
                employeeName: line.employeeName,
                grossCents: line.grossCents,
                cppEmployeeCents: line.cppEmployeeCents,
                eiEmployeeCents: line.eiEmployeeCents,
                incomeTaxCents: line.incomeTaxCents,
                otherDeductionsCents: line.otherDeductionsCents,
                cppEmployerCents: line.cppEmployerCents,
                eiEmployerCents: line.eiEmployerCents,
                netCents: line.netCents,
              }))
            : undefined,
        })),
      });
      toast.success(`Imported ${pluralize(outcome.created, "pay run")}`, outcome.skipped ? `${pluralize(outcome.skipped, "run")} already recorded were skipped.` : undefined);
      onClose();
    } catch (error) {
      toast.error("Couldn't import the pay runs", errorMessage(error));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Drawer
      open={open}
      onClose={onClose}
      title="Import pay runs"
      footer={
        <>
          <span className="register-drawer__spacer" />
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn btn--accent" onClick={submit} disabled={busy || !canWrite || !result?.runs.length}>
            {result?.runs.length ? `Import ${pluralize(result.runs.length, "pay run")}` : "Import"}
          </button>
        </>
      }
    >
      <p className="register-hint">
        Export the payroll register from your provider as CSV: one row per employee per pay run, or one row per run. We read the pay
        date, period, employee, gross, CPP, EI, income tax, other deductions, employer CPP and EI, and net pay. Dates must be YYYY-MM-DD.
        Runs already recorded for the same period and pay date are skipped. <a href={sampleHref} download="payroll-sample.csv">Download a sample file</a>.
      </p>
      <label className="register-file">
        <FileUp size={16} aria-hidden="true" />
        <span>{fileName || "Choose a CSV file"}</span>
        <input type="file" accept=".csv,text/csv" onChange={(event) => void read(event.target.files?.[0])} disabled={!canWrite} />
      </label>
      <Field label="Payroll provider"><input className="input" value={provider} onChange={(event) => setProvider(event.target.value)} /></Field>
      {result && result.errors.length > 0 && (
        <InspectorNote tone="warn" title={`${pluralize(result.errors.length, "row")} couldn't be read`}>
          <ul className="register-errors">
            {result.errors.slice(0, 6).map((error) => <li key={error}>{error}</li>)}
          </ul>
        </InspectorNote>
      )}
      {result && result.runs.length > 0 && (
        <div className="register-lines" role="table" aria-label="Pay runs in the file">
          <div className="register-lines__row register-lines__row--head" role="row">
            <span role="columnheader">Pay date</span>
            <span role="columnheader" className="num">Gross</span>
            <span role="columnheader" className="num">Net</span>
            <span role="columnheader" className="num">Employees</span>
          </div>
          {result.runs.slice(0, 24).map((run) => (
            <div className="register-lines__row" role="row" key={`${run.periodStart}-${run.payDate}`}>
              <span role="cell">{formatDate(run.payDate)}</span>
              <span role="cell" className="num"><Money cents={run.grossCents} /></span>
              <span role="cell" className="num"><Money cents={run.netCents} /></span>
              <span role="cell" className="num">{run.lines.length || "—"}</span>
            </div>
          ))}
        </div>
      )}
      <p className="register-hint">Names are matched to the <Link to="/app/employees">Employees</Link> page so slips can be prepared from the runs.</p>
    </Drawer>
  );
}

