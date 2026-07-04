import { useEffect, useMemo, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, EmptyState, Pill } from "../components/ui";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import { Tooltip } from "../components/Tooltip";
import { useToast } from "../components/Toast";
import { Plus, Calendar, AlertTriangle, Monitor, Pencil, Trash2, ExternalLink } from "lucide-react";
import { formatDateTime } from "../lib/format";
import type { ToneVariant } from "../components/ui";
import { type MenuSection } from "../components/Menu";
import { useConfirm } from "../components/Modal";
import { hasStartedMinutesDraft } from "../features/meetings/lib/meetingDetailHelpers";
import { daysUntil, isGeneralMeeting } from "../features/meetings/lib/noticeWindow";
import {
  MeetingFormFields,
  makeMeetingDraft,
  meetingToDraft,
  numberOrUndefined,
  useMeetingFormData,
  OVERLAP_WINDOW_MS,
  type MeetingDraft,
} from "../features/meetings/components/MeetingFormFields";
import type { Doc } from "../../convex/_generated/dataModel";

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

export function MeetingsPage() {
  const society = useSociety();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MeetingDraft | null>(null);
  const [params, setParams] = useSearchParams();
  const data = useMeetingFormData(society?._id, form?.scheduledAt);
  const meetings = data.meetings;
  const meetingTemplates = data.meetingTemplates;
  const minutesList = useQuery(api.minutes.list, society ? { societyId: society._id } : "skip") as
    | Doc<"minutes">[]
    | undefined;
  const create = useMutation(api.meetings.create);
  const updateMeeting = useMutation(api.meetings.update);
  const removeMeeting = useMutation(api.meetings.remove);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const toast = useToast();
  const [editingId, setEditingId] = useState<Doc<"meetings">["_id"] | null>(null);
  const [currentViewId, setCurrentViewId] = useState<Doc<"views">["_id"] | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "meeting",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  const noticeMinDays = data.noticeMinDays;
  const noticeMaxDays = data.noticeMaxDays;
  const effectiveNoticeMinDays = data.effectiveNoticeMinDays;

  const conflicts = useMemo(() => computeConflicts(meetings ?? []), [meetings]);
  const minutesByMeeting = useMemo(() => {
    const map = new Map<string, Doc<"minutes">>();
    for (const record of minutesList ?? []) map.set(String(record.meetingId), record);
    return map;
  }, [minutesList]);

  const openNew = (overrides: Partial<MeetingDraft> = {}) => {
    setEditingId(null);
    setForm(makeMeetingDraft(data, overrides));
    setOpen(true);
  };

  const openEdit = (meeting: Doc<"meetings">) => {
    setEditingId(meeting._id);
    setForm(meetingToDraft(meeting));
    setOpen(true);
  };

  const handleDelete = async (meeting: Doc<"meetings">) => {
    const hasMinutes = hasStartedMinutesDraft(minutesByMeeting.get(String(meeting._id)));
    const ok = await confirm({
      title: `Delete "${meeting.title}"?`,
      message: hasMinutes
        ? "This meeting has minutes with recorded content. Deleting it also deletes its agenda and minutes. This action cannot be undone."
        : "This will remove the meeting along with its agenda and minutes scaffolding. This action cannot be undone.",
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
    // Only hard-block on creation with less than the minimum notice — the notice
    // window governs when notice is sent, not how far ahead a meeting may be
    // scheduled, and edits to past/held meetings must stay possible. Scheduling
    // beyond the max is allowed; the drawer shows an advisory warning instead.
    if (!editingId && isGeneralMeeting(form.type)) {
      const days = daysUntil(form.scheduledAt);
      if (days == null || days < effectiveNoticeMinDays) {
        toast.error(`General meetings need at least ${effectiveNoticeMinDays} days of notice.`);
        return;
      }
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
            <button className="btn-action btn-action--primary" type="button" onClick={() => openNew()}>
              <Plus size={12} /> New meeting
            </button>
          </div>
        }
      />

      {showMetadataWarning ? (
          <RecordTableMetadataEmpty societyId={society?._id} objectLabel="meeting" />
        ) : tableData.objectMetadata ? (
          <RecordTableScope
            tableId="meetings"
            objectMetadata={tableData.objectMetadata}
            hydratedView={tableData.hydratedView}
            records={meetings ?? []}
            onRecordClick={(recordId) => navigate(`/app/meetings/${recordId}`)}
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
                if (field.name === "minutes") {
                  const minutesRecord = minutesByMeeting.get(String(record._id));
                  if (minutesRecord?.approvedAt) return <Badge tone="success">Approved</Badge>;
                  if (hasStartedMinutesDraft(minutesRecord)) return <Badge tone="info">Draft</Badge>;
                  if (record.status === "Held") return <Badge tone="warn">Needs minutes</Badge>;
                  return <span className="muted">—</span>;
                }
                return undefined;
              }}
              rowMenuSections={meetingMenuSections}
            />
          </RecordTableScope>
        ) : null}

      <Drawer
        open={open} onClose={() => setOpen(false)} title={editingId ? "Edit meeting" : "Schedule meeting"}
        footer={<><button className="btn" type="button" onClick={() => setOpen(false)}>Cancel</button><button className="btn btn--accent" type="button" onClick={save}>{editingId ? "Save" : "Schedule"}</button></>}
      >
        {form && (
          <MeetingFormFields
            value={form}
            onChange={(patch) => setForm((prev) => (prev ? { ...prev, ...patch } : prev))}
            data={data}
            editingId={editingId}
          />
        )}
      </Drawer>
    </div>
  );
}

function meetingStatusTone(status: string): ToneVariant {
  if (status === "Held") return "success";
  if (status === "Cancelled") return "danger";
  return "warn";
}
