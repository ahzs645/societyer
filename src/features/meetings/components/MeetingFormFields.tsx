/**
 * Meeting create/edit form — the fields, the derived scheduling data, and the
 * default-draft factory, extracted from MeetingsPage so the same form can be
 * reused by the page Drawer and the global "Create meeting" popup
 * (MeetingCreateModal).
 */
import { useEffect, useMemo, useRef } from "react";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Field } from "@/components/ui";
import { Select } from "@/components/Select";
import { DateTimeInput } from "@/components/DateTimeInput";
import { Checkbox, Toggle } from "@/components/Controls";
import { NameAutocomplete } from "@/components/NameAutocomplete";
import { MarkdownEditor } from "@/components/MarkdownEditor";
import { AlertTriangle, BookMarked } from "lucide-react";
import { formatDateTime, toDateTimeLocalValue } from "@/lib/format";
import { useBylawRules } from "@/hooks/useBylawRules";
import { daysUntil, isGeneralMeeting, meetingScheduleConflicts, meetsNoticeWindow } from "../lib/noticeWindow";
import { useHiddenSuggestions, looksLikeLink } from "@/lib/hiddenSuggestions";
import type { Doc, Id } from "../../../../convex/_generated/dataModel";

export type MeetingDraft = {
  type: string;
  title: string;
  scheduledAt: string;
  location: string;
  electronic: boolean;
  quorumRequired: string;
  status: string;
  attendeeIds: string[];
  meetingTemplateId: string;
  committeeId: string;
  conflictAcknowledged: boolean;
  notes?: string;
};

type BylawRules = ReturnType<typeof useBylawRules>["rules"];

export type MeetingFormData = {
  meetings: Doc<"meetings">[] | undefined;
  meetingTemplates: Doc<"meetingTemplates">[] | undefined;
  committees: Doc<"committees">[] | undefined;
  defaultTemplate: Doc<"meetingTemplates"> | undefined;
  rules: BylawRules;
  effectiveRules: BylawRules;
  noticeMinDays: number;
  noticeMaxDays: number;
  effectiveNoticeMinDays: number;
  effectiveNoticeMaxDays: number;
  recentLocations: string[];
  hideLocationSuggestion: (value: string) => void;
};

/**
 * Loads and derives everything the meeting form needs: the bylaw rule set (both
 * the current rules and the date-specific rules for the drafted meeting date),
 * templates, notice windows, and recent-location suggestions.
 */
export function useMeetingFormData(
  societyId: Id<"societies"> | undefined,
  scheduledAt?: string,
): MeetingFormData {
  const { rules } = useBylawRules();
  const seedMeetingTemplates = useMutation(api.meetingTemplates.seedDefaults);
  const templateSeedRequested = useRef(false);
  const meetings = useQuery(api.meetings.list, societyId ? { societyId } : "skip") as
    | Doc<"meetings">[]
    | undefined;
  const meetingTemplates = useQuery(
    api.meetingTemplates.list,
    societyId ? { societyId } : "skip",
  ) as Doc<"meetingTemplates">[] | undefined;
  const committees = useQuery(
    api.committees.list,
    societyId ? { societyId } : "skip",
  ) as Doc<"committees">[] | undefined;
  const formRules = useQuery(
    api.bylawRules.getForDate,
    societyId && scheduledAt ? { societyId, dateISO: scheduledAt } : "skip",
  );
  useEffect(() => {
    if (!societyId || meetingTemplates === undefined || templateSeedRequested.current) return;
    const hasBoard = meetingTemplates.some((template) => template.meetingType === "Board");
    const hasAgm = meetingTemplates.some((template) => template.meetingType === "AGM");
    if (hasBoard && hasAgm) return;
    templateSeedRequested.current = true;
    void seedMeetingTemplates({ societyId }).catch(() => {
      templateSeedRequested.current = false;
    });
  }, [meetingTemplates, seedMeetingTemplates, societyId]);
  const { hide: hideLocationSuggestion, isHidden: isHiddenLocation } =
    useHiddenSuggestions("meeting-location");

  const noticeMinDays = rules?.generalNoticeMinDays ?? 14;
  const noticeMaxDays = rules?.generalNoticeMaxDays ?? 60;
  const effectiveRules = (formRules ?? rules) as BylawRules;
  const effectiveNoticeMinDays = effectiveRules?.generalNoticeMinDays ?? noticeMinDays;
  const effectiveNoticeMaxDays = effectiveRules?.generalNoticeMaxDays ?? noticeMaxDays;

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

  const defaultTemplate = meetingTemplatesForType(meetingTemplates, "Board").find((template) => template.isDefault) ??
    meetingTemplatesForType(meetingTemplates, "Board")[0];

  return {
    meetings,
    meetingTemplates,
    committees,
    defaultTemplate,
    rules,
    effectiveRules,
    noticeMinDays,
    noticeMaxDays,
    effectiveNoticeMinDays,
    effectiveNoticeMaxDays,
    recentLocations,
    hideLocationSuggestion,
  };
}

/**
 * A blank meeting draft that needs no loaded data — used to seed the form
 * synchronously (so a resizable dialog can measure its full height on open,
 * before rules/templates arrive). `makeMeetingDraft` refines it once data loads.
 */
export function blankMeetingDraft(overrides: Partial<MeetingDraft> = {}): MeetingDraft {
  const scheduled = new Date();
  scheduled.setDate(scheduled.getDate() + 14);
  return {
    type: "Board",
    title: "",
    scheduledAt: toDateTimeLocalValue(scheduled),
    location: "",
    electronic: false,
    quorumRequired: "",
    status: "Scheduled",
    attendeeIds: [],
    meetingTemplateId: "",
    committeeId: "",
    conflictAcknowledged: false,
    ...overrides,
  };
}

/** Build a blank meeting draft for the "new meeting" flow, using the loaded
 * bylaw rules / default template. */
export function makeMeetingDraft(
  data: MeetingFormData,
  overrides: Partial<MeetingDraft> = {},
): MeetingDraft {
  const type = overrides.type ?? "Board";
  const template = meetingTemplatesForType(data.meetingTemplates, type).find((row) => row.isDefault) ??
    meetingTemplatesForType(data.meetingTemplates, type)[0];
  const scheduled = new Date();
  scheduled.setDate(scheduled.getDate() + data.noticeMinDays);
  return blankMeetingDraft({
    type,
    scheduledAt: toDateTimeLocalValue(scheduled),
    electronic: !!data.rules?.allowElectronicMeetings,
    meetingTemplateId: template?._id ? String(template._id) : "",
    ...overrides,
  });
}

/** Build the meeting draft for editing an existing meeting. */
export function meetingToDraft(meeting: Doc<"meetings">): MeetingDraft {
  return {
    type: meeting.type,
    title: meeting.title,
    scheduledAt: meeting.scheduledAt ? toDateTimeLocalValue(new Date(meeting.scheduledAt)) : "",
    location: meeting.location ?? "",
    electronic: !!meeting.electronic,
    quorumRequired: meeting.quorumRequired != null ? String(meeting.quorumRequired) : "",
    status: meeting.status,
    attendeeIds: meeting.attendeeIds ?? [],
    meetingTemplateId: meeting.meetingTemplateId ? String(meeting.meetingTemplateId) : "",
    committeeId: meeting.committeeId ? String(meeting.committeeId) : "",
    conflictAcknowledged: false,
    notes: meeting.notes ?? "",
  };
}

export function meetingTemplatesForType(
  templates: Doc<"meetingTemplates">[] | undefined,
  type: string,
) {
  return (templates ?? []).filter((template) => !template.meetingType || template.meetingType === type);
}

export function numberOrUndefined(value: unknown) {
  if (value === "" || value == null) return undefined;
  const number = Number(value);
  return Number.isFinite(number) ? number : undefined;
}

function templateSummary(template: Doc<"meetingTemplates"> | undefined) {
  if (!template) return "Template details are loading.";
  const items = Array.isArray(template.items) ? template.items : [];
  const motionCount = items.filter((item) => item.motionTemplateId || item.motionText).length;
  return `${items.length} agenda item${items.length === 1 ? "" : "s"}${
    motionCount ? `, ${motionCount} recurring motion${motionCount === 1 ? "" : "s"}` : ""
  }. New meetings receive a snapshot.`;
}

export function MeetingFormFields({
  value,
  onChange,
  data,
  editingId = null,
}: {
  value: MeetingDraft;
  onChange: (patch: Partial<MeetingDraft>) => void;
  data: MeetingFormData;
  /** Present when editing an existing meeting — hides create-only sections and
   * excludes the meeting itself from the conflict check. */
  editingId?: Id<"meetings"> | null;
}) {
  const {
    meetingTemplates,
    effectiveRules,
    effectiveNoticeMinDays,
    effectiveNoticeMaxDays,
    recentLocations,
    hideLocationSuggestion,
    meetings,
    committees,
  } = data;
  const availableTemplates = meetingTemplatesForType(meetingTemplates, value.type);
  const overlaps = meetingScheduleConflicts(meetings, value.scheduledAt, editingId);

  return (
    <div className="meeting-form">
      {isGeneralMeeting(value.type) &&
      (daysUntil(value.scheduledAt) ?? 0) >= 0 &&
      !meetsNoticeWindow(value.scheduledAt, effectiveNoticeMinDays, effectiveNoticeMaxDays) ? (
        <div className="flag flag--warn" style={{ marginBottom: 12 }}>
          <AlertTriangle />
          <div>
            General meetings should be scheduled with {effectiveNoticeMinDays}–
            {effectiveNoticeMaxDays} days of notice under the rule set effective on this meeting
            date.
          </div>
        </div>
      ) : null}
      {!editingId && (
        <div className="meeting-template-picker">
          <Field label="Template">
            <Select
              value={value.meetingTemplateId}
              onChange={(v) => onChange({ meetingTemplateId: v })}
              options={[
                { value: "", label: "Blank meeting" },
                ...availableTemplates.map((template) => ({
                  value: String(template._id),
                  label: `${template.name}${template.isDefault ? " (default)" : ""}`,
                })),
              ]}
            />
          </Field>
          {value.meetingTemplateId ? (
            <p className="meeting-template-picker__summary">
              <BookMarked size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
              {templateSummary(
                availableTemplates.find(
                  (template) => String(template._id) === value.meetingTemplateId,
                ),
              )}
            </p>
          ) : (
            <p className="meeting-template-picker__summary">
              Start with an empty agenda and add sections from the meeting page.
            </p>
          )}
        </div>
      )}
      <Field label="Title" required>
        <input
          className="input"
          required
          value={value.title}
          onChange={(e) => onChange({ title: e.target.value })}
        />
      </Field>
      <div className="row" style={{ gap: 12 }}>
        <Field label="Type">
          <Select
            value={value.type}
            onChange={(v) => {
              const templates = meetingTemplatesForType(meetingTemplates, v);
              const template = templates.find((row) => row.isDefault) ?? templates[0];
              onChange({
                type: v,
                committeeId: v === "Committee" ? value.committeeId : "",
                meetingTemplateId: editingId ? value.meetingTemplateId : template ? String(template._id) : "",
              });
            }}
            options={["Board", "Committee", "AGM", "SGM"].map((t) => ({ value: t, label: t }))}
          />
        </Field>
        <Field label="Scheduled">
          <DateTimeInput
            value={value.scheduledAt}
            onChange={(v) => onChange({ scheduledAt: v, conflictAcknowledged: false })}
          />
        </Field>
      </div>
      {value.type === "Committee" && (
        <Field label="Committee" required>
          <Select
            value={value.committeeId}
            onChange={(committeeId) => onChange({ committeeId })}
            options={[
              { value: "", label: "Select committee" },
              ...(committees ?? []).map((committee) => ({
                value: String(committee._id),
                label: committee.name,
              })),
            ]}
          />
        </Field>
      )}
      {editingId && (
        <Field label="Status">
          <Select
            value={value.status}
            onChange={(v) => onChange({ status: v })}
            options={["Scheduled", "Held", "Cancelled"].map((s) => ({ value: s, label: s }))}
          />
        </Field>
      )}
      <Field label="Venue / link">
        <NameAutocomplete
          value={value.location}
          onChange={(v) => onChange({ location: v })}
          options={recentLocations}
          onRemoveOption={hideLocationSuggestion}
          placeholder={value.electronic ? "Zoom, Teams, or join link…" : "Where is it being held?"}
          ariaLabel="Venue or join link"
        />
      </Field>
      <Toggle
        checked={value.electronic}
        onChange={(v) => onChange({ electronic: v })}
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
          value={value.quorumRequired ?? ""}
          onChange={(e) => onChange({ quorumRequired: e.target.value })}
        />
      </Field>
      <Field label="Notes">
        <MarkdownEditor
          rows={4}
          value={value.notes ?? ""}
          onChange={(markdown) => onChange({ notes: markdown })}
        />
      </Field>
      {value.type === "AGM" && (
        <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          Reminder: AGM notice must be sent {effectiveNoticeMinDays}–{effectiveNoticeMaxDays} days
          in advance.
          {effectiveRules?.requireAgmFinancialStatements
            ? " Financial statements must be presented."
            : ""}
          {effectiveRules?.requireAgmElections
            ? " Elections are expected under the effective rule set."
            : ""}
        </div>
      )}
      {overlaps.length > 0 && (
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
            <AlertTriangle
              size={12}
              style={{ verticalAlign: -1, color: "var(--warn, #c78b00)", marginRight: 4 }}
            />
            <strong>Schedule conflict:</strong> {overlaps.length} other meeting
            {overlaps.length === 1 ? "" : "s"} within 2h of this time:
            <ul style={{ margin: "4px 0 0 20px" }}>
              {overlaps.map((m) => (
                <li key={m._id} className="muted">
                  {m.title} — {formatDateTime(m.scheduledAt)}
                </li>
              ))}
            </ul>
            <div style={{ marginTop: 8 }}>
              <Checkbox
                checked={value.conflictAcknowledged}
                onChange={(conflictAcknowledged) => onChange({ conflictAcknowledged })}
                label="I reviewed this conflict and want to schedule anyway."
              />
            </div>
          </div>
      )}
    </div>
  );
}
