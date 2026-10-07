import { useMemo, useState } from "react";
import { CalendarClock, Pencil, Save } from "lucide-react";
import { api } from "@/lib/convexApi";
import { usePermissions } from "@/hooks/usePermissions";
import { usePermissionedMutation } from "@/hooks/usePermissionedMutation";
import { useToast } from "@/components/Toast";
import { Badge } from "@/components/ui";
import { EvidenceRowsEditor, type EvidenceColumn } from "@/components/EvidenceRowsEditor";
import { StructuredMinutesEditor, StructuredMinutesSummary } from "./MeetingDetailSupport";
import { structuredEditFromMinutes, structuredMetadataChanges, type StructuredMinutesEdit } from "../lib/structuredMinutes";
import { useDirtyCloseGuard } from "../lib/useDirtyCloseGuard";
import { slugBody } from "../../../../shared/meetingBody";

const NEXT_BODY_LABELS: Record<string, string> = { board: "Board", agm: "AGM", sgm: "SGM" };

type NextMeetingRow = { at?: string; dateText?: string; precision?: string; body?: string; location?: string; notes?: string };

/** Picker value for a stored next meeting (A16). */
function bodyChoiceFor(row: any): string {
  if (row?.committeeId) return `committee:${row.committeeId}`;
  return String(row?.bodyKey ?? "");
}

function nextMeetingRowsFrom(minutes: any): NextMeetingRow[] {
  return (Array.isArray(minutes?.nextMeetings) ? minutes.nextMeetings : []).map((row: any) => ({
    at: row.at ? String(row.at).slice(0, 10) : undefined,
    dateText: row.dateText,
    precision: row.precision,
    body: bodyChoiceFor(row) || undefined,
    location: row.location,
    notes: row.notes,
  }));
}

function nextMeetingsPatch(rows: NextMeetingRow[], committees: any[]) {
  return rows
    .filter((row) => row.at || row.dateText || row.location || row.notes)
    .map((row) => {
      const out: Record<string, unknown> = {};
      if (row.at) out.at = row.at;
      if (row.dateText) out.dateText = row.dateText;
      out.precision = row.precision || (row.at ? "date" : row.dateText ? "month" : undefined);
      if (row.body?.startsWith("committee:")) {
        const committee = committees.find((candidate) => String(candidate._id) === row.body!.slice("committee:".length));
        if (committee) {
          out.committeeId = committee._id;
          out.bodyKey = `committee:${committee.bodyKey || slugBody(committee.name) || "committee"}`;
        }
      } else if (row.body) {
        out.bodyKey = row.body;
      }
      if (row.location) out.location = row.location;
      if (row.notes) out.notes = row.notes;
      return Object.fromEntries(Object.entries(out).filter(([, value]) => value !== undefined));
    });
}

export function MinutesMetadataCard({ minutes, meetingType, committees = [], people = [] }: { minutes: any; meetingType: string; committees?: any[]; people?: any[] }) {
  const { can } = usePermissions();
  const canWrite = can("minutes:write") && !minutes?.approvedAt;
  const update = usePermissionedMutation(api.minutes.update, canWrite);
  const toast = useToast();
  const [draft, setDraft] = useState<StructuredMinutesEdit | null>(null);
  const [original, setOriginal] = useState<StructuredMinutesEdit | null>(null);
  const [nextRows, setNextRows] = useState<NextMeetingRow[]>([]);
  const [originalNext, setOriginalNext] = useState("");
  const [saving, setSaving] = useState(false);
  const peopleNames = useMemo(() => [...new Set((people ?? []).map((person: any) => person.fullName).filter(Boolean))].sort(), [people]);
  const nextColumns: EvidenceColumn[] = useMemo(() => [
    { key: "at", label: "Date", type: "date" },
    { key: "dateText", label: "Date as written", },
    {
      key: "precision",
      label: "Precision",
      emptyLabel: "Not stated",
      choices: [
        { value: "datetime", label: "Date and time" },
        { value: "date", label: "Date only" },
        { value: "month", label: "Month only" },
      ],
    },
    {
      key: "body",
      label: "Body",
      choices: [
        { value: "board", label: "Board" },
        { value: "agm", label: "AGM" },
        { value: "sgm", label: "SGM" },
        ...(committees ?? []).map((committee: any) => ({ value: `committee:${committee._id}`, label: committee.name })),
      ],
    },
    { key: "location", label: "Location" },
    { key: "notes", label: "Notes" },
  ], [committees]);
  const dirty = !!draft && !!original && (JSON.stringify(draft) !== JSON.stringify(original) || JSON.stringify(nextRows) !== originalNext);
  const cancel = useDirtyCloseGuard(dirty, () => { setDraft(null); setOriginal(null); }, "minutes details");
  if (!minutes) return null;

  const start = () => {
    const value = structuredEditFromMinutes(minutes);
    const rows = nextMeetingRowsFrom(minutes);
    setOriginal(value);
    setDraft(value);
    setNextRows(rows);
    setOriginalNext(JSON.stringify(rows));
  };

  const save = async () => {
    if (!canWrite || !draft || !original || saving) return;
    setSaving(true);
    try {
      // Only submit fields the user edited. Untouched source arrays may contain
      // richer values than the legacy pipe-row editor can represent.
      const patch: Record<string, unknown> = structuredMetadataChanges(draft, original);
      if (JSON.stringify(nextRows) !== originalNext) {
        const nextMeetings = nextMeetingsPatch(nextRows, committees);
        patch.nextMeetings = nextMeetings;
        const first = nextMeetings.find((row: any) => row.at);
        if (first && !draft.nextMeetingAt.trim()) patch.nextMeetingAt = String(first.at);
      }
      if (Object.keys(patch).length) await update({ id: minutes._id, patch: patch as any });
      setDraft(null);
      setOriginal(null);
      toast.success("Minutes details saved");
    } catch (error) {
      toast.error("Could not save minutes details", error instanceof Error ? error.message : String(error));
    } finally {
      setSaving(false);
    }
  };

  const nextMeetings: any[] = Array.isArray(minutes.nextMeetings) ? minutes.nextMeetings : [];
  return (
    <div className="card" style={{ marginTop: 16 }} data-testid="minutes-details-card">
      <div className="card__head">
        <h2 className="card__title">Minutes details</h2>
        <span className="card__subtitle">Chair, secretary, call to order, adjournment, next meetings</span>
        <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
          {draft && canWrite ? <>
            <button className="btn-action" disabled={saving} onClick={() => { void cancel(); }}>Cancel</button>
            <button className="btn-action btn-action--primary" disabled={saving} onClick={() => { void save(); }} data-testid="minutes-details-save"><Save size={12} /> {saving ? "Saving..." : "Save details"}</button>
          </> : canWrite && <button className="btn-action" onClick={start} data-testid="minutes-details-edit"><Pencil size={12} /> Edit details</button>}
        </div>
      </div>
      <div className="card__body">
        {draft && canWrite ? (
          <>
            <StructuredMinutesEditor
              value={draft}
              onChange={setDraft}
              isAgm={meetingType === "AGM"}
              includeRecordArrays={false}
              peopleNames={peopleNames}
              presentAttendees={((minutes.detailedAttendance ?? []) as any[]).filter((row) => row?.status === "present" && row?.name)}
            />
            <div className="minutes-next-meetings">
              <EvidenceRowsEditor title="Next meetings" rows={nextRows} columns={nextColumns} onChange={setNextRows} />
            </div>
          </>
        ) : (
          <>
            <StructuredMinutesSummary minutes={minutes} hideNextMeetingAt={nextMeetings.length > 0} />
            {nextMeetings.length > 0 && (
              <div className="row" style={{ gap: 6, flexWrap: "wrap", marginTop: 8 }}>
                {nextMeetings.map((row: any, index: number) => (
                  <Badge key={index} tone="info">
                    <CalendarClock size={11} style={{ verticalAlign: -1, marginRight: 4 }} />
                    Next: {row.at ? String(row.at).slice(0, 10) : row.dateText ?? "date not stated"}
                    {row.committeeId ? ` · ${(committees ?? []).find((committee: any) => String(committee._id) === String(row.committeeId))?.name ?? "committee"}` : row.bodyKey ? ` · ${NEXT_BODY_LABELS[row.bodyKey] ?? row.bodyKey}` : ""}
                    {row.location ? ` · ${row.location}` : ""}
                  </Badge>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}
