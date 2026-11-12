/**
 * P16: board roster observations from source rosters, next to the director
 * register. Explains why the register can be empty while rosters exist, and
 * promotes an observation to a "Needs review" director entry on request.
 */
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { Users } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { FIELD_TYPES, RecordListTable, RecordTableEmpty, RecordTablePhoneCard, staticRecordTable } from "@/platform/record-engine";
import { useToast } from "../../components/Toast";
import { useConfirm } from "../../components/Modal";
import { Badge } from "../../components/ui";
import { entityHref } from "../../components/HoverCard/entityRefs";
import { sourceRoleLabel } from "../../../shared/personHistory";

/** One row of `directors.rosterSuggestions`. */
type RosterSuggestion = {
  seatId: string;
  observationId: string;
  personId?: string;
  personName: string;
  personFullName?: string;
  roleTitle?: string;
  organizationName?: string;
  sheet: string;
  observedDate?: string;
  termStart?: string;
  sourceUrl?: string;
  sourceReference?: string;
  directorId?: string;
  directorStatus?: string;
};

type RosterRecord = {
  _id: string;
  personName: string;
  role: string;
  organizationName: string;
  sheet: string;
  observedDate: string | null;
  sourceReference: string;
  register: string;
  row: RosterSuggestion;
};

const ROSTER_TABLE = staticRecordTable({
  id: "board-roster-observations",
  nameSingular: "rosterObservation",
  namePlural: "rosterObservations",
  labelSingular: "Roster observation",
  labelPlural: "Roster observations",
  labelIdentifierFieldName: "personName",
  fields: [
    { name: "personName", label: "Person", fieldType: FIELD_TYPES.TEXT, size: 200, config: { groupable: false } },
    { name: "role", label: "Role", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "organizationName", label: "Organization", fieldType: FIELD_TYPES.TEXT, size: 180 },
    { name: "sheet", label: "Roster", fieldType: FIELD_TYPES.TEXT, size: 160 },
    { name: "observedDate", label: "Observed", fieldType: FIELD_TYPES.DATE, size: 120 },
    { name: "sourceReference", label: "Source", fieldType: FIELD_TYPES.TEXT, size: 180 },
    {
      name: "register",
      label: "Register",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      config: {
        options: [
          { value: "Active", label: "Active", color: "green" },
          { value: "NeedsReview", label: "Needs review", color: "amber" },
          { value: "Resigned", label: "Resigned", color: "amber" },
          { value: "Removed", label: "Removed", color: "amber" },
          { value: "NotListed", label: "Not listed", color: "gray" },
        ],
      },
    },
  ],
});

function rosterRecord(row: RosterSuggestion): RosterRecord {
  return {
    _id: `${row.seatId}:${row.observationId}`,
    personName: row.personFullName ?? row.personName,
    role: sourceRoleLabel(row.roleTitle),
    organizationName: row.organizationName ?? "",
    sheet: row.sheet,
    observedDate: row.observedDate ?? null,
    sourceReference: row.sourceReference ?? "",
    register: row.directorId ? row.directorStatus ?? "" : "NotListed",
    row,
  };
}

export function BoardRosterCard({ societyId, activeDirectorCount }: { societyId: string; activeDirectorCount: number }) {
  const { can } = usePermissions();
  const [open, setOpen] = useState(false);
  const rows = useQuery(api.directors.rosterSuggestions, can("directors:read") && can("members:read") ? { societyId } : "skip") as RosterSuggestion[] | undefined;
  const promote = useMutation(api.directors.promoteRosterObservation);
  const toast = useToast();
  const confirm = useConfirm();
  const [sheet, setSheet] = useState("");
  const sheets = useMemo(() => Array.from(new Set((rows ?? []).map((r) => r.sheet))).sort().reverse(), [rows]);
  const records = useMemo(() => (rows ?? []).filter((r) => !sheet || r.sheet === sheet).map(rosterRecord), [rows, sheet]);
  if (!rows?.length) return null;
  const unregistered = rows.filter((r) => !r.directorId).length;

  const addToRegister = async (r: RosterSuggestion) => {
    const ok = await confirm({ title: `Add ${r.personFullName ?? r.personName} to the director register?`, message: `The entry starts as “Needs review”, with term start ${r.termStart ?? r.observedDate ?? "unknown"} from the ${r.sheet} roster, no consent and no residency recorded. It does not count as an active director until you confirm it.`, confirmLabel: "Add as needs review" });
    if (!ok) return;
    try { await promote({ seatId: r.seatId, observationId: r.observationId }); toast.success("Added to the director register", "Status: Needs review"); }
    catch (e: unknown) { toast.error("Could not add", e instanceof Error ? e.message : String(e)); }
  };

  const registerBadge = (r: RosterSuggestion) => {
    if (!r.directorId) return <span className="muted">Not listed</span>;
    const href = entityHref({ kind: "director", id: r.directorId });
    const badge = <Badge tone={r.directorStatus === "Active" ? "success" : "warn"}>{r.directorStatus === "NeedsReview" ? "Needs review" : r.directorStatus}</Badge>;
    return href ? <Link to={href} aria-label={`Open ${r.personFullName ?? r.personName} in the director register`}>{badge}</Link> : badge;
  };

  return (
    <details className="card" style={{ marginBottom: 16 }} open={open} onToggle={(e) => setOpen((e.currentTarget as HTMLDetailsElement).open)}>
      <summary className="card__head" style={{ cursor: "pointer" }}>
        <span className="card__title">Board rosters from source documents ({rows.length})</span>
        {unregistered > 0 && <Badge tone="warn">{unregistered} not on the register</Badge>}
      </summary>
      {open && (
        <>
          <div className="card__body" style={{ paddingBottom: 0 }}>
            <p className="muted" style={{ margin: 0 }}>
              {activeDirectorCount === 0 ? "The director register is empty, but these source rosters list board members. " : ""}
              A roster shows who sat on the board when it was written; it does not prove an election, a term or consent.
              Add a person to the register as <strong>Needs review</strong>, then confirm the appointment and set them Active.
            </p>
          </div>
          <RecordListTable<RosterRecord>
            variant="card"
            table={ROSTER_TABLE}
            tableId="board-roster-observations"
            label="Board rosters"
            icon={<Users size={14} />}
            records={records}
            toolbarActions={
              <select className="input" value={sheet} onChange={(e) => setSheet(e.target.value)} aria-label="Roster sheet" style={{ width: "auto", display: "inline-block" }}>
                <option value="">All board rosters</option>
                {sheets.map((s) => <option key={s} value={s}>{s}</option>)}
              </select>
            }
            renderCell={({ record, field }) => {
              const r = record.row;
              if (field.name === "personName")
                return r.personId ? <Link to={`/app/people-directory/${r.personId}`}>{record.personName}</Link> : <span>{record.personName}</span>;
              if (field.name === "organizationName") return <span className="muted">{record.organizationName}</span>;
              if (field.name === "observedDate" && !r.observedDate) return <span className="muted">date unknown</span>;
              if (field.name === "sourceReference")
                return r.sourceUrl ? <a href={r.sourceUrl} target="_blank" rel="noreferrer">{r.sourceReference}</a> : <span className="muted">{r.sourceReference}</span>;
              if (field.name === "register") return registerBadge(r);
              return undefined;
            }}
            renderRowActions={(record) =>
              record.row.directorId ? null : (
                <button type="button" className="btn btn--sm" disabled={!can("directors:write")} onClick={() => void addToRegister(record.row)}>
                  Add to register…
                </button>
              )
            }
            renderPhoneCard={(record, { selecting }) => (
              <RecordTablePhoneCard
                title={record.row.personId ? <Link to={`/app/people-directory/${record.row.personId}`}>{record.personName}</Link> : record.personName}
                recordName={record.personName}
                badge={registerBadge(record.row)}
                meta={[record.role, record.organizationName]}
                detail={[record.sheet, record.observedDate ?? "date unknown", record.sourceReference]}
                selecting={selecting}
              />
            )}
            emptyState={<RecordTableEmpty title="No observations on this roster" />}
          />
        </>
      )}
    </details>
  );
}
