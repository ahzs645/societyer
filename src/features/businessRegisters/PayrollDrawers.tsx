import { useEffect, useMemo, useState } from "react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field, InspectorNote } from "../../components/ui";
import { Select } from "../../components/Select";
import { DatePicker } from "../../components/DatePicker";
import { Checkbox } from "../../components/Controls";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate } from "../../lib/format";
import {
  PAY_RUN_TYPES,
  PAY_RUN_AMOUNT_FIELDS,
  sumPayRunLines,
  type PayRunLine,
  ROE_REASONS,
  ROE_STATUS_LABEL,
  SLIP_STATUS_LABEL,
  SLIP_TYPES,
  SLIP_TYPE_LABEL,
  REMITTANCE_STATUS_LABEL,
  monthEnd,
  monthStart,
  payRunDifferenceCents,
  remittableCents,
  slipFilingDeadline,
} from "../../../shared/businessRegisters";
import { centsToInput, FieldRow, inputToCents, MoneyField } from "./formHelpers";
import type { PayRunRow, PayrollEmployee, RemittanceRow, RoeRow, SlipRow } from "./types";

const AMOUNT_FIELDS = [
  ["grossCents", "Taxable gross pay"],
  ["nonCashTaxableCents", "Non-cash taxable benefits"],
  ["nonTaxableCashCents", "Non-taxable cash / reimbursements"],
  ["cppEmployeeCents", "CPP withheld"],
  ["cpp2EmployeeCents", "CPP2 withheld"],
  ["eiEmployeeCents", "EI withheld"],
  ["incomeTaxCents", "Combined income tax withheld"],
  ["federalTaxCents", "Federal tax (if known)"],
  ["provincialTaxCents", "Provincial tax (if known)"],
  ["additionalIncomeTaxCents", "Additional TD1 tax (if known)"],
  ["otherDeductionsCents", "Other deductions"],
  ["netCents", "Net pay"],
  ["cppEmployerCents", "Employer CPP"],
  ["cpp2EmployerCents", "Employer CPP2"],
  ["eiEmployerCents", "Employer EI"],
] as const;

type AmountKey = (typeof AMOUNT_FIELDS)[number][0];
type LineDraft = { employeeId?: string; providerEmployeeId?: string; employeeName: string; amounts: Record<AmountKey, string>; persisted?: boolean };

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/, "").split("\n")[0] : "Something went wrong.";
}

/* ------------------------------------------------------------------ pay run */

export function PayRunDrawer({ open, onClose, societyId, run, employees, canWrite, today }: {
  open: boolean; onClose: () => void; societyId: string; run: PayRunRow | null; employees: PayrollEmployee[] | null; canWrite: boolean; today: string;
}) {
  const toast = useToast(), save = usePermissionedMutation(api.payroll.savePayRun, canWrite), remove = usePermissionedMutation(api.payroll.removePayRun, canWrite);
  const [period, setPeriod] = useState({ periodStart: "", periodEnd: "", payDate: "" });
  const [amounts, setAmounts] = useState<Record<AmountKey, string>>({} as Record<AmountKey, string>);
  const [byEmployee, setByEmployee] = useState(false), [lines, setLines] = useState<LineDraft[]>([]), [notes, setNotes] = useState(""), [busy, setBusy] = useState(false);
  const [identity, setIdentity] = useState({ providerName: "", providerRunId: "", runType: "regular", correctsRunId: "", correctionOfProviderRunId: "" });
  const activeEmployees = useMemo(() => (employees || []).filter((employee) => employee.active), [employees]);
  const frozen = !!run?.calculationId, editable = canWrite && !frozen;
  const draftAmounts = (value?: Record<string, unknown>) => Object.fromEntries(AMOUNT_FIELDS.map(([key]) => [key, value ? ["federalTaxCents", "provincialTaxCents", "additionalIncomeTaxCents"].includes(key) && value[key] === undefined ? "" : centsToInput(Number(value[key] || 0)) : ""])) as Record<AmountKey, string>;
  useEffect(() => {
    if (!open) return;
    const start = today.slice(8) > "15" ? `${today.slice(0, 7)}-16` : monthStart(today);
    setPeriod(run ? { periodStart: run.periodStart, periodEnd: run.periodEnd, payDate: run.payDate } : { periodStart: start, periodEnd: start.endsWith("-16") ? monthEnd(today) : `${today.slice(0, 7)}-15`, payDate: today });
    setAmounts(draftAmounts(run as unknown as Record<string, unknown>));
    setByEmployee(run ? run.lines.length > 0 : activeEmployees.length > 0);
    setLines(run ? run.lines.map((line) => ({ employeeId: line.employeeId, providerEmployeeId: line.providerEmployeeId, employeeName: line.employeeName, persisted: true, amounts: draftAmounts(line as unknown as Record<string, unknown>) })) : activeEmployees.map((employee) => ({ employeeId: employee._id, providerEmployeeId: employee.providerEmployeeId || employee.employeeNumber, employeeName: employee.name, amounts: draftAmounts() })));
    setNotes(run?.notes || "");
    setIdentity({ providerName: run?.providerName || "", providerRunId: run?.providerRunId || "", runType: run?.runType || "regular", correctsRunId: run?.correctsRunId || "", correctionOfProviderRunId: run?.correctionOfProviderRunId || "" });
  }, [open, run, today, activeEmployees]);
  const lineTotals = useMemo(() => {
    const parsed = lines.map((line) => ({ employeeId: line.employeeId, providerEmployeeId: line.providerEmployeeId, employeeName: line.employeeName, ...Object.fromEntries(AMOUNT_FIELDS.filter(([key]) => !["federalTaxCents", "provincialTaxCents", "additionalIncomeTaxCents"].includes(key) || line.amounts[key]?.trim()).map(([key]) => [key, inputToCents(line.amounts[key]) || 0])) } as PayRunLine)).filter((line, index) => lines[index].persisted || PAY_RUN_AMOUNT_FIELDS.some((field) => Number(line[field]) !== 0));
    return { ...sumPayRunLines(parsed), lines: parsed };
  }, [lines]);
  const totals = byEmployee ? lineTotals : Object.fromEntries(AMOUNT_FIELDS.filter(([key]) => !["federalTaxCents", "provincialTaxCents", "additionalIncomeTaxCents"].includes(key) || amounts[key]?.trim()).map(([key]) => [key, inputToCents(amounts[key]) || 0])) as Record<AmountKey, number>;
  const updateLine = (index: number, patch: Partial<LineDraft>) => setLines((previous) => previous.map((line, i) => i === index ? { ...line, ...patch } : line));
  const estimateStandard = (index: number) => {
    const line = lines[index], cpp = inputToCents(line.amounts.cppEmployeeCents) || 0, cpp2 = inputToCents(line.amounts.cpp2EmployeeCents) || 0, ei = inputToCents(line.amounts.eiEmployeeCents) || 0;
    const net = (inputToCents(line.amounts.grossCents) || 0) - (inputToCents(line.amounts.nonCashTaxableCents) || 0) + (inputToCents(line.amounts.nonTaxableCashCents) || 0) - cpp - cpp2 - ei - (inputToCents(line.amounts.incomeTaxCents) || 0) - (inputToCents(line.amounts.otherDeductionsCents) || 0);
    updateLine(index, { amounts: { ...line.amounts, cppEmployerCents: centsToInput(cpp), cpp2EmployerCents: centsToInput(cpp2), eiEmployerCents: centsToInput(Math.round(ei * 1.4)), netCents: centsToInput(net) } });
  };
  const submit = async () => {
    if (!canWrite) return;
    setBusy(true);
    try {
      const drafts = byEmployee ? lines.map((line) => line.amounts) : [amounts];
      if (!frozen && drafts.some((draft) => AMOUNT_FIELDS.some(([key]) => draft[key]?.trim() && inputToCents(draft[key]) === undefined))) throw new Error("Enter valid monetary amounts before saving.");
      await save({ ...(run ? { id: run._id } : {}), societyId, ...period,
        ...(!frozen ? { ...identity, ...(byEmployee ? { lines: lineTotals.lines } : { ...totals, ...(run?.lines.length ? { clearLines: true } : {}) }) } : {}), notes: notes || undefined });
      toast.success(run ? "Pay run saved" : "Pay run added", "Employee detail, remittances and deadlines are up to date."); onClose();
    } catch (error) { toast.error("Couldn't save the pay run", errorMessage(error)); } finally { setBusy(false); }
  };
  const del = async () => {
    if (!run || !editable) return;
    setBusy(true);
    try { await remove({ id: run._id }); toast.success("Pay run removed"); onClose(); } catch (error) { toast.error("Couldn't remove the pay run", errorMessage(error)); } finally { setBusy(false); }
  };
  return <Drawer open={open} onClose={onClose} title={run ? "Pay run" : "New pay run"} size="wide" footer={<>
    {run && editable && <button className="btn btn--ghost btn--danger-text" onClick={del} disabled={busy}>Remove</button>}<span className="register-drawer__spacer" /><button className="btn" onClick={onClose}>{canWrite ? "Cancel" : "Close"}</button>{canWrite && <button className="btn btn--accent" onClick={submit} disabled={busy}>Save</button>}
  </>}>
    <InspectorNote title={frozen ? "Finalized calculation" : "Payroll register"}>{frozen ? "Financial fields are frozen. Notes can be updated; corrections use a new calculation linked to this run." : "Record manual or provider payroll here. Employee detail is preserved on later edits. Use payroll calculations for native calculated earnings and deductions."}</InspectorNote>
    <FieldRow>{([['periodStart', 'Period start'], ['periodEnd', 'Period end'], ['payDate', 'Pay date']] as const).map(([key, label]) => <Field key={key} label={label} required><DatePicker value={period[key]} onChange={(value) => setPeriod({ ...period, [key]: value })} disabled={!editable} /></Field>)}</FieldRow>
    <FieldRow><Field label="Payroll provider"><input className="input" value={identity.providerName} onChange={(event) => setIdentity({ ...identity, providerName: event.target.value })} disabled={!editable} /></Field><Field label="Provider run ID"><input className="input" value={identity.providerRunId} onChange={(event) => setIdentity({ ...identity, providerRunId: event.target.value })} disabled={!editable} /></Field><Field label="Run type"><Select value={identity.runType} onChange={(runType) => setIdentity({ ...identity, runType })} options={PAY_RUN_TYPES.map((value) => ({ value, label: value.replace(/_/g, ' ') }))} disabled={!editable} /></Field></FieldRow>
    {['correction', 'reversal'].includes(identity.runType) && <FieldRow><Field label="Original pay run ID"><input className="input" value={identity.correctsRunId} onChange={(event) => setIdentity({ ...identity, correctsRunId: event.target.value })} disabled={!editable} /></Field><Field label="Or original provider run ID"><input className="input" value={identity.correctionOfProviderRunId} onChange={(event) => setIdentity({ ...identity, correctionOfProviderRunId: event.target.value })} disabled={!editable} /></Field></FieldRow>}
    <Checkbox checked={byEmployee} onChange={(value) => { if (!value) setAmounts(draftAmounts(lineTotals)); setByEmployee(value); }} label={run?.lines.length ? "Keep employee detail (turn off to replace it with aggregate totals)" : "Enter amounts by employee"} disabled={!editable} />
    {byEmployee ? <section className="register-section"><h3 className="register-section__title">By employee</h3>{lines.map((line, index) => <fieldset className="register-employee" key={`${index}-${line.employeeId || line.providerEmployeeId || 'manual'}`}><legend>{line.employeeName || `Employee ${index + 1}`}</legend>
      <FieldRow>{employees?.length ? <Field label="Linked employee"><Select value={line.employeeId || ''} onChange={(employeeId) => updateLine(index, { employeeId: employeeId || undefined, employeeName: employees.find((employee) => employee._id === employeeId)?.name || line.employeeName })} options={employees.map((employee) => ({ value: employee._id, label: employee.name }))} clearable clearLabel="Unlinked provider employee" disabled={!editable} /></Field> : null}<Field label="Employee name"><input className="input" value={line.employeeName} onChange={(event) => updateLine(index, { employeeName: event.target.value })} disabled={!editable} /></Field><Field label="Provider employee ID"><input className="input" value={line.providerEmployeeId || ''} onChange={(event) => updateLine(index, { providerEmployeeId: event.target.value || undefined })} disabled={!editable} /></Field></FieldRow>
      <div className="register-money-grid">{AMOUNT_FIELDS.map(([key, label]) => <MoneyField key={key} label={label} value={line.amounts[key] || ''} onChange={(value) => updateLine(index, { amounts: { ...line.amounts, [key]: value } })} disabled={!editable} />)}</div>
      {editable && <button className="btn btn--sm" onClick={() => estimateStandard(index)}>Fill standard employer shares and net</button>}
      {editable && lines.length > 1 && <button className="btn btn--sm btn--ghost btn--danger-text" onClick={() => setLines((previous) => previous.filter((_, i) => i !== index))}>Remove employee line</button>}
    </fieldset>)}{editable && <button className="btn btn--sm" onClick={() => setLines([...lines, { employeeName: '', amounts: draftAmounts() }])}>Add employee line</button>}<p className="register-hint">Standard shares fill matching CPP/CPP2 and 1.4× EI only when selected. Keep actual provider amounts, including any approved reduced EI multiplier.</p></section>
      : <section className="register-section"><h3 className="register-section__title">Run totals</h3><div className="register-money-grid">{AMOUNT_FIELDS.map(([key, label]) => <MoneyField key={key} label={label} value={amounts[key] || ''} onChange={(value) => setAmounts({ ...amounts, [key]: value })} disabled={!editable} />)}</div></section>}
    <dl className="register-summary"><div><dt>Taxable gross</dt><dd><Money cents={totals.grossCents} /></dd></div><div><dt>Net cash pay</dt><dd><Money cents={totals.netCents} /></dd></div><div><dt>Owed to the CRA, including CPP2</dt><dd><Money cents={remittableCents(totals)} /></dd></div></dl>
    {payRunDifferenceCents(totals) !== 0 && <InspectorNote tone="warn" title="The amounts don't add up">Taxable gross, less non-cash benefits, plus non-taxable cash, less employee deductions differs from the recorded net cash by <Money cents={payRunDifferenceCents(totals)} />.</InspectorNote>}
    {run?.sourceMissingFields?.length ? <p className="register-hint">Import fields explicitly confirmed as zero: {run.sourceMissingFields.join(', ')}.</p> : null}
    <Field label="Notes"><textarea className="textarea" rows={2} value={notes} onChange={(event) => setNotes(event.target.value)} disabled={!canWrite} /></Field>
    {run?.transactionId && <p className="register-hint">Matched to the net-pay line in the bank feed.</p>}
  </Drawer>;
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
      cpp2: centsToInput(slip?.cpp2Cents),
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
        cpp2Cents: inputToCents(form.cpp2) ?? 0,
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
        Slips and the summary for {year} are due at the end of February {year + 1}, adjusted to the next CRA business day. File them with your payroll provider or the CRA, then mark them filed here.
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
        <MoneyField label="CPP (T4 box 16)" value={form.cpp ?? ""} onChange={(cpp) => setForm({ ...form, cpp })} disabled={!canWrite} />
        <MoneyField label="CPP2 (T4 box 16A)" value={form.cpp2 ?? ""} onChange={(cpp2) => setForm({ ...form, cpp2 })} disabled={!canWrite} />
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

export { PayrollSettingsDrawer } from "./PayrollSettingsDrawer";

/* ------------------------------------------------------------------ import */

export { PayrollImportDrawer } from "./PayrollImportDrawer";
