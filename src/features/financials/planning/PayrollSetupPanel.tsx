import { useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { CheckCircle2, Circle, Settings2, Users, Wallet } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "../../../hooks/usePermissions";
import { REMITTER_TYPE_LABEL, type RemitterType } from "../../../../shared/businessRegisters";
import { formatDate } from "../../../lib/format";

export type PayrollPlanningReadiness = {
  settingsSaved: boolean; providerName?: string; hasPayrollAccount: boolean;
  remitterType?: string; scheduleComplete: boolean;
  workersCompProvider?: string; hasWorkersCompAccount: boolean;
  workersCompCadence?: string; workersCompFirstDueDate?: string;
};
type PlanningReadinessWorkspace = { payrollReadiness: PayrollPlanningReadiness | null };
type EmployeeReadinessPage = { page: Array<{ _id: string; name: string; status?: string }>; isDone: boolean };

/** Safe planning readiness only. Actual pay runs and employee private fields are never queried here. */
export function PayrollSetupPanel({ societyId, onOpenSettings }: { societyId: string; onOpenSettings?: () => void }) {
  const permissions = usePermissions();
  const canReadFinance = permissions.loaded && permissions.can("financials:read");
  const canReadEmployees = permissions.loaded && permissions.can("employees:read");
  const workspace = useQuery(api.costPlanning.workspace, canReadFinance ? { societyId } : "skip") as PlanningReadinessWorkspace | undefined;
  const employees = useQuery(api.costPlanning.sourcePage, canReadFinance && canReadEmployees ? { societyId, collection: "employees", cursor: null } : "skip") as EmployeeReadinessPage | undefined;
  if (!permissions.loaded) return <p className="muted" role="status">Loading payroll setup access…</p>;
  if (!canReadFinance) return null;
  const readiness = workspace?.payrollReadiness;
  const providerReady = Boolean(readiness?.providerName);
  const remittanceReady = Boolean(readiness?.settingsSaved && readiness.hasPayrollAccount && readiness.scheduleComplete);
  const workersCompReady = Boolean(readiness?.workersCompProvider && readiness.hasWorkersCompAccount && readiness.workersCompCadence && readiness.workersCompFirstDueDate);
  const mark = (ready: boolean) => ready ? <CheckCircle2 size={16} aria-hidden="true" /> : <Circle size={16} aria-hidden="true" />;
  const settingsAction = onOpenSettings
    ? <button type="button" className="btn btn--sm" onClick={onOpenSettings}><Settings2 size={14} aria-hidden="true" />Review payroll settings</button>
    : <Link className="btn btn--sm" to="/app/payroll?setup=1"><Settings2 size={14} aria-hidden="true" />Review payroll settings</Link>;
  return <section className="card" aria-labelledby="planning-payroll-setup">
    <div className="card__head"><div><h2 className="card__title" id="planning-payroll-setup"><Wallet size={16} aria-hidden="true" /> Payroll setup</h2><p className="card__subtitle">Keep staff forecasts connected to your employment records and actual payroll process.</p></div>{settingsAction}</div>
    <div className="card__body form-stack">
      {!workspace ? <p className="muted" role="status">Loading payroll setup…</p> : readiness == null ? <p className="muted">Employee read permission is required to view payroll setup details. You can still plan manual or vacant positions using reviewed cost assumptions.</p> : <>
        <div className="register-field-row">
          <div>{mark(Boolean(employees?.page.length))}<h3>Employee records</h3><p>{employees ? employees.page.length ? "Staff records available" : employees.isDone ? "No employee records yet" : "More employee records are available" : "Loading employee choices…"}</p><p className="muted">{employees?.page.length ? `${employees.page.length} records on the first page${employees.isDone ? "." : "; the staff picker can load more."} Link a staff cost to reuse employment dates, or keep a vacant position manual.` : "Add current staff records when they are ready. Vacant positions can be planned without creating an employee."}</p></div>
          <div>{mark(providerReady)}<h3>Payroll provider</h3><p>{readiness.providerName || "Provider not recorded"}</p><p className="muted">Record the provider or service used to prepare actual pay runs. Enter or import the resulting gross pay and deductions on Payroll.</p></div>
        </div>
        <div className="register-field-row">
          <div>{mark(remittanceReady)}<h3>CRA remittances</h3><p>{remittanceReady ? `${REMITTER_TYPE_LABEL[readiness.remitterType as RemitterType] ?? readiness.remitterType ?? "Remittance"} schedule recorded` : "Review account and remittance schedule"}</p><p className="muted">{readiness.hasPayrollAccount ? "Payroll account recorded. " : "Add the CRA payroll program account. "}{readiness.settingsSaved && readiness.scheduleComplete ? "Confirm the remitter type and dates against the CRA notice." : "Save the remitter type and dates from the CRA notice so actual remittance deadlines can be tracked."}</p></div>
          <div>{mark(workersCompReady)}<h3>Workers’ compensation</h3><p>{workersCompReady ? `${readiness.workersCompProvider} reporting recorded` : readiness.workersCompProvider ? `${readiness.workersCompProvider}: complete reporting details` : "Review coverage and reporting"}</p><p className="muted">{workersCompReady ? `Next reporting date: ${formatDate(readiness.workersCompFirstDueDate!)}. Review whether premiums are included in your employer cost assumptions.` : "When coverage applies, record the board, account and reporting dates in payroll settings. Include the reviewed employer cost in your forecast."}</p></div>
        </div>
      </>}
      <p className="muted">Staff cost assumptions do not update employee compensation or create pay runs, remittances or payments. Review actual payroll results against the forecast separately.</p>
      <div className="btn-row">{canReadEmployees && <Link className="btn btn--sm" to="/app/employees"><Users size={14} aria-hidden="true" />Employee records</Link>}<Link className="btn btn--sm" to="/app/payroll">Payroll records</Link></div>
    </div>
  </section>;
}
