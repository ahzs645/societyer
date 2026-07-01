import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, EmptyState, Field, Pill } from "../components/ui";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import { Select } from "../components/Select";
import { DateTimeInput } from "../components/DateTimeInput";
import { Toggle } from "../components/Controls";
import { Tooltip } from "../components/Tooltip";
import { useToast } from "../components/Toast";
import { Plus, Calendar, Tag, AlertTriangle, BookMarked, Monitor, MoreHorizontal, Pencil, Trash2, ExternalLink } from "lucide-react";
import { formatDateTime, toDateTimeLocalValue } from "../lib/format";
import { useBylawRules } from "../hooks/useBylawRules";
import { CalendarView } from "../components/CalendarView";
import type { ToneVariant } from "../components/ui";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { NameAutocomplete } from "../components/NameAutocomplete";
import { Menu, type MenuSection } from "../components/Menu";
import { ContextMenu } from "../components/ContextMenu";
import { useConfirm } from "../components/Modal";
import { useHiddenSuggestions, looksLikeLink } from "../lib/hiddenSuggestions";
import type { Doc } from "../../convex/_generated/dataModel";

const OVERLAP_WINDOW_MS = 2 * 60 * 60 * 1000; // within 2 hours counts as concurrent

function computeConflicts(meetings: Doc<"meetings">[]): Map<string, string[]> {
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

type MeetingDraft = {
  type: string;
  title: string;
  scheduledAt: string;
  location: string;
  electronic: boolean;
  quorumRequired: string;
  status: string;
  attendeeIds: string[];
  meetingTemplateId: string;
  notes?: string;
};

export function MeetingsPage() {
  const society = useSociety();
  const { rules } = useBylawRules();
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip") as
    | Doc<"meetings">[]
    | undefined;
  const meetingTemplates = useQuery(
    api.meetingTemplates.list,
    society ? { societyId: society._id } : "skip",
  ) as Doc<"meetingTemplates">[] | undefined;
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MeetingDraft | null>(null);
  const [viewMode, setViewMode] = useState<"list" | "calendar">("list");
  const [params, setParams] = useSearchParams();
  const formRules = useQuery(
    api.bylawRules.getForDate,
    society && form?.scheduledAt ? { societyId: society._id, dateISO: form.scheduledAt } : "skip",
  );
  const create = useMutation(api.meetings.create);
  const updateMeeting = useMutation(api.meetings.update);
  const removeMeeting = useMutation(api.meetings.remove);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const toast = useToast();
  const [editingId, setEditingId] = useState<Doc<"meetings">["_id"] | null>(null);
  const [contextMenu, setContextMenu] = useState<
    { x: number; y: number; meeting: Doc<"meetings"> } | null
  >(null);
  const [currentViewId, setCurrentViewId] = useState<Doc<"views">["_id"] | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "meeting",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const noticeMinDays = rules?.generalNoticeMinDays ?? 14;
  const noticeMaxDays = rules?.generalNoticeMaxDays ?? 60;
  const effectiveRules = formRules ?? rules;
  const effectiveNoticeMinDays = effectiveRules?.generalNoticeMinDays ?? noticeMinDays;
  const effectiveNoticeMaxDays = effectiveRules?.generalNoticeMaxDays ?? noticeMaxDays;

  const conflicts = useMemo(() => computeConflicts(meetings ?? []), [meetings]);
  const { hide: hideLocationSuggestion, isHidden: isHiddenLocation } = useHiddenSuggestions("meeting-location");
  const recentLocations = useMemo(() => {
    const sorted = (meetings ?? [])
      .filter((m) => m.location && m.location.trim())
      .sort((a, b) => (b.scheduledAt ?? "").localeCompare(a.scheduledAt ?? ""));
    const seen = new Set<string>();
    const out: string[] = [];
    for (const m of sorted) {
      const loc = m.location!.trim();
      const key = loc.toLowerCase();
      if (seen.has(key)) continue;
      if (looksLikeLink(loc)) continue;
      if (isHiddenLocation(loc)) continue;
      seen.add(key);
      out.push(loc);
    }
    return out;
  }, [meetings, isHiddenLocation]);
  const defaultTemplate =
    (meetingTemplates ?? []).find((template) => template.isDefault) ?? (meetingTemplates ?? [])[0];

  const openNew = (overrides: Partial<MeetingDraft> = {}) => {
    setEditingId(null);
    setForm({
      type: "Board", title: "",
      scheduledAt: toDateTimeLocalValue(new Date(Date.now() + noticeMinDays * 864e5)),
      location: "",
      electronic: !!rules?.allowElectronicMeetings,
      quorumRequired: "",
      status: "Scheduled",
      attendeeIds: [],
      meetingTemplateId: defaultTemplate?._id ? String(defaultTemplate._id) : "",
      ...overrides,
    });
    setOpen(true);
  };

  const openEdit = (meeting: Doc<"meetings">) => {
    setEditingId(meeting._id);
    setForm({
      type: meeting.type,
      title: meeting.title,
      scheduledAt: meeting.scheduledAt ? toDateTimeLocalValue(new Date(meeting.scheduledAt)) : "",
      location: meeting.location ?? "",
      electronic: !!meeting.electronic,
      quorumRequired: meeting.quorumRequired != null ? String(meeting.quorumRequired) : "",
      status: meeting.status,
      attendeeIds: meeting.attendeeIds ?? [],
      meetingTemplateId: meeting.meetingTemplateId ? String(meeting.meetingTemplateId) : "",
      notes: meeting.notes ?? "",
    });
    setOpen(true);
  };

  const handleDelete = async (meeting: Doc<"meetings">) => {
    const hasMinutes = !!meeting.minutesId;
    const ok = await confirm({
      title: `Delete "${meeting.title}"?`,
      message: hasMinutes
        ? "This meeting has recorded minutes attached. Deleting it removes the meeting record but the minutes document will be orphaned."
        : "This will remove the meeting from the schedule. This action cannot be undone.",
      confirmLabel: "Delete",
      tone: "danger",
    });
    if (!ok) return;
    await removeMeeting({ id: meeting._id });
    toast.success("Meeting deleted", meeting.title);
  };

  const meetingMenuSections = (meeting: Doc<"meetings">): MenuSection[] => [
    {
      id: "actions",
      items: [
        {
          id: "open",
          label: "Open",
          icon: <ExternalLink size={14} />,
          onSelect: () => navigate(`/app/meetings/${meeting._id}`),
        },
        {
          id: "edit",
          label: "Edit",
          icon: <Pencil size={14} />,
          onSelect: () => openEdit(meeting),
        },
      ],
    },
    {
      id: "danger",
      items: [
        {
          id: "delete",
          label: "Delete",
          icon: <Trash2 size={14} />,
          destructive: true,
          onSelect: () => { void handleDelete(meeting); },
        },
      ],
    },
  ];

  useEffect(() => {
    if (!society || open || !meetingTemplates) return;
    const intent = params.get("intent");
    if (intent !== "create" && intent !== "generate-agm-package") return;
    const type = params.get("type") === "AGM" ? "AGM" : "Board";
    openNew({
      type,
      title: intent === "generate-agm-package" ? "Annual general meeting" : "",
      notes:
        intent === "generate-agm-package"
          ? "AGM package requested from command palette. Add agenda, notice, financial statements, and voting materials."
          : "",
    });
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      next.delete("intent");
      next.delete("type");
      return next;
    }, { replace: true });
  }, [open, params, setParams, society, meetingTemplates]);

  if (society === undefined) return <div className="page meetings-page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  const save = async () => {
    if (!form) return;
    if (isGeneralMeeting(form.type) && !meetsNoticeWindow(form.scheduledAt, effectiveNoticeMinDays, effectiveNoticeMaxDays)) {
      toast.error(`General meetings need ${effectiveNoticeMinDays}–${effectiveNoticeMaxDays} days of notice.`);
      return;
    }
    if (editingId) {
      await updateMeeting({
        id: editingId,
        patch: {
          type: form.type,
          title: form.title,
          scheduledAt: form.scheduledAt,
          location: form.location,
          electronic: form.electronic,
          quorumRequired: numberOrUndefined(form.quorumRequired),
          status: form.status,
          attendeeIds: form.attendeeIds,
          notes: form.notes,
        },
      });
      setOpen(false);
      toast.success("Meeting updated", form.title);
      return;
    }
    const meetingId = await create({
      societyId: society._id,
      ...form,
      meetingTemplateId: form.meetingTemplateId || undefined,
      quorumRequired: numberOrUndefined(form.quorumRequired),
    });
    setOpen(false);
    toast.success("Meeting scheduled", form.title);
    if (meetingId) navigate(`/app/meetings/${meetingId}`);
  };

  return (
    <div className="page meetings-page">
      <PageHeader
        title="Meetings"
        icon={<Calendar size={16} />}
        iconColor="orange"
        subtitle="Board meetings, committee meetings, and general meetings (AGM/SGM)."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap", justifyContent: "flex-end", alignItems: "center" }}>
            <Tooltip content="Required notice window for general meetings under the active bylaw rule set.">
              <Pill tone="info" size="sm">
                Notice: {noticeMinDays}–{noticeMaxDays} days
              </Pill>
            </Tooltip>
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
            <button className="btn-action btn-action--primary" type="button" onClick={() => openNew()}>
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
              items={meetings ?? []}
              getDate={(meeting) => meeting.scheduledAt}
              getLabel={(meeting) => `${meetingTimeLabel(meeting.scheduledAt)} ${meeting.title}`}
              getTone={(meeting) => meetingStatusTone(meeting.status)}
              getId={(meeting) => meeting._id}
              onSelect={(meeting) => navigate(`/app/meetings/${meeting._id}`)}
            />
          </div>
        </div>
      ) : (
        showMetadataWarning ? (
          <RecordTableMetadataEmpty societyId={society?._id} objectLabel="meeting" />
        ) : tableData.objectMetadata ? (
          <RecordTableScope
            tableId="meetings"
            objectMetadata={tableData.objectMetadata}
            hydratedView={tableData.hydratedView}
            records={meetings ?? []}
            onRecordClick={(_recordId, record) => openEdit(record)}
            onUpdate={async ({ recordId, fieldName, value }) => {
              if (fieldName === "minutes") return;
              await updateMeeting({ id: recordId as Doc<"meetings">["_id"], patch: { [fieldName]: value } as any });
            }}
          >
            <RecordTableViewToolbar
              societyId={society._id}
              objectMetadataId={tableData.objectMetadata._id as Doc<"objectMetadata">["_id"]}
              icon={<Calendar size={14} />}
              label="All meetings"
              views={tableData.views}
              currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
              onChangeView={(viewId) => setCurrentViewId(viewId as Doc<"views">["_id"])}
              onOpenFilter={() => setFilterOpen((x) => !x)}
            />
            <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
            <RecordTableFilterChips />
            <RecordTable
              loading={tableData.loading || meetings === undefined}
              emptyState={
                <EmptyState
                  icon={<Calendar size={18} />}
                  title="No meetings scheduled yet"
                  description="Schedule a board, committee, or general meeting to start tracking agendas, attendees, and minutes."
                  action={
                    <button className="btn btn--accent" type="button" onClick={() => openNew()}>
                      <Plus size={12} /> Schedule meeting
                    </button>
                  }
                />
              }
              renderCell={({ record, field }) => {
                if (field.name === "scheduledAt") {
                  const overlap = conflicts.get(record._id);
                  return (
                    <span>
                      <span className="mono">{formatDateTime(record.scheduledAt)}</span>
                      {overlap && (
                        <Tooltip content={`Overlaps with: ${overlap.join(", ")}`}>
                          <span
                            aria-label={`${overlap.length} concurrent meeting${overlap.length === 1 ? "" : "s"}: ${overlap.join(", ")}`}
                            style={{ marginLeft: 6, display: "inline-flex", alignItems: "center", color: "var(--warn, #c78b00)" }}
                          >
                            <AlertTriangle size={12} />
                          </span>
                        </Tooltip>
                      )}
                    </span>
                  );
                }
                if (field.name === "location") {
                  const hasLocation = !!record.location;
                  if (!hasLocation && !record.electronic) return <span className="muted">—</span>;
                  return (
                    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {record.electronic && (
                        <Tooltip content="Electronic participation permitted">
                          <span aria-label="Electronic participation permitted" style={{ display: "inline-flex", alignItems: "center", color: "var(--info, #3b82f6)" }}>
                            <Monitor size={14} />
                          </span>
                        </Tooltip>
                      )}
                      <span>{hasLocation ? record.location : <span className="muted">Online</span>}</span>
                    </span>
                  );
                }
                if (field.name === "status") return <Badge tone={meetingStatusTone(record.status)}>{record.status}</Badge>;
                if (field.name === "minutes") return record.status === "Held" ? <Badge tone="success">Recorded</Badge> : <span className="muted">—</span>;
                return undefined;
              }}
              renderRowActions={(row) => (
                <Menu
                  align="right"
                  minWidth={180}
                  sections={meetingMenuSections(row)}
                  trigger={
                    <button type="button" className="btn btn--ghost btn--sm btn--icon" aria-label={`Actions for ${row.title}`} onClick={(e) => e.stopPropagation()}>
                      <MoreHorizontal size={14} />
                    </button>
                  }
                />
              )}
            />
          </RecordTableScope>
        ) : null
      )}

      <Drawer
        open={open} onClose={() => setOpen(false)} title={editingId ? "Edit meeting" : "Schedule meeting"}
        footer={<><button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" type="button" onClick={save}>{editingId ? "Save" : "Schedule"}</button></>}
      >
        {form && (
          <div>
            {isGeneralMeeting(form.type) && !meetsNoticeWindow(form.scheduledAt, effectiveNoticeMinDays, effectiveNoticeMaxDays) ? (
              <div className="flag flag--warn" style={{ marginBottom: 12 }}>
                <AlertTriangle />
                <div>
                  General meetings should be scheduled with {effectiveNoticeMinDays}–{effectiveNoticeMaxDays} days of notice under the rule set effective on this meeting date.
                </div>
              </div>
            ) : null}
            {!editingId && <div className="meeting-template-picker">
              <Field label="Template">
                <Select
                  value={form.meetingTemplateId}
                  onChange={(v) => setForm({ ...form, meetingTemplateId: v })}
                  options={[
                    { value: "", label: "Blank meeting" },
                    ...(meetingTemplates ?? []).map((template) => ({
                      value: String(template._id),
                      label: `${template.name}${template.isDefault ? " (default)" : ""}`,
                    })),
                  ]}
                />
              </Field>
              {form.meetingTemplateId ? (
                <p className="meeting-template-picker__summary">
                  <BookMarked size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                  {templateSummary((meetingTemplates ?? []).find((template) => String(template._id) === form.meetingTemplateId))}
                </p>
              ) : (
                <p className="meeting-template-picker__summary">Start with an empty agenda and add sections from the meeting page.</p>
              )}
            </div>}
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
            <Field label="Venue / link">
              <NameAutocomplete
                value={form.location}
                onChange={(v) => setForm({ ...form, location: v })}
                options={recentLocations}
                onRemoveOption={hideLocationSuggestion}
                placeholder={form.electronic ? "Zoom, Teams, or join link…" : "Where is it being held?"}
                ariaLabel="Venue or join link"
              />
            </Field>
            <Toggle
              checked={form.electronic}
              onChange={(v) => setForm({ ...form, electronic: v })}
              disabled={!effectiveRules?.allowElectronicMeetings}
              label="Electronic participation permitted"
            />
            <Field label="Quorum required">
              <input
                className="input"
                type="number"
                placeholder={
                  effectiveRules?.quorumType === "fixed"
                    ? String(effectiveRules?.quorumValue ?? "")
                    : "Computed for AGM/SGM"
                }
                value={form.quorumRequired ?? ""}
                onChange={(e) => setForm({ ...form, quorumRequired: e.target.value })}
              />
            </Field>
            <Field label="Notes"><MarkdownEditor rows={4} value={form.notes ?? ""} onChange={(markdown) => setForm({ ...form, notes: markdown })} /></Field>
            {form.type === "AGM" && (
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                Reminder: AGM notice must be sent {effectiveNoticeMinDays}–{effectiveNoticeMaxDays} days in advance.
                {effectiveRules?.requireAgmFinancialStatements ? " Financial statements must be presented." : ""}
                {effectiveRules?.requireAgmElections ? " Elections are expected under the effective rule set." : ""}
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

      <ContextMenu
        position={contextMenu ? { x: contextMenu.x, y: contextMenu.y } : null}
        sections={contextMenu ? meetingMenuSections(contextMenu.meeting) : []}
        onClose={() => setContextMenu(null)}
      />
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

function templateSummary(template: any) {
  if (!template) return "Template details are loading.";
  const items = Array.isArray(template.items) ? template.items : [];
  const motionCount = items.filter((item: any) => item.motionTemplateId || item.motionText).length;
  return `${items.length} agenda item${items.length === 1 ? "" : "s"}${motionCount ? `, ${motionCount} recurring motion${motionCount === 1 ? "" : "s"}` : ""}. New meetings receive a snapshot.`;
}
