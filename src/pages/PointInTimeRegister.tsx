import { useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { History, Users } from "lucide-react";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { organizationRuleScope } from "../../shared/entityRuleScope";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { DatePicker } from "../components/DatePicker";
import { Badge, Banner } from "../components/ui";
import { formatDate } from "../lib/format";
import { organizationTodayISO } from "../lib/dateRanges";
import { activeAsOf } from "../../shared/registerHistory";
import { normalizeOptionValue, SOURCE_OPTION_VALUES } from "../../shared/orgHubOptions";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type FieldMetadata,
  type RecordTableCardHelpers,
} from "@/platform/record-engine";

/**
 * Point-in-Time Register — reconstructs who held each role on a chosen date,
 * using the roleHolders startDate/endDate intervals (logic:
 * shared/registerHistory.ts via convex/registerHistory.ts). Answers the
 * statutory minute-book question "who were the directors on date X?".
 *
 * Read-only: no mutations, so it does not touch the static-mirror write gate.
 */
const SOCIETY_ROLES: Array<{ roleType: string; label: string }> = [
  { roleType: "director", label: "Directors" },
  { roleType: "officer", label: "Officers" },
  { roleType: "member", label: "Members" },
];
// A corporation's general-meeting voters are its shareholders (role holders),
// not the society member register.
const CORPORATION_ROLES: Array<{ roleType: string; label: string }> = [
  { roleType: "director", label: "Directors" },
  { roleType: "officer", label: "Officers" },
  { roleType: "shareholder", label: "Shareholders" },
];

type HolderRow = { _id?: string; fullName?: string; startDate?: string; title?: string };
type HolderRecord = { _id: string; fullName: string; title: string | null; startDate: string | null };

/** A director row as directors:list returns it (the fields this page reads). */
type DirectorRow = {
  _id: string;
  name?: string;
  firstName?: string;
  lastName?: string;
  position?: string;
  officerTitle?: string;
  termStart?: string;
  termEnd?: string;
};

const directorName = (director: DirectorRow) => director.name ?? `${director.firstName ?? ""} ${director.lastName ?? ""}`.trim();

const HOLDERS_TABLE = staticRecordTable({
  id: "point-in-time-holders",
  nameSingular: "holder",
  namePlural: "holders",
  labelSingular: "Holder",
  labelPlural: "Holders",
  labelIdentifierFieldName: "fullName",
  sorts: [{ field: "fullName", direction: "asc" }],
  fields: [
    { name: "fullName", label: "Name", fieldType: FIELD_TYPES.TEXT, size: 240, config: { groupable: false } },
    { name: "title", label: "Title", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "startDate", label: "Since", fieldType: FIELD_TYPES.DATE, size: 140 },
  ],
});

/** A director whose position is an officer title (President, Treasurer, …) holds that office too. */
function officerTitleOf(director: DirectorRow): string | undefined {
  for (const raw of [director.officerTitle, director.position]) {
    const code = normalizeOptionValue("officerTitles", raw);
    if (code && code !== "other" && SOURCE_OPTION_VALUES.officerTitles.includes(code)) return String(raw);
  }
  return undefined;
}

function RoleCard({
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
  const records = useMemo<HolderRecord[] | undefined>(() => {
    if (fetched === undefined) return undefined;
    // Registers merge several sources (role holders, directors, members) into one list.
    const seen = new Set(fetched.map((r) => (r.fullName ?? "").toLowerCase()));
    const merged = [...fetched, ...(extraRows ?? []).filter((r) => !seen.has((r.fullName ?? "").toLowerCase()))];
    return merged.map((row, index) => ({
      _id: row._id ?? `${row.fullName ?? ""}-${index}`,
      fullName: row.fullName ?? "",
      title: row.title ?? null,
      startDate: row.startDate ?? null,
    }));
  }, [fetched, extraRows]);
  const headingId = `pit-register-${roleType}`;

  const renderCell = ({ record, field }: { record: HolderRecord; field: FieldMetadata }) =>
    field.name === "fullName" ? <strong>{record.fullName}</strong> : undefined;
  const renderPhoneCard = (record: HolderRecord, { selecting }: RecordTableCardHelpers) => (
    <RecordTablePhoneCard
      title={record.fullName}
      meta={[record.title ?? "", record.startDate ? `Since ${formatDate(record.startDate)}` : ""]}
      selecting={selecting}
    />
  );

  return (
    <section className="card" aria-labelledby={headingId}>
      <div className="card__head">
        <h2 className="card__title" id={headingId}>{label}</h2>
        {records && <Badge>{records.length}</Badge>}
      </div>
      <RecordListTable<HolderRecord>
        variant="card"
        table={HOLDERS_TABLE}
        tableId={`point-in-time-${roleType}`}
        label={label}
        icon={<Users size={14} />}
        records={records ?? []}
        loading={records === undefined}
        renderCell={renderCell}
        renderPhoneCard={renderPhoneCard}
        emptyState={<RecordTableEmpty title="None in office on this date" />}
      />
    </section>
  );
}

export function PointInTimeRegisterPage() {
  const society = useSociety();
  const { can } = usePermissions();
  const canReadHistory = can("settings:read");
  const ROLES = organizationRuleScope(society).isCorporation ? CORPORATION_ROLES : SOCIETY_ROLES;
  const visibleRoles = ROLES.filter((role) => canReadHistory && can(role.roleType === "member" ? "members:read" : "directors:read"));
  // Defaults to the organisation's today (and back to it when the picker is
  // cleared) rather than the browser's calendar day.
  const [pickedAsOf, setAsOf] = useState<string>("");
  const asOf = pickedAsOf || organizationTodayISO(society);
  const directors = useQuery(api.directors.list, society && can("directors:read") ? { societyId: society._id } : "skip") as DirectorRow[] | undefined;

  // Board term starts/ends as a timeline of transitions, so the snapshot above
  // gains context: who joined or left the board around the selected date.
  const changes = useMemo(() => {
    const events: { date: string; kind: "joined" | "left"; name: string; role?: string }[] = [];
    for (const d of directors ?? []) {
      const name = directorName(d);
      if (d.termStart) events.push({ date: d.termStart, kind: "joined", name, role: d.position });
      if (d.termEnd) events.push({ date: d.termEnd, kind: "left", name, role: d.position });
    }
    return events.sort((a, b) => a.date.localeCompare(b.date));
  }, [directors]);

  // Officers are usually directors holding an officer title; the role-holder
  // register rarely carries separate "officer" rows, so derive them here.
  const directorOfficers = useMemo<HolderRow[]>(
    () =>
      activeAsOf(directors ?? [], asOf, { start: "termStart", end: "termEnd" })
        .map((d) => ({ d, title: officerTitleOf(d) }))
        .filter((entry) => entry.title)
        .map(({ d, title }) => ({
          _id: String(d._id),
          fullName: directorName(d),
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
      />

      {/* The date is the page's one filter: it sits under the header rather than
          in the header actions, where it squeezed the title on phones. */}
      <div className="register-asof">
        <label className="register-asof__date">
          <span>As of</span>
          <DatePicker value={asOf} onChange={(value) => setAsOf(value)} />
        </label>
      </div>

      {visibleRoles.length < ROLES.length && (
        <Banner tone="info" title="Some registers are hidden">
          This snapshot excludes role registers outside your current read permissions. Historical role-holder snapshots require workspace settings read access.
        </Banner>
      )}
      {visibleRoles.map((role) => (
        <RoleCard
          key={role.roleType}
          societyId={society._id}
          asOf={asOf}
          roleType={role.roleType}
          label={role.label}
          extraRows={role.roleType === "officer" ? directorOfficers : undefined}
        />
      ))}

      {changes.length > 0 && (
        <section className="card" aria-labelledby="pit-register-changes">
          <div className="card__head">
            <h2 className="card__title" id="pit-register-changes">Board changes around this date</h2>
          </div>
          <div className="card__body">
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
        </section>
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
        <span className="pit-register__date">{formatDate(event.date)}</span>
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
