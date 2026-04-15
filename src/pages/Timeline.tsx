import { useMemo } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { formatDateTime } from "../lib/format";

export function TimelinePage() {
  const society = useSociety();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip");

  const grouped = useMemo(() => {
    const events: { date: string; kind: string; title: string; sub?: string; to?: string; past: boolean; color?: string }[] = [];
    const now = Date.now();
    (meetings ?? []).forEach((m: any) => {
      const committee = (committees ?? []).find((c: any) => c._id === m.committeeId);
      events.push({
        date: m.scheduledAt,
        kind: m.type,
        title: m.title,
        sub: `${m.location ?? "TBD"}${committee ? ` · ${committee.name}` : ""}`,
        to: `/app/meetings/${m._id}`,
        past: new Date(m.scheduledAt).getTime() < now,
        color: committee?.color,
      });
    });
    (filings ?? []).forEach((f: any) => {
      events.push({
        date: f.dueDate,
        kind: "Filing",
        title: `${kindLabel(f.kind)} — ${f.periodLabel ?? ""}`,
        sub: f.status === "Filed" ? `Filed ${f.filedAt ?? ""}` : "Due",
        past: f.status === "Filed",
      });
    });
    return events.sort((a, b) => b.date.localeCompare(a.date));
  }, [meetings, committees, filings]);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const now = Date.now();
  const future = grouped.filter((e) => new Date(e.date).getTime() >= now).reverse();
  const past = grouped.filter((e) => new Date(e.date).getTime() < now);

  return (
    <div className="page">
      <PageHeader title="Timeline" subtitle="Every meeting, filing, and due date on one spine." />

      <div className="two-col">
        <div className="card">
          <div className="card__head"><h2 className="card__title">Upcoming</h2></div>
          <div className="card__body">
            <div className="timeline-vertical">
              {future.map((e, i) => (
                <div className="timeline-vertical__item is-future" key={i}>
                  <span className="timeline-vertical__dot" style={e.color ? { borderColor: e.color } : undefined} />
                  <div className="row">
                    <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDateTime(e.date)}</span>
                    <Badge tone={e.kind === "AGM" ? "accent" : e.kind === "Filing" ? "warn" : "info"}>{e.kind}</Badge>
                  </div>
                  <div className="timeline-vertical__title">
                    {e.to ? <Link to={e.to}>{e.title}</Link> : e.title}
                  </div>
                  {e.sub && <div className="timeline-vertical__desc">{e.sub}</div>}
                </div>
              ))}
              {future.length === 0 && <div className="muted">Nothing upcoming.</div>}
            </div>
          </div>
        </div>

        <div className="card">
          <div className="card__head"><h2 className="card__title">Past</h2></div>
          <div className="card__body">
            <div className="timeline-vertical">
              {past.map((e, i) => (
                <div className="timeline-vertical__item is-past" key={i}>
                  <span className="timeline-vertical__dot" />
                  <div className="row">
                    <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDateTime(e.date)}</span>
                    <Badge>{e.kind}</Badge>
                  </div>
                  <div className="timeline-vertical__title">
                    {e.to ? <Link to={e.to}>{e.title}</Link> : e.title}
                  </div>
                  {e.sub && <div className="timeline-vertical__desc">{e.sub}</div>}
                </div>
              ))}
              {past.length === 0 && <div className="muted">Nothing in the past yet.</div>}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function kindLabel(k: string) {
  switch (k) {
    case "AnnualReport": return "BC Annual report";
    case "ChangeOfDirectors": return "Change of directors";
    case "ChangeOfAddress": return "Change of address";
    case "BylawAmendment": return "Bylaw amendment";
    case "T3010": return "CRA T3010";
    case "T2": return "CRA T2";
    case "T1044": return "CRA T1044";
    case "T4": return "T4 / T4A";
    case "GSTHST": return "GST/HST";
    default: return k;
  }
}
