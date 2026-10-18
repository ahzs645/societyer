import { CitationBadge } from "../components/CitationTooltip";
import { calendarDateKey } from "../lib/calendarDates";
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  ChevronDown,
  Circle,
  Clock,
  FileCheck2,
  Gavel,
  Info,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Badge } from "../components/ui";
import { Select } from "../components/Select";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { InfoPopover } from "../components/InfoPopover";
import { formatDate, relative } from "../lib/format";
import { organizationVocabulary, type OrganizationVocabulary } from "../lib/organizationVocabulary";
import { StatTile } from "../components/StatTile";
import { useIsMobile } from "../lib/useIsMobile";

type CycleItem = {
  id: string;
  phase: "before" | "during" | "after" | "ongoing";
  title: string;
  detail: string;
  status: "complete" | "attention" | "blocked" | "upcoming";
  evidence: string[];
  sourceIds?: readonly string[];
  dueDate?: string;
  to: string;
  actionLabel: string;
};

type Phase = {
  id: "before" | "during" | "after" | "ongoing";
  title: string;
  subtitle: string;
  icon: typeof CalendarCheck;
};

const PHASES: Phase[] = [
  {
    id: "before",
    title: "Before AGM",
    subtitle: "Financials, notice, agenda, member register, director terms, motions.",
    icon: CalendarCheck,
  },
  {
    id: "during",
    title: "During AGM",
    subtitle: "Attendance, quorum, votes, elections, financial presentation, minutes.",
    icon: Gavel,
  },
  {
    id: "after",
    title: "After AGM",
    subtitle: "Approved minutes, annual report evidence, director changes, minute book.",
    icon: FileCheck2,
  },
  {
    id: "ongoing",
    title: "Ongoing",
    subtitle: "Privacy, conflicts, retention, policy reviews, deadlines, member register updates.",
    icon: ShieldCheck,
  },
];

/** Corporations hold an annual meeting of shareholders, not a society AGM. */
const CORPORATE_PHASE_COPY: Record<Phase["id"], Pick<Phase, "title" | "subtitle">> = {
  before: { title: "Before annual meeting", subtitle: "Financials, notice, agenda, shareholder register, director terms, resolutions." },
  during: { title: "During annual meeting", subtitle: "Attendance, quorum, votes, director elections, financial presentation, minutes." },
  after: { title: "After annual meeting", subtitle: "Approved minutes, annual filing evidence, director changes, minute book." },
  ongoing: { title: "Ongoing", subtitle: "Privacy, conflicts, retention, policy reviews, deadlines, register updates." },
};

function phasesFor(entity: OrganizationVocabulary): Phase[] {
  return entity.isCorporation ? PHASES.map((phase) => ({ ...phase, ...CORPORATE_PHASE_COPY[phase.id] })) : PHASES;
}

export function AnnualCyclePage() {
  const society = useSociety();
  const [year, setYear] = useState(new Date().getFullYear());
  const isMobile = useIsMobile();
  const data = useQuery(api.annualCycle.summary, society ? { societyId: society._id, year } : "skip");

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }, []);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (!data) return <PageLoading />;

  const entity = organizationVocabulary(society);
  const visiblePhases = phasesFor(entity);
  const phases = data.phases ?? {};
  const fallbackItems = visiblePhases.flatMap((phase) => phases[phase.id] ?? []) as CycleItem[];
  const counts = data.counts ?? {
    completed: fallbackItems.filter((item) => item.status === "complete").length,
    total: fallbackItems.length,
    blocked: fallbackItems.filter((item) => item.status === "blocked").length,
    attention: fallbackItems.filter((item) => item.status === "attention").length,
    votingMembers: 0,
    activeDirectors: 0,
  };
  const progress = counts.total > 0 ? Math.round((counts.completed / counts.total) * 100) : 0;
  const nextItem = (data.nextItem ?? fallbackItems.find((item) => item.status !== "complete") ?? fallbackItems[0]) as CycleItem | undefined;

  const attentionItems = fallbackItems
    .filter((item) => item.status === "blocked" || item.status === "attention")
    .sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status]);
  const filed = data.annualReport?.status === "Filed";
  const reportOverdue = !filed
    && !!data.annualReportDueDate && data.annualReportDueDate < calendarDateKey(new Date());

  return (
    <div className="page">
      <PageHeader
        title="Annual cycle"
        icon={<ListChecks size={16} />}
        iconColor="orange"
        subtitle={`This year's ${entity.annualMeeting}, filings and records in one checklist.`}
        info={<p>A guided compliance view that pulls {entity.isSociety ? "AGM" : "the annual meeting"}, filings, financials, records, and ongoing governance into one workflow.</p>}
        actions={
          <Select
            value={String(year)}
            onChange={(value) => setYear(Number(value))}
            options={years.map((option) => ({ value: String(option), label: String(option) }))}
          />
        }
      />

      <section className="onboarding-flow annual-cycle-hero" aria-labelledby="annual-cycle-title">
        {isMobile ? (
          /* Phones: phase and progress in one line; the facts the desktop shows
             as stat tiles fold into a single wrap-around line under the bar. */
          <div className="onboarding-flow__story">
            <div>
              <span className="onboarding-flow__eyebrow">Current phase</span>
              <h2 id="annual-cycle-title">{data.currentStage ?? "Annual cycle"}</h2>
            </div>
            <div className="onboarding-flow__status">
              <span className="mono">{progress}%</span>
              <span>{counts.completed}/{counts.total} ready</span>
            </div>
          </div>
        ) : (
          <div className="onboarding-flow__story">
            <div>
              <h2 id="annual-cycle-title">{data.society?.name ?? entity.organizationTitle} annual compliance cycle</h2>
              <p>
                {data.currentStage ?? "Annual cycle"}. {counts.completed}/{counts.total} evidence checks are complete,
                with {counts.blocked} blocked and {counts.attention} needing attention.
              </p>
            </div>
            <div className="onboarding-flow__status">
              <span className="mono">{progress}%</span>
              <span>evidence ready</span>
            </div>
          </div>
        )}

        <div className="onboarding-flow__bar" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>

        {isMobile && <CycleFacts variant="line" entity={entity} counts={counts} dueDate={data.annualReportDueDate} filed={filed} overdue={reportOverdue} />}

        <div className="onboarding-flow__next">
          <div>
            <span className="onboarding-flow__eyebrow">Next action</span>
            <strong>{nextItem?.title ?? "No next action"}</strong>
            <span>{nextItem?.detail ? humanDates(nextItem.detail) : "No annual-cycle evidence checks are available yet."}</span>
            {isMobile && nextItem?.dueDate && (
              <span>Due {formatDate(nextItem.dueDate)} · {relative(nextItem.dueDate)}</span>
            )}
          </div>
          {nextItem && (
            <Link to={appPath(nextItem.to)} className="btn-action btn-action--primary">
              {nextItem.actionLabel} <ArrowRight size={12} />
            </Link>
          )}
        </div>
      </section>

      {!isMobile && <CycleFacts variant="tiles" entity={entity} counts={counts} dueDate={data.annualReportDueDate} filed={filed} overdue={reportOverdue} />}

      {isMobile ? (
        <MobileCycle phases={visiblePhases} itemsByPhase={phases} attentionItems={attentionItems} nextItemId={nextItem?.id} />
      ) : (
        <PhaseGrid phases={visiblePhases} itemsByPhase={phases} />
      )}

      {(data.caveats ?? []).length > 0 && (
        <details
          className="muted"
          style={{
            marginTop: 24,
            paddingTop: 12,
            borderTop: "1px solid var(--border)",
            fontSize: "var(--fs-sm)",
            lineHeight: 1.5,
          }}
        >
          <summary
            style={{
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              gap: 6,
              listStyle: "none",
              userSelect: "none",
            }}
          >
            <Info size={13} />
            <strong style={{ fontWeight: 600, flexShrink: 0 }}>Caveats</strong>
            <span>· Rules are evidence checks, not legal conclusions</span>
          </summary>
          <ul style={{ margin: "8px 0 0", paddingLeft: 24 }}>
            {(data.caveats ?? []).map((caveat: string) => (
              <li key={caveat} style={{ margin: "2px 0" }}>{caveat}</li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

type CycleCounts = { completed: number; total: number; blocked: number; attention: number; votingMembers: number; activeDirectors: number };

/** The cycle's headline numbers: stat tiles on desktop, one wrapping line on phones. */
function CycleFacts({
  variant,
  entity,
  counts,
  dueDate,
  filed,
  overdue,
}: {
  variant: "tiles" | "line";
  entity: OrganizationVocabulary;
  counts: CycleCounts;
  dueDate?: string | null;
  filed: boolean;
  overdue: boolean;
}) {
  if (variant === "line") {
    return (
      <ul className="annual-cycle-facts" aria-label="Cycle facts">
        {counts.blocked > 0 && <li className="annual-cycle-facts__danger">{counts.blocked} blocked</li>}
        {counts.attention > 0 && <li className="annual-cycle-facts__warn">{counts.attention} need work</li>}
        <li className={filed ? "annual-cycle-facts__ok" : overdue ? "annual-cycle-facts__danger" : undefined}>
          Annual report {filed ? "filed" : `due ${dueDate ? formatDate(dueDate) : "not computed"}`}
        </li>
        {entity.isSociety && <li>{counts.votingMembers} voting members</li>}
        <li>{counts.activeDirectors} active directors</li>
      </ul>
    );
  }
  return (
    <div className="stat-grid stat-grid--3 annual-cycle-stats">
      {/* votingMembers counts the society member register. */}
      {entity.isSociety && <StatTile label="Voting members" value={counts.votingMembers} icon={<Circle size={14} />} />}
      <StatTile label="Active directors" value={counts.activeDirectors} icon={<ShieldCheck size={14} />} />
      <StatTile
        label="Annual report due"
        value={dueDate ? formatDate(dueDate) : "Not computed"}
        icon={<FileCheck2 size={14} />}
        // Red only when the report itself is overdue, not because some other
        // cycle item is blocked (G-12).
        tone={filed ? "ok" : overdue ? "danger" : undefined}
      />
    </div>
  );
}

function PhaseGrid({ phases, itemsByPhase }: { phases: Phase[]; itemsByPhase: Partial<Record<string, unknown[]>> }) {
  return (
    <div className="annual-cycle-phase-grid">
      {phases.map((phase) => {
        const items = (itemsByPhase[phase.id] ?? []) as CycleItem[];
        const complete = items.filter((item) => item.status === "complete").length;
        const Icon = phase.icon;
        return (
          <section className="card" key={phase.id}>
            <div className="card__head" style={{ alignItems: "flex-start" }}>
              <div className="row" style={{ gap: 8 }}>
                <Icon size={16} style={{ color: "var(--accent)" }} />
                <div>
                  <div className="row" style={{ gap: 4, flexWrap: "nowrap" }}>
                    <h2 className="card__title">{phase.title}</h2>
                    <InfoPopover label={`About ${phase.title}`}><p>{phase.subtitle}</p></InfoPopover>
                  </div>
                  <div className="card__subtitle">{complete}/{items.length} complete</div>
                </div>
              </div>
            </div>
            {/* Steps that need work stay full cards; ready and upcoming steps
                are one-line rows that open to the same detail. */}
            <div className="card__body col" style={{ gap: 6 }}>
              {items.map((item) => needsWork(item)
                ? <CycleCard key={item.id} item={item} />
                : <CycleRow key={item.id} item={item} />)}
            </div>
          </section>
        );
      })}
    </div>
  );
}

const STATUS_ORDER: Record<CycleItem["status"], number> = { blocked: 0, attention: 1, upcoming: 2, complete: 3 };

function needsWork(item: CycleItem) {
  return item.status === "blocked" || item.status === "attention";
}

/**
 * Phones: the hero carries the one next action, then the steps that need work
 * as cards, then every other step folded into its phase. Each phase summary
 * keeps the phase's full done/total so the count matches the desktop columns.
 */
function MobileCycle({
  phases,
  itemsByPhase,
  attentionItems,
  nextItemId,
}: {
  phases: Phase[];
  itemsByPhase: Partial<Record<string, unknown[]>>;
  attentionItems: CycleItem[];
  nextItemId?: string;
}) {
  const cards = attentionItems.filter((item) => item.id !== nextItemId);
  const shownAbove = new Set([...cards.map((item) => item.id), ...(nextItemId ? [nextItemId] : [])]);
  return (
    <>
      {cards.length > 0 && (
        <section className="annual-cycle-section" aria-labelledby="annual-cycle-attention">
          <h2 id="annual-cycle-attention" className="annual-cycle-section__title">
            Needs attention <span className="annual-cycle-section__count">{cards.length}</span>
          </h2>
          <div className="col" style={{ gap: 8 }}>
            {cards.map((item) => <CycleCard key={item.id} item={item} />)}
          </div>
        </section>
      )}

      <section className="annual-cycle-section" aria-labelledby="annual-cycle-phases">
        <h2 id="annual-cycle-phases" className="annual-cycle-section__title">All steps by phase</h2>
        <div className="annual-cycle-phases">
          {phases.map((phase) => {
            const items = (itemsByPhase[phase.id] ?? []) as CycleItem[];
            const complete = items.filter((item) => item.status === "complete").length;
            const rest = items.filter((item) => !shownAbove.has(item.id));
            const above = items.length - rest.length;
            const Icon = phase.icon;
            return (
              <details className="annual-cycle-phase" key={phase.id}>
                <summary className="annual-cycle-phase__head">
                  <Icon size={16} aria-hidden="true" className="annual-cycle-phase__icon" />
                  <span className="annual-cycle-phase__title">{phase.title}</span>
                  <span className="annual-cycle-phase__count" aria-label={`${complete} of ${items.length} complete`}>
                    {complete}/{items.length}
                  </span>
                  <ChevronDown size={16} aria-hidden="true" className="annual-cycle-phase__chevron" />
                </summary>
                <div className="annual-cycle-phase__body">
                  <p className="annual-cycle-phase__subtitle">{phase.subtitle}</p>
                  {rest.map((item) => <CycleRow key={item.id} item={item} />)}
                  {above > 0 && (
                    <p className="annual-cycle-phase__note">
                      {above === 1 ? "1 more step" : `${above} more steps`} in this phase {above === 1 ? "is" : "are"} listed above.
                    </p>
                  )}
                </div>
              </details>
            );
          })}
        </div>
      </section>
    </>
  );
}

function StatusIcon({ status }: { status: CycleItem["status"] }) {
  const Icon = status === "complete"
    ? CheckCircle2
    : status === "blocked"
      ? AlertTriangle
      : status === "attention"
        ? Clock
        : Circle;
  return <Icon size={16} aria-hidden="true" style={{ flexShrink: 0, color: statusColor(status) }} />;
}

/** Sources and evidence: the supporting detail behind a step. */
function StepSources({ item }: { item: CycleItem }) {
  return (
    <>
      {!!item.sourceIds?.length && (
        <div className="annual-cycle-sources">{item.sourceIds.map((id) => <CitationBadge key={id} citationId={id} />)}</div>
      )}
      {item.evidence.length > 0 && (
        <div className="annual-cycle-evidence-list">
          <span className="annual-cycle-evidence-list__label">Evidence</span>
          <ul>
            {item.evidence.map((evidence) => <li key={evidence}>{humanDates(evidence)}</li>)}
          </ul>
        </div>
      )}
    </>
  );
}

/**
 * A ready or upcoming step as one line: status, title and due date. The whole
 * line toggles the step open in place, where the legal detail, sources,
 * evidence and the step's own link live.
 */
function CycleRow({ item }: { item: CycleItem }) {
  return (
    <details className="annual-cycle-row">
      <summary className="annual-cycle-row__head">
        <StatusIcon status={item.status} />
        <span className="annual-cycle-row__title">{item.title}</span>
        <span className="sr-only">{statusLabel(item.status)}</span>
        <span className="annual-cycle-row__meta">
          {item.dueDate ? formatDate(item.dueDate, "MMM d") : statusLabel(item.status)}
        </span>
        <ChevronDown size={14} aria-hidden="true" className="annual-cycle-row__chevron" />
      </summary>
      <div className="annual-cycle-row__body">
        <div className="row" style={{ gap: 6 }}>
          <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
          {item.dueDate && <span className="muted">Due {formatDate(item.dueDate)} · {relative(item.dueDate)}</span>}
        </div>
        <p>{humanDates(item.detail)}</p>
        <StepSources item={item} />
        <Link to={appPath(item.to)} className="btn-action" style={{ alignSelf: "flex-start" }}>
          {item.actionLabel} <ArrowRight size={12} />
        </Link>
      </div>
    </details>
  );
}

function CycleCard({ item }: { item: CycleItem }) {
  const sourceCount = (item.sourceIds?.length ?? 0) + item.evidence.length;
  return (
    <div
      className="annual-cycle-card"
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        background: item.status === "blocked" ? "var(--danger-soft)" : item.status === "attention" ? "var(--warn-soft)" : "var(--bg-panel)",
      }}
    >
      <div className="row" style={{ alignItems: "flex-start", gap: 8, flexWrap: "nowrap" }}>
        <span style={{ marginTop: 2, display: "inline-flex" }}><StatusIcon status={item.status} /></span>
        <div className="col" style={{ flex: 1, gap: 6, minWidth: 0 }}>
          <div
            className="row"
            style={{ justifyContent: "space-between", gap: 8, alignItems: "flex-start", flexWrap: "nowrap" }}
          >
            <strong>{item.title}</strong>
            <span style={{ flexShrink: 0 }}>
              <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
            </span>
          </div>
          <div className="muted annual-cycle-card__detail" style={{ fontSize: "var(--fs-sm)" }}>{humanDates(item.detail)}</div>
          {item.dueDate && (
            <div className="muted" style={{ fontSize: "var(--fs-xs)" }}>
              Due {formatDate(item.dueDate)} · {relative(item.dueDate)}
            </div>
          )}
          {/* Sources and evidence sit behind one toggle beside the step's link,
              so the reason and the action stay together. */}
          <div className="annual-cycle-card__foot">
            <Link to={appPath(item.to)} className="btn-action">
              {item.actionLabel} <ArrowRight size={12} />
            </Link>
            {sourceCount > 0 && (
              <details className="disclosure annual-cycle-evidence">
                <summary>
                  {item.evidence.length > 0 ? `Evidence (${item.evidence.length})` : `Sources (${item.sourceIds?.length ?? 0})`}
                </summary>
                <div className="col" style={{ gap: 6, marginTop: 6 }}>
                  <StepSources item={item} />
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

/** Server-written details cite ISO days ("due 2027-01-31"); show the app's date format. */
function humanDates(text: string) {
  return text.replace(/\b(\d{4}-\d{2}-\d{2})\b/g, (iso) => formatDate(iso));
}

function appPath(to: string) {
  return to.startsWith("/app") ? to : `/app${to}`;
}

function statusTone(status: CycleItem["status"]) {
  if (status === "complete") return "success";
  if (status === "blocked") return "danger";
  if (status === "attention") return "warn";
  return "info";
}

function statusColor(status: CycleItem["status"]) {
  if (status === "complete") return "var(--success)";
  if (status === "blocked") return "var(--danger)";
  if (status === "attention") return "var(--warn)";
  return "var(--text-tertiary)";
}

function statusLabel(status: CycleItem["status"]) {
  if (status === "complete") return "Ready";
  if (status === "blocked") return "Blocked";
  if (status === "attention") return "Needs work";
  return "Upcoming";
}
