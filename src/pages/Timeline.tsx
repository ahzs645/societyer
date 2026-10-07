import { useEffect, useMemo, useRef } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { GitBranch } from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge } from "../components/ui";
import { formatDate, formatDateTime, isPastDue, money } from "../lib/format";

export function TimelinePage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const committees = useQuery(api.committees.list, society && loaded && can("committees:read") ? { societyId: society._id } : "skip");
  const filings = useQuery(api.filings.list, society && loaded && can("filings:read") ? { societyId: society._id } : "skip");
  const commitments = useQuery(api.commitments.list, society && loaded && can("commitments:read") ? { societyId: society._id } : "skip");
  const commitmentEvents = useQuery(api.commitments.eventsForSociety, society && loaded && can("commitments:read") ? { societyId: society._id } : "skip");
  const feeTimeline = useQuery(api.subscriptions.feeTimeline, society && loaded && can("settings:read") ? { societyId: society._id } : "skip");
  const fundingSources = useQuery(api.fundingSources.list, society && loaded && can("financials:read") ? { societyId: society._id } : "skip");
  // G-26: the timeline claims "every due date" but omitted deadlines,
  // elections and bylaw amendment milestones.
  const deadlines = useQuery(api.deadlines.list, society && loaded && can("deadlines:read") ? { societyId: society._id } : "skip");
  const elections = useQuery(api.elections.list, society && loaded && can("elections:read") ? { societyId: society._id } : "skip");
  const bylawAmendments = useQuery(api.bylawAmendments.list, society && loaded && can("documents:read") ? { societyId: society._id } : "skip");

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
        title: [kindLabel(f.kind), f.periodLabel].filter(Boolean).join(" — "),
        sub: f.status === "Filed" ? `Filed ${f.filedAt ? formatDate(f.filedAt) : ""}` : "Due",
        to: `/app/filings?filing=${encodeURIComponent(String(f._id))}`,
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
        past: isPastDue(commitment.nextDueDate, now),
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
        past: isPastDue(period.effectiveFrom, now),
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
          past: isPastDue(event.eventDate, now),
        });
      });
    });
    const today = new Date().toISOString().slice(0, 10);
    (deadlines ?? []).forEach((deadline: any) => {
      if (!deadline.dueDate) return;
      const done = deadline.status ? deadline.status !== "open" : Boolean(deadline.done);
      events.push({
        date: deadline.dueDate,
        kind: "Deadline",
        title: deadline.title,
        sub: `${deadline.category ?? "Deadline"}${done ? " · done" : String(deadline.dueDate).slice(0, 10) < today ? " · overdue" : ""}`,
        to: "/app/deadlines",
        past: done || String(deadline.dueDate).slice(0, 10) < today,
      });
    });
    (elections ?? []).forEach((election: any) => {
      if (election.opensAtISO) {
        events.push({
          date: election.opensAtISO,
          kind: "Election",
          title: `${election.title} — voting opens`,
          sub: election.status,
          to: `/app/elections/${election._id}`,
          past: new Date(election.opensAtISO).getTime() < now,
        });
      }
      if (election.closesAtISO) {
        events.push({
          date: election.closesAtISO,
          kind: "Election",
          title: `${election.title} — voting closes`,
          sub: election.status,
          to: `/app/elections/${election._id}`,
          past: new Date(election.closesAtISO).getTime() < now,
        });
      }
    });
    (bylawAmendments ?? []).forEach((amendment: any) => {
      if (amendment.resolutionPassedAtISO) {
        events.push({
          date: amendment.resolutionPassedAtISO,
          kind: "Bylaws",
          title: `${amendment.title} — special resolution passed`,
          to: "/app/bylaw-diff",
          past: true,
        });
      }
      if (amendment.filedAtISO) {
        events.push({
          date: amendment.filedAtISO,
          kind: "Bylaws",
          title: `${amendment.title} — filed with the registrar`,
          to: "/app/bylaw-diff",
          past: true,
        });
      }
    });
    return events.filter((event) => Boolean(event.date)).sort((a, b) => String(b.date).localeCompare(String(a.date)));
  }, [meetings, committees, filings, commitments, commitmentEvents, feeTimeline, fundingSources, deadlines, elections, bylawAmendments]);

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

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Timeline"
        icon={<GitBranch size={16} />}
        iconColor="purple"
        subtitle="Meetings, filings, deadlines, elections, bylaw milestones, commitments, member-fee changes and funding events on one spine."
      />

      <div className="card">
        <div className="card__body">
          <div className="timeline-vertical">
            {past.map((e, i) => (
              <div className="timeline-vertical__item is-past" key={`past-${i}-${e.date}`}>
                <span className="timeline-vertical__dot" style={e.color ? { borderColor: e.color } : undefined} />
                <div className="row">
                  <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{timelineDate(e.date)}</span>
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
                  <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{timelineDate(e.date)}</span>
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

/** Date-only values ("2026-05-12") have no time of day; showing them as
 *  "12:00AM" invented a time (G-26). */
function timelineDate(value: string) {
  return /^\d{4}-\d{2}-\d{2}$/.test(String(value ?? "")) ? formatDate(value) : formatDateTime(value);
}
