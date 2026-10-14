import { useCallback, useState } from "react";
import { useMutation, useQuery } from "convex/react";
import { CalendarClock, PiggyBank, Plus, Shield, TrendingUp } from "lucide-react";
import { api } from "@/lib/convexApi";
import { ObjectRecordTable, RecordTableEmpty } from "@/platform/record-engine";
import { useFinancePermissions } from "@/hooks/useFinancePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { StatTile } from "../components/StatTile";
import { Money } from "../components/Money";
import { formatDate, pluralize } from "../lib/format";
import { HOLDING_STATUS_LABEL } from "../../shared/businessRegisters";
import { HoldingDrawer } from "../features/businessRegisters/HoldingDrawer";
import { useOnceWhen } from "../features/businessRegisters/formHelpers";
import type { InvestmentsWorkspace } from "../features/businessRegisters/types";

const STATUS_TONE = { active: "success", maturing: "warn", matured: "danger", redeemed: "neutral" } as const;

/**
 * Investments register: GICs, term deposits, savings and investment accounts
 * held as reserves, with accrued interest, restricted versus unrestricted
 * money, and reminders 30 and 7 days before each maturity on the Deadlines
 * page. Buying, renewing and redeeming happen with the institution.
 */
export function InvestmentsPage() {
  const society = useSociety();
  const { canWrite } = useFinancePermissions();
  const workspace = useQuery(api.investments.workspace, society ? { societyId: society._id } : "skip") as InvestmentsWorkspace | undefined;
  const syncDeadlines = useMutation(api.payroll.syncDeadlines);
  const [drawer, setDrawer] = useState<{ id: string | null } | null>(null);

  const runSync = useCallback(() => {
    if (society) void syncDeadlines({ societyId: society._id }).catch(() => undefined);
  }, [society, syncDeadlines]);
  useOnceWhen(Boolean(canWrite && workspace && workspace.deadlineChanges > 0), runSync);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const reserves = workspace?.reserves;
  const active = drawer?.id ? workspace?.holdings.find((row) => row._id === drawer.id) ?? null : null;

  return (
    <div className="page business-register-page">
      <PageHeader
        title="Investments"
        icon={<TrendingUp size={16} />}
        iconColor="green"
        subtitle="Reserves held in GICs, term deposits, savings and investment accounts."
        info={
          <p>
            Record each holding with its principal, rate and term. Interest accrues day by day on an actual/365 basis, and reminders land on the Deadlines page 30 and 7 days before a holding matures.
            Holdings tied to a restricted fund count as restricted reserves.
          </p>
        }
        actions={
          <button type="button" className="btn-action btn-action--primary" disabled={!canWrite || !workspace} onClick={() => setDrawer({ id: null })}>
            <Plus size={12} aria-hidden="true" /> New holding
          </button>
        }
      />

      <div className="stat-grid" role="group" aria-label="Reserves summary">
        <StatTile
          label="Invested reserves"
          icon={<PiggyBank size={14} />}
          value={<Money variant="hero" trimWholeCents cents={reserves ? reserves.totalCents : null} />}
          sub={reserves ? `${pluralize(reserves.activeCount, "holding")}, interest included` : undefined}
        />
        <StatTile
          label="Unrestricted"
          icon={<TrendingUp size={14} />}
          value={<Money variant="hero" trimWholeCents cents={reserves ? reserves.unrestrictedCents : null} />}
        />
        <StatTile
          label="Restricted"
          icon={<Shield size={14} />}
          value={<Money variant="hero" trimWholeCents cents={reserves ? reserves.restrictedCents : null} />}
          sub="Held for a restricted fund or purpose"
        />
        <StatTile
          label="Next maturity"
          icon={<CalendarClock size={14} />}
          compact
          value={reserves?.nextMaturity ? formatDate(reserves.nextMaturity.date) : reserves ? "None scheduled" : "—"}
          sub={reserves?.nextMaturity ? `${reserves.nextMaturity.name}, in ${pluralize(reserves.nextMaturity.daysAway, "day")}` : undefined}
          subTone={reserves?.nextMaturity && reserves.nextMaturity.daysAway <= 30 ? "warn" : undefined}
        />
      </div>

      <ObjectRecordTable
        societyId={society._id}
        nameSingular="investmentHolding"
        label="All holdings"
        objectLabel="investment"
        icon={<PiggyBank size={14} />}
        records={workspace?.holdings ?? []}
        loading={workspace === undefined}
        onRecordClick={(id) => setDrawer({ id })}
        renderCell={({ record, field }) => {
          if (field.name === "effectiveStatus") return <Badge tone={STATUS_TONE[record.effectiveStatus as keyof typeof STATUS_TONE] ?? "neutral"}>{HOLDING_STATUS_LABEL[record.effectiveStatus as keyof typeof HOLDING_STATUS_LABEL] ?? record.effectiveStatus}</Badge>;
          if (field.name === "restricted") return record.restricted ? <Badge tone="purple">{record.fundName ?? "Restricted"}</Badge> : <span className="muted">Unrestricted</span>;
          if (field.name === "ratePercent") return record.ratePercent !== undefined ? <span className="num">{Number(record.ratePercent).toFixed(2)}%</span> : <span className="muted">—</span>;
          if (field.name === "maturityDate") return record.maturityDate ? <span className="num">{formatDate(record.maturityDate)}</span> : <span className="muted">No term</span>;
          return undefined;
        }}
        emptyState={
          <RecordTableEmpty
            title="No investments yet"
            description="Add a GIC, term deposit, savings or investment account the organization holds as reserves."
            action={canWrite ? <button className="btn btn--accent btn--sm" onClick={() => setDrawer({ id: null })}><Plus size={12} /> New holding</button> : undefined}
          />
        }
      />

      <HoldingDrawer open={drawer !== null} onClose={() => setDrawer(null)} societyId={society._id} holding={active} funds={workspace?.funds ?? []} canWrite={canWrite} today={workspace?.today ?? ""} />
    </div>
  );
}
