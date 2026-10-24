import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { FileUp } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissionedMutation } from "../../hooks/usePermissionedMutation";
import { Drawer, Field, InspectorNote } from "../../components/ui";
import { Select } from "../../components/Select";
import { Checkbox } from "../../components/Controls";
import { Money } from "../../components/Money";
import { useToast } from "../../components/Toast";
import { formatDate, pluralize } from "../../lib/format";
import { parsePayrollCsv, PAYROLL_CSV_FIELD_LABELS, type PayrollCsvField, type PayrollCsvResult } from "../../../shared/businessRegisters";

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message.replace(/^.*Uncaught Error:\s*/, "").split("\n")[0] : "Something went wrong.";
}

const SAMPLE_CSV = [
  "Period start,Period end,Pay date,Employee,Employee ID,Provider run ID,Run type,Gross,Non cash taxable,Non taxable cash,CPP,CPP2,EI,Federal tax,Provincial tax,Other deductions,Employer CPP,Employer CPP2,Employer EI,Net",
  "2026-01-01,2026-01-15,2026-01-15,Sample Employee,EMP-001,RUN-2026-01,regular,2500.00,0,0,141.80,0,40.75,200.00,112.40,0,141.80,0,57.05,2005.05",
].join("\n");

export function PayrollImportDrawer({ open, onClose, societyId, canWrite, defaultProvider }: { open: boolean; onClose: () => void; societyId: string; canWrite: boolean; defaultProvider?: string }) {
  const toast = useToast(), importRuns = usePermissionedMutation(api.payroll.importPayRuns, canWrite);
  const [text, setText] = useState(""), [fileName, setFileName] = useState(""), [provider, setProvider] = useState(""), [busy, setBusy] = useState(false);
  const [mapping, setMapping] = useState<Partial<Record<PayrollCsvField, number | null>>>({});
  const [confirmZero, setConfirmZero] = useState(false), [standardShares, setStandardShares] = useState(false);
  const result = useMemo<PayrollCsvResult | null>(() => text ? parsePayrollCsv(text, { mapping, providerName: provider, confirmMissingAsZero: confirmZero, standardEmployerShares: standardShares }) : null, [text, mapping, provider, confirmZero, standardShares]);
  useEffect(() => { if (!open) return; setText(""); setFileName(""); setProvider(defaultProvider || ""); setMapping({}); setConfirmZero(false); setStandardShares(false); }, [open, defaultProvider]);
  const read = async (file?: File) => {
    if (!file) return;
    try { if (file.size > 2_000_000) throw new Error("Choose a payroll CSV smaller than 2 MB."); setText(await file.text()); setFileName(file.name); setMapping({}); setConfirmZero(false); }
    catch (error) { toast.error("Couldn't read the payroll CSV", errorMessage(error)); }
  };
  const sampleHref = useMemo(() => `data:text/csv;charset=utf-8,${encodeURIComponent(SAMPLE_CSV)}`, []);
  const submit = async () => {
    if (!result?.runs.length || result.errors.length || result.requiresReview || !canWrite) return;
    setBusy(true);
    try {
      const outcome = await importRuns({ societyId, providerName: provider || undefined, runs: result.runs.map((run) => ({ ...run, lines: run.lines.length ? run.lines : undefined })) });
      toast.success(`Imported ${pluralize(outcome.created, "pay run")}`, outcome.skipped ? `${pluralize(outcome.skipped, "identical run")} already recorded were skipped.` : undefined); onClose();
    } catch (error) { toast.error("Couldn't import the pay runs", errorMessage(error)); } finally { setBusy(false); }
  };
  return <Drawer open={open} onClose={onClose} title="Import pay runs" size="wide" footer={<><span className="register-drawer__spacer" /><button className="btn" onClick={onClose}>Cancel</button><button className="btn btn--accent" onClick={submit} disabled={busy || !canWrite || !result?.runs.length || !!result.errors.length || result.requiresReview}>{result?.runs.length ? `Import ${pluralize(result.runs.length, "pay run")}` : "Import"}</button></>}>
    <p className="register-hint">Import one row per employee per provider run. Combined income tax and separate federal/provincial tax have distinct mappings. Missing amounts stay unknown until you map them or explicitly confirm zeroes. Provider/run IDs distinguish bonuses and corrections on the same pay date. <a href={sampleHref} download="payroll-sample.csv">Download a sample file</a>.</p>
    <label className="register-file"><FileUp size={16} aria-hidden="true" /><span>{fileName || "Choose a CSV file"}</span><input type="file" accept=".csv,text/csv" onChange={(event) => void read(event.target.files?.[0])} disabled={!canWrite} /></label>
    <Field label="Payroll provider"><input className="input" value={provider} onChange={(event) => setProvider(event.target.value)} disabled={!canWrite} /></Field>
    {result && <>
      <h3>Column mapping</h3><p className="register-hint">Tax mapping: {result.taxMode === 'split' ? 'federal + provincial + any separately mapped additional tax' : result.taxMode === 'combined' ? 'combined income tax; split values are retained when supplied' : 'missing — map the tax columns or confirm zero'}. Known zeroes are retained as zero; blank cells are listed below.</p>
      <div className="register-money-grid">{result.mapping.map((entry) => <Field key={entry.field} label={PAYROLL_CSV_FIELD_LABELS[entry.field]}><Select value={entry.column === null ? '' : String(entry.column)} onChange={(value) => { setMapping((previous) => ({ ...previous, [entry.field]: value === '' ? null : Number(value) })); setConfirmZero(false); }} options={result.headers.map((header, index) => ({ value: String(index), label: `${index + 1}. ${header}` }))} clearable clearLabel="Not mapped" disabled={!canWrite} /></Field>)}</div>
      <Checkbox checked={standardShares} onChange={(value) => { setStandardShares(value); setConfirmZero(false); }} label="Use standard employer shares where missing" hint="Matching CPP/CPP2 and 1.4× EI. Do not select this for approved reduced employer EI rates." disabled={!canWrite} />
      {result.missingCells.length > 0 && <InspectorNote tone="warn" title="Missing values are not confirmed zeroes"><ul>{result.missingCells.slice(0, 12).map((entry, index) => <li key={index}>Row {entry.row}: {PAYROLL_CSV_FIELD_LABELS[entry.field as PayrollCsvField] || entry.field} is missing.</li>)}</ul>{result.missingCells.length > 12 && <p>{result.missingCells.length - 12} additional missing cells.</p>}<Checkbox checked={confirmZero} onChange={setConfirmZero} label="I verified that all remaining missing amounts are zero" hint="This confirmation is retained with the imported run." disabled={!canWrite} /></InspectorNote>}
      {result.errors.length > 0 && <InspectorNote tone="warn" title="Correct the file before importing"><ul className="register-errors">{result.errors.slice(0, 8).map((error, index) => <li key={index}>{error}</li>)}</ul></InspectorNote>}
      {result.warnings.map((warning, index) => <p className="register-hint" key={index}>{warning}</p>)}
      {result.runs.length > 0 && <div className="register-lines" role="table" aria-label="Pay runs in the file"><div className="register-lines__row register-lines__row--head" role="row"><span role="columnheader">Pay date / run</span><span role="columnheader" className="num">Taxable gross</span><span role="columnheader" className="num">Income tax incl. provincial</span><span role="columnheader" className="num">Net cash</span></div>{result.runs.slice(0, 24).map((run, index) => <div className="register-lines__row" role="row" key={index}><span role="cell">{formatDate(run.payDate)} · {run.providerRunId || 'regular'} · {run.runType}</span><span role="cell" className="num"><Money cents={run.grossCents} /></span><span role="cell" className="num"><Money cents={run.incomeTaxCents} /></span><span role="cell" className="num"><Money cents={run.netCents} /></span></div>)}</div>}
    </>}
    <p className="register-hint">Stable provider employee IDs match the <Link to="/app/employees">Employees</Link> register. Name-only matching is used only when unambiguous. Unmatched provider IDs remain separate until linked.</p>
  </Drawer>;
}
