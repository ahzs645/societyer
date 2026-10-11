import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { History } from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { DatePicker } from "../components/DatePicker";
import { Badge } from "../components/ui";
import { formatDate } from "../lib/format";
import { todayDateOnly } from "../../shared/dateOnly";
import { activeAsOf } from "../../shared/registerHistory";
import { normalizeOptionValue, SOURCE_OPTION_VALUES } from "../../shared/orgHubOptions";

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

type HolderRow = { _id?: string; fullName?: string; startDate?: string; title?: string };

/** A director whose position is an officer title (President, Treasurer, …) holds that office too. */
function officerTitleOf(director: any): string | undefined {
  for (const raw of [director.officerTitle, director.position]) {
    const code = normalizeOptionValue("officerTitles", raw);
    if (code && code !== "other" && SOURCE_OPTION_VALUES.officerTitles.includes(code)) return String(raw);
  }
  return undefined;
}

function RoleColumn({
  societyId,
  asOf,
  roleType,
  label,
  extraRows,
}: {
  societyId: string;
  asOf: string;
  roleType: string;
  label: string;
  /** Rows derived elsewhere (officers held by directors), merged by name. */
  extraRows?: HolderRow[];
}) {
  const fetched = useQuery(api.registerHistory.roleHoldersAsOfDate, {
    societyId,
    asOf,
    roleType,
  }) as HolderRow[] | undefined;
  const rows = useMemo(() => {
    if (fetched === undefined) return undefined;
    if (!extraRows?.length) return fetched;
    const seen = new Set(fetched.map((r) => (r.fullName ?? "").toLowerCase()));
    return [...fetched, ...extraRows.filter((r) => !seen.has((r.fullName ?? "").toLowerCase()))];
  }, [fetched, extraRows]);

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
              {r.title ? <span style={{ color: "var(--text-secondary)" }}> · {r.title}</span> : null}
              {r.startDate ? (
                <span style={{ color: "var(--text-tertiary)" }}> · since {formatDate(r.startDate)}</span>
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
  const { can } = usePermissions();
  const canReadHistory = can("settings:read");
  const visibleRoles = ROLES.filter((role) => canReadHistory && can(role.roleType === "member" ? "members:read" : "directors:read"));
  const [asOf, setAsOf] = useState<string>(() => todayDateOnly());
  const directors = useQuery(api.directors.list, society && can("directors:read") ? { societyId: society._id } : "skip");

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

  // Officers are usually directors holding an officer title; the role-holder
  // register rarely carries separate "officer" rows, so derive them here.
  const directorOfficers = useMemo<HolderRow[]>(
    () =>
      activeAsOf((directors ?? []) as any[], asOf, { start: "termStart", end: "termEnd" })
        .map((d: any) => ({ d, title: officerTitleOf(d) }))
        .filter((entry) => entry.title)
        .map(({ d, title }) => ({
          _id: String(d._id),
          fullName: d.name ?? `${d.firstName ?? ""} ${d.lastName ?? ""}`.trim(),
          startDate: d.termStart,
          title,
        })),
    [directors, asOf],
  );

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
        subtitle="Who held each role on a chosen date."
        info={<p>Rebuilt from role-holder and director term dates — the statutory &ldquo;who were the directors on date X?&rdquo; view. Officers include directors whose position is an officer title such as President or Treasurer.</p>}
        actions={
          <label style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 13, color: "var(--text-secondary)", whiteSpace: "nowrap" }}>As of</span>
            <DatePicker
              value={asOf}
              onChange={(value) => setAsOf(value)}
            />
          </label>
        }
      />

      {visibleRoles.length < ROLES.length && <p className="muted">This snapshot excludes role registers outside your current read permissions. Historical role-holder snapshots require workspace settings read access.</p>}
      <div style={{ display: "flex", gap: 16, flexWrap: "wrap" }}>
        {visibleRoles.map((role) => (
          <RoleColumn
            key={role.roleType}
            societyId={society._id}
            asOf={asOf}
            roleType={role.roleType}
            label={role.label}
            extraRows={role.roleType === "officer" ? directorOfficers : undefined}
          />
        ))}
      </div>

      {changes.length > 0 && (
        <div className="card" style={{ marginTop: 16, padding: 16 }}>
          <h3 style={{ margin: "0 0 12px" }}>Board changes around this date</h3>
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
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDate(event.date)}</span>
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
