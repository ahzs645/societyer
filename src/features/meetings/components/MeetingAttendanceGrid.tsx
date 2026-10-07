/**
 * Attendance grid (schema B4/B5, ui-meetings F5/F13/F15, ui-people P9).
 *
 * Replaces the JSON / pipe-text attendance editors: one row per person with
 * status (present, regrets, absent, staff, guest, proxy), role, affiliation,
 * represented organization, a people-directory link and the quorum flag. Role
 * words, organizations and headings are flagged with a one-click "Not a
 * person" correction, and counts update as you edit. Saving writes the
 * minutes, the meeting and the attendance register together.
 */
import { useEffect, useMemo, useState } from "react";
import { useQuery } from "convex/react";
import { ClipboardPaste, FileText, Plus, Save, Trash2, UserX, Users, Wand2, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import { Badge } from "@/components/ui";
import { Select } from "@/components/Select";
import { Modal } from "@/components/Modal";
import { Checkbox } from "@/components/Controls";
import { useToast } from "@/components/Toast";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import {
  ATTENDANCE_GRID_STATUSES,
  ATTENDANCE_GRID_STATUS_LABELS,
  attendanceCounts,
  attendanceRowSuggestion,
  attendanceRowsFromMinutes,
  attendanceRowsFromPaste,
  attendanceRowsFromSourceParticipants,
  blankAttendanceRow,
  defaultQuorumCounted,
  mergeAttendanceRows,
  normalizePersonKey,
  type AttendanceGridRow,
  type AttendanceGridStatus,
} from "../../../../shared/meetingAttendanceGrid";
import { PersonNameLinkField, type DirectoryPerson } from "../../../components/PersonNameLinkField";
import { useDirtyCloseGuard } from "../lib/useDirtyCloseGuard";

const STATUS_OPTIONS = ATTENDANCE_GRID_STATUSES.map((value) => ({ value, label: ATTENDANCE_GRID_STATUS_LABELS[value] }));
const STATUS_TONE: Record<AttendanceGridStatus, "success" | "neutral" | "warn" | "info"> = {
  present: "success", proxy: "success", staff: "info", guest: "info", regrets: "neutral", absent: "warn", unknown: "warn",
};

type NonPerson = { name: string; kind: string };

function rowsSignature(rows: AttendanceGridRow[], nonPersons: NonPerson[]) {
  return JSON.stringify([rows.map(({ key: _key, ...rest }) => rest), nonPersons]);
}

export function MeetingAttendanceGrid({
  meeting,
  minutes,
  people,
  editing,
  onEditingChange,
  quorumRequired,
  activeProxyCount = 0,
  expectedPeople,
  expectedPeopleLabel,
}: {
  meeting: any;
  minutes: any;
  people: DirectoryPerson[] | undefined;
  editing: boolean;
  onEditingChange: (editing: boolean) => void;
  quorumRequired?: number | null;
  activeProxyCount?: number;
  /** Names to add with one click (current directors / committee members). */
  expectedPeople?: string[];
  expectedPeopleLabel?: string;
}) {
  const { can } = usePermissions();
  const canEdit = can("minutes:write") && can("meetings:write") && !minutes?.approvedAt;
  const records = useQuery(api.meetings.attendanceRecords, can("meetings:read") && meeting?._id ? { meetingId: meeting._id } : "skip") as any[] | undefined;
  const save = usePermissionedMutation(api.minutes.saveAttendanceGrid, canEdit);
  const toast = useToast();
  const [rows, setRows] = useState<AttendanceGridRow[]>([]);
  const [nonPersons, setNonPersons] = useState<NonPerson[]>([]);
  const [initial, setInitial] = useState("");
  const [pasteOpen, setPasteOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [pasteStatus, setPasteStatus] = useState<AttendanceGridStatus>("present");
  const [saving, setSaving] = useState(false);

  const viewRows = useMemo(() => attendanceRowsFromMinutes(minutes, records ?? []), [minutes, records]);

  useEffect(() => {
    if (!editing) return;
    const seeded = attendanceRowsFromMinutes(minutes, records ?? []);
    setRows(seeded);
    setNonPersons([]);
    setInitial(rowsSignature(seeded, []));
    setPasteOpen(false);
    // Seed once per edit session.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editing]);

  const dirty = editing && rowsSignature(rows, nonPersons) !== initial;
  const close = useDirtyCloseGuard(dirty, () => onEditingChange(false), "attendance changes");

  const activeRows = editing ? rows : viewRows;
  const counts = attendanceCounts(activeRows);
  const quorumMet = quorumRequired == null ? null : counts.quorumCounted + activeProxyCount >= quorumRequired;
  const suggestions = useMemo(() => new Map(activeRows.map((row) => [row.key, attendanceRowSuggestion(row, people)])), [activeRows, people]);
  const notPersonSuggestions = activeRows.filter((row) => suggestions.get(row.key)?.kind === "not_person");
  const nonPersonEvidence: any[] = useMemo(() => {
    try {
      const parsed = minutes?.draftTranscript ? JSON.parse(minutes.draftTranscript) : null;
      return Array.isArray(parsed?.nonPersonAttendance) ? parsed.nonPersonAttendance : [];
    } catch {
      return [];
    }
  }, [minutes?.draftTranscript]);
  const participants = minutes?.sourceMeetingRecord?.participants;

  const patchRow = (key: string, diff: Partial<AttendanceGridRow>) => setRows((current) => current.map((row) => {
    if (row.key !== key) return row;
    const next = { ...row, ...diff };
    if (diff.status && diff.quorumCounted === undefined) next.quorumCounted = defaultQuorumCounted(diff.status);
    return next;
  }));
  const removeRow = (key: string) => setRows((current) => current.filter((row) => row.key !== key));
  const markNotPerson = (key: string) => {
    const row = rows.find((candidate) => candidate.key === key);
    if (!row) return;
    const suggestion = attendanceRowSuggestion(row);
    setNonPersons((current) => [...current, { name: row.name, kind: suggestion?.kind === "not_person" ? suggestion.reason : "not_person" }]);
    removeRow(key);
  };
  const markAllNotPersons = () => {
    const flagged = rows.filter((row) => suggestions.get(row.key)?.kind === "not_person");
    setNonPersons((current) => [...current, ...flagged.map((row) => {
      const suggestion = suggestions.get(row.key);
      return { name: row.name, kind: suggestion?.kind === "not_person" ? suggestion.reason : "not_person" };
    })]);
    const drop = new Set(flagged.map((row) => row.key));
    setRows((current) => current.filter((row) => !drop.has(row.key)));
  };
  const restoreNonPerson = (name: string) => {
    setNonPersons((current) => current.filter((entry) => entry.name !== name));
    setRows((current) => [...current, blankAttendanceRow({ name, status: "unknown", quorumCounted: false })]);
  };
  const addRows = (incoming: AttendanceGridRow[]) => {
    const blankRows = incoming.filter((row) => !normalizePersonKey(row.name));
    const merged = mergeAttendanceRows(rows, incoming);
    setRows([...merged.rows, ...blankRows]);
    if (incoming.length && !blankRows.length && !merged.added && !merged.filled) {
      toast.info("Nothing to add", "Everyone in that list is already in the grid with their role and affiliation.");
    } else if (merged.filled) {
      toast.success(`${merged.added} added · ${merged.filled} updated`, "Blank roles and affiliations were filled in; values you typed were kept.");
    }
  };
  const applySuggestion = (row: AttendanceGridRow) => {
    const suggestion = suggestions.get(row.key);
    if (!suggestion) return;
    if (suggestion.kind === "not_person") markNotPerson(row.key);
    else if (suggestion.kind === "split") patchRow(row.key, { name: suggestion.name, roleTitle: suggestion.roleTitle, affiliation: suggestion.affiliation });
    else if (suggestion.kind === "link") patchRow(row.key, { personId: suggestion.personId });
  };

  const submit = async () => {
    if (!canEdit || !minutes) return;
    const blank = rows.filter((row) => !row.name.trim());
    if (blank.length) {
      toast.error("Some rows have no name", "Enter a name or remove the empty rows.");
      return;
    }
    setSaving(true);
    try {
      const result: any = await save({
        minutesId: minutes._id,
        rows: rows.map(({ key: _key, ...row }) => ({
          ...row,
          personId: row.personId as any,
          recordId: row.recordId as any,
        })),
        nonPersons,
        quorumStatusIfUnset: quorumMet == null ? undefined : quorumMet ? "confirmed" : "not_met",
      });
      toast.success("Attendance saved", `${result?.attendees ?? counts.inAttendance} attending · ${result?.absent ?? counts.notAttending} regrets/absent${nonPersons.length ? ` · ${nonPersons.length} kept as evidence` : ""}`);
      setInitial(rowsSignature(rows, nonPersons));
      onEditingChange(false);
    } catch (error: any) {
      toast.error("Couldn't save attendance", error?.message ?? String(error));
    } finally {
      setSaving(false);
    }
  };

  const summary = (
    <div className="attendance-grid__counts" data-testid="attendance-counts">
      <Badge tone="success">{counts.present} present</Badge>
      {counts.inAttendance - counts.present > 0 && <Badge tone="info">{counts.inAttendance - counts.present} staff/guests/proxies</Badge>}
      <Badge tone="neutral">{counts.notAttending} regrets/absent</Badge>
      {quorumRequired != null && (
        <Badge tone={quorumMet ? "success" : "warn"}>
          {counts.quorumCounted}{activeProxyCount ? ` + ${activeProxyCount} proxies` : ""} of {quorumRequired} needed for quorum
        </Badge>
      )}
      {minutes?.quorumStatus === "confirmed" && quorumRequired != null && counts.quorumCounted + activeProxyCount < quorumRequired && (
        <Badge tone="warn">Quorum is recorded as met, but only {counts.quorumCounted + activeProxyCount} of {quorumRequired} are counted present — check the attendance</Badge>
      )}
      {notPersonSuggestions.length > 0 && (
        <Badge tone="warn">{notPersonSuggestions.length} entr{notPersonSuggestions.length === 1 ? "y looks" : "ies look"} like a role, organization or heading</Badge>
      )}
    </div>
  );

  const linkSuggestions = activeRows.filter((row) => suggestions.get(row.key)?.kind === "link");
  const linkAll = () => setRows((current) => current.map((row) => {
    const suggestion = suggestions.get(row.key);
    return suggestion?.kind === "link" ? { ...row, personId: suggestion.personId } : row;
  }));

  const view = (
      <div className="attendance-grid attendance-grid--view">
        {summary}
        {viewRows.length === 0 ? (
          <p className="muted" style={{ fontSize: "var(--fs-sm)" }}>No attendance recorded yet.</p>
        ) : (
          <ul className="attendance-grid__list">
            {viewRows.map((row) => {
              const linked = row.personId ? people?.find((person) => String(person._id) === String(row.personId)) : undefined;
              const suggestion = suggestions.get(row.key);
              return (
                <li key={row.key} className="attendance-grid__item">
                  <div className="attendance-grid__who">
                    <strong>{row.name}</strong>
                    {linked && <span className="muted" title="Linked to the people directory"> · {linked.fullName === row.name ? "linked" : linked.fullName}</span>}
                    {(row.roleTitle || row.affiliation || row.representedOrganization) && (
                      <span className="muted attendance-grid__meta">
                        {[row.roleTitle, row.affiliation, row.representedOrganization && row.representedOrganization !== row.affiliation ? `represents ${row.representedOrganization}` : ""].filter(Boolean).join(" · ")}
                      </span>
                    )}
                    {suggestion?.kind === "not_person" && <span className="attendance-grid__flag">{suggestion.label}</span>}
                  </div>
                  <Badge tone={STATUS_TONE[row.status]}>{ATTENDANCE_GRID_STATUS_LABELS[row.status]}</Badge>
                </li>
              );
            })}
          </ul>
        )}
        {nonPersonEvidence.length > 0 && (
          <details className="attendance-grid__evidence">
            <summary>{nonPersonEvidence.length} source entr{nonPersonEvidence.length === 1 ? "y" : "ies"} kept as evidence, not attendees</summary>
            <p className="muted">{nonPersonEvidence.map((row) => row.name).join(" · ")}</p>
          </details>
        )}
        {canEdit && (
          <button type="button" className="btn-action" onClick={() => onEditingChange(true)} data-testid="attendance-edit">
            <Users size={12} /> Edit attendance
          </button>
        )}
      </div>
  );

  if (!editing) return view;

  return (
    <>
    {view}
    <Modal
      open
      onClose={() => { void close(); }}
      title="Edit attendance"
      size="xl"
      footer={
        <>
          <button type="button" className="btn" onClick={() => { void close(); }}>Cancel</button>
          <button type="button" className="btn btn--accent" disabled={!canEdit || saving} onClick={() => { void submit(); }} data-testid="attendance-save">
            <Save size={12} /> {saving ? "Saving…" : "Save attendance"}
          </button>
        </>
      }
    >
    <div className="attendance-grid attendance-grid--edit" data-testid="attendance-grid">
      {summary}
      <div className="attendance-grid__toolbar">
        <button type="button" className="btn-action" onClick={() => addRows([blankAttendanceRow()])}>
          <Plus size={12} /> Add person
        </button>
        <button type="button" className="btn-action" onClick={() => setPasteOpen((open) => !open)}>
          <ClipboardPaste size={12} /> Paste names
        </button>
        {Array.isArray(participants) && participants.length > 0 && (
          <button type="button" className="btn-action" onClick={() => addRows(attendanceRowsFromSourceParticipants(participants))} title="Add the attendance list parsed from the source record">
            <FileText size={12} /> Use names and roles from source
          </button>
        )}
        {expectedPeople && expectedPeople.length > 0 && (
          <button type="button" className="btn-action" onClick={() => addRows(expectedPeople.map((name) => blankAttendanceRow({ name })))}>
            <Users size={12} /> {expectedPeopleLabel ?? "Add expected people"}
          </button>
        )}
        {linkSuggestions.length > 0 && (
          <button type="button" className="btn-action" onClick={linkAll} data-testid="attendance-link-all">
            <Wand2 size={12} /> Link {linkSuggestions.length} to the people directory
          </button>
        )}
        {notPersonSuggestions.length > 0 && (
          <button type="button" className="btn-action btn-action--warn" onClick={markAllNotPersons} data-testid="attendance-mark-all-non-persons">
            <UserX size={12} /> Mark {notPersonSuggestions.length} flagged as not people
          </button>
        )}
      </div>
      {pasteOpen && (
        <div className="attendance-grid__paste">
          <textarea
            className="textarea"
            rows={4}
            value={pasteText}
            onChange={(event) => setPasteText(event.target.value)}
            placeholder={"One person per line, e.g.\nAlex Example, Ministry of Examples\nBlair Sample (Chair)"}
            aria-label="Names to add"
          />
          <div className="row" style={{ gap: 6, alignItems: "center" }}>
            <Select value={pasteStatus} onChange={(value) => setPasteStatus(value as AttendanceGridStatus)} options={STATUS_OPTIONS} size="sm" aria-label="Status for pasted names" />
            <button type="button" className="btn-action btn-action--primary" disabled={!pasteText.trim()} onClick={() => { addRows(attendanceRowsFromPaste(pasteText, pasteStatus)); setPasteText(""); setPasteOpen(false); }}>
              Add names
            </button>
          </div>
        </div>
      )}
      <div className="attendance-grid__table" role="table" aria-label="Attendance">
        <div className="attendance-grid__row attendance-grid__row--head" role="row">
          <span role="columnheader">Name / person</span>
          <span role="columnheader">Status</span>
          <span role="columnheader">Role</span>
          <span role="columnheader">Affiliation</span>
          <span role="columnheader">Represents</span>
          <span role="columnheader" title="Counts toward quorum">Quorum</span>
          <span role="columnheader" className="sr-only">Actions</span>
        </div>
        {rows.map((row, index) => {
          const suggestion = suggestions.get(row.key);
          return (
            <div key={row.key} className={`attendance-grid__row${suggestion?.kind === "not_person" ? " is-flagged" : ""}`} role="row" data-testid="attendance-row">
              <span role="cell" className="attendance-grid__name">
                <PersonNameLinkField
                  value={{ name: row.name, personId: row.personId }}
                  onChange={(next) => patchRow(row.key, { name: next.name, personId: next.personId })}
                  people={people}
                  ariaLabel={`Attendee ${index + 1} name`}
                  compact
                />
                {suggestion && (
                  <button type="button" className={`attendance-grid__suggestion attendance-grid__suggestion--${suggestion.kind}`} onClick={() => applySuggestion(row)}>
                    <Wand2 size={11} /> {suggestion.kind === "not_person" ? `${suggestion.label} — mark not a person` : suggestion.label}
                  </button>
                )}
              </span>
              <span role="cell">
                <Select value={row.status} onChange={(status) => patchRow(row.key, { status: status as AttendanceGridStatus })} options={STATUS_OPTIONS} size="sm" aria-label={`Status for ${row.name || `attendee ${index + 1}`}`} />
              </span>
              <span role="cell"><input className="input input--sm" value={row.roleTitle ?? ""} onChange={(event) => patchRow(row.key, { roleTitle: event.target.value })} aria-label={`Role for ${row.name || `attendee ${index + 1}`}`} placeholder="Chair, Treasurer…" /></span>
              <span role="cell"><input className="input input--sm" value={row.affiliation ?? ""} onChange={(event) => patchRow(row.key, { affiliation: event.target.value })} aria-label={`Affiliation for ${row.name || `attendee ${index + 1}`}`} /></span>
              <span role="cell"><input className="input input--sm" value={row.representedOrganization ?? ""} onChange={(event) => patchRow(row.key, { representedOrganization: event.target.value })} aria-label={`Organization represented by ${row.name || `attendee ${index + 1}`}`} placeholder="Seat holder for…" /></span>
              <span role="cell" className="attendance-grid__quorum">
                <Checkbox checked={row.quorumCounted !== false && (row.status === "present" || row.status === "proxy")} disabled={!(row.status === "present" || row.status === "proxy")} onChange={(checked) => patchRow(row.key, { quorumCounted: checked })} bare ariaLabel={`${row.name || `Attendee ${index + 1}`} counts toward quorum`} />
              </span>
              <span role="cell" className="attendance-grid__actions">
                <button type="button" className="btn-action btn-action--icon" onClick={() => markNotPerson(row.key)} title="Not a person (role, organization or heading) — keep as source evidence" aria-label={`Mark ${row.name || "row"} as not a person`}>
                  <UserX size={12} />
                </button>
                <button type="button" className="btn-action btn-action--icon" onClick={() => removeRow(row.key)} title="Remove row" aria-label={`Remove ${row.name || "row"}`}>
                  <Trash2 size={12} />
                </button>
              </span>
            </div>
          );
        })}
        {rows.length === 0 && <p className="muted" style={{ padding: 8 }}>No attendees. Add people, paste a list or use the names from the source.</p>}
      </div>
      {nonPersons.length > 0 && (
        <div className="attendance-grid__nonpersons" data-testid="attendance-non-persons">
          <strong>Kept as source evidence, not attendees:</strong>
          {nonPersons.map((entry) => (
            <span key={entry.name} className="attendance-grid__chip">
              {entry.name}
              <button type="button" onClick={() => restoreNonPerson(entry.name)} aria-label={`Restore ${entry.name} as an attendee`} title="Restore as attendee"><X size={10} /></button>
            </span>
          ))}
        </div>
      )}
    </div>
    </Modal>
    </>
  );
}
