import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { GitBranch } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { formatDateTime, money } from "../lib/format";

export function TimelinePage() {
  const society = useSociety();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const filings = useQuery(api.filings.list, society ? { societyId: society._id } : "skip");
  const commitments = useQuery(api.commitments.list, society ? { societyId: society._id } : "skip");
  const commitmentEvents = useQuery(api.commitments.eventsForSociety, society ? { societyId: society._id } : "skip");
  const feeTimeline = useQuery(api.subscriptions.feeTimeline, society ? { societyId: society._id } : "skip");
  const fundingSources = useQuery(api.fundingSources.list, society ? { societyId: society._id } : "skip");

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
    (commitments ?? []).forEach((commitment: any) => {
      if (!commitment.nextDueDate || commitment.status === "Closed" || commitment.status === "Paused") return;
      events.push({
        date: commitment.nextDueDate,
        kind: "Commitment",
        title: commitment.title,
        sub: `${commitment.cadence}${commitment.counterparty ? ` · ${commitment.counterparty}` : ""}`,
        to: "/app/commitments",
        past: new Date(commitment.nextDueDate).getTime() < now,
      });
    });
    (commitmentEvents ?? []).forEach((event: any) => {
      const commitment = (commitments ?? []).find((row: any) => String(row._id) === String(event.commitmentId));
      events.push({
        date: event.happenedAtISO,
        kind: "Commitment",
        title: event.title,
        sub: commitment ? `${commitment.title}${event.summary ? ` · ${event.summary}` : ""}` : event.summary,
        to: "/app/commitments",
        past: true,
      });
    });
    (feeTimeline ?? []).forEach((period: any) => {
      if (period.effectiveFrom === "current") return;
      events.push({
        date: period.effectiveFrom,
        kind: "Member fee",
        title: `${period.label} — ${money(period.priceCents)} / ${period.interval}`,
        sub: period.effectiveTo ? `Ends ${period.effectiveTo}` : period.status,
        to: "/app/membership",
        past: new Date(period.effectiveFrom).getTime() < now,
      });
    });
    (fundingSources ?? []).forEach((source: any) => {
      (source.events ?? []).forEach((event: any) => {
        events.push({
          date: event.eventDate,
          kind: "Funding",
          title: event.label,
          sub: `${source.name}${event.amountCents != null ? ` · ${money(event.amountCents)}` : ""}${event.attributionStatus ? ` · ${event.attributionStatus}` : ""}`,
          to: "/app/treasurer",
          past: new Date(event.eventDate).getTime() < now,
        });
      });
    });
    return events.sort((a, b) => b.date.localeCompare(a.date));
  }, [meetings, committees, filings, commitments, commitmentEvents, feeTimeline, fundingSources]);

  // Hooks must run before any early returns so the rules-of-hooks contract holds.
  const nowMarkerRef = useRef<HTMLDivElement | null>(null);
  const renderNow = Date.now();
  // Order top-to-bottom chronologically: oldest past at the top, future stretching
  // downward, with the Now marker as the pivot. `grouped` is sorted descending by
  // date (line 90), so past needs reversing; future is reversed back to ascending.
  const past = useMemo(
    () => grouped.filter((e) => new Date(e.date).getTime() < renderNow).slice().reverse(),
    [grouped, renderNow],
  );
  const future = useMemo(
    () => grouped.filter((e) => new Date(e.date).getTime() >= renderNow).slice().reverse(),
    [grouped, renderNow],
  );

  useEffect(() => {
    // After the initial render, scroll the Now marker into view so the user
    // lands on the present instead of the top of the entire history.
    nowMarkerRef.current?.scrollIntoView({ block: "center", behavior: "auto" });
  }, []);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Timeline"
        icon={<GitBranch size={16} />}
        iconColor="purple"
        subtitle="Every meeting, filing, commitment, member-fee change, funding event, and due date on one spine."
      />

      <div className="card">
        <div className="card__body">
          <div className="timeline-vertical">
            {past.map((e, i) => (
              <div className="timeline-vertical__item is-past" key={`past-${i}-${e.date}`}>
                <span className="timeline-vertical__dot" style={e.color ? { borderColor: e.color } : undefined} />
                <div className="row">
                  <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDateTime(e.date)}</span>
                  <Badge tone={eventTone(e.kind)}>{e.kind}</Badge>
                </div>
                <div className="timeline-vertical__title">
                  {e.to ? <Link to={e.to}>{e.title}</Link> : e.title}
                </div>
                {e.sub && <div className="timeline-vertical__desc">{e.sub}</div>}
              </div>
            ))}

            <div className="timeline-vertical__now" ref={nowMarkerRef} aria-label="Now">
              <span className="timeline-vertical__now-dot" />
              <span className="timeline-vertical__now-label">
                Now · {formatDateTime(new Date(renderNow).toISOString())}
              </span>
            </div>

            {future.map((e, i) => (
              <div className="timeline-vertical__item is-future" key={`future-${i}-${e.date}`}>
                <span className="timeline-vertical__dot" style={e.color ? { borderColor: e.color } : undefined} />
                <div className="row">
                  <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDateTime(e.date)}</span>
                  <Badge tone={eventTone(e.kind)}>{e.kind}</Badge>
                </div>
                <div className="timeline-vertical__title">
                  {e.to ? <Link to={e.to}>{e.title}</Link> : e.title}
                </div>
                {e.sub && <div className="timeline-vertical__desc">{e.sub}</div>}
              </div>
            ))}

            {past.length === 0 && future.length === 0 && (
              <div className="muted">No events yet.</div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function eventTone(kind: string) {
  return kind === "AGM" ? "accent" : kind === "Filing" ? "warn" : kind === "Funding" || kind === "Commitment" ? "success" : "info";
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
