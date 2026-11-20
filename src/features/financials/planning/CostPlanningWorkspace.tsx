import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useMutation, useQuery } from "convex/react";
import { useSearchParams } from "react-router-dom";
import { Plus } from "lucide-react";
import { api } from "@/lib/convexApi";
import { PageHeader } from "../../../pages/_helpers";
import { Banner, Drawer, SkeletonRows } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { Select } from "../../../components/Select";
import { useFinancePermissions } from "../../../hooks/useFinancePermissions";
import { useToast } from "../../../components/Toast";
import { BooksNav } from "../components/BooksNav";
import { ReportPdfDownload } from "../reports/ReportPdfDownload";
import {
  projectCostPeriod,
  type CostBasis,
  type CostPeriod,
  type PlanningCost,
  type PlanningStatus,
  type StaffCostPlan,
} from "../../../../shared/costPlanning";
import { PlanningPeriodForm } from "./PlanningPeriodForm";
import { PlanningCostForm } from "./PlanningCostForm";
import { StaffCostForm } from "./StaffCostForm";
import { PayrollSetupPanel } from "./PayrollSetupPanel";
import { PlanningCostLists } from "./PlanningCostLists";
import { PlanningImports } from "./PlanningImports";
import { PlanningActualSpending, PlanningOverview, type PlanningActualMeta } from "./PlanningOverview";
import { PlanningQueryBoundary, usePlanningCollection } from "./usePlanningSources";
import { SavedPeriodsCard, periodDates, type PeriodRow, type PlanningWorkspace } from "./PlanningPeriodPicker";
import {
  costFields,
  nextSemester,
  periodFields,
  planningError,
  type Archived,
  type PlanningActual,
} from "./planningFormUtils";
import { exportCostPlan, planningReportDocument } from "./planningExports";
import "./cost-planning.scss";

type PeriodFormState = { value?: CostPeriod; duplicate?: boolean };
type ModalState =
  | { kind: "cost"; value?: PlanningCost }
  | { kind: "staff"; value?: StaffCostPlan };

const BASIS_OPTIONS: Array<{ value: CostBasis; label: string }> = [
  { value: "cash", label: "Cash · dated payments" },
  { value: "allocated", label: "Allocated · covered period" },
];

function periodFormTitle(form: PeriodFormState) {
  if (form.duplicate) return "Duplicate next term";
  return form.value ? "Edit period" : "New period";
}

function modalTitle(modal: ModalState) {
  if (modal.kind === "cost") return modal.value ? "Edit planning cost" : "New cost";
  return modal.value ? "Edit staff cost" : "Add staff cost";
}

export function CostPlanningWorkspace({ societyId }: { societyId: string }) {
  const [search, setSearch] = useSearchParams();
  const permissions = useFinancePermissions();
  const toast = useToast();
  const periodId = search.get("period") || undefined;
  const [archived, setArchived] = useState(false);
  const [periodForm, setPeriodForm] = useState<PeriodFormState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const workspace = useQuery(api.costPlanning.workspace, { societyId, periodId, archived }) as
    | PlanningWorkspace
    | undefined;
  const archiveMutation = useMutation(api.costPlanning.setArchived);

  const selectPeriod = useCallback(
    (id: string) =>
      setSearch(
        (old) => {
          const next = new URLSearchParams(old);
          next.set("period", id);
          return next;
        },
        { replace: true },
      ),
    [setSearch],
  );
  const firstPeriodId = workspace?.periods[0]?._id;
  useEffect(() => {
    if (!periodId && firstPeriodId) selectPeriod(firstPeriodId);
  }, [periodId, selectPeriod, firstPeriodId]);
  const period = workspace?.selectedPeriod ?? (!periodId ? workspace?.periods[0] : null);

  const archivePeriod = async () => {
    if (!period || busy) return;
    setBusy(true);
    setError("");
    try {
      await archiveMutation({ societyId, kind: "period", id: period._id, archived: !period.archivedAtISO });
      toast.success(period.archivedAtISO ? "Period restored" : "Period archived");
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      setBusy(false);
    }
  };

  const periodActions = period && permissions.canWrite && (
    <div className="cost-planner__head-actions">
      <button
        type="button"
        className="btn btn--sm"
        disabled={busy || Boolean(period.archivedAtISO)}
        onClick={() => setPeriodForm({ value: period })}
      >
        Edit period
      </button>
      <button
        type="button"
        className="btn btn--sm"
        disabled={busy}
        onClick={() => setPeriodForm({ value: nextSemester(period), duplicate: true })}
      >
        Duplicate next term
      </button>
      <button type="button" className="btn btn--ghost btn--sm" disabled={busy} onClick={() => void archivePeriod()}>
        {period.archivedAtISO ? "Restore period" : "Archive period"}
      </button>
    </div>
  );

  return (
    <div className="page cost-planner">
      <PageHeader
        title="Semester cost planner"
        subtitle="Plan semester funding, recurring commitments and full employer costs using editable assumptions."
        info={
          <p>
            Compare the cash due in a term with the cost allocated to its covered days. Plans stay live as assumptions
            change; exported files keep the snapshot generated at download.
          </p>
        }
        actions={
          permissions.canWrite ? (
            <button
              type="button"
              className="btn-action btn-action--primary"
              disabled={!workspace}
              onClick={() => setPeriodForm({})}
            >
              <Plus size={12} aria-hidden="true" /> New period
            </button>
          ) : undefined
        }
      />
      <BooksNav />
      {!workspace ? (
        <SkeletonRows rows={4} columns={3} />
      ) : (
        <div className="cost-planner__content">
          {workspace.baseCurrencyWarning && (
            <Banner tone="warn">
              {workspace.baseCurrencyWarning} Enter an explicit currency when creating a period.
            </Banner>
          )}
          <SavedPeriodsCard
            societyId={societyId}
            workspace={workspace}
            archived={archived}
            onArchived={setArchived}
            selectedId={periodId}
            onSelect={selectPeriod}
          />
          {error && <Banner tone="danger">{error}</Banner>}
          {period && (
            <PlanningPeriodContent
              key={period._id}
              societyId={societyId}
              period={period}
              today={workspace.today}
              periodActions={periodActions}
            />
          )}
          {periodForm && (
            <Drawer open title={periodFormTitle(periodForm)} onClose={() => setPeriodForm(null)}>
              <PlanningPeriodForm
                societyId={societyId}
                today={workspace.today}
                currency={workspace.baseCurrency ?? ""}
                value={periodForm.value}
                duplicate={periodForm.duplicate}
                onCancel={() => setPeriodForm(null)}
                onSaved={(id) => {
                  selectPeriod(id);
                  setPeriodForm(null);
                  toast.success("Planning period saved");
                }}
              />
            </Drawer>
          )}
        </div>
      )}
    </div>
  );
}

function PlanningPeriodContent({
  societyId,
  period,
  today,
  periodActions,
}: {
  societyId: string;
  period: PeriodRow;
  today: string;
  periodActions: ReactNode;
}) {
  const permissions = useFinancePermissions();
  const canWrite = permissions.canWrite && !period.archivedAtISO;
  const toast = useToast();
  const [modal, setModal] = useState<ModalState | null>(null);
  const [showImports, setShowImports] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [asOf, setAsOf] = useState(today < period.endDate ? today : period.endDate);
  const costs = usePlanningCollection<Archived<PlanningCost>>({ societyId, collection: "costs" }, "Planning costs");
  const staff = usePlanningCollection<Archived<StaffCostPlan>>(
    { societyId, collection: "staff" },
    "Staff planning assumptions",
  );
  const actuals = usePlanningCollection<PlanningActual>(
    period.spendBudgetId ? { societyId, collection: "actuals", periodId: period._id, asOf } : undefined,
    "Linked bank spending",
  );
  const actualMetadata = actuals.page?.actuals as PlanningActualMeta | undefined;
  const savePeriod = useMutation(api.costPlanning.savePeriod);
  const saveCost = useMutation(api.costPlanning.saveCost);
  const setArchived = useMutation(api.costPlanning.setArchived);
  const activeCosts = useMemo(() => costs.rows.filter((cost) => !cost.archivedAtISO), [costs.rows]);
  const activeStaff = useMemo(() => staff.rows.filter((member) => !member.archivedAtISO), [staff.rows]);
  const complete = costs.ready && staff.ready;

  const result = useMemo(() => {
    if (!complete) return { projection: undefined, error: "" };
    try {
      return { projection: projectCostPeriod(period, activeCosts, activeStaff), error: "" };
    } catch (cause) {
      return { projection: undefined, error: planningError(cause) };
    }
  }, [activeCosts, activeStaff, complete, period]);
  const exportInput = useMemo(
    () =>
      result.projection
        ? {
            projection: result.projection,
            costs: activeCosts,
            staff: activeStaff,
            actuals: actuals.rows,
            actualMetadata,
            actualsReady: actuals.ready,
          }
        : undefined,
    [activeCosts, activeStaff, actualMetadata, actuals.ready, actuals.rows, result.projection],
  );
  const pdf = useMemo(() => (exportInput ? planningReportDocument(exportInput) : undefined), [exportInput]);

  const change = async (action: () => Promise<unknown>, success?: string) => {
    if (busy || !canWrite) return;
    setBusy(true);
    setError("");
    try {
      await action();
      if (success) toast.success(success);
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      setBusy(false);
    }
  };
  const changeBasis = (basis: CostBasis) =>
    void change(() => savePeriod({ societyId, id: period._id, fields: { ...periodFields(period), basis } }));
  const changePlanned = (includePlanned: boolean) =>
    void change(() => savePeriod({ societyId, id: period._id, fields: { ...periodFields(period), includePlanned } }));
  const archive = (kind: "cost" | "staff", id: string, archived: boolean) =>
    void change(
      () => setArchived({ societyId, kind, id, archived }),
      archived ? "Planning assumption archived" : "Planning assumption restored",
    );
  const changeStatus = (cost: PlanningCost, status: PlanningStatus) =>
    void change(() => saveCost({ societyId, id: cost._id, fields: { ...costFields(cost), status } }));
  const download = async (format: "csv" | "xlsx") => {
    if (!exportInput || !complete || !actuals.ready || !permissions.canExport || busy) return;
    setBusy(true);
    setError("");
    try {
      await exportCostPlan(exportInput, format);
    } catch (cause) {
      setError(planningError(cause));
    } finally {
      setBusy(false);
    }
  };
  const exportDisabled = !permissions.canExport || !actuals.ready || busy;
  const visibleError = error || result.error;

  return (
    <div className="cost-planner__content">
      <section className="card" aria-label="Selected planning period">
        <div className="card__head">
          <div className="cost-planner__head-title">
            <h2 className="card__title">{period.name}</h2>
            <p className="card__subtitle">
              {periodDates(period)}
              {period.archivedAtISO ? " · archived" : ""}
            </p>
          </div>
          {periodActions}
        </div>
        <div className="card__body cost-planner__toolbar">
          <label>
            Forecast basis
            <Select value={period.basis} disabled={!canWrite || busy} onChange={changeBasis} options={BASIS_OPTIONS} />
          </label>
          <Checkbox
            checked={period.includePlanned}
            disabled={!canWrite || busy}
            onChange={changePlanned}
            label="Include planned costs"
          />
          {canWrite && (
            <div className="cost-planner__actions">
              <button type="button" className="btn btn--accent btn--sm" onClick={() => setModal({ kind: "cost" })}>
                New cost
              </button>
              <button type="button" className="btn btn--sm" onClick={() => setModal({ kind: "staff" })}>
                Add staff cost
              </button>
              <button
                type="button"
                className="btn btn--sm"
                aria-expanded={showImports}
                onClick={() => setShowImports((old) => !old)}
              >
                Import existing costs
              </button>
            </div>
          )}
        </div>
      </section>
      {costs.loader}
      {staff.loader}
      {actuals.loader}
      {!complete && !costs.error && !staff.error && (
        <Banner tone="info" title="Loading all planning assumptions…">
          {costs.rows.length} cost records and {staff.rows.length} staff records received. Complete totals appear after
          every page loads.
        </Banner>
      )}
      {visibleError && <Banner tone="danger">{visibleError}</Banner>}
      {result.projection && (
        <>
          <PlanningOverview projection={result.projection} />
          <section className="card" aria-label="Export planning snapshot">
            <div className="card__head">
              <h2 className="card__title">Export snapshot</h2>
              <div className="cost-planner__head-actions">
                <button type="button" className="btn btn--sm" disabled={exportDisabled} onClick={() => void download("csv")}>
                  Export CSV
                </button>
                <button type="button" className="btn btn--sm" disabled={exportDisabled} onClick={() => void download("xlsx")}>
                  Export Excel
                </button>
              </div>
            </div>
            <div className="card__body cost-planner__exports">
              <p className="muted">
                All {activeCosts.length} active costs and {activeStaff.length} active staff assumptions loaded.
                Downloads keep this forecast snapshot.
              </p>
              {permissions.canExport && (
                <ReportPdfDownload
                  societyId={societyId}
                  report={pdf}
                  filename={`${period.name} cost plan`}
                  label="Download planning PDF"
                  disabled={!complete || !actuals.ready || busy}
                />
              )}
            </div>
          </section>
        </>
      )}
      <PlanningCostLists
        costs={costs.rows}
        staff={staff.rows}
        projection={result.projection}
        canWrite={Boolean(canWrite)}
        busy={busy}
        onNewCost={() => setModal({ kind: "cost" })}
        onNewStaff={() => setModal({ kind: "staff" })}
        onEditCost={(value) => setModal({ kind: "cost", value })}
        onEditStaff={(value) => setModal({ kind: "staff", value })}
        onArchive={archive}
        onCostStatus={changeStatus}
      />
      {showImports && (
        <PlanningImports
          societyId={societyId}
          currency={period.currency}
          canWrite={Boolean(canWrite)}
          onImported={() => toast.success("Planning cost linked")}
        />
      )}
      <PlanningActualSpending
        periodCurrency={period.currency}
        linked={Boolean(period.spendBudgetId)}
        loading={!actuals.ready}
        error={actuals.error}
        rows={actuals.rows}
        metadata={actualMetadata}
        asOf={asOf}
        startDate={period.startDate}
        endDate={today < period.endDate ? today : period.endDate}
        onAsOf={(value) => {
          if (/^\d{4}-\d{2}-\d{2}$/.test(value)) setAsOf(value);
        }}
      />
      <PlanningQueryBoundary label="Payroll planning setup" onRetry={() => window.location.reload()}>
        <PayrollSetupPanel societyId={societyId} />
      </PlanningQueryBoundary>
      {modal && (
        <Drawer open title={modalTitle(modal)} onClose={() => setModal(null)}>
          {modal.kind === "cost" ? (
            <PlanningCostForm
              societyId={societyId}
              currency={period.currency}
              today={today}
              value={modal.value}
              onCancel={() => setModal(null)}
              onSaved={() => {
                setModal(null);
                toast.success("Planning cost saved");
              }}
            />
          ) : (
            <StaffCostForm
              societyId={societyId}
              currency={period.currency}
              today={today}
              value={modal.value}
              onCancel={() => setModal(null)}
              onSaved={() => setModal(null)}
            />
          )}
        </Drawer>
      )}
    </div>
  );
}
