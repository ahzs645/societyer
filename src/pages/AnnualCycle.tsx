import { type ReactNode, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import {
  AlertTriangle,
  ArrowRight,
  CalendarCheck,
  CheckCircle2,
  Circle,
  Clock,
  FileCheck2,
  Gavel,
  ListChecks,
  ShieldCheck,
} from "lucide-react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { Badge } from "../components/ui";
import { PageHeader, SeedPrompt } from "./_helpers";
import { formatDate, relative } from "../lib/format";

type CycleItem = {
  id: string;
  phase: "before" | "during" | "after" | "ongoing";
  title: string;
  detail: string;
  status: "complete" | "attention" | "blocked" | "upcoming";
  evidence: string[];
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
    subtitle: "PIPA, conflicts, retention, policy reviews, deadlines, member register updates.",
    icon: ShieldCheck,
  },
];

export function AnnualCyclePage() {
  const society = useSociety();
  const [year, setYear] = useState(new Date().getFullYear());
  const data = useQuery(api.annualCycle.summary, society ? { societyId: society._id, year } : "skip");

  const years = useMemo(() => {
    const current = new Date().getFullYear();
    return [current - 1, current, current + 1];
  }, []);

  if (society === undefined) return <div className="page">Loading...</div>;
  if (society === null) return <SeedPrompt />;
  if (!data) return <div className="page">Loading...</div>;

  const progress = Math.round((data.counts.completed / data.counts.total) * 100);
  const nextItem = data.nextItem as CycleItem;

  return (
    <div className="page">
      <PageHeader
        title="Annual Cycle"
        icon={<ListChecks size={16} />}
        iconColor="orange"
        subtitle="A guided compliance view that pulls AGM, filings, financials, records, and ongoing governance into one workflow."
        actions={
          <select className="input" value={year} onChange={(event) => setYear(Number(event.target.value))}>
            {years.map((option) => (
              <option key={option} value={option}>{option}</option>
            ))}
          </select>
        }
      />

      <section className="onboarding-flow" aria-labelledby="annual-cycle-title">
        <div className="onboarding-flow__story">
          <div>
            <h2 id="annual-cycle-title">{data.society?.name ?? "Society"} annual compliance cycle</h2>
            <p>
              {data.currentStage}. {data.counts.completed}/{data.counts.total} evidence checks are complete,
              with {data.counts.blocked} blocked and {data.counts.attention} needing attention.
            </p>
          </div>
          <div className="onboarding-flow__status">
            <span className="mono">{progress}%</span>
            <span>evidence ready</span>
          </div>
        </div>

        <div className="onboarding-flow__bar" aria-hidden="true">
          <span style={{ width: `${progress}%` }} />
        </div>

        <div className="onboarding-flow__next">
          <div>
            <span className="onboarding-flow__eyebrow">Next action</span>
            <strong>{nextItem.title}</strong>
            <span>{nextItem.detail}</span>
          </div>
          <Link to={appPath(nextItem.to)} className="btn-action btn-action--primary">
            {nextItem.actionLabel} <ArrowRight size={12} />
          </Link>
        </div>
      </section>

      <div className="stat-grid">
        <Stat label="Stage" value={data.currentStage} icon={<Clock size={14} />} />
        <Stat label="Voting members" value={data.counts.votingMembers} icon={<Circle size={14} />} />
        <Stat label="Active directors" value={data.counts.activeDirectors} icon={<ShieldCheck size={14} />} />
        <Stat
          label="Annual report due"
          value={data.annualReportDueDate ? formatDate(data.annualReportDueDate) : "Not computed"}
          icon={<FileCheck2 size={14} />}
          tone={data.annualReport?.status === "Filed" ? "ok" : data.counts.blocked ? "danger" : undefined}
        />
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))", gap: 16 }}>
        {PHASES.map((phase) => {
          const items = (data.phases[phase.id] ?? []) as CycleItem[];
          const complete = items.filter((item) => item.status === "complete").length;
          const Icon = phase.icon;
          return (
            <section className="card" key={phase.id}>
              <div className="card__head" style={{ alignItems: "flex-start" }}>
                <div className="row" style={{ gap: 8 }}>
                  <Icon size={16} style={{ color: "var(--accent)" }} />
                  <div>
                    <h2 className="card__title">{phase.title}</h2>
                    <div className="card__subtitle">{complete}/{items.length} complete</div>
                  </div>
                </div>
              </div>
              <div className="card__body col" style={{ gap: 10 }}>
                <p className="muted" style={{ margin: 0, fontSize: "var(--fs-sm)" }}>{phase.subtitle}</p>
                {items.map((item) => <CycleCard key={item.id} item={item} />)}
              </div>
            </section>
          );
        })}
      </div>

      <div className="card" style={{ marginTop: 16 }}>
        <div className="card__head">
          <h2 className="card__title">Caveats</h2>
          <span className="card__subtitle">Rules are evidence checks, not legal conclusions</span>
        </div>
        <div className="card__body">
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {data.caveats.map((caveat: string) => (
              <li key={caveat}>{caveat}</li>
            ))}
          </ul>
        </div>
      </div>
    </div>
  );
}

function CycleCard({ item }: { item: CycleItem }) {
  const Icon = item.status === "complete"
    ? CheckCircle2
    : item.status === "blocked"
      ? AlertTriangle
      : item.status === "attention"
        ? Clock
        : Circle;
  return (
    <div
      style={{
        border: "1px solid var(--border)",
        borderRadius: 8,
        padding: 12,
        background: item.status === "blocked" ? "var(--danger-soft)" : item.status === "attention" ? "var(--warn-soft)" : "var(--bg)",
      }}
    >
      <div className="row" style={{ alignItems: "flex-start", gap: 8 }}>
        <Icon size={16} style={{ marginTop: 2, color: statusColor(item.status) }} />
        <div className="col" style={{ flex: 1, gap: 6 }}>
          <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
            <strong>{item.title}</strong>
            <Badge tone={statusTone(item.status)}>{statusLabel(item.status)}</Badge>
          </div>
          <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{item.detail}</div>
          {item.dueDate && (
            <div className="mono muted" style={{ fontSize: "var(--fs-xs)" }}>
              Due {formatDate(item.dueDate)} · {relative(item.dueDate)}
            </div>
          )}
          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
            {item.evidence.slice(0, 3).map((evidence) => (
              <Badge key={evidence}>{evidence}</Badge>
            ))}
          </div>
          <Link to={appPath(item.to)} className="btn-action" style={{ alignSelf: "flex-start" }}>
            {item.actionLabel} <ArrowRight size={12} />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Stat({
  label,
  value,
  icon,
  tone,
}: {
  label: string;
  value: string | number;
  icon: ReactNode;
  tone?: "ok" | "danger";
}) {
  return (
    <div className={`stat-card${tone === "danger" ? " stat-card--danger" : tone === "ok" ? " stat-card--ok" : ""}`}>
      <div className="stat-card__label">{icon}{label}</div>
      <div className="stat-card__value" style={{ fontSize: typeof value === "string" && value.length > 18 ? "var(--fs-lg)" : undefined }}>
        {value}
      </div>
    </div>
  );
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
