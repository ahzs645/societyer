import { useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { EmptyState, SkeletonRows } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { formatDate } from "../../../lib/format";
import type { CostPeriod } from "../../../../shared/costPlanning";
import { PlanningQueryBoundary } from "./usePlanningSources";
import type { Archived } from "./planningFormUtils";

export type PeriodRow = Archived<CostPeriod>;
export type PlanningWorkspace = {
  periods: PeriodRow[];
  selectedPeriod: PeriodRow | null;
  isDone: boolean;
  continueCursor: string;
  today: string;
  baseCurrency: string | null;
  baseCurrencyWarning?: string | null;
  jurisdiction?: string;
  organization: { name: string };
};

export function periodDates(period: PeriodRow) {
  return `${formatDate(period.startDate)}–${formatDate(period.endDate)} · ${period.currency}`;
}

/** The saved periods to choose from, with archived ones on request and further pages on demand. */
export function SavedPeriodsCard({
  societyId,
  workspace,
  archived,
  onArchived,
  selectedId,
  onSelect,
}: {
  societyId: string;
  workspace: PlanningWorkspace;
  archived: boolean;
  onArchived: (archived: boolean) => void;
  selectedId?: string;
  onSelect: (id: string) => void;
}) {
  return (
    <section className="card" aria-label="Saved planning periods">
      <div className="card__head">
        <h2 className="card__title">Saved periods</h2>
        <div className="cost-planner__head-actions">
          <Checkbox checked={archived} onChange={onArchived} label="Show archived periods" />
        </div>
      </div>
      <div className="card__body">
        {workspace.periods.length > 0 ? (
          <nav className="cost-planner__periods" aria-label="Choose planning period">
            {workspace.periods.map((saved) => (
              <PeriodButton key={saved._id} period={saved} selected={selectedId === saved._id} onSelect={onSelect} />
            ))}
          </nav>
        ) : (
          <EmptyState
            size="sm"
            align="start"
            title={archived ? "No archived periods" : "No saved periods yet"}
            description={archived ? undefined : "Create a semester or choose custom dates."}
          />
        )}
        <MorePeriods
          key={`${societyId}:${archived}`}
          societyId={societyId}
          archived={archived}
          cursor={!workspace.isDone ? workspace.continueCursor : undefined}
          selectedId={selectedId}
          onSelect={onSelect}
        />
      </div>
    </section>
  );
}

function PeriodButton({
  period,
  selected,
  onSelect,
}: {
  period: PeriodRow;
  selected: boolean;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      className={`cost-planner__period${selected ? " is-selected" : ""}`}
      aria-pressed={selected}
      onClick={() => onSelect(period._id)}
    >
      <strong>{period.name}</strong>
      <small>{periodDates(period)}</small>
    </button>
  );
}

type PeriodPageProps = {
  societyId: string;
  archived: boolean;
  selectedId?: string;
  onSelect: (id: string) => void;
};

function MorePeriods({ cursor, ...props }: PeriodPageProps & { cursor?: string }) {
  const [open, setOpen] = useState(false);
  const [attempt, setAttempt] = useState(0);
  if (!cursor) return null;
  if (!open) {
    return (
      <button type="button" className="btn btn--sm" onClick={() => setOpen(true)}>
        Load more periods
      </button>
    );
  }
  return (
    <PlanningQueryBoundary key={attempt} label="More planning periods" onRetry={() => setAttempt((old) => old + 1)}>
      <PeriodPage {...props} cursor={cursor} />
    </PlanningQueryBoundary>
  );
}

function PeriodPage({ societyId, archived, cursor, selectedId, onSelect }: PeriodPageProps & { cursor: string }) {
  const response = useQuery(api.costPlanning.workspace, { societyId, cursor, archived }) as
    | PlanningWorkspace
    | undefined;
  if (!response) return <SkeletonRows rows={2} columns={2} />;
  if (!response.isDone && (!response.continueCursor || response.continueCursor === cursor)) {
    throw new Error("Period pagination did not advance. Retry loading saved periods.");
  }
  return (
    <>
      <nav className="cost-planner__periods" aria-label="More planning periods">
        {response.periods.map((period) => (
          <PeriodButton key={period._id} period={period} selected={selectedId === period._id} onSelect={onSelect} />
        ))}
      </nav>
      <MorePeriods
        societyId={societyId}
        archived={archived}
        cursor={response.isDone ? undefined : response.continueCursor}
        selectedId={selectedId}
        onSelect={onSelect}
      />
    </>
  );
}
