import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { History } from "lucide-react";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { DatePicker } from "../components/DatePicker";
import { Badge } from "../components/ui";
import { formatDate } from "../lib/format";

/**
 * Point-in-Time Register — reconstructs who held each role on a chosen date,
 * using the roleHolders startDate/endDate intervals (logic:
 * shared/registerHistory.ts via convex/registerHistory.ts). Answers the
 * statutory minute-book question "who were the directors on date X?".
 *
 * Read-only: no mutations, so it does not touch the static-mirror write gate.
 */
const ROLES: Array<{ roleType: string; label: string }> = [
  { roleType: "director", label: "Directors" },
  { roleType: "officer", label: "Officers" },
  { roleType: "member", label: "Members" },
];

function RoleColumn({
  societyId,
  asOf,
  roleType,
  label,
}: {
  societyId: string;
  asOf: string;
  roleType: string;
  label: string;
}) {
  const rows = useQuery(api.registerHistory.roleHoldersAsOfDate, {
    societyId,
    asOf,
    roleType,
  }) as Array<{ _id?: string; fullName?: string; startDate?: string }> | undefined;

  return (
    <div className="card" style={{ flex: 1, minWidth: 220, padding: 16 }}>
      <h3 style={{ margin: "0 0 8px" }}>
        {label} <span style={{ color: "var(--text-tertiary)" }}>({rows?.length ?? 0})</span>
      </h3>
      {rows === undefined ? (
        <p style={{ color: "var(--text-tertiary)" }}>Loading…</p>
      ) : rows.length === 0 ? (
        <p style={{ color: "var(--text-tertiary)" }}>None in office on this date.</p>
      ) : (
        <ul style={{ margin: 0, padding: 0, listStyle: "none", fontSize: "var(--fs-sm)" }}>
          {rows.map((r) => (
            <li key={r._id ?? r.fullName} style={{ padding: "3px 0" }}>
              {r.fullName}
              {r.startDate ? (
                <span style={{ color: "var(--text-tertiary)" }}> · since {r.startDate}</span>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function PointInTimeRegisterPage() {
  const society = useSociety();
  const [asOf, setAsOf] = useState<string>(() => new Date().toISOString().slice(0, 10));
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");

  // Board term starts/ends as a timeline of transitions, so the snapshot above
  // gains context: who joined or left the board around the selected date.
  const changes = useMemo(() => {
    const events: { date: string; kind: "joined" | "left"; name: string; role?: string }[] = [];
    for (const d of (directors ?? []) as any[]) {
      const name = d.name ?? `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim();
      if (d.termStart) events.push({ date: d.termStart, kind: "joined", name, role: d.position });
      if (d.termEnd) events.push({ date: d.termEnd, kind: "left", name, role: d.position });
    }
    return events.sort((a, b) => a.date.localeCompare(b.date));
  }, [directors]);

  // Pivot the strip on the selected date: a few transitions on each side of it.
  const before = useMemo(() => changes.filter((e) => e.date <= asOf).slice(-6), [changes, asOf]);
  const after = useMemo(() => changes.filter((e) => e.date > asOf).slice(0, 6), [changes, asOf]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  return (
    <div className="page">
      <PageHeader
        title="Point-in-time register"
        icon={<History size={16} />}
        iconColor="blue"
        subtitle="Reconstruct who held each role on any past date from the role-holder term history — the statutory 'who were the directors on date X?' view."
        actions={
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)" }}>As of</span>
            <DatePicker
              value={asOf}
              onChange={(value) => setAsOf(value)}
            />
          </label>
        }
      />

      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {ROLES.map((role) => (
          <RoleColumn
            key={role.roleType}
            societyId={society._id}
            asOf={asOf}
            roleType={role.roleType}
            label={role.label}
          />
        ))}
      </div>

      {changes.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <h3 style={{ margin: "0 0 4px" }}>Board changes around this date</h3>
          <p style={{ margin: "0 0 12px", color: "var(--text-tertiary)", fontSize: "var(--fs-sm)" }}>
            Director term starts and ends near the selected date, from the role-holder history.
          </p>
          <div className="timeline-vertical">
            {before.map((e, i) => (
              <TransitionItem key={`before-${i}-${e.date}`} event={e} tense="is-past" />
            ))}
            <div className="timeline-vertical__now">
              <span className="timeline-vertical__now-dot" />
              <span className="timeline-vertical__now-label">As of · {formatDate(asOf)}</span>
            </div>
            {after.map((e, i) => (
              <TransitionItem key={`after-${i}-${e.date}`} event={e} tense="is-future" />
            ))}
            {before.length === 0 && after.length === 0 && (
              <div className="muted">No board changes on record.</div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function TransitionItem({
  event,
  tense,
}: {
  event: { date: string; kind: "joined" | "left"; name: string; role?: string };
  tense: "is-past" | "is-future";
}) {
  return (
    <div className={`timeline-vertical__item ${tense}`}>
      <span className="timeline-vertical__dot" />
      <div className="row">
        <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDate(event.date)}</span>
        <Badge tone={event.kind === "joined" ? "success" : "warn"}>
          {event.kind === "joined" ? "Joined" : "Left"}
        </Badge>
      </div>
      <div className="timeline-vertical__title">{event.name}</div>
      {event.role && <div className="timeline-vertical__desc">{event.role}</div>}
    </div>
  );
}

export default PointInTimeRegisterPage;
