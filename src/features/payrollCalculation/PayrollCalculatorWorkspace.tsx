import {
  Suspense,
  lazy,
  useState,
  type ComponentType,
  type LazyExoticComponent,
} from "react";
import { useSearchParams } from "react-router-dom";
import type {
  CalculationInput,
  EarningCodeFields,
} from "../../../shared/payrollCalculation";
import { usePermissions } from "../../hooks/usePermissions";
import { Field } from "../../components/ui";
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
  return (
    <div className="page payroll-calculator">
      <header className="payroll-calculator__heading">
        <div>
          <h1>Payroll calculator</h1>
          <p>
            {metadata.metadata?.organization.name ?? "Organization"} · Reviewed
            earnings, source-backed deductions, and retained payroll records.
          </p>
        </div>
        <div className="payroll-calculator__actions">
          <a className="btn" href="/app/payroll">
            Payroll register
          </a>
          <a className="btn" href="/app/financials/planning">
            Semester cost planner
          </a>
        </div>
      </header>
      <div className="payroll-calculator__notice">
        <strong>
          Native coverage: ordinary British Columbia employment, 2026.
        </strong>{" "}
        Earnings use work-date rules; deductions use the payment-year and
        January/July CRA edition. Unsupported dates, provinces, missing history,
        or unreviewed assumptions block approval. Preview and finalization do
        not initiate deposits or external filings.
      </div>
      {!canWrite && (
        <p className="payroll-calculator__notice">
          Read-only access. Finance write permission is required to change
          sources or approve payroll.
        </p>
      )}
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
              onChange={(event) => {
                const value = Number(event.target.value);
                if (Number.isInteger(value) && value >= 2024 && value <= 2100) {
                  setYear(value);
                  setParams((previous) => {
                    const copy = new URLSearchParams(previous);
                    copy.delete("calculation");
                    return copy;
                  });
                }
              }}
            />
          </Field>
        )}
        <a href="/app/payroll?setup=1">
          Registered payroll account and provider settings
        </a>
      </div>
      <PayrollViewSettings
        preferences={presentation.preferences}
        onChange={presentation.update}
        onReset={presentation.reset}
        error={presentation.error}
      />
      <nav
        className="payroll-calculator__tabs"
        aria-label="Payroll calculator sections"
      >
        {visiblePayrollViews(presentation.preferences, permissions.can).map(
          (item) => (
            <button
              key={item.id}
              type="button"
              className="btn btn--sm"
              aria-pressed={view.id === item.id}
              onClick={() => navigate(item.id)}
            >
              {presentation.preferences.favorites.includes(item.id) && (
                <span aria-hidden="true">★ </span>
              )}
              {item.label}
            </button>
          ),
        )}
      </nav>
      {presentation.preferences.hidden.includes(view.id) && (
        <p className="payroll-calculator__notice">
          {view.label} is hidden from your navigation; this direct link remains
          available.{" "}
          <button
            type="button"
            className="btn btn--sm"
            onClick={() =>
              presentation.update((previous) => ({
                ...previous,
                hidden: previous.hidden.filter((id) => id !== view.id),
              }))
            }
          >
            Show {view.label} in navigation
          </button>
        </p>
      )}
      {metadata.loader}
      {employees.loader}
      {codes.loader}
      {records.loader}
      {!ready &&
        !metadata.error &&
        !employees.error &&
        !codes.error &&
        !records.error && (
          <p role="status">Loading all payroll source pages…</p>
        )}
      {!canAccess ? (
        <p role="alert">
          This payroll view requires{" "}
          {view.permissions
            .filter((permission) => !permissions.can(permission))
            .join(" and ")}
          . Authorized supporting calculators remain available under Tools.
        </p>
      ) : (
        ready && (
          <PayrollQueryBoundary
            key={`${societyId}:${view.id}:${recordId ?? ""}:${attempt}`}
            label="Payroll section"
            onRetry={() => setAttempt((old) => old + 1)}
          >
            <details
              className="payroll-calculator__view-section"
              open={presentation.preferences.expanded[view.id]}
              onToggle={(event) => {
                const expanded = event.currentTarget.open;
                if (expanded !== presentation.preferences.expanded[view.id])
                  presentation.update((previous) => ({
                    ...previous,
                    expanded: { ...previous.expanded, [view.id]: expanded },
                  }));
              }}
            >
              <summary>{view.label} section</summary>
              <div>
                {Core ? (
                  Core()
                ) : Panel ? (
                  <Suspense
                    fallback={
                      <p role="status">Loading {view.label.toLowerCase()}…</p>
                    }
                  >
                    <Panel societyId={societyId} />
                  </Suspense>
                ) : (
                  <p role="alert">
                    This registered payroll module is unavailable. Reload after
                    its application update.
                  </p>
                )}
              </div>
            </details>
          </PayrollQueryBoundary>
        )
      )}
    </div>
  );
}
