import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Archive, ArchiveRestore, ClipboardCheck, Gauge, Pencil, Plus, Trash2 } from "lucide-react";
import { FIELD_TYPES, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, EmptyState } from "../components/ui";
import { Progress, Tabs } from "../components/primitives";
import { Money } from "../components/Money";
import { StatStrip, StatTile } from "../components/StatTile";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { pluralize } from "../lib/format";
import { SpendBudgetDrawer } from "../features/financials/spendBudgets/SpendBudgetDrawer";
import { BUDGET_STATUS_TONE, SpendBudgetDetail, spendTone, windowLabel } from "../features/financials/spendBudgets/SpendBudgetDetail";
import { errorMessage } from "../features/financials/banking/types";
import type { SpendBudgetRow, SpendBudgetsData } from "../features/financials/spendBudgets/types";
import { RegisterTable } from "../features/financials/components/RegisterTable";
import { SPEND_BUDGET_CYCLES, SPEND_BUDGET_CYCLE_LABELS } from "../../shared/spendBudgets";

type BudgetTab = "active" | "upcoming" | "ended" | "archived";

const TAB_LABELS: Record<BudgetTab, string> = { active: "Active", upcoming: "Upcoming", ended: "Ended", archived: "Archived" };

const BUDGETS_TABLE = staticRecordTable({
  id: "spend-budgets",
  nameSingular: "spendBudget",
  namePlural: "spendBudgets",
  labelSingular: "Spend budget",
  labelPlural: "Spend budgets",
  labelIdentifierFieldName: "name",
  density: "comfortable",
  fields: [
    { name: "name", label: "Budget", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "assignedTo", label: "Assigned to", fieldType: FIELD_TYPES.TEXT, size: 200 },
    {
      name: "cycle",
      label: "Resets",
      fieldType: FIELD_TYPES.SELECT,
      size: 110,
      config: { options: SPEND_BUDGET_CYCLES.map((cycle) => ({ value: cycle, label: SPEND_BUDGET_CYCLE_LABELS[cycle], color: "gray" })) },
    },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 110,
      config: {
        options: [
          { value: "active", label: "Active", color: "green" },
          { value: "upcoming", label: "Upcoming", color: "blue" },
          { value: "ended", label: "Ended", color: "gray" },
          { value: "archived", label: "Archived", color: "gray" },
        ],
      },
    },
    { name: "spentCents", label: "Spent this cycle", fieldType: FIELD_TYPES.CURRENCY, size: 260, config: { isCents: true } },
    { name: "remainingCents", label: "Remaining", fieldType: FIELD_TYPES.CURRENCY, size: 130, config: { isCents: true } },
    { name: "limitCents", label: "Limit", fieldType: FIELD_TYPES.CURRENCY, size: 130, isVisible: false, config: { isCents: true } },
    { name: "percentSpent", label: "% spent", fieldType: FIELD_TYPES.NUMBER, size: 100, isVisible: false, config: { suffix: "%" } },
    { name: "cycleWindow", label: "This cycle", fieldType: FIELD_TYPES.TEXT, size: 240, isVisible: false },
    { name: "startDate", label: "Starts", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "endDate", label: "Ends", fieldType: FIELD_TYPES.DATE, size: 120 },
  ],
});

type BudgetRecord = {
  _id: string;
  name: string;
  /** The committee, then the people, as one line. */
  assignedTo: string;
  cycle: SpendBudgetRow["cycle"];
  /** The tab it sits under: its date status, or "archived". */
  status: SpendBudgetRow["status"] | "archived";
  spentCents: number;
  remainingCents: number;
  limitCents: number;
  percentSpent: number;
  cycleWindow: string;
  startDate: string;
  endDate: string | null;
  budget: SpendBudgetRow;
};

function budgetRecord(row: SpendBudgetRow): BudgetRecord {
  return {
    _id: row._id,
    name: row.name,
    assignedTo: [row.committeeName, ...row.memberNames].filter(Boolean).join(", "),
    cycle: row.cycle,
    status: row.archived ? "archived" : row.status,
    spentCents: row.spend.spentCents,
    remainingCents: row.spend.remainingCents,
    limitCents: row.limitCents,
    percentSpent: row.spend.percentSpent,
    cycleWindow: windowLabel(row),
    startDate: row.startDate,
    endDate: row.endDate ?? null,
    budget: row,
  };
}

/**
 * Spend budgets: spending limits for committees and named people that reset
 * weekly, monthly or quarterly, or run once. "% spent" counts the claims
 * charged to each budget in its current cycle. Separate from the annual line
 * budgets on Financials.
 */
export function SpendBudgetsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const data = useQuery(api.spendBudgets.list, society ? { societyId: society._id } : "skip") as SpendBudgetsData | undefined;
  const setArchived = useMutation(api.spendBudgets.setArchived);
  const remove = useMutation(api.spendBudgets.remove);
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<BudgetTab>("active");
  const [editing, setEditing] = useState<{ budget: SpendBudgetRow | null } | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  const rows = useMemo(() => (data?.rows ?? []).filter((row) => (tab === "archived" ? row.archived : !row.archived && row.status === tab)), [data, tab]);
  const records = useMemo<BudgetRecord[]>(() => rows.map(budgetRecord), [rows]);
  const count = (which: BudgetTab) => (data?.rows ?? []).filter((row) => (which === "archived" ? row.archived : !row.archived && row.status === which)).length;
  const open = data?.rows.find((row) => row._id === openId) ?? null;

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const archive = async (row: SpendBudgetRow, archived: boolean) => {
    try {
      await setArchived({ id: row._id, archived });
      toast.success(archived ? "Spend budget archived" : "Spend budget restored", archived ? "New claims can't be charged to it; its history stays." : undefined);
    } catch (error: unknown) {
      toast.error("Could not update the spend budget", errorMessage(error));
    }
  };
  const del = async (row: SpendBudgetRow) => {
    const ok = await confirm({ title: `Delete ${row.name}?`, message: "Only budgets no claim was charged to can be deleted.", confirmLabel: "Delete", tone: "danger" });
    if (!ok) return;
    try {
      await remove({ id: row._id });
      toast.success("Spend budget deleted");
    } catch (error: unknown) {
      toast.error("Could not delete the spend budget", errorMessage(error));
    }
  };

  const summary = data?.summary;
  return (
    <div className="page spend-budgets-page">
      <PageHeader
        title="Spend budgets"
        icon={<Gauge size={16} />}
        iconColor="green"
        subtitle="Spending limits for committees and people, reset each cycle."
        info={
          <>
            <p>
              Claimants choose a spend budget they're assigned to when they submit an expense claim, and see a warning
              when a claim would go over what's left. Submitted, approved and paid claims count against the cycle they
              were incurred in.
            </p>
            <p>These limits are separate from the annual budget-vs-actual lines on Financials.</p>
          </>
        }
        actions={
          <>
            <Link className="btn-action" to="/app/approvals"><ClipboardCheck size={12} aria-hidden="true" /> Approvals</Link>
            <Link className="btn-action" to="/app/financials/planning"><Gauge size={12} aria-hidden="true" /> Plan semester costs</Link>
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite} onClick={() => setEditing({ budget: null })}>
              <Plus size={12} aria-hidden="true" /> New budget
            </button>
          </>
        }
      />

      <StatStrip className="stat-strip--fit" ariaLabel="Spend budget summary">
        <StatTile label="Active budgets" value={summary?.activeCount ?? "—"} sub={summary?.upcomingCount ? `${summary.upcomingCount} upcoming` : undefined} />
        <StatTile label="Limit this cycle" value={<Money variant="hero" trimWholeCents cents={summary?.limitCents} />} />
        <StatTile label="Spent" value={<Money variant="hero" trimWholeCents cents={summary?.spentCents} />} sub={summary?.limitCents ? `${Math.round(((summary.spentCents ?? 0) / summary.limitCents) * 100)}% of active limits` : undefined} />
        <StatTile label="Remaining" value={<Money variant="hero" trimWholeCents cents={summary?.remainingCents} />} tone={summary?.overLimitCount ? "danger" : "neutral"} sub={summary?.overLimitCount ? `${pluralize(summary.overLimitCount, "budget")} over the limit` : "Across active budgets"} />
      </StatStrip>

      <Tabs<BudgetTab>
        value={tab}
        onChange={setTab}
        tabRoles
        ariaLabel="Spend budget status"
        items={[
          { id: "active", label: "Active", count: data ? count("active") : null },
          { id: "upcoming", label: "Upcoming", count: data ? count("upcoming") : null },
          { id: "ended", label: "Ended", count: data ? count("ended") : null },
          { id: "archived", label: "Archived", count: data ? count("archived") : null },
        ]}
      />

      <div className="card spend-budgets-card">
        <RegisterTable<BudgetRecord>
          table={BUDGETS_TABLE}
          tableId="spend-budgets"
          label={`${TAB_LABELS[tab]} budgets`}
          icon={<Gauge size={14} />}
          records={records}
          loading={data === undefined}
          onOpen={(record) => setOpenId(record._id)}
          renderCell={({ record, field }) => {
            const row = record.budget;
            if (field.name === "status") return <Badge tone={BUDGET_STATUS_TONE[row.status]}>{row.archived ? "Archived" : row.statusLabel}</Badge>;
            if (field.name === "spentCents")
              return (
                <div className="spend-budgets-table__spend">
                  <span className="spend-budgets-table__figures"><Money cents={row.spend.spentCents} /> <span className="muted">of <Money cents={row.limitCents} trimWholeCents /></span> <strong>{row.spend.percentSpent}%</strong></span>
                  <Progress value={row.spend.percentSpent} tone={spendTone(row)} />
                </div>
              );
            if (field.name === "remainingCents") return <Money cents={row.spend.remainingCents} tone={row.spend.overLimit ? "out" : "auto"} />;
            if (field.name === "endDate" && !row.endDate) return <span className="muted">Onward</span>;
            return undefined;
          }}
          rowMenuSections={(record) => {
            const row = record.budget;
            return [
              { id: "edit", items: [{ id: "edit", label: "Edit", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => setEditing({ budget: row }) }] },
              {
                id: "archive",
                items: [
                  row.archived
                    ? { id: "restore", label: "Restore", icon: <ArchiveRestore size={14} />, disabled: !canWrite, onSelect: () => void archive(row, false) }
                    : { id: "archive", label: "Archive", icon: <Archive size={14} />, disabled: !canWrite, onSelect: () => void archive(row, true) },
                  { id: "delete", label: "Delete", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite || row.claims.length > 0 || row.transactions.length > 0, hint: row.claims.length ? "Has claims" : row.transactions.length ? "Has bank transactions" : undefined, onSelect: () => void del(row) },
                ],
              },
            ];
          }}
          renderPhoneCard={(record, { open, field, selecting }) => {
            const row = record.budget;
            return (
              <RecordTablePhoneCard
                title={row.name}
                badge={field("status")}
                meta={[
                  <span key="spent"><Money cents={row.spend.spentCents} /> of <Money cents={row.limitCents} trimWholeCents /> · {row.spend.percentSpent}%</span>,
                  row.cycleLabel,
                ]}
                detail={[record.assignedTo]}
                onOpen={open}
                selecting={selecting}
              />
            );
          }}
          emptyState={
            <EmptyState icon={<Gauge size={20} />} title={`No ${tab} spend budgets`} description="Give a committee or a few people a monthly, quarterly or one-time limit for their expense claims." action={canWrite && tab === "active" ? <button type="button" className="btn btn--sm btn--accent" onClick={() => setEditing({ budget: null })}><Plus size={12} aria-hidden="true" /> New budget</button> : undefined} />
          }
        />
      </div>

      {open && !editing && <SpendBudgetDetail budget={open} canWrite={canWrite} onClose={() => setOpenId(null)} onEdit={() => setEditing({ budget: open })} />}
      <SpendBudgetDrawer open={Boolean(editing)} budget={editing?.budget ?? null} societyId={society._id} data={data} onClose={() => setEditing(null)} />
    </div>
  );
}
