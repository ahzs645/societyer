import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useState } from "react";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Flag } from "../components/ui";
import { formatDate, formatDateTime, relative } from "../lib/format";
import { Link } from "react-router-dom";
import { ArrowRight, Users, UserCog, Calendar, AlertTriangle, Activity } from "lucide-react";
import { formatDistanceToNowStrict, parseISO } from "date-fns";

export function Dashboard() {
  const society = useSociety();
  const data = useQuery(api.dashboard.summary, society ? { societyId: society._id } : "skip");
  const activity = useQuery(api.activity.list, society ? { societyId: society._id, limit: 10 } : "skip");
  const goals = useQuery(api.goals.list, society ? { societyId: society._id } : "skip");
  const tasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip");

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!data) return <div className="page">Loading…</div>;

  const { counts, upcomingMeetings, upcomingFilings, overdueFilings, complianceFlags } = data;

  return (
    <div className="page">
      <PageHeader
        title="Dashboard"
        subtitle="Compliance posture, upcoming obligations, and governance snapshot."
      />

      <div className="stat-grid">
        <Stat
          label="Active members"
          value={counts.members}
          icon={<Users size={14} />}
          sub="with voting rights counted separately in members list"
        />
        <Stat
          label="Active directors"
          value={counts.directors}
          icon={<UserCog size={14} />}
          sub={`${counts.bcResidents} BC resident${counts.bcResidents === 1 ? "" : "s"} (s.42 requires ≥ 1)`}
        />
        <Stat
          label="Meetings this year"
          value={counts.meetingsThisYear}
          icon={<Calendar size={14} />}
        />
        <Stat
          label="Overdue filings"
          value={counts.overdueFilings}
          tone={counts.overdueFilings ? "danger" : "ok"}
          icon={<AlertTriangle size={14} />}
        />
      </div>

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Compliance posture</h2>
              <span className="card__subtitle">Automated checks against the Societies Act</span>
            </div>
            <div className="card__body" style={{ display: "grid", gap: 6 }}>
              {complianceFlags.map((f, i) => (
                <Flag
                  key={i}
                  level={f.level}
                  citationId={(f as any).citationId}
                  citationIds={(f as any).citationIds}
                >
                  {f.text}
                </Flag>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Filings requiring attention</h2>
              <Link to="/app/filings" className="card__subtitle row" style={{ marginLeft: "auto" }}>
                View all <ArrowRight size={12} />
              </Link>
            </div>
            <table className="table">
              <thead>
                <tr>
                  <th>Kind</th>
                  <th>Period</th>
                  <th>Due</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {overdueFilings.length > 0 && (
                  <tr>
                    <td colSpan={4} className="table__cell--muted" style={{ background: "var(--danger-soft)", color: "var(--danger)", fontWeight: 700 }}>
                      Overdue · {overdueFilings.length}
                    </td>
                  </tr>
                )}
                {overdueFilings.slice(0, 4).map((f: any) => renderFilingRow(f))}
                {upcomingFilings.length > 0 && (
                  <tr>
                    <td colSpan={4} className="table__cell--muted" style={{ background: "var(--bg-subtle)", fontWeight: 700 }}>
                      Upcoming · {upcomingFilings.length}
                    </td>
                  </tr>
                )}
                {upcomingFilings.slice(0, overdueFilings.length > 0 ? 4 : 6).map((f: any) => renderFilingRow(f))}
                {overdueFilings.length + upcomingFilings.length === 0 && (
                  <tr>
                    <td colSpan={4} className="table__cell--muted" style={{ textAlign: "center", padding: 24 }}>
                      No overdue or upcoming filings.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Upcoming meetings</h2>
              <Link to="/app/meetings" className="card__subtitle row" style={{ marginLeft: "auto" }}>
                View all <ArrowRight size={12} />
              </Link>
            </div>
            <div className="card__body col">
              {upcomingMeetings.length === 0 && (
                <div className="muted">No meetings scheduled.</div>
              )}
              {upcomingMeetings.map((m: any) => (
                <Link
                  key={m._id}
                  to={`/app/meetings/${m._id}`}
                  className="col"
                  style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 6 }}
                >
                  <div className="row">
                    <Badge tone={m.type === "AGM" ? "accent" : "info"}>{m.type}</Badge>
                    <strong>{m.title}</strong>
                  </div>
                  <div className="muted">{formatDateTime(m.scheduledAt)} · {relative(m.scheduledAt)}</div>
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{m.location}</div>
                </Link>
              ))}
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Society</h2>
            </div>
            <div className="card__body col">
              <div><strong>{society.name}</strong></div>
              <div className="muted mono">{society.incorporationNumber}</div>
              <div className="muted">Fiscal year end: {society.fiscalYearEnd ?? "—"}</div>
              <div className="muted">{society.registeredOfficeAddress}</div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {society.isCharity && <Badge tone="accent">CRA charity</Badge>}
                {society.isMemberFunded && <Badge tone="info">Member-funded</Badge>}
                {society.boardCadence && <Badge>Board meets {society.boardCadence.toLowerCase()}</Badge>}
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head">
              <h2 className="card__title"><Activity size={14} style={{ display: "inline-block", marginRight: 4, verticalAlign: -2 }} />Activity</h2>
            </div>
            <div className="card__body col" style={{ gap: 0 }}>
              {(activity ?? []).map((a: any) => (
                <div className="activity-item" key={a._id}>
                  <span className="activity-item__avatar">
                    {a.actor.split(" ").map((p: string) => p[0]).join("").slice(0, 2).toUpperCase()}
                  </span>
                  <div className="activity-item__text">
                    <strong>{a.actor}</strong> {a.summary}
                    <div className="activity-item__meta">{relativeShort(a.createdAtISO)}</div>
                  </div>
                </div>
              ))}
              {(!activity || activity.length === 0) && <div className="muted">No activity yet.</div>}
            </div>
          </div>
        </div>
      </div>

      <div className="spacer-6" />

      <div className="two-col">
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Goals at a glance</h2>
            <Link to="/app/goals" className="card__subtitle row" style={{ marginLeft: "auto" }}>
              All goals <ArrowRight size={12} />
            </Link>
          </div>
          <div className="card__body col">
            {(goals ?? []).slice(0, 4).map((g: any) => (
              <Link key={g._id} to={`/app/goals/${g._id}`} className="col" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 6, gap: 6 }}>
                <div className="row">
                  <strong>{g.title}</strong>
                  <Badge tone={g.status === "OnTrack" ? "success" : g.status === "AtRisk" ? "warn" : g.status === "OffTrack" ? "danger" : "neutral"}>
                    {g.status}
                  </Badge>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  <div className="progress" style={{ flex: 1 }}>
                    <div className="progress__fill" style={{ width: `${g.progressPercent}%`, background: g.status === "AtRisk" || g.status === "OffTrack" ? "var(--warn)" : undefined }} />
                  </div>
                  <span className="mono" style={{ minWidth: 40, textAlign: "right" }}>{g.progressPercent}%</span>
                </div>
              </Link>
            ))}
            {(!goals || goals.length === 0) && <div className="muted">No goals yet.</div>}
          </div>
        </div>

        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Open tasks</h2>
            <Link to="/app/tasks" className="card__subtitle row" style={{ marginLeft: "auto" }}>
              All tasks <ArrowRight size={12} />
            </Link>
          </div>
          <table className="table">
            <tbody>
              {(tasks ?? []).filter((t: any) => t.status !== "Done").slice(0, 6).map((t: any) => (
                <tr key={t._id}>
                  <td style={{ width: 12 }}><span className={`priority-dot priority-${t.priority}`} /></td>
                  <td>{t.title}</td>
                  <td className="muted">{t.assignee ?? "—"}</td>
                  <td className="table__cell--mono muted">{t.dueDate ? formatDate(t.dueDate) : ""}</td>
                </tr>
              ))}
              {(!tasks || tasks.filter((t: any) => t.status !== "Done").length === 0) && (
                <tr><td className="muted" style={{ textAlign: "center", padding: 24 }}>Nothing open.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function relativeShort(iso: string) {
  try {
    const d = iso.length === 10 ? parseISO(iso) : new Date(iso);
    return `${formatDistanceToNowStrict(d)} ago`;
  } catch {
    return "";
  }
}

function Stat({
  label,
  value,
  sub,
  tone,
  icon,
}: {
  label: string;
  value: number | string;
  sub?: string;
  tone?: "danger" | "ok";
  icon?: React.ReactNode;
}) {
  const [expanded, setExpanded] = useState(false);
  // The description (`sub`) is hidden on mobile by CSS and revealed when the
  // user taps the cell. Desktop users see it inline as before — the handler
  // still toggles `.is-expanded` but has no visual effect above 760px.
  const expandable = Boolean(sub);
  const handleToggle = expandable ? () => setExpanded((v) => !v) : undefined;
  return (
    <div
      className={`stat${expandable ? " stat--expandable" : ""}${expanded ? " is-expanded" : ""}`}
      onClick={handleToggle}
      onKeyDown={expandable ? (e) => {
        if (e.key === "Enter" || e.key === " ") { e.preventDefault(); setExpanded((v) => !v); }
      } : undefined}
      role={expandable ? "button" : undefined}
      tabIndex={expandable ? 0 : undefined}
      aria-expanded={expandable ? expanded : undefined}
    >
      <div className="stat__label">
        {icon} {label}
      </div>
      <div
        className="stat__value"
        style={{ color: tone === "danger" ? "var(--danger)" : undefined }}
      >
        {value}
      </div>
      {sub && <div className="stat__sub">{sub}</div>}
    </div>
  );
}

function renderFilingRow(f: any) {
  return (
    <tr key={f._id}>
      <td>{kindLabel(f.kind)}</td>
      <td className="table__cell--muted">{f.periodLabel ?? "—"}</td>
      <td className="table__cell--mono">{formatDate(f.dueDate)}</td>
      <td>{renderFilingStatus(f)}</td>
    </tr>
  );
}

export function kindLabel(k: string) {
  switch (k) {
    case "AnnualReport":
      return "BC Annual report";
    case "ChangeOfDirectors":
      return "Change of directors";
    case "ChangeOfAddress":
      return "Change of address";
    case "BylawAmendment":
      return "Bylaw amendment";
    case "T2":
      return "CRA T2";
    case "T1044":
      return "CRA T1044 (NPO)";
    case "T3010":
      return "CRA T3010 (charity)";
    case "T4":
      return "T4 / T4A";
    case "GSTHST":
      return "GST/HST return";
    default:
      return k;
  }
}

export function renderFilingStatus(f: any) {
  if (f.status === "Filed") return <Badge tone="success">Filed</Badge>;
  const overdue = new Date(f.dueDate).getTime() < Date.now();
  return overdue ? <Badge tone="danger">Overdue</Badge> : <Badge tone="info">Upcoming</Badge>;
}
