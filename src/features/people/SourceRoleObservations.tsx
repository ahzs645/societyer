import { sourceRoleLabel } from "../../../shared/personHistory";
import { Link } from "react-router-dom";
import { useQuery } from "convex/react";
import { History } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { FIELD_TYPES, RecordListTable, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";

/** One source occurrence from `personHistory.overview`, as this list reads it. */
export type SourceRoleObservation = {
  _id: string;
  recordTable?: string;
  personId?: string;
  personName?: string;
  roleTitle?: string;
  context?: string;
  affiliation?: string;
  observedDate?: string;
  matchStatus?: string;
  sourceUrl?: string;
  sourceReference?: string;
};

type ObservationRecord = {
  _id: string;
  personName: string;
  role: string;
  affiliation: string;
  observedDate: string;
  matchStatus: string;
  sourceReference: string;
  observation: SourceRoleObservation;
};

const OBSERVATIONS_TABLE = staticRecordTable({
  id: "source-role-observations",
  nameSingular: "sourceRoleObservation",
  namePlural: "sourceRoleObservations",
  labelSingular: "Source observation",
  labelPlural: "Source observations",
  labelIdentifierFieldName: "personName",
  fields: [
    { name: "personName", label: "Source person", fieldType: FIELD_TYPES.TEXT, size: 200, config: { groupable: false } },
    { name: "role", label: "Role / committee", fieldType: FIELD_TYPES.TEXT, size: 240 },
    { name: "affiliation", label: "Affiliation at source date", fieldType: FIELD_TYPES.TEXT, size: 200 },
    // Source periods are often partial ("2019", "2019-05"), so they stay text.
    { name: "observedDate", label: "Observed period", fieldType: FIELD_TYPES.TEXT, size: 140 },
    { name: "matchStatus", label: "Identity review", fieldType: FIELD_TYPES.TEXT, size: 140 },
    { name: "sourceReference", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 180 },
  ],
});

/** Roster observations whose role reads like a board seat (director/officer). */
export function isBoardSeatObservation(observation: SourceRoleObservation | null | undefined): boolean {
  const text = `${observation?.roleTitle ?? ""} ${observation?.context ?? ""}`.toLowerCase();
  return /director|board|president|chair|treasurer|secretary|vice/.test(text) && !/committee member|staff|observer/.test(text);
}

function observationRecord(o: SourceRoleObservation): ObservationRecord {
  return {
    _id: o._id,
    personName: o.personName || "Unknown",
    role: `${sourceRoleLabel(o.roleTitle)} · ${o.context ?? ""}`,
    affiliation: o.affiliation || "Unknown",
    observedDate: o.observedDate || "Unknown",
    matchStatus: o.matchStatus ?? "",
    sourceReference: o.sourceReference ?? "",
    observation: o,
  };
}

export function SourceRoleObservations({ societyId, registerCount, onAddAsDirector }: { societyId: string; registerCount?: number; onAddAsDirector?: (observation: SourceRoleObservation) => void }) {
  const { can } = usePermissions();
  const data = useQuery(api.personHistory.overview, can("members:read") && can("directors:read") ? { societyId } : "skip") as { occurrences?: SourceRoleObservation[] } | undefined;
  const observations = (data?.occurrences ?? []).filter((o) => o.recordTable === "organizationSeats");
  if (!observations.length) return null;
  const canAdd = !!onAddAsDirector && can("directors:write");
  const latestDate = observations.map((o) => String(o.observedDate ?? "")).filter(Boolean).sort().at(-1);
  // P16: an imported workspace can have hundreds of roster observations and an
  // empty legal register. Say why, and offer to start a register entry from a
  // recent observation instead of leaving "0 directors" unexplained.
  const emptyRegisterNote = registerCount === 0 ? (
    <div className="card__body" role="status" style={{ paddingBottom: 0 }}>
      <strong>The director register is empty, but {observations.length} roster observations were imported{latestDate ? ` (latest ${latestDate})` : ""}.</strong>{" "}
      Observations are evidence of who sat on the board or committees at a source date; they are not the current legal register, so they do not count toward the minimum number of directors.
      To build the register, add the current directors{canAdd ? " (use \"Add as director\" on a recent board observation to prefill one)" : ""} and attach the AGM minutes or consent that appointed them.
    </div>
  ) : null;
  const personCell = (o: SourceRoleObservation) =>
    o.personId ? <Link to={`/app/people-directory/${o.personId}`}>{o.personName}</Link> : <span>{o.personName || "Unknown"}</span>;
  return (
    <details className="card" style={{ marginBottom: 16 }} open={registerCount === 0 || undefined}>
      <summary className="card__head">Source board and committee observations ({observations.length})</summary>
      {emptyRegisterNote}
      <div className="card__body" style={{ paddingBottom: 0 }}>
        <p>These source observations preserve people, organizations and roles at their recorded periods. Appointment dates, current status and legal membership require separate evidence.</p>
        <Link to="/app/people-history">Review identities and dated history</Link>
      </div>
      <RecordListTable<ObservationRecord>
        variant="card"
        table={OBSERVATIONS_TABLE}
        tableId="source-role-observations"
        label="Source observations"
        icon={<History size={14} />}
        records={observations.map(observationRecord)}
        renderCell={({ record, field }) => {
          const o = record.observation;
          if (field.name === "personName") return personCell(o);
          if (field.name === "sourceReference") return o.sourceUrl ? <a href={o.sourceUrl} target="_blank" rel="noreferrer">{o.sourceReference}</a> : undefined;
          return undefined;
        }}
        renderRowActions={canAdd ? (record) =>
          record.observation.personName && isBoardSeatObservation(record.observation)
            ? <button type="button" className="btn btn--ghost btn--sm" onClick={() => onAddAsDirector?.(record.observation)}>Add as director</button>
            : null
          : undefined}
        renderPhoneCard={(record, { selecting }) => (
          <RecordTablePhoneCard
            title={personCell(record.observation)}
            recordName={record.personName}
            meta={[record.role, record.observedDate]}
            detail={[record.affiliation, record.matchStatus, record.sourceReference]}
            selecting={selecting}
          />
        )}
      />
    </details>
  );
}
