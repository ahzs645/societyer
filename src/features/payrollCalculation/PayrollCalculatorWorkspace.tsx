import {
  Suspense,
  lazy,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from "react";
import { Link, useSearchParams } from "react-router-dom";
import { Star } from "lucide-react";
import type {
  CalculationInput,
  EarningCodeFields,
} from "../../../shared/payrollCalculation";
import { usePermissions } from "../../hooks/usePermissions";
import { Banner, Field, SkeletonRows } from "../../components/ui";
import { Tabs } from "../../components/primitives";
import { PageHeader } from "../../pages/_helpers";
import { PayrollSourcesPanel } from "./PayrollSourcesPanel";
import {
  PayrollQueryBoundary,
  usePayrollPages,
  type PayrollRow,
} from "./payrollUi";
import type { PayrollPickerRow } from "./PayrollSourceForms";
import type { PayrollRecordSummary } from "./PayrollRunForm";
import { PayrollCalculateView, PayrollRecordsView } from "./PayrollCoreViews";
import {
  payrollView,
  visiblePayrollViews,
  type PayrollRendererKey,
  type PayrollViewId,
} from "./payrollViewRegistry";
import {
  PayrollViewSettings,
  usePayrollViewPreferences,
} from "./payrollViewPreferences";
import "./payroll-calculator.scss";

type PanelRenderer = Exclude<
  PayrollRendererKey,
  "calculate" | "sources" | "records"
>;
const PANELS: Record<
  PanelRenderer,
  LazyExoticComponent<ComponentType<{ societyId: string }>>
> = {
  tools: lazy(() =>
    import("./PayrollToolsPanel").then((module) => ({
      default: module.PayrollToolsPanel,
    })),
  ),
  filings: lazy(() =>
    import("./PayrollFilingPanel").then((module) => ({
      default: module.PayrollFilingPanel,
    })),
  ),
  leave: lazy(() =>
    import("./PayrollLeavePanel").then((module) => ({
      default: module.PayrollLeavePanel,
    })),
  ),
  td1: lazy(() =>
    import("./PayrollTd1ImportPanel").then((module) => ({
      default: module.PayrollTd1ImportPanel,
    })),
  ),
  rules: lazy(() =>
    import("./PayrollRulesPanel").then((module) => ({
      default: module.PayrollRulesPanel,
    })),
  ),
  remittances: lazy(() =>
    import("./PayrollRemittancePanel").then((module) => ({
      default: module.PayrollRemittancePanel,
    })),
  ),
  roe: lazy(() =>
    import("./PayrollRoeWorkflowPanel").then((module) => ({
      default: module.PayrollRoeWorkflowPanel,
    })),
  ),
};
/** What the calculator covers, behind the header's ⓘ. */
const COVERAGE_INFO = (
  <>
    <p>
      <strong>Native coverage: ordinary British Columbia employment, 2026.</strong>
    </p>
    <p>
      Earnings use work-date rules; deductions use the payment-year and
      January/July CRA edition. Unsupported dates, provinces, missing history,
      or unreviewed assumptions block approval. Preview and finalization do not
      initiate deposits or external filings.
    </p>
  </>
);

export function PayrollCalculatorWorkspace({
  societyId,
}: {
  societyId: string;
}) {
  const permissions = usePermissions(),
    canWrite = permissions.can("financials:write"),
    [params, setParams] = useSearchParams();
  const view = payrollView(params.get("tab")),
    canAccess = view.permissions.every(permissions.can),
    presentation = usePayrollViewPreferences(societyId);
  const [year, setYear] = useState(new Date().getUTCFullYear()),
    [input, setInput] = useState<CalculationInput | undefined>(),
    [initial, setInitial] = useState<CalculationInput | undefined>(),
    [draftId, setDraftId] = useState<string | undefined>(),
    [formVersion, setFormVersion] = useState(0),
    [attempt, setAttempt] = useState(0),
    [previewAttempt, setPreviewAttempt] = useState(0);
  const metadata = usePayrollPages<PayrollPickerRow>(
    { societyId, collection: "employer", year },
    "Payroll workspace",
  );
  const employees = usePayrollPages<PayrollPickerRow>(
    view.needsEmployees && canAccess
      ? { societyId, collection: "employees" }
      : undefined,
    "Payroll employees",
  );
  const codes = usePayrollPages<PayrollRow<EarningCodeFields>>(
    view.needsCodes && canAccess
      ? { societyId, collection: "codes" }
      : undefined,
    "Reviewed earning codes",
  );
  const records = usePayrollPages<PayrollRecordSummary>(
    view.needsRecords && canAccess
      ? { societyId, collection: "calculations", year }
      : undefined,
    "Saved payroll calculations",
  );
  const today =
      metadata.metadata?.today ?? new Date().toISOString().slice(0, 10),
    recordId = params.get("calculation"),
    ready = metadata.ready && employees.ready && codes.ready && records.ready;
  function navigate(next: PayrollViewId, id?: string) {
    setParams((previous) => {
      const copy = new URLSearchParams(previous);
      copy.set("tab", next);
      if (id) copy.set("calculation", id);
      else copy.delete("calculation");
      return copy;
    });
    setAttempt(0);
  }
  function prepare(value: CalculationInput, id?: string) {
    setInput(undefined);
    setDraftId(id);
    setFormVersion((old) => old + 1);
    setInitial(value);
    navigate("calculate");
  }
  const core = {
    calculate: () => (
      <PayrollCalculateView
        societyId={societyId}
        today={today}
        employees={employees.rows}
        codes={codes.rows}
        records={records.rows}
        initial={initial}
        input={input}
        draftId={draftId}
        formVersion={formVersion}
        previewAttempt={previewAttempt}
        canWrite={canWrite}
        onNew={() => {
          setInitial(undefined);
          setInput(undefined);
          setDraftId(undefined);
          setFormVersion((old) => old + 1);
        }}
        onPreview={setInput}
        onChanged={() => setInput(undefined)}
        onRetry={() => setPreviewAttempt((old) => old + 1)}
        onSaved={(id) => {
          setInput(undefined);
          setDraftId(undefined);
          navigate("records", id);
        }}
      />
    ),
    sources: () => (
      <PayrollSourcesPanel
        key={`${view.id}:${year}`}
        societyId={societyId}
        year={year}
        today={today}
        employees={employees.rows}
        tab={view.source!}
        canWrite={canWrite}
      />
    ),
    records: () => (
      <PayrollRecordsView
        societyId={societyId}
        year={year}
        today={today}
        records={records.rows}
        recordId={recordId}
        canWrite={canWrite}
        onOpen={(id) => navigate("records", id)}
        onEdit={prepare}
        onReplacement={(value) => prepare(value)}
      />
    ),
  };
  const Core = core[view.renderer as keyof typeof core],
    Panel = PANELS[view.renderer as PanelRenderer];
  const sourceError =
    metadata.error || employees.error || codes.error || records.error;
  const missingPermissions = view.permissions.filter(
    (permission) => !permissions.can(permission),
  );
  const tabs = visiblePayrollViews(presentation.preferences, permissions.can).map(
    (item) => ({
      id: item.id,
      label: item.label,
      icon: presentation.preferences.favorites.includes(item.id) ? (
        <Star size={12} aria-hidden="true" />
      ) : undefined,
    }),
  );
  const organizationName = metadata.metadata?.organization.name ?? "Organization";

  function changeYear(value: number) {
    if (!Number.isInteger(value) || value < 2024 || value > 2100) return;
    setYear(value);
    setParams((previous) => {
      const copy = new URLSearchParams(previous);
      copy.delete("calculation");
      return copy;
    });
  }

  function showInNavigation() {
    presentation.update((previous) => ({
      ...previous,
      hidden: previous.hidden.filter((id) => id !== view.id),
    }));
  }

  function toggleSection(expanded: boolean) {
    if (expanded === presentation.preferences.expanded[view.id]) return;
    presentation.update((previous) => ({
      ...previous,
      expanded: { ...previous.expanded, [view.id]: expanded },
    }));
  }

  function renderView() {
    if (Core) return Core();
    if (!Panel)
      return (
        <Banner tone="danger" title="Payroll module unavailable">
          This registered payroll module is unavailable. Reload after its
          application update.
        </Banner>
      );
    return (
      <Suspense fallback={<SkeletonRows rows={4} columns={3} />}>
        <Panel societyId={societyId} />
      </Suspense>
    );
  }

  return (
    <div className="page payroll-calculator">
      <PageHeader
        title="Payroll calculator"
        subtitle={`${organizationName} · Reviewed earnings, source-backed deductions, and retained payroll records.`}
        info={COVERAGE_INFO}
        actions={
          <>
            <Link className="btn-action" to="/app/payroll">
              Payroll register
            </Link>
            <Link className="btn-action" to="/app/financials/planning">
              Semester cost planner
            </Link>
          </>
        }
      />
      {!canWrite && (
        <Banner tone="info" title="Read-only access">
          Finance write permission is required to change sources or approve
          payroll.
        </Banner>
      )}
      <Tabs<PayrollViewId>
        value={view.id}
        onChange={(id) => navigate(id)}
        tabRoles
        ariaLabel="Payroll calculator sections"
        items={tabs}
      />
      <div className="payroll-calculator__toolbar">
        {view.paymentYear && (
          <Field
            label="Payroll payment year"
            hint="Filters setup, work history, opening balances and saved runs. Run dates remain explicit."
          >
            <input
              className="input"
              type="number"
              min="2024"
              max="2100"
              value={year}
              onChange={(event) => changeYear(Number(event.target.value))}
            />
          </Field>
        )}
        <Link to="/app/payroll?setup=1">
          Registered payroll account and provider settings
        </Link>
      </div>
      <PayrollViewSettings
        preferences={presentation.preferences}
        onChange={presentation.update}
        onReset={presentation.reset}
        error={presentation.error}
      />
      {presentation.preferences.hidden.includes(view.id) && (
        <Banner tone="info">
          {view.label} is hidden from your navigation; this direct link remains
          available.{" "}
          <button type="button" className="btn btn--sm" onClick={showInNavigation}>
            Show {view.label} in navigation
          </button>
        </Banner>
      )}
      {metadata.loader}
      {employees.loader}
      {codes.loader}
      {records.loader}
      {!ready && !sourceError && <SkeletonRows rows={6} columns={4} />}
      {!canAccess ? (
        <Banner tone="info" title={`${view.label} needs more access`}>
          This payroll view requires {missingPermissions.join(" and ")}.
          Authorized supporting calculators remain available under Tools.
        </Banner>
      ) : (
        ready && (
          <PayrollQueryBoundary
            key={`${societyId}:${view.id}:${recordId ?? ""}:${attempt}`}
            label="Payroll section"
            onRetry={() => setAttempt((old) => old + 1)}
          >
            <details
              className="disclosure payroll-calculator__view-section"
              open={presentation.preferences.expanded[view.id]}
              onToggle={(event) => toggleSection(event.currentTarget.open)}
            >
              <summary>{view.label} section</summary>
              <div>{renderView()}</div>
            </details>
          </PayrollQueryBoundary>
        )
      )}
    </div>
  );
}
