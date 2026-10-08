import { useEffect, useMemo, useRef, useState } from "react";
import { MEETING_STATUS_LABELS, MEETING_STATUS_OPTIONS, meetingStatusTone as sharedMeetingStatusTone } from "../../shared/meetingStatus";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { meetingPreparationEnabled } from "../offline/config";
import { getAuthMode } from "../lib/authMode";
import { isLocalDataRuntime } from "../lib/staticRuntime";
import { usePermissions } from "../hooks/usePermissions";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, EmptyState, Field } from "../components/ui";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableBulkBar,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import { Tooltip } from "../components/Tooltip";
import { useToast } from "../components/Toast";
import { Plus, Calendar, AlertTriangle, CheckCircle2, Copy, Monitor, Pencil, RotateCcw, Tag, Trash2, ExternalLink, Merge } from "lucide-react";
import type { ToneVariant } from "../components/ui";
import { type MenuSection } from "../components/Menu";
import { Modal, useConfirm } from "../components/Modal";
import { Select } from "../components/Select";
import { normalizedMeetingTitle, suggestedMeetingTitle } from "../features/meetings/lib/meetingDetailHelpers";
import { isGeneralMeeting, isPastMeeting, meetingCreateLabels, meetingScheduleConflicts, newGeneralMeetingNoticeProblem, OVERLAP_WINDOW_MS, statusForNewMeeting } from "../features/meetings/lib/noticeWindow";
import {
  MeetingFormFields,
  makeMeetingDraft,
  numberOrUndefined,
  useMeetingFormData,
  type MeetingDraft,
} from "../features/meetings/components/MeetingFormFields";
import { EditMeetingDrawer } from "../features/meetings/components/EditMeetingDrawer";
import { MergeMeetingDialog } from "../features/meetings/components/MergeMeetingDialog";
import { useDirtyCloseGuard } from "../features/meetings/lib/useDirtyCloseGuard";
import { formatMeetingDate, meetingDatePrecision } from "../../shared/meetingDates";
import { bodyPatchForValue, bodyValueForMeeting, meetingBodyLabel, meetingBodyOptions } from "../../shared/meetingBodyPicker";
import { duplicateMeetingGroups, preferredMeetingToKeep } from "../../shared/meetingMerge";
import type { Doc } from "../../convex/_generated/dataModel";


function computeConflicts(meetings: Doc<"meetings">[]): Map<string, string[]> {
  // Date-only meetings carry a noon placeholder, not a time: two of them on one
  // day are not a time clash (duplicates are flagged separately).
  const byTime = meetings
    .filter((m) => m.status !== "Cancelled" && meetingDatePrecision(m as any) === "datetime")
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

type ReviewFilter = "all" | "needs_review" | "reviewed" | "duplicates" | "no_motions" | "date_only" | "minutes_missing";
const REVIEW_FILTERS: Array<{ value: ReviewFilter; label: string }> = [
  { value: "all", label: "All meetings" },
  { value: "needs_review", label: "Source review pending" },
  { value: "reviewed", label: "Source reviewed" },
  { value: "duplicates", label: "Same-day duplicates" },
  { value: "no_motions", label: "No motions recorded" },
  { value: "date_only", label: "Date only (no time)" },
  { value: "minutes_missing", label: "Held, no minutes" },
];

const SOURCE_REVIEW_LABELS: Record<string, string> = {
  imported_needs_review: "Needs review",
  source_reviewed: "Reviewed",
  rejected: "Rejected",
  not_applicable: "Not imported",
};

type BulkKind = "status" | "body";

export function MeetingsPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canManage = loaded && can("meetings:write");
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<MeetingDraft | null>(null);
  const [formInitial, setFormInitial] = useState("");
  const [params, setParams] = useSearchParams();
  const data = useMeetingFormData(society?._id, form?.scheduledAt);
  const meetings = data.meetings;
  const meetingTemplates = data.meetingTemplates;
  const committees = data.committees;
  // Light per-meeting summaries — never the full minutes rows (F26).
  const minutesSummaries = useQuery(api.minutes.listSummaries, society && can("minutes:read") ? { societyId: society._id } : "skip") as any[] | undefined;
  const create = useMutation(api.meetings.create);
  const updateMeeting = useMutation(api.meetings.update);
  const removeMeeting = useMutation(api.meetings.remove);
  const markSourceReview = useMutation(api.meetings.markSourceReview);
  const confirm = useConfirm();
  const navigate = useNavigate();
  const toast = useToast();
  const [editing, setEditing] = useState<Doc<"meetings"> | null>(null);
  const [mergeFor, setMergeFor] = useState<{ meeting: any; suggested: string[] } | null>(null);
  const [bulk, setBulk] = useState<{ kind: BulkKind; rows: any[]; value: string } | null>(null);
  const [currentViewId, setCurrentViewId] = useState<Doc<"views">["_id"] | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const reviewFilter = (params.get("review") as ReviewFilter | null) ?? "all";
  const bodyFilter = params.get("body") ?? "";
  const setListParam = (key: string, value: string) => setParams((prev) => {
    const next = new URLSearchParams(prev);
    if (!value || value === "all") next.delete(key);
    else next.set(key, value);
    return next;
  }, { replace: true });
  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "meeting",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;
  // Workspaces seeded before the review columns existed get them once: the
  // seed mutation is idempotent and reconciles new fields into system views.
  const ensureMetadata = useMutation(api.seedRecordTableMetadata.ensureForSociety);
  const metadataHealRef = useRef<string | null>(null);
  useEffect(() => {
    const metadata = tableData.objectMetadata;
    if (!society?._id || !metadata || !loaded || !can("settings:write")) return;
    if (metadata.fields.some((field) => field.name === "sourceReviewStatus")) return;
    if (metadataHealRef.current === String(society._id)) return;
    metadataHealRef.current = String(society._id);
    void ensureMetadata({ societyId: society._id }).catch(() => undefined);
  }, [society?._id, tableData.objectMetadata, loaded, can, ensureMetadata]);
  const noticeMinDays = data.noticeMinDays;
  const noticeMaxDays = data.noticeMaxDays;
  const effectiveNoticeMinDays = data.effectiveNoticeMinDays;
  const hasUnacknowledgedConflict = !!form &&
    meetingScheduleConflicts(meetings, form.scheduledAt, null).length > 0 &&
    !form.conflictAcknowledged;
  const formDirty = !!form && JSON.stringify(form) !== formInitial;
  const closeCreate = useDirtyCloseGuard(formDirty, () => setOpen(false), "meeting");

  const conflicts = useMemo(() => computeConflicts(meetings ?? []), [meetings]);
  const summaryByMeeting = useMemo(() => {
    const map = new Map<string, any>();
    for (const record of minutesSummaries ?? []) map.set(String(record.meetingId), record);
    return map;
  }, [minutesSummaries]);
  const committeeRows = useMemo(() => (committees ?? []).map((row: any) => ({ _id: String(row._id), name: row.name, status: row.status, bodyKey: row.bodyKey })), [committees]);
  const duplicateGroups = useMemo(() => duplicateMeetingGroups((meetings ?? []) as any[], committeeRows), [meetings, committeeRows]);
  const duplicateCount = useMemo(() => {
    const map = new Map<string, number>();
    for (const group of duplicateGroups) for (const meeting of group.meetings) map.set(String(meeting._id), group.meetings.length - 1);
    return map;
  }, [duplicateGroups]);

  // Records enriched with review columns; date order (newest first) by default (F23).
  const records = useMemo(() => {
    const rows = (meetings ?? []).map((meeting: any) => {
      const summary = summaryByMeeting.get(String(meeting._id));
      return {
        ...meeting,
        body: meetingBodyLabel(meeting, committeeRows),
        bodyValue: bodyValueForMeeting(meeting),
        sourceReviewStatus: meeting.sourceReviewStatus ?? summary?.sourceReviewStatus ?? "not_applicable",
        motionCount: summary?.motionCount ?? 0,
        presentCount: summary?.presentCount ?? 0,
        datePrecision: meetingDatePrecision(meeting),
        duplicateCount: duplicateCount.get(String(meeting._id)) ?? 0,
        _summary: summary,
        _searchText: [meeting.title, meeting.sourceTitle, meeting.location, meetingBodyLabel(meeting, committeeRows), formatMeetingDate(meeting, { withTime: false }), String(meeting.scheduledAt ?? "").slice(0, 10), summary?.peopleText].filter(Boolean).join(" "),
      };
    });
    rows.sort((a, b) => String(b.scheduledAt ?? "").localeCompare(String(a.scheduledAt ?? "")));
    return rows;
  }, [meetings, summaryByMeeting, committeeRows, duplicateCount]);

  const reviewCounts = useMemo(() => {
    const counts: Record<ReviewFilter, number> = { all: records.length, needs_review: 0, reviewed: 0, duplicates: 0, no_motions: 0, date_only: 0, minutes_missing: 0 };
    for (const row of records) {
      if (row.sourceReviewStatus === "imported_needs_review") counts.needs_review += 1;
      if (row.sourceReviewStatus === "source_reviewed") counts.reviewed += 1;
      if (row.duplicateCount > 0) counts.duplicates += 1;
      if (!row.motionCount) counts.no_motions += 1;
      if (row.datePrecision === "date") counts.date_only += 1;
      if ((row.status === "Held" || row.status === "HeldMinutesMissing") && !row._summary?.started) counts.minutes_missing += 1;
    }
    return counts;
  }, [records]);

  const filteredRecords = useMemo(() => records.filter((row) => {
    if (bodyFilter && row.bodyValue !== bodyFilter && !(bodyFilter === "committee" && row.type === "Committee")) return false;
    switch (reviewFilter) {
      case "needs_review": return row.sourceReviewStatus === "imported_needs_review";
      case "reviewed": return row.sourceReviewStatus === "source_reviewed";
      case "duplicates": return row.duplicateCount > 0;
      case "no_motions": return !row.motionCount;
      case "date_only": return row.datePrecision === "date";
      case "minutes_missing": return (row.status === "Held" || row.status === "HeldMinutesMissing") && !row._summary?.started;
      default: return true;
    }
  }), [records, reviewFilter, bodyFilter]);

  const bodyFilterOptions = useMemo(() => [
    { value: "", label: "All bodies" },
    ...meetingBodyOptions(committeeRows).filter((option) => !option.value.endsWith(":special")).map((option) => ({ value: option.value, label: option.label })),
  ], [committeeRows]);

  const openNew = (overrides: Partial<MeetingDraft> = {}) => {
    const draft = makeMeetingDraft(data, overrides);
    setForm(draft);
    setFormInitial(JSON.stringify(draft));
    setOpen(true);
  };

  const handleDelete = async (meeting: Doc<"meetings">) => {
    const hasMinutes = !!summaryByMeeting.get(String(meeting._id))?.started;
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

  const meetingMenuSections = (meeting: any): MenuSection[] => !canManage ? [{ id: "actions", items: [{ id: "open", label: "Open", icon: <ExternalLink size={14} />, onSelect: () => navigate(`/app/meetings/${meeting._id}`) }] }] : [
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
          onSelect: () => setEditing(meeting),
        },
        {
          id: "review",
          label: meeting.sourceReviewStatus === "source_reviewed" ? "Reopen source review" : "Mark source reviewed",
          icon: <CheckCircle2 size={14} />,
          onSelect: () => { void setReview([meeting], meeting.sourceReviewStatus === "source_reviewed" ? "imported_needs_review" : "source_reviewed"); },
        },
        ...(meeting.duplicateCount > 0 ? [{
          id: "merge",
          label: `Merge duplicate (${meeting.duplicateCount})…`,
          icon: <Merge size={14} />,
          onSelect: () => setMergeFor({ meeting, suggested: duplicateGroupFor(meeting) }),
        }] : []),
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

  const duplicateGroupFor = (meeting: any) => duplicateGroups.find((group) => group.meetings.some((row: any) => String(row._id) === String(meeting._id)))?.meetings.filter((row: any) => String(row._id) !== String(meeting._id)).map((row: any) => String(row._id)) ?? [];

  const setReview = async (rows: any[], status: "source_reviewed" | "imported_needs_review") => {
    if (!canManage) return;
    let done = 0;
    for (const row of rows) {
      if (status === "source_reviewed" && row.sourceReviewStatus === "source_reviewed") continue;
      await markSourceReview({ id: row._id, status, notes: status === "source_reviewed" ? "Marked reviewed from the meetings list." : "Source review reopened from the meetings list." });
      done += 1;
    }
    toast.success(status === "source_reviewed" ? "Marked source reviewed" : "Source review reopened", `${done} meeting${done === 1 ? "" : "s"}`);
  };

  const applyBulk = async () => {
    if (!bulk || !canManage) return;
    let done = 0;
    for (const row of bulk.rows) {
      if (bulk.kind === "status") {
        await updateMeeting({ id: row._id, patch: { status: bulk.value } });
      } else {
        const body = bodyPatchForValue(bulk.value);
        if (body.hostBody === "external") continue;
        await updateMeeting({ id: row._id, patch: { type: body.type, special: body.special, hostBody: body.hostBody, ...(body.committeeId ? { committeeId: body.committeeId as any } : {}), ...(body.clearCommitteeId ? { clearCommitteeId: true } : {}) } });
      }
      done += 1;
    }
    toast.success(bulk.kind === "status" ? "Status updated" : "Body updated", `${done} meeting${done === 1 ? "" : "s"}`);
    setBulk(null);
  };

  useEffect(() => {
    if (!society || open || !meetingTemplates || !canManage) return;
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, params, setParams, society, meetingTemplates, canManage]);

  if (society === undefined) return <div className="page meetings-page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  const save = async () => {
    if (!form) return;
    const title = normalizedMeetingTitle(form.title) || suggestedMeetingTitle(form, data.committees);
    if (!title) {
      toast.error("Enter a meeting title.");
      return;
    }
    if (form.type === "Committee" && !form.committeeId) {
      toast.error("Select the committee for this meeting.");
      return;
    }
    if (hasUnacknowledgedConflict) {
      toast.error("Review and acknowledge the schedule conflict before continuing.");
      return;
    }
    // Only hard-block on creation with less than the minimum notice — the notice
    // window governs when notice is sent, not how far ahead a meeting may be
    // scheduled. Scheduling beyond the max is allowed; the drawer shows an
    // advisory warning instead.
    // A meeting dated before today records one already held: no notice check, status Held.
    const noticeProblem = isGeneralMeeting(form.type) ? newGeneralMeetingNoticeProblem(form.scheduledAt, effectiveNoticeMinDays, data.effectiveRules) : null;
    if (noticeProblem) {
      toast.error(noticeProblem);
      return;
    }
    const past = isPastMeeting(form.scheduledAt);
    const { conflictAcknowledged: _conflictAcknowledged, committeeId, ...payload } = form;
    const meetingId = await create({
      societyId: society._id,
      ...payload,
      status: statusForNewMeeting(form.scheduledAt, payload.status),
      title,
      committeeId: (committeeId || undefined) as any,
      meetingTemplateId: form.meetingTemplateId || undefined,
      quorumRequired: numberOrUndefined(form.quorumRequired),
    });
    setFormInitial(JSON.stringify(form));
    setOpen(false);
    toast.success(past ? "Held meeting recorded" : "Meeting scheduled", title);
    if (meetingId) navigate(`/app/meetings/${meetingId}`);
  };

  const recentLocations = data.recentLocations;

  return (
    <div className="page meetings-page">
      <PageHeader
        title="Meetings"
        icon={<Calendar size={16} />}
        iconColor="orange"
        subtitle="Board meetings, committee meetings, and general meetings (AGM/SGM)."
        actions={
          <>
          {meetingPreparationEnabled() && getAuthMode() !== "none" && !isLocalDataRuntime() && <Link className="btn" to="/app/meetings/offline">Offline preparation</Link>}
          <button
            className="btn-action btn-action--primary meetings-page__new"
            type="button"
            onClick={() => openNew()}
            disabled={!canManage}
            aria-label="New meeting"
            title={`New meeting — general meetings need ${noticeMinDays}–${noticeMaxDays} days of notice`}
          >
            <Plus size={14} />
            <span className="meetings-page__new-label">New meeting</span>
          </button>
          </>
        }
      />

      <div className="meetings-review-toolbar" role="toolbar" aria-label="Review filters">
        <div className="meetings-review-toolbar__select">
          <Select
            value={reviewFilter}
            onChange={(value) => setListParam("review", value)}
            options={REVIEW_FILTERS.map((option) => ({ value: option.value, label: `${option.label} (${reviewCounts[option.value]})` }))}
            size="sm"
            aria-label="Review filter"
          />
        </div>
        <div className="meetings-review-toolbar__select">
          <Select value={bodyFilter} onChange={(value) => setListParam("body", value)} options={bodyFilterOptions} size="sm" searchable aria-label="Body filter" />
        </div>
        {(reviewFilter !== "all" || bodyFilter) && (
          <button type="button" className="btn-action" onClick={() => setParams((prev) => { const next = new URLSearchParams(prev); next.delete("review"); next.delete("body"); return next; }, { replace: true })}>
            Clear review filters
          </button>
        )}
        {/* Only worth a line when it says something the view pill's count doesn't. */}
        {(filteredRecords.length !== records.length || reviewCounts.needs_review > 0 || duplicateGroups.length > 0) && (
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }} data-testid="meetings-review-count">
          {filteredRecords.length} of {records.length} meetings
          {reviewCounts.needs_review > 0 ? ` · ${reviewCounts.needs_review} awaiting source review` : ""}
          {duplicateGroups.length > 0 ? ` · ${duplicateGroups.length} same-day duplicate group${duplicateGroups.length === 1 ? "" : "s"}` : ""}
        </span>
        )}
      </div>

      {reviewFilter === "duplicates" && duplicateGroups.length > 0 && (
        <div className="card meetings-duplicates" data-testid="duplicate-groups">
          <div className="card__head">
            <h2 className="card__title"><Copy size={14} style={{ verticalAlign: -2, marginRight: 6 }} />Same-day duplicates</h2>
            <span className="card__subtitle">Meetings of one body on one day — usually draft/approved or .doc/.pdf copies of one meeting</span>
          </div>
          <div className="card__body">
            <ul className="merge-preview__list">
              {duplicateGroups.map((group) => (
                <li key={group.key}>
                  <strong>{group.date}</strong> · {meetingBodyLabel(group.meetings[0] as any, committeeRows)}:{" "}
                  {group.meetings.map((row: any, index: number) => (
                    <span key={row._id}>
                      {index > 0 ? " · " : ""}
                      <Link to={`/app/meetings/${row._id}`}>{row.title}</Link>
                      {/* Copies usually share a generated title: say which file each came from. */}
                      <span className="muted" style={{ fontSize: "var(--fs-xs)" }}>
                        {" "}({[
                          row.sourceTitle ? String(row.sourceTitle).replace(/^\d{4}-\d{2}-\d{2}\s*/, "") : "",
                          summaryByMeeting.get(String(row._id))?.approvedAt ? "minutes approved" : "",
                          `${summaryByMeeting.get(String(row._id))?.sectionCount ?? 0} sections`,
                          `${summaryByMeeting.get(String(row._id))?.motionCount ?? 0} motions`,
                        ].filter(Boolean).join(", ")})
                      </span>
                    </span>
                  ))}
                  {canManage && (
                    <button type="button" className="btn-action" style={{ marginLeft: 8 }} onClick={() => {
                      // Keep the approved/final copy by default, not whichever sorts first.
                      const keep: any = preferredMeetingToKeep(group.meetings as any[], (row: any) => summaryByMeeting.get(String(row._id))) ?? group.meetings[0];
                      setMergeFor({ meeting: keep, suggested: group.meetings.filter((row: any) => String(row._id) !== String(keep._id)).map((row: any) => String(row._id)) });
                    }}>
                      <Merge size={12} /> Merge…
                    </button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}

      {showMetadataWarning ? (
          <RecordTableMetadataEmpty societyId={society?._id} objectLabel="meeting" />
        ) : tableData.objectMetadata ? (
          <RecordTableScope
            tableId="meetings"
            objectMetadata={tableData.objectMetadata}
            hydratedView={tableData.hydratedView}
            records={filteredRecords}
            onRecordClick={(recordId) => navigate(`/app/meetings/${recordId}`)}
            onCreate={canManage ? () => openNew() : undefined}
            onUpdate={canManage ? async ({ recordId, fieldName, value }) => {
              if (!["title", "type", "location", "status", "scheduledAt"].includes(fieldName)) return;
              await updateMeeting({ id: recordId as Doc<"meetings">["_id"], patch: { [fieldName]: value } as any });
            } : undefined}
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
              selectable={canManage}
              loading={tableData.loading || meetings === undefined}
              emptyState={
                <EmptyState
                  icon={<Calendar size={18} />}
                  title={records.length ? "No meetings match these filters" : "No meetings scheduled yet"}
                  description={records.length ? "Clear the review filters to see every meeting." : "Schedule a board, committee, or general meeting to start tracking agendas, attendees, and minutes."}
                  action={
                    records.length ? undefined : (
                      <button className="btn btn--accent" type="button" onClick={() => openNew()} disabled={!canManage}>
                        <Plus size={12} /> Schedule meeting
                      </button>
                    )
                  }
                />
              }
              renderCell={({ record, field }) => {
                if (field.name === "scheduledAt") {
                  const overlap = conflicts.get(record._id);
                  return (
                    <span>
                      <span className="mono">{formatMeetingDate(record)}</span>
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
                if (field.name === "status") return <Badge tone={meetingStatusTone(record.status)}>{meetingStatusLabel(record.status)}</Badge>;
                if (field.name === "minutes") {
                  const summary = record._summary;
                  if (summary?.approvedAt) return <Badge tone="success">Approved</Badge>;
                  if (summary?.started) return <Badge tone="info">Draft</Badge>;
                  if (record.status === "Held" || record.status === "HeldMinutesMissing") return <Badge tone="warn">{record.status === "HeldMinutesMissing" ? "Minutes missing" : "Needs minutes"}</Badge>;
                  return <span className="muted">—</span>;
                }
                if (field.name === "sourceReviewStatus") {
                  const status = String(record.sourceReviewStatus ?? "not_applicable");
                  return <Badge tone={status === "source_reviewed" ? "success" : status === "imported_needs_review" ? "warn" : status === "rejected" ? "danger" : "neutral"}>{SOURCE_REVIEW_LABELS[status] ?? status}</Badge>;
                }
                if (field.name === "body") return <span>{record.body}</span>;
                if (field.name === "duplicateCount") return record.duplicateCount ? <Badge tone="warn">{record.duplicateCount}</Badge> : <span className="muted">—</span>;
                if (field.name === "datePrecision") return <span className="muted">{record.datePrecision === "date" ? "Date only" : "Date and time"}</span>;
                return undefined;
              }}
              rowMenuSections={meetingMenuSections}
            />
            <RecordTableBulkBar
              actions={canManage ? [
                {
                  id: "bulk-review",
                  label: "Mark source reviewed",
                  icon: <CheckCircle2 size={12} />,
                  onRun: async (_ids, rows) => {
                    const ok = await confirm({
                      title: `Mark ${rows.length} meeting${rows.length === 1 ? "" : "s"} source reviewed?`,
                      message: "Each meeting and its minutes are recorded as reviewed against their source documents, with you as the reviewer.",
                      confirmLabel: "Mark reviewed",
                    });
                    if (ok) await setReview(rows, "source_reviewed");
                  },
                },
                {
                  id: "bulk-reopen",
                  label: "Reopen review",
                  icon: <RotateCcw size={12} />,
                  onRun: async (_ids, rows) => { await setReview(rows, "imported_needs_review"); },
                },
                {
                  id: "bulk-status",
                  label: "Set status…",
                  icon: <Tag size={12} />,
                  keepSelection: true,
                  onRun: (_ids, rows) => setBulk({ kind: "status", rows, value: "Held" }),
                },
                {
                  id: "bulk-body",
                  label: "Set body…",
                  icon: <Tag size={12} />,
                  keepSelection: true,
                  onRun: (_ids, rows) => setBulk({ kind: "body", rows, value: "board" }),
                },
                {
                  id: "bulk-delete",
                  label: "Delete",
                  icon: <Trash2 size={12} />,
                  tone: "danger",
                  onRun: async (_ids, rows) => {
                    const withMinutes = rows.filter((row: any) => row._summary?.started).length;
                    const ok = await confirm({
                      title: `Delete ${rows.length} meeting${rows.length === 1 ? "" : "s"}?`,
                      message: `Their agendas and minutes are deleted too${withMinutes ? ` — ${withMinutes} have recorded minutes content` : ""}. This cannot be undone.`,
                      confirmLabel: "Delete",
                      tone: "danger",
                    });
                    if (!ok) return;
                    for (const row of rows) await removeMeeting({ id: row._id });
                    toast.success(`Deleted ${rows.length} meeting${rows.length === 1 ? "" : "s"}`);
                  },
                },
              ] : []}
            />
          </RecordTableScope>
        ) : null}

      <Drawer
        open={open} onClose={() => { void closeCreate(); }} title={meetingCreateLabels(form?.scheduledAt ?? "").title}
        footer={<><button className="btn" type="button" onClick={() => { void closeCreate(); }}>Cancel</button><button className="btn btn--accent" type="button" onClick={save} disabled={!canManage || hasUnacknowledgedConflict}>{meetingCreateLabels(form?.scheduledAt ?? "").action}</button></>}
      >
        {form && (
          <MeetingFormFields
            value={form}
            onChange={(patch) => setForm((prev) => (prev ? { ...prev, ...patch } : prev))}
            data={data}
            editingId={null}
          />
        )}
      </Drawer>

      <EditMeetingDrawer
        open={!!editing}
        onClose={() => setEditing(null)}
        meeting={editing}
        committees={committees}
        recentLocations={recentLocations}
      />

      {mergeFor && (
        <MergeMeetingDialog
          meeting={mergeFor.meeting}
          meetings={(meetings ?? []) as any[]}
          committees={committeeRows}
          suggestedIds={mergeFor.suggested}
          onClose={() => setMergeFor(null)}
        />
      )}

      <Modal
        open={!!bulk}
        onClose={() => setBulk(null)}
        title={bulk?.kind === "status" ? `Set status for ${bulk?.rows.length ?? 0} meetings` : `Set body for ${bulk?.rows.length ?? 0} meetings`}
        size="sm"
        footer={
          <>
            <button className="btn" type="button" onClick={() => setBulk(null)}>Cancel</button>
            <button className="btn btn--accent" type="button" onClick={() => { void applyBulk(); }} data-testid="bulk-apply">Apply</button>
          </>
        }
      >
        {bulk && (
          <Field label={bulk.kind === "status" ? "Status" : "Body"}>
            <Select
              value={bulk.value}
              onChange={(value) => setBulk({ ...bulk, value })}
              searchable={bulk.kind === "body"}
              options={bulk.kind === "status"
                ? MEETING_STATUS_OPTIONS.map((option) => ({ value: option.value, label: option.label }))
                : meetingBodyOptions(committeeRows).filter((option) => option.value !== "external").map((option) => ({ value: option.value, label: option.label, hint: option.group }))}
            />
          </Field>
        )}
      </Modal>
    </div>
  );
}

function meetingStatusTone(status: string): ToneVariant {
  return sharedMeetingStatusTone(status) as ToneVariant;
}

function meetingStatusLabel(status: string) {
  return MEETING_STATUS_LABELS[status] ?? status;
}
