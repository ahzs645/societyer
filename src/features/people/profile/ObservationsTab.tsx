import { useMemo } from "react";
import { Link } from "react-router-dom";
import { Users } from "lucide-react";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { sourceRoleLabel } from "../../../../shared/personHistory";
import { CardHead, MATCH_STATUSES, MatchStatusBadge, SourceLink, plural, type Occurrence } from "./shared";

/** The person profile's Observations tab: meetings, rosters and records that name the person. */

type ObservationRecord = Occurrence & { sourceRole: string; historyAtMeeting: string };

const OBSERVATIONS_TABLE = staticRecordTable({
  id: "person-profile:observations",
  nameSingular: "personObservation",
  namePlural: "personObservations",
  labelSingular: "Observation",
  labelPlural: "Observations",
  labelIdentifierFieldName: "context",
  sorts: [{ field: "observedDate", direction: "desc" }],
  fields: [
    { name: "observedDate", label: "Date", fieldType: FIELD_TYPES.TEXT, size: 120 },
    { name: "context", label: "Context", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "personName", label: "Name as written", fieldType: FIELD_TYPES.TEXT, size: 200 },
    { name: "matchStatus", label: "Identity", fieldType: FIELD_TYPES.SELECT, size: 170, config: { options: MATCH_STATUSES } },
    { name: "sourceRole", label: "Source role", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "affiliation", label: "Source affiliation", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "historyAtMeeting", label: "Verified history that day", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "notes", label: "Notes", fieldType: FIELD_TYPES.TEXT, size: 220, config: { groupable: false } },
    { name: "sourceReference", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 200, config: { groupable: false } },
  ],
});

/* --------------------------- observations tab ---------------------------- */

export function ObservationsCard({ occurrences }: { occurrences: Occurrence[] }) {
  const records = useMemo<ObservationRecord[]>(
    () => occurrences.map((row) => ({
      ...row,
      sourceRole: sourceRoleLabel(row.roleTitle),
      historyAtMeeting: row.historical ? `role ${row.historical.role.state}; affiliation ${row.historical.affiliation.state}` : "",
    })),
    [occurrences],
  );
  return (
    <section className="card">
      <CardHead title="Meetings, roster observations and related records" subtitle={plural(occurrences.length, "observation")} />
      <RecordListTable<ObservationRecord>
        variant="card"
        table={OBSERVATIONS_TABLE}
        tableId="person-profile-observations"
        label="Observations"
        icon={<Users size={14} />}
        records={records}
        renderCell={({ record, field }) => {
          if (field.name === "observedDate") return <span>{record.observedDate || "Date unknown"}</span>;
          if (field.name === "matchStatus") return <MatchStatusBadge status={record.matchStatus} />;
          if (field.name === "affiliation") return <span>{record.affiliation || "Unknown"}</span>;
          if (field.name === "sourceReference") return <SourceLink url={record.sourceUrl} reference={record.sourceReference} />;
          return undefined;
        }}
        renderRowActions={(row) => (row.href ? <Link className="btn btn--ghost btn--sm" to={row.href}>Open related record</Link> : null)}
        renderPhoneCard={(row, { selecting }) => (
          <RecordTablePhoneCard
            title={row.context}
            badge={<MatchStatusBadge status={row.matchStatus} />}
            meta={[row.observedDate || "Date unknown", row.personName]}
            detail={[row.sourceRole, row.affiliation || ""]}
            selecting={selecting}
          />
        )}
        emptyState={<RecordTableEmpty title="No observations yet" description="Meetings and rosters that name this person appear here." />}
      />
    </section>
  );
}

