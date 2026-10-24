import { useCallback, useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link, useSearchParams } from "react-router-dom";
import { CalendarClock, ClipboardCheck, FileText, FileUp, Landmark, Plus, Settings2, Users, Wallet } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ObjectRecordTable, RecordTableEmpty } from "@/platform/record-engine";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useUrlTab } from "../hooks/useUrlTab";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { Tabs } from "../components/primitives";
import { StatTile } from "../components/StatTile";
import { Money } from "../components/Money";
import { MoreActionsMenu } from "../components/MoreActionsMenu";
import { useToast } from "../components/Toast";
import { formatDate, pluralize } from "../lib/format";
import { periodLabel, REMITTANCE_STATUS_LABEL, ROE_REASONS, ROE_STATUS_LABEL, SLIP_STATUS_LABEL } from "../../shared/businessRegisters";
import { PayrollImportDrawer, PayRunDrawer, PayrollSettingsDrawer, RemittanceDrawer, RoeDrawer, SlipDrawer } from "../features/businessRegisters/PayrollDrawers";
import { useOnceWhen } from "../features/businessRegisters/formHelpers";
import type { PayrollWorkspace } from "../features/businessRegisters/types";
import { PayrollSetupPanel } from "../features/financials/planning/PayrollSetupPanel";

const TABS = ["runs", "remittances", "slips", "roes"] as const;
type PayrollTab = (typeof TABS)[number];

type DrawerState =
  | { kind: "run"; id: string | null }
  | { kind: "remittance"; id: string }
  | { kind: "slip"; id: string | null }
  | { kind: "roe"; id: string | null }
  | { kind: "settings" }
  | { kind: "import" }
  | null;

const REMITTANCE_TONE = { paid: "success", partial: "warn", overdue: "danger", due: "warn", unscheduled: "neutral" } as const;
const SLIP_TONE: Record<string, "success" | "warn" | "neutral"> = { filed: "success", issued: "warn", draft: "neutral" };

/**
 * Payroll register: record-keeping for pay runs (entered or imported from a
 * payroll provider), the source deductions owed to the CRA and when, year-end
 * slips and records of employment. Payroll itself runs with the provider and
 * payments are made outside Societyer.
 */
export function PayrollPage() {
  const society = useSociety();
  const toast = useToast();
  const { canWrite } = useFinancePermissions();
  const workspace = useQuery(api.payroll.workspace, society ? { societyId: society._id } : "skip") as PayrollWorkspace | undefined;
  const generateSlips = usePermissionedMutation(api.payroll.generateSlips, canWrite);
  const syncDeadlines = useMutation(api.payroll.syncDeadlines);
  const [tab, setTab] = useUrlTab(TABS, "runs");
  const [searchParams, setSearchParams] = useSearchParams();
  const [drawer, setDrawer] = useState<DrawerState>(() => searchParams.get("setup") === "1" ? { kind: "settings" } : null);

  const runSync = useCallback(() => {
    if (society) void syncDeadlines({ societyId: society._id }).catch(() => undefined);
  }, [society, syncDeadlines]);
  useOnceWhen(Boolean(canWrite && workspace && workspace.deadlineChanges > 0), runSync);

  const runRecords = useMemo(() => (workspace?.runs ?? []).map((run) => ({
    ...run,
    period: periodLabel(run.periodStart, run.periodEnd),
    deductionsCents: run.cppEmployeeCents + (run.cpp2EmployeeCents ?? 0) + run.eiEmployeeCents + run.incomeTaxCents + (run.otherDeductionsCents ?? 0),
    employerCents: run.cppEmployerCents + (run.cpp2EmployerCents ?? 0) + run.eiEmployerCents,
    balanced: run.differenceCents === 0,
  })), [workspace?.runs]);
  const slipRecords = workspace?.slips ?? [];
  const roeRecords = useMemo(() => (workspace?.roes ?? []).map((roe) => ({
    ...roe,
    reason: ROE_REASONS.find((reason) => reason.value === roe.reasonCode)?.label ?? roe.reasonCode,
  })), [workspace?.roes]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const summary = workspace?.summary;
  const employees = workspace?.employees ?? null;
  const slipYear = summary?.slipYear ?? new Date().getFullYear() - 1;
  const currentYear = summary?.year ?? slipYear + 1;
  // In January and February the slips being prepared are last year's.
  const prepYear = workspace && Number(workspace.today.slice(5, 7)) <= 2 ? currentYear - 1 : currentYear;
  const close = () => {
    setDrawer(null);
    if (searchParams.has("setup")) { const nextParams = new URLSearchParams(searchParams); nextParams.delete("setup"); setSearchParams(nextParams, { replace: true }); }
  };

  const generate = async (year: number) => {
    try {
      const result = await generateSlips({ societyId: society._id, year });
      toast.success(`T4 slips for ${year} prepared`, [result.created && `${pluralize(result.created, "new draft")}`, result.updated && `${pluralize(result.updated, "draft")} refreshed`, result.kept && `${pluralize(result.kept, "filed slip")} left as is`].filter(Boolean).join(", ") || undefined);
      setTab("slips");
    } catch (error) {
      toast.error("Couldn't prepare the slips", error instanceof Error ? error.message.split("\n")[0].replace(/^.*Uncaught Error:\s*/, "") : undefined);
    }
  };

  const primary =
    tab === "slips" ? { label: "New slip", open: () => setDrawer({ kind: "slip", id: null }) }
    : tab === "roes" ? { label: "New record of employment", open: () => setDrawer({ kind: "roe", id: null }) }
    : { label: "New pay run", open: () => setDrawer({ kind: "run", id: null }) };

  const next = summary?.nextRemittance;
  const activeRun = drawer?.kind === "run" && drawer.id ? workspace?.runs.find((row) => row._id === drawer.id) ?? null : null;
  const activeRemittance = drawer?.kind === "remittance" ? workspace?.remittances.find((row) => row._id === drawer.id) ?? null : null;
  const activeSlip = drawer?.kind === "slip" && drawer.id ? workspace?.slips.find((row) => row._id === drawer.id) ?? null : null;
  const activeRoe = drawer?.kind === "roe" && drawer.id ? workspace?.roes.find((row) => row._id === drawer.id) ?? null : null;

  return (
    <div className="page business-register-page">
      <PageHeader
        title="Payroll"
        icon={<Wallet size={16} />}
        iconColor="green"
        subtitle="Pay runs, CRA source deductions, year-end slips and records of employment."
        info={
          <>
            <p>
              Calculate supported B.C. payroll in the payroll calculator, or record and reconcile pay runs from your provider here. Make payments and CRA remittances through your bank or My Business Account and record them here.
              Remittances, slip filing and records of employment show on the Deadlines page.
            </p>
            <p>
              Regular remitters owe each month's deductions by the 15th of the next month. Quarterly and accelerated remitters set the schedule from their CRA notice under Payroll settings.
              T4, T4A and RL-1 slips for a year are due on the last day of the following February.
            </p>
          </>
        }
        actions={
          <>
            <Link className="btn btn--sm" to="/app/payroll/calculator">Payroll calculator</Link>
            <Link className="btn btn--sm" to="/app/payroll/calculator?tab=tools">Payroll tools</Link>
            <Link className="btn btn--sm" to="/app/financials/planning"><CalendarClock size={14} aria-hidden="true" />Semester cost planner</Link>
            <MoreActionsMenu
              items={[
                { id: "import", label: "Import pay runs from CSV", icon: <FileUp size={14} />, disabled: !canWrite, onSelect: () => setDrawer({ kind: "import" }) },
                { id: "slips", label: `Prepare T4 slips for ${prepYear}`, icon: <FileText size={14} />, disabled: !canWrite || !workspace?.runs.some((run) => run.payDate.startsWith(String(prepYear)) && run.lines.length), onSelect: () => void generate(prepYear) },
                { id: "settings", label: "Payroll settings", icon: <Settings2 size={14} />, onSelect: () => setDrawer({ kind: "settings" }) },
              ]}
            />
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || !workspace} onClick={primary.open}>
              <Plus size={12} aria-hidden="true" /> {primary.label}
            </button>
          </>
        }
      />

      <div className="stat-grid" role="group" aria-label="Payroll summary">
        <StatTile
          label={`Gross pay, ${currentYear}`}
          icon={<Wallet size={14} />}
          value={<Money variant="hero" trimWholeCents cents={summary ? summary.ytdGrossCents : null} />}
          sub={summary ? pluralize(summary.ytdRunCount, "pay run") : undefined}
          onClick={() => setTab("runs")}
          pressed={tab === "runs"}
          actionLabel="Show pay runs"
        />
        <StatTile
          label="Owed to the CRA"
          icon={<Landmark size={14} />}
          value={<Money variant="hero" trimWholeCents cents={summary ? summary.outstandingCents : null} />}
          tone={summary?.overdueRemittanceCount ? "danger" : "neutral"}
          sub={next ? `Next due ${formatDate(next.dueDate)}` : summary ? "Nothing due" : undefined}
          subTone={summary?.overdueRemittanceCount ? "danger" : undefined}
          onClick={() => setTab("remittances")}
          pressed={tab === "remittances"}
          actionLabel="Show remittances"
        />
        <StatTile
          label={`${slipYear} slips`}
          icon={<FileText size={14} />}
          compact
          value={summary ? (summary.slipCount ? `${summary.slipsFiled} of ${summary.slipCount} filed` : "None yet") : "—"}
          sub={summary ? `Due ${formatDate(summary.slipDeadline)}` : undefined}
          subTone={summary && workspace && summary.slipsFiled < summary.slipCount && summary.slipDeadline < workspace.today ? "warn" : undefined}
          onClick={() => setTab("slips")}
          pressed={tab === "slips"}
          actionLabel="Show year-end slips"
        />
        <StatTile
          label={`Source deductions, ${currentYear}`}
          icon={<CalendarClock size={14} />}
          value={<Money variant="hero" trimWholeCents cents={summary ? summary.ytdRemittableCents : null} />}
          sub="CPP, CPP2, EI and income tax"
        />
        <StatTile
          label={`CPP2, ${currentYear}`}
          icon={<Landmark size={14} />}
          value={<Money variant="hero" trimWholeCents cents={summary ? summary.ytdCpp2EmployeeCents + summary.ytdCpp2EmployerCents : null} />}
          sub="Employee and employer additional CPP"
          onClick={() => setTab("runs")}
          pressed={tab === "runs"}
          actionLabel="Show CPP2 pay run amounts"
        />
      </div>

      {employees && employees.length === 0 && (
        <p className="register-hint register-hint--banner">
          <Users size={14} aria-hidden="true" /> Add staff on the <Link to="/app/employees">Employees</Link> page to split pay runs by employee and prepare T4 slips.
        </p>
      )}

      <PayrollSetupPanel societyId={society._id} onOpenSettings={() => setDrawer({ kind: "settings" })} />

      <Tabs<PayrollTab>
        value={tab}
        onChange={setTab}
        tabRoles
        ariaLabel="Payroll records"
        items={[
          { id: "runs", label: "Pay runs", count: workspace?.runs.length ?? null },
          { id: "remittances", label: "Remittances", count: summary?.openRemittanceCount || null },
          { id: "slips", label: "Year-end slips", count: workspace?.slips.length ?? null },
          { id: "roes", label: "Records of employment", count: workspace?.roes.length ?? null },
        ]}
      />

      {tab === "runs" && (
        <ObjectRecordTable
          societyId={society._id}
          nameSingular="payRun"
          label="All pay runs"
          objectLabel="pay run"
          icon={<Wallet size={14} />}
          records={runRecords}
          loading={workspace === undefined}
          onRecordClick={(id) => setDrawer({ kind: "run", id })}
          renderCell={({ record, field }) => {
            if (field.name === "payDate") return <span className="num">{formatDate(record.payDate)}</span>;
            if (field.name === "balanced") return record.balanced ? <Badge tone="success">Adds up</Badge> : <Badge tone="warn">Check amounts</Badge>;
            if (field.name === "source") return <Badge tone={record.source === "import" ? "info" : "neutral"}>{record.source === "import" ? "Imported" : "Entered"}</Badge>;
            return undefined;
          }}
          emptyState={
            <RecordTableEmpty
              title="No pay runs yet"
              description="Add each pay run as your provider runs it, or import the provider's register as CSV."
              action={canWrite ? <button className="btn btn--accent btn--sm" onClick={() => setDrawer({ kind: "import" })}><FileUp size={12} /> Import CSV</button> : undefined}
            />
          }
        />
      )}

      {tab === "remittances" && (
        <>
          {workspace && !workspace.scheduleComplete && (
            <p className="register-hint register-hint--banner">
              <Settings2 size={14} aria-hidden="true" /> Set your remittance schedule in <button className="link-button" onClick={() => setDrawer({ kind: "settings" })}>Payroll settings</button> to get due dates.
            </p>
          )}
          <ObjectRecordTable
            societyId={society._id}
            nameSingular="payrollRemittance"
            label="All remittances"
            objectLabel="remittance"
            icon={<Landmark size={14} />}
            records={workspace?.remittances ?? []}
            loading={workspace === undefined}
            onRecordClick={(id) => setDrawer({ kind: "remittance", id })}
            renderCell={({ record, field }) => {
              if (field.name === "status") return <Badge tone={REMITTANCE_TONE[record.status as keyof typeof REMITTANCE_TONE] ?? "neutral"}>{REMITTANCE_STATUS_LABEL[record.status as keyof typeof REMITTANCE_STATUS_LABEL] ?? record.status}</Badge>;
              if (field.name === "dueDate") return record.dueDate ? <span className="num">{formatDate(record.dueDate)}</span> : <span className="muted">—</span>;
              return undefined;
            }}
            emptyState={<RecordTableEmpty title="No remittances yet" description="Each month with pay runs gets a remittance with its CRA due date." />}
          />
        </>
      )}

      {tab === "slips" && (
        <ObjectRecordTable
          societyId={society._id}
          nameSingular="payrollSlip"
          label="All slips"
          objectLabel="slip"
          icon={<FileText size={14} />}
          records={slipRecords}
          loading={workspace === undefined}
          onRecordClick={(id) => setDrawer({ kind: "slip", id })}
          renderCell={({ record, field }) => {
            if (field.name === "status") return <Badge tone={SLIP_TONE[record.status] ?? "neutral"}>{SLIP_STATUS_LABEL[record.status as keyof typeof SLIP_STATUS_LABEL] ?? record.status}</Badge>;
            if (field.name === "year") return <span className="num">{record.year}</span>;
            return undefined;
          }}
          emptyState={
            <RecordTableEmpty
              title="No slips yet"
              description={`Prepare draft T4 slips from the ${prepYear} pay runs, or add a slip by hand.`}
              action={canWrite ? <button className="btn btn--accent btn--sm" onClick={() => void generate(prepYear)}><FileText size={12} /> Prepare T4 slips</button> : undefined}
            />
          }
        />
      )}

      {tab === "roes" && (
        <ObjectRecordTable
          societyId={society._id}
          nameSingular="recordOfEmployment"
          label="All records of employment"
          objectLabel="record of employment"
          icon={<ClipboardCheck size={14} />}
          records={roeRecords}
          loading={workspace === undefined}
          onRecordClick={(id) => setDrawer({ kind: "roe", id })}
          renderCell={({ record, field }) => {
            if (field.name === "status") return <Badge tone={record.status === "issued" ? "success" : "warn"}>{ROE_STATUS_LABEL[record.status as keyof typeof ROE_STATUS_LABEL] ?? record.status}</Badge>;
            return undefined;
          }}
          emptyState={<RecordTableEmpty title="No records of employment" description="When someone stops working or has an interruption in earnings, record the ROE you issue and its due date." />}
        />
      )}

      <PayRunDrawer open={drawer?.kind === "run"} onClose={close} societyId={society._id} run={activeRun} employees={employees} canWrite={canWrite} today={workspace?.today ?? ""} />
      <RemittanceDrawer open={drawer?.kind === "remittance"} onClose={close} remittance={activeRemittance} canWrite={canWrite} today={workspace?.today ?? ""} />
      <SlipDrawer open={drawer?.kind === "slip"} onClose={close} societyId={society._id} slip={activeSlip} employees={employees} canWrite={canWrite} defaultYear={slipYear} />
      <RoeDrawer open={drawer?.kind === "roe"} onClose={close} societyId={society._id} roe={activeRoe} employees={employees} canWrite={canWrite} />
      {workspace && <PayrollSettingsDrawer open={drawer?.kind === "settings"} onClose={close} societyId={society._id} settings={workspace.settings} canWrite={canWrite} />}
      <PayrollImportDrawer open={drawer?.kind === "import"} onClose={close} societyId={society._id} canWrite={canWrite} defaultProvider={workspace?.settings.providerName} />
    </div>
  );
}
