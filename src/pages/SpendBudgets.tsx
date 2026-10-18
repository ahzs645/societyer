import { useMemo, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { Link } from "react-router-dom";
import { Archive, ArchiveRestore, ClipboardCheck, Gauge, MoreHorizontal, Pencil, Plus, Trash2 } from "lucide-react";
import { api } from "@/lib/convexApi";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, EmptyState } from "../components/ui";
import { Progress, Tabs } from "../components/primitives";
import { Menu } from "../components/Menu";
import { Money } from "../components/Money";
import { StatTile } from "../components/StatTile";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { formatDate, pluralize } from "../lib/format";
import { SpendBudgetDrawer } from "../features/financials/spendBudgets/SpendBudgetDrawer";
import { BUDGET_STATUS_TONE, SpendBudgetDetail, spendTone, windowLabel } from "../features/financials/spendBudgets/SpendBudgetDetail";
import { errorMessage } from "../features/financials/banking/types";
import type { SpendBudgetRow, SpendBudgetsData } from "../features/financials/spendBudgets/types";

type BudgetTab = "active" | "upcoming" | "ended" | "archived";

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
            <button type="button" className="btn-action btn-action--primary" disabled={!canWrite} onClick={() => setEditing({ budget: null })}>
              <Plus size={12} aria-hidden="true" /> New budget
            </button>
          </>
        }
      />

      <div className="stat-grid">
        <StatTile label="Active budgets" value={summary?.activeCount ?? "—"} sub={summary?.upcomingCount ? `${summary.upcomingCount} upcoming` : undefined} />
        <StatTile label="Limit this cycle" value={<Money variant="hero" trimWholeCents cents={summary?.limitCents} />} />
        <StatTile label="Spent" value={<Money variant="hero" trimWholeCents cents={summary?.spentCents} />} sub={summary?.limitCents ? `${Math.round(((summary.spentCents ?? 0) / summary.limitCents) * 100)}% of active limits` : undefined} />
        <StatTile label="Remaining" value={<Money variant="hero" trimWholeCents cents={summary?.remainingCents} />} tone={summary?.overLimitCount ? "danger" : "neutral"} sub={summary?.overLimitCount ? `${pluralize(summary.overLimitCount, "budget")} over the limit` : "Across active budgets"} />
      </div>

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
        {data === undefined ? (
          <div className="card__body"><div className="record-table__loading">{Array.from({ length: 4 }).map((_, i) => <div key={i} className="record-table__loading-row" />)}</div></div>
        ) : rows.length === 0 ? (
          <div className="card__body">
            <EmptyState icon={<Gauge size={20} />} title={`No ${tab} spend budgets`} description="Give a committee or a few people a monthly, quarterly or one-time limit for their expense claims." action={canWrite && tab === "active" ? <button type="button" className="btn btn--sm btn--accent" onClick={() => setEditing({ budget: null })}><Plus size={12} aria-hidden="true" /> New budget</button> : undefined} />
          </div>
        ) : (
          <table className="table table--comfortable spend-budgets-table">
            <thead>
              <tr>
                <th>Budget</th>
                <th>Assigned to</th>
                <th>Resets</th>
                <th>Status</th>
                <th className="spend-budgets-table__spend">Spent this cycle</th>
                <th className="num">Remaining</th>
                <th className="spend-budgets-table__actions"><span className="sr-only">Actions</span></th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row._id} onClick={() => setOpenId(row._id)}>
                  <td data-label="Budget">
                    <button type="button" className="approvals-table__title" onClick={(event) => { event.stopPropagation(); setOpenId(row._id); }}>{row.name}</button>
                    <span className="muted spend-budgets-table__meta">{formatDate(row.startDate)}{row.endDate ? ` – ${formatDate(row.endDate)}` : " onward"}</span>
                  </td>
                  <td data-label="Assigned to">{[row.committeeName, ...row.memberNames].filter(Boolean).join(", ") || <span className="muted">—</span>}</td>
                  <td data-label="Resets">{row.cycleLabel}</td>
                  <td data-label="Status"><Badge tone={BUDGET_STATUS_TONE[row.status]}>{row.archived ? "Archived" : row.statusLabel}</Badge></td>
                  <td data-label="Spent this cycle" className="spend-budgets-table__spend">
                    <span className="spend-budgets-table__figures"><Money cents={row.spend.spentCents} /> <span className="muted">of <Money cents={row.limitCents} trimWholeCents /></span> <strong>{row.spend.percentSpent}%</strong></span>
                    <Progress value={row.spend.percentSpent} tone={spendTone(row)} />
                    <span className="muted spend-budgets-table__meta">{windowLabel(row)}</span>
                  </td>
                  <td data-label="Remaining" className="num"><Money cents={row.spend.remainingCents} tone={row.spend.overLimit ? "out" : "auto"} /></td>
                  <td className="spend-budgets-table__actions" onClick={(event) => event.stopPropagation()}>
                    <Menu
                      align="right"
                      label={`Actions for ${row.name}`}
                      trigger={<button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${row.name}`}><MoreHorizontal size={14} /></button>}
                      sections={[
                        { id: "edit", items: [{ id: "edit", label: "Edit", icon: <Pencil size={14} />, disabled: !canWrite, onSelect: () => setEditing({ budget: row }) }] },
                        {
                          id: "archive",
                          items: [
                            row.archived
                              ? { id: "restore", label: "Restore", icon: <ArchiveRestore size={14} />, disabled: !canWrite, onSelect: () => void archive(row, false) }
                              : { id: "archive", label: "Archive", icon: <Archive size={14} />, disabled: !canWrite, onSelect: () => void archive(row, true) },
                            { id: "delete", label: "Delete", icon: <Trash2 size={14} />, destructive: true, disabled: !canWrite || row.claims.length > 0, hint: row.claims.length ? "Has claims" : undefined, onSelect: () => void del(row) },
                          ],
                        },
                      ]}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {open && !editing && <SpendBudgetDetail budget={open} canWrite={canWrite} onClose={() => setOpenId(null)} onEdit={() => setEditing({ budget: open })} />}
      <SpendBudgetDrawer open={Boolean(editing)} budget={editing?.budget ?? null} societyId={society._id} data={data} onClose={() => setEditing(null)} />
    </div>
  );
}
