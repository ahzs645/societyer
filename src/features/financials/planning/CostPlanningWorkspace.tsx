import { useCallback, useEffect, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { api } from "@/lib/convexApi";
import { PageHeader } from "../../../pages/_helpers";
import { Drawer } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { Select } from "../../../components/Select";
import { useFinancePermissions } from "../../../hooks/useFinancePermissions";
import { useToast } from "../../../components/Toast";
import { formatDate } from "../../../lib/format";
import { BooksNav } from "../components/BooksNav";
import { ReportPdfDownload } from "../reports/ReportPdfDownload";
import { projectCostPeriod, type CostBasis, type CostPeriod, type PlanningCost, type PlanningStatus, type StaffCostPlan } from "../../../../shared/costPlanning";
import { PlanningPeriodForm } from "./PlanningPeriodForm";
import { PlanningCostForm } from "./PlanningCostForm";
import { StaffCostForm } from "./StaffCostForm";
import { PayrollSetupPanel } from "./PayrollSetupPanel";
import { PlanningCostLists } from "./PlanningCostLists";
import { PlanningImports } from "./PlanningImports";
import { PlanningActualSpending, PlanningOverview, type PlanningActualMeta } from "./PlanningOverview";
import { PlanningQueryBoundary, usePlanningCollection } from "./usePlanningSources";
import { costFields, nextSemester, periodFields, planningError, type Archived, type PlanningActual } from "./planningFormUtils";
import { exportCostPlan, planningReportDocument } from "./planningExports";
import "./cost-planning.scss";

type PeriodRow = Archived<CostPeriod>;
type PlanningWorkspace = { periods: PeriodRow[]; selectedPeriod: PeriodRow | null; isDone: boolean; continueCursor: string; today: string; baseCurrency: string | null; baseCurrencyWarning?: string | null; jurisdiction?: string; organization: { name: string } };
export function CostPlanningWorkspace({ societyId }: { societyId: string }) {
  const [search, setSearch] = useSearchParams(), permissions = useFinancePermissions(), toast = useToast();
  const periodId = search.get("period") || undefined;
  const [archived, setArchived] = useState(false), [periodForm, setPeriodForm] = useState<{ value?: CostPeriod; duplicate?: boolean } | null>(null), [busy, setBusy] = useState(false), [error, setError] = useState("");
  const workspace = useQuery(api.costPlanning.workspace, { societyId, periodId, archived }) as PlanningWorkspace | undefined;
  const archiveMutation = useMutation(api.costPlanning.setArchived);
  const selectPeriod = useCallback((id: string) => setSearch((old) => { const next = new URLSearchParams(old); next.set("period", id); return next; }, { replace: true }), [setSearch]);
  const firstPeriodId = workspace?.periods[0]?._id;
  useEffect(() => { if (!periodId && firstPeriodId) selectPeriod(firstPeriodId); }, [periodId, selectPeriod, firstPeriodId]);
  const period = workspace?.selectedPeriod ?? (!periodId ? workspace?.periods[0] : null);
  const archivePeriod = async () => { if (!period || busy) return; setBusy(true); setError(""); try { await archiveMutation({ societyId, kind: "period", id: period._id, archived: !period.archivedAtISO }); toast.success(period.archivedAtISO ? "Period restored" : "Period archived"); } catch (cause) { setError(planningError(cause)); } finally { setBusy(false); } };
  return <div className="page cost-planner"><PageHeader title="Semester cost planner" subtitle="Plan semester funding, recurring commitments and full employer costs using editable assumptions." actions={permissions.canWrite ? <button type="button" className="btn btn--accent" disabled={!workspace} onClick={() => setPeriodForm({})}>New period</button> : undefined} /><BooksNav />
    <p className="cost-planner__intro">Compare the cash due in a term with the cost allocated to its covered days. Plans stay live as assumptions change; exported files keep the snapshot generated at download.</p>
    {!workspace ? <p role="status">Loading saved planning periods…</p> : <>
      {workspace.baseCurrencyWarning && <p className="cost-planner__warning">{workspace.baseCurrencyWarning} Enter an explicit currency when creating a period.</p>}
      <section className="card cost-planner__panel" aria-label="Saved planning periods"><div className="cost-planner__section-heading"><h2>Saved periods</h2><Checkbox checked={archived} onChange={setArchived} label="Show archived periods" /></div><nav className="cost-planner__periods" aria-label="Choose planning period">{workspace.periods.map((saved) => <PeriodButton key={saved._id} period={saved} selected={periodId === saved._id} onSelect={selectPeriod} />)}</nav><MorePeriods key={`${societyId}:${archived}`} societyId={societyId} archived={archived} cursor={!workspace.isDone ? workspace.continueCursor : undefined} selectedId={periodId} onSelect={selectPeriod} />{!workspace.periods.length && <p className="muted">{archived ? "No archived periods." : "No saved periods yet. Create a semester or choose custom dates."}</p>}</section>
      {error && <p className="field__error" role="alert">{error}</p>}
      {period && <><div className="cost-planner__section-heading"><div><h2>{period.name}</h2><p className="muted">{formatDate(period.startDate)}–{formatDate(period.endDate)} · {period.currency}{period.archivedAtISO ? " · archived" : ""}</p></div>{permissions.canWrite && <div className="cost-planner__actions"><button type="button" className="btn btn--sm" disabled={busy || Boolean(period.archivedAtISO)} onClick={() => setPeriodForm({ value: period })}>Edit period</button><button type="button" className="btn btn--sm" disabled={busy} onClick={() => setPeriodForm({ value: nextSemester(period), duplicate: true })}>Duplicate next term</button><button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void archivePeriod()}>{period.archivedAtISO ? "Restore period" : "Archive period"}</button></div>}</div><PlanningPeriodContent key={period._id} societyId={societyId} period={period} today={workspace.today} /></>}
      {periodForm && <Drawer open title={periodForm.duplicate ? "Duplicate next term" : periodForm.value ? "Edit period" : "New period"} onClose={() => setPeriodForm(null)}><PlanningPeriodForm societyId={societyId} today={workspace.today} currency={workspace.baseCurrency ?? ""} value={periodForm.value} duplicate={periodForm.duplicate} onCancel={() => setPeriodForm(null)} onSaved={(id) => { selectPeriod(id); setPeriodForm(null); toast.success("Planning period saved"); }} /></Drawer>}
    </>}
  </div>;
}
function PeriodButton({ period, selected, onSelect }: { period: PeriodRow; selected: boolean; onSelect: (id: string) => void }) { return <button type="button" className={`cost-planner__period${selected ? " is-selected" : ""}`} aria-pressed={selected} onClick={() => onSelect(period._id)}><strong>{period.name}</strong><small>{formatDate(period.startDate)}–{formatDate(period.endDate)} · {period.currency}</small></button>; }
function MorePeriods({ societyId, archived, cursor, selectedId, onSelect }: { societyId: string; archived: boolean; cursor?: string; selectedId?: string; onSelect: (id: string) => void }) {
  const [open, setOpen] = useState(false), [attempt, setAttempt] = useState(0);
  if (!cursor) return null;
  return open ? <PlanningQueryBoundary key={attempt} label="More planning periods" onRetry={() => setAttempt((old) => old + 1)}><PeriodPage societyId={societyId} archived={archived} cursor={cursor} selectedId={selectedId} onSelect={onSelect} /></PlanningQueryBoundary> : <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>Load more periods</button>;
}
function PeriodPage({ societyId, archived, cursor, selectedId, onSelect }: { societyId: string; archived: boolean; cursor: string; selectedId?: string; onSelect: (id: string) => void }) {
  const response = useQuery(api.costPlanning.workspace, { societyId, cursor, archived }) as PlanningWorkspace | undefined;
  if (!response) return <p role="status">Loading more periods…</p>;
  if (!response.isDone && (!response.continueCursor || response.continueCursor === cursor)) throw new Error("Period pagination did not advance. Retry loading saved periods.");
  return <><nav className="cost-planner__periods" aria-label="More planning periods">{response.periods.map((period) => <PeriodButton key={period._id} period={period} selected={selectedId === period._id} onSelect={onSelect} />)}</nav><MorePeriods societyId={societyId} archived={archived} cursor={response.isDone ? undefined : response.continueCursor} selectedId={selectedId} onSelect={onSelect} /></>;
}
function PlanningPeriodContent({ societyId, period, today }: { societyId: string; period: PeriodRow; today: string }) {
  const permissions = useFinancePermissions(), canWrite = permissions.canWrite && !period.archivedAtISO, toast = useToast();
  const [modal, setModal] = useState<{ kind: "cost"; value?: PlanningCost } | { kind: "staff"; value?: StaffCostPlan } | null>(null), [showImports, setShowImports] = useState(false), [busy, setBusy] = useState(false), [error, setError] = useState(""), [asOf, setAsOf] = useState(today < period.endDate ? today : period.endDate);
  const costs = usePlanningCollection<Archived<PlanningCost>>({ societyId, collection: "costs" }, "Planning costs"), staff = usePlanningCollection<Archived<StaffCostPlan>>({ societyId, collection: "staff" }, "Staff planning assumptions");
  const actuals = usePlanningCollection<PlanningActual>(period.spendBudgetId ? { societyId, collection: "actuals", periodId: period._id, asOf } : undefined, "Linked bank spending");
  const actualMetadata = actuals.page?.actuals as PlanningActualMeta | undefined;
  const savePeriod = useMutation(api.costPlanning.savePeriod), saveCost = useMutation(api.costPlanning.saveCost), setArchived = useMutation(api.costPlanning.setArchived);
  const activeCosts = useMemo(() => costs.rows.filter((cost) => !cost.archivedAtISO), [costs.rows]), activeStaff = useMemo(() => staff.rows.filter((member) => !member.archivedAtISO), [staff.rows]);
  const complete = costs.ready && staff.ready;
  const result = useMemo(() => { if (!complete) return { projection: undefined, error: "" }; try { return { projection: projectCostPeriod(period, activeCosts, activeStaff), error: "" }; } catch (cause) { return { projection: undefined, error: planningError(cause) }; } }, [activeCosts, activeStaff, complete, period]);
  const exportInput = useMemo(() => result.projection ? { projection: result.projection, costs: activeCosts, staff: activeStaff, actuals: actuals.rows, actualMetadata, actualsReady: actuals.ready } : undefined, [activeCosts, activeStaff, actualMetadata, actuals.ready, actuals.rows, result.projection]);
  const pdf = useMemo(() => exportInput ? planningReportDocument(exportInput) : undefined, [exportInput]);
  const change = async (action: () => Promise<unknown>, success?: string) => { if (busy || !canWrite) return; setBusy(true); setError(""); try { await action(); if (success) toast.success(success); } catch (cause) { setError(planningError(cause)); } finally { setBusy(false); } };
  const changeBasis = (basis: CostBasis) => void change(() => savePeriod({ societyId, id: period._id, fields: { ...periodFields(period), basis } }));
  const changePlanned = (includePlanned: boolean) => void change(() => savePeriod({ societyId, id: period._id, fields: { ...periodFields(period), includePlanned } }));
  const archive = (kind: "cost" | "staff", id: string, archived: boolean) => void change(() => setArchived({ societyId, kind, id, archived }), archived ? "Planning assumption archived" : "Planning assumption restored");
  const changeStatus = (cost: PlanningCost, status: PlanningStatus) => void change(() => saveCost({ societyId, id: cost._id, fields: { ...costFields(cost), status } }));
  const download = async (format: "csv" | "xlsx") => { if (!exportInput || !complete || !actuals.ready || !permissions.canExport || busy) return; setBusy(true); setError(""); try { await exportCostPlan(exportInput, format); } catch (cause) { setError(planningError(cause)); } finally { setBusy(false); } };
  return <div className="cost-planner__content"><div className="cost-planner__toolbar"><label>Forecast basis<Select value={period.basis} disabled={!canWrite || busy} onChange={changeBasis} options={[{ value: "cash", label: "Cash · dated payments" }, { value: "allocated", label: "Allocated · covered period" }]} /></label><Checkbox checked={period.includePlanned} disabled={!canWrite || busy} onChange={changePlanned} label="Include planned costs" />{canWrite && <div className="cost-planner__actions"><button type="button" className="btn btn--accent btn--sm" onClick={() => setModal({ kind: "cost" })}>New cost</button><button type="button" className="btn btn--sm" onClick={() => setModal({ kind: "staff" })}>Add staff cost</button><button type="button" className="btn btn--sm" aria-expanded={showImports} onClick={() => setShowImports((old) => !old)}>Import existing costs</button></div>}</div>
    {costs.loader}{staff.loader}{actuals.loader}{!complete && !costs.error && !staff.error && <p role="status">Loading all planning assumptions… {costs.rows.length} cost records and {staff.rows.length} staff records received. Complete totals appear after every page loads.</p>}{(error || result.error) && <p className="field__error" role="alert">{error || result.error}</p>}
    {result.projection && <><PlanningOverview projection={result.projection} /><section className="cost-planner__exports" aria-label="Export planning snapshot"><p className="muted">All {activeCosts.length} active costs and {activeStaff.length} active staff assumptions loaded. Downloads keep this forecast snapshot.</p><div className="cost-planner__actions"><button type="button" className="btn btn--sm" disabled={!permissions.canExport || !actuals.ready || busy} onClick={() => void download("csv")}>Export CSV</button><button type="button" className="btn btn--sm" disabled={!permissions.canExport || !actuals.ready || busy} onClick={() => void download("xlsx")}>Export Excel</button></div>{permissions.canExport && <ReportPdfDownload societyId={societyId} report={pdf} filename={`${period.name} cost plan`} label="Download planning PDF" disabled={!complete || !actuals.ready || busy} />}</section></>}
    <PlanningCostLists costs={costs.rows} staff={staff.rows} projection={result.projection} canWrite={Boolean(canWrite)} busy={busy} onNewCost={() => setModal({ kind: "cost" })} onNewStaff={() => setModal({ kind: "staff" })} onEditCost={(value) => setModal({ kind: "cost", value })} onEditStaff={(value) => setModal({ kind: "staff", value })} onArchive={archive} onCostStatus={changeStatus} />
    {showImports && <PlanningImports societyId={societyId} currency={period.currency} canWrite={Boolean(canWrite)} onImported={() => toast.success("Planning cost linked")} />}
    <PlanningActualSpending periodCurrency={period.currency} linked={Boolean(period.spendBudgetId)} loading={!actuals.ready} error={actuals.error} rows={actuals.rows} metadata={actualMetadata} asOf={asOf} startDate={period.startDate} endDate={today < period.endDate ? today : period.endDate} onAsOf={(value) => { if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setAsOf(value); }} />
    <PlanningQueryBoundary label="Payroll planning setup" onRetry={() => window.location.reload()}><PayrollSetupPanel societyId={societyId} /></PlanningQueryBoundary>
    {modal && <Drawer open title={modal.kind === "cost" ? modal.value ? "Edit planning cost" : "New cost" : modal.value ? "Edit staff cost" : "Add staff cost"} onClose={() => setModal(null)}>{modal.kind === "cost" ? <PlanningCostForm societyId={societyId} currency={period.currency} today={today} value={modal.value} onCancel={() => setModal(null)} onSaved={() => { setModal(null); toast.success("Planning cost saved"); }} /> : <StaffCostForm societyId={societyId} currency={period.currency} today={today} value={modal.value} onCancel={() => setModal(null)} onSaved={() => setModal(null)} />}</Drawer>}
  </div>;
}
