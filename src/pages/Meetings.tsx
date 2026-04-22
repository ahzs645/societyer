import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { DataTable } from "../components/DataTable";
import { FilterField } from "../components/FilterBar";
import { Select } from "../components/Select";
import { DateTimeInput } from "../components/DateTimeInput";
import { Toggle } from "../components/Controls";
import { useToast } from "../components/Toast";
import { Plus, Calendar, Tag, AlertTriangle } from "lucide-react";
import { formatDateTime } from "../lib/format";
import { useBylawRules } from "../hooks/useBylawRules";
import { CalendarView } from "../components/CalendarView";
import type { ToneVariant } from "../components/ui";

const OVERLAP_WINDOW_MS = 2 * 60 * 60 * 1000; // within 2 hours counts as concurrent

function computeConflicts(meetings: any[]): Map<string, string[]> {
  const byTime = meetings
    .filter((m) => m.status !== "Cancelled")
    .map((m) => ({ id: m._id, title: m.title, ts: new Date(m.scheduledAt).getTime() }))
    .sort((a, b) => a.ts - b.ts);
  const out = new Map<string, string[]>();
  for (let i = 0; i < byTime.length; i++) {
    for (let j = i + 1; j < byTime.length; j++) {
      if (byTime[j].ts - byTime[i].ts > OVERLAP_WINDOW_MS) break;
      out.set(byTime[i].id, [...(out.get(byTime[i].id) ?? []), byTime[j].title]);
      out.set(byTime[j].id, [...(out.get(byTime[j].id) ?? []), byTime[i].title]);
    }
  }
  return out;
}

const MEETING_FIELDS: FilterField<any>[] = [
  { id: "title", label: "Title", icon: <Tag size={14} />, match: (m, q) => m.title.toLowerCase().includes(q.toLowerCase()) },
  { id: "type", label: "Type", icon: <Tag size={14} />, options: ["Board", "Committee", "AGM", "SGM"], match: (m, q) => m.type === q },
  { id: "status", label: "Status", icon: <Tag size={14} />, options: ["Scheduled", "Held", "Cancelled"], match: (m, q) => m.status === q },
  { id: "electronic", label: "Electronic", options: ["Yes", "No"], match: (m, q) => (m.electronic ? "Yes" : "No") === q },
  { id: "location", label: "Location", icon: <Tag size={14} />, match: (m, q) => (m.location ?? "").toLowerCase().includes(q.toLowerCase()) },
  { id: "year", label: "Scheduled in year", icon: <Calendar size={14} />, match: (m, q) => (m.scheduledAt ?? "").startsWith(q) },
];

export function MeetingsPage() {
  const society = useSociety();
  const { rules } = useBylawRules();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<any>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const formRules = useQuery(
    api.bylawRules.getForDate,
    society && form?.scheduledAt ? { societyId: society._id, dateISO: form.scheduledAt } : "skip",
  );
  const create = useMutation(api.meetings.create);
  const navigate = useNavigate();
  const toast = useToast();
  const noticeMinDays = rules?.generalNoticeMinDays ?? 14;
  const noticeMaxDays = rules?.generalNoticeMaxDays ?? 60;

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;

  const conflicts = computeConflicts(meetings ?? []);

  const openNew = () => {
    setForm({
      type: "Board", title: "",
      scheduledAt: toDateTimeLocalValue(new Date(Date.now() + noticeMinDays * 864e5)),
      location: "",
      electronic: !!rules?.allowElectronicMeetings,
      quorumRequired: "",
      status: "Scheduled",
      attendeeIds: [],
    });
    setOpen(true);
  };
  const save = async () => {
    if (!form) return;
    const effectiveRules = formRules ?? rules;
    const effectiveNoticeMinDays = effectiveRules?.generalNoticeMinDays ?? noticeMinDays;
    const effectiveNoticeMaxDays = effectiveRules?.generalNoticeMaxDays ?? noticeMaxDays;
    if (isGeneralMeeting(form.type) && !meetsNoticeWindow(form.scheduledAt, effectiveNoticeMinDays, effectiveNoticeMaxDays)) {
      toast.error(`General meetings need ${effectiveNoticeMinDays}–${effectiveNoticeMaxDays} days of notice.`);
      return;
    }
    await create({
      societyId: society._id,
      ...form,
      quorumRequired: numberOrUndefined(form.quorumRequired),
    });
    setOpen(false);
    toast.success("Meeting scheduled", form.title);
  };

  return (
    <div className="page">
      <PageHeader
        title="Meetings"
        icon={<Calendar size={16} />}
        iconColor="orange"
        subtitle={`Board meetings, committee meetings, and general meetings (AGM/SGM). Active notice rule: ${noticeMinDays}–${noticeMaxDays} days.`}
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end" }}>
            <div className="segmented" role="tablist" aria-label="Meeting view">
              <button
                type="button"
                className={`segmented__btn${viewMode === "list" ? " is-active" : ""}`}
                aria-pressed={viewMode === "list"}
                onClick={() => setViewMode("list")}
              >
                List
              </button>
              <button
                type="button"
                className={`segmented__btn${viewMode === "calendar" ? " is-active" : ""}`}
                aria-pressed={viewMode === "calendar"}
                onClick={() => setViewMode("calendar")}
              >
                Calendar
              </button>
            </div>
            <button className="btn-action btn-action--primary" onClick={openNew}>
              <Plus size={12} /> New meeting
            </button>
          </div>
        }
      />

      {viewMode === "calendar" ? (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Meeting calendar</h2>
            <span className="card__subtitle">Click a meeting to open its hub.</span>
          </div>
          <div className="card__body">
            <CalendarView
              items={(meetings ?? []) as any[]}
              getDate={(meeting) => meeting.scheduledAt}
              getLabel={(meeting) => `${meetingTimeLabel(meeting.scheduledAt)} ${meeting.title}`}
              getTone={(meeting) => meetingStatusTone(meeting.status)}
              getId={(meeting) => meeting._id}
              onSelect={(meeting) => navigate(`/app/meetings/${meeting._id}`)}
            />
          </div>
        </div>
      ) : (
        <DataTable
          label="All meetings"
          icon={<Calendar size={14} />}
          data={(meetings ?? []) as any[]}
          rowKey={(r) => r._id}
          filterFields={MEETING_FIELDS}
          searchPlaceholder="Search meetings…"
          defaultSort={{ columnId: "scheduledAt", dir: "desc" }}
          onRowClick={(row) => navigate(`/app/meetings/${row._id}`)}
          columns={[
            { id: "title", header: "Title", sortable: true, accessor: (r) => r.title, render: (r) => <strong>{r.title}</strong> },
            {
              id: "type", header: "Type", sortable: true,
              accessor: (r) => r.type,
              render: (r) => <Badge tone={r.type === "AGM" ? "accent" : r.type === "SGM" ? "warn" : "info"}>{r.type}</Badge>,
            },
            {
              id: "scheduledAt", header: "When", sortable: true,
              accessor: (r) => r.scheduledAt,
              render: (r) => {
                const overlap = conflicts.get(r._id);
                return (
                  <span>
                    <span className="mono">{formatDateTime(r.scheduledAt)}</span>
                    {overlap && (
                      <span
                        title={`Overlaps with: ${overlap.join(", ")}`}
                        style={{ marginLeft: 6, display: "inline-flex", alignItems: "center" }}
                      >
                        <Badge tone="warn">
                          <AlertTriangle size={10} style={{ marginRight: 3, verticalAlign: -1 }} />
                          {overlap.length} concurrent
                        </Badge>
                      </span>
                    )}
                  </span>
                );
              },
            },
            {
              id: "location", header: "Location", sortable: true,
              accessor: (r) => r.location ?? "",
              render: (r) => (
                <span>
                  {r.location ?? "—"} {r.electronic && <Badge tone="info">Electronic</Badge>}
                </span>
              ),
            },
            {
              id: "status", header: "Status", sortable: true,
              accessor: (r) => r.status,
              render: (r) => <Badge tone={meetingStatusTone(r.status)}>{r.status}</Badge>,
            },
            {
              id: "minutes", header: "Minutes",
              render: (r) => r.minutesId ? <Badge tone="success">Recorded</Badge> : <span className="muted">—</span>,
            },
          ]}
        />
      )}

      <Drawer
        open={open} onClose={() => setOpen(false)} title="Schedule meeting"
        footer={<><button className="btn" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" onClick={save}>Schedule</button></>}
      >
        {form && (
          <div>
            {(() => {
              const effectiveRules = formRules ?? rules;
              const effectiveNoticeMinDays = effectiveRules?.generalNoticeMinDays ?? noticeMinDays;
              const effectiveNoticeMaxDays = effectiveRules?.generalNoticeMaxDays ?? noticeMaxDays;
              return isGeneralMeeting(form.type) && !meetsNoticeWindow(form.scheduledAt, effectiveNoticeMinDays, effectiveNoticeMaxDays) ? (
              <div className="flag flag--warn" style={{ marginBottom: 12 }}>
                <AlertTriangle />
                <div>
                  General meetings should be scheduled with {effectiveNoticeMinDays}–{effectiveNoticeMaxDays} days of notice under the rule set effective on this meeting date.
                </div>
              </div>
              ) : null;
            })()}
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Type">
                <Select
                  value={form.type}
                  onChange={(v) => setForm({ ...form, type: v })}
                  options={["Board", "Committee", "AGM", "SGM"].map((t) => ({ value: t, label: t }))}
                />
              </Field>
              <Field label="Scheduled">
                <DateTimeInput value={form.scheduledAt} onChange={(v) => setForm({ ...form, scheduledAt: v })} />
              </Field>
            </div>
            <Field label="Location"><input className="input" value={form.location} onChange={(e) => setForm({ ...form, location: e.target.value })} /></Field>
            <Toggle
              checked={form.electronic}
              onChange={(v) => setForm({ ...form, electronic: v })}
              disabled={!(formRules ?? rules)?.allowElectronicMeetings}
              label="Electronic participation permitted"
            />
            <Field label="Quorum required">
              <input
                className="input"
                type="number"
                placeholder={
                  (formRules ?? rules)?.quorumType === "fixed"
                    ? String((formRules ?? rules)?.quorumValue ?? "")
                    : "Computed for AGM/SGM"
                }
                value={form.quorumRequired ?? ""}
                onChange={(e) => setForm({ ...form, quorumRequired: e.target.value })}
              />
            </Field>
            <Field label="Notes"><textarea className="textarea" value={form.notes ?? ""} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></Field>
            {form.type === "AGM" && (
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                Reminder: AGM notice must be sent {(formRules ?? rules)?.generalNoticeMinDays ?? noticeMinDays}–{(formRules ?? rules)?.generalNoticeMaxDays ?? noticeMaxDays} days in advance.
                {(formRules ?? rules)?.requireAgmFinancialStatements ? " Financial statements must be presented." : ""}
                {(formRules ?? rules)?.requireAgmElections ? " Elections are expected under the effective rule set." : ""}
              </div>
            )}
            {(() => {
              const draftTs = form.scheduledAt ? new Date(form.scheduledAt).getTime() : NaN;
              if (!Number.isFinite(draftTs)) return null;
              const overlaps = (meetings ?? []).filter(
                (m) =>
                  m.status !== "Cancelled" &&
                  Math.abs(new Date(m.scheduledAt).getTime() - draftTs) <= OVERLAP_WINDOW_MS,
              );
              if (overlaps.length === 0) return null;
              return (
                <div
                  style={{
                    marginTop: 8,
                    padding: 10,
                    border: "1px solid var(--border)",
                    borderRadius: 6,
                    background: "var(--bg-subtle)",
                    fontSize: 13,
                  }}
                >
                  <AlertTriangle size={12} style={{ verticalAlign: -1, color: "var(--warn, #c78b00)", marginRight: 4 }} />
                  <strong>Schedule conflict:</strong> {overlaps.length} other meeting{overlaps.length === 1 ? "" : "s"} within 2h of this time:
                  <ul style={{ margin: "4px 0 0 20px" }}>
                    {overlaps.map((m) => (
                      <li key={m._id} className="muted">
                        {m.title} — {formatDateTime(m.scheduledAt)}
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })()}
          </div>
        )}
      </Drawer>
    </div>
  );
}

function isGeneralMeeting(type: string) {
  return type === "AGM" || type === "SGM";
}

function meetsNoticeWindow(value: string, minDays: number, maxDays: number) {
  const scheduled = new Date(value).getTime();
  if (!Number.isFinite(scheduled)) return false;
  const now = Date.now();
  const min = now + minDays * 864e5;
  const max = now + maxDays * 864e5;
  return scheduled >= min && scheduled <= max;
}

function numberOrUndefined(value: unknown) {
  if (value === "" || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function meetingStatusTone(status: string): ToneVariant {
  if (status === "Held") return "success";
  if (status === "Cancelled") return "danger";
  return "warn";
}

function meetingTimeLabel(value: string) {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return "";
  return date.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function toDateTimeLocalValue(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  const hours = String(date.getHours()).padStart(2, "0");
  const minutes = String(date.getMinutes()).padStart(2, "0");
  return `${year}-${month}-${day}T${hours}:${minutes}`;
}
