import { useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { BookOpen, CalendarPlus, Gavel, Layers, Pencil, Plus, Tag as TagIcon, X } from "lucide-react";
import { api } from "@/lib/convexApi";
import type { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Select } from "../components/Select";
import { useToast } from "../components/Toast";
import { formatDate } from "../lib/format";
import { isRoutineMotion } from "../lib/motionGovernance";
import { ROUTINE_MOTION_TAGS } from "../../shared/proceduralMotions";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import {
  RecordTable,
  RecordTableScope,
  RecordTableViewToolbar,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  useObjectRecordTableData,
} from "@/modules/object-record";
import { Tabs } from "../components/primitives";
import { MotionBacklogPage } from "./MotionBacklog";
import { MotionLibraryPage } from "./MotionLibrary";

const MOTION_STATUSES = ["Backlog", "Draft", "Agenda", "Moved", "Tabled", "Deferred", "Withdrawn", "Voted", "Archived"];
const MOTION_OUTCOMES = [
  { value: "", label: "—" },
  { value: "Carried", label: "Carried" },
  { value: "Defeated", label: "Defeated" },
];

type MotionForm = {
  title: string;
  text: string;
  status: string;
  outcome: string;
  movedBy: string;
  secondedBy: string;
  votesFor: string;
  votesAgainst: string;
  abstentions: string;
};

// A motion is safely editable from this master page only if it's a genuine
// first-class row that doesn't mirror a meeting's minutes: motions with
// `minutesId` set get overwritten on the next minutes sync, so they must be
// edited in the meeting instead (via the meeting link).
function canEditMotion(m: any): boolean {
  return !m.minutesId;
}

const MOTIONS_TABS = ["motions", "tabled", "templates"] as const;
type MotionsTab = (typeof MOTIONS_TABS)[number];

// The Motions area consolidates the master motions table, the Tabled/backlog
// workflow, and the template library into one tabbed page (driven by ?tab=).
export function MotionsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const tabFromUrl = searchParams.get("tab") as MotionsTab | null;
  const tab: MotionsTab = tabFromUrl && MOTIONS_TABS.includes(tabFromUrl) ? tabFromUrl : "motions";
  const setTab = (next: MotionsTab) =>
    setSearchParams(
      (prev) => {
        const params = new URLSearchParams(prev);
        if (next === "motions") params.delete("tab");
        else params.set("tab", next);
        return params;
      },
      { replace: true },
    );

  return (
    <div className="page motions">
      <PageHeader
        title="Motions"
        icon={<Gavel size={16} />}
        iconColor="orange"
        subtitle="Every decision your society has moved — a referenceable record across all meetings."
      />
      <Tabs<MotionsTab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "motions", label: "Motions", icon: <Gavel size={13} /> },
          { id: "tabled", label: "Tabled", icon: <Layers size={13} /> },
          { id: "templates", label: "Templates", icon: <BookOpen size={13} /> },
        ]}
      />
      {tab === "motions" && <MotionsTableTab />}
      {tab === "tabled" && <MotionBacklogPage embedded />}
      {tab === "templates" && <MotionLibraryPage embedded />}
    </div>
  );
}

// The master motions table (object-record RecordTable). The seeded "Motions"
// view hides routine bookkeeping (adjournment, accept-previous-minutes, …) via a
// notIn filter on the labels field; switch to "All motions" to see them. Labels
// are free-form and editable inline.
function MotionsTableTab() {
  const society = useSociety();
  const toast = useToast();
  const [currentViewId, setCurrentViewId] = useState<Id<"views"> | undefined>(undefined);
  const [filterOpen, setFilterOpen] = useState(false);
  const [tagDraft, setTagDraft] = useState<Record<string, string>>({});
  const [editing, setEditing] = useState<any | null>(null);
  const [form, setForm] = useState<MotionForm | null>(null);

  const motions = useQuery(api.motions.list, society ? { societyId: society._id } : "skip");
  const meetings = useQuery(api.meetings.list, society ? { societyId: society._id } : "skip");
  const setTags = useMutation(api.motions.setTags);
  const update = useMutation(api.motions.update);

  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "motion",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const meetingById = useMemo(() => {
    const map = new Map<string, any>();
    (meetings ?? []).forEach((m: any) => map.set(String(m._id), m));
    return map;
  }, [meetings]);

  const records = useMemo(() => {
    return (motions ?? []).map((m: any) => {
      const tags = Array.isArray(m.tags) ? m.tags.map(String) : [];
      // Ensure routine motions carry a routine label so the seeded default view's
      // notIn(tags) filter hides them — parity with the old isRoutineMotion(),
      // which also classified by proceduralKind/wording, not just stored tags
      // (a safety net for any imported/legacy row missing procedural tags).
      const tagsForFilter =
        isRoutineMotion(m) && !tags.some((t: string) => ROUTINE_MOTION_TAGS.includes(t))
          ? [...tags, "routine"]
          : tags;
      const meeting = m.primaryMeetingId ? meetingById.get(String(m.primaryMeetingId)) : null;
      return {
        ...m,
        _hasTitle: !!(m.title && String(m.title).trim()),
        title: m.title ?? "",
        tags: tagsForFilter,
        meeting: meeting ? `${meeting.title} (${formatDate(meeting.scheduledAt)})` : "",
      };
    });
  }, [motions, meetingById]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const addTag = async (row: any) => {
    const value = (tagDraft[String(row._id)] ?? "").trim().toLowerCase();
    if (!value) return;
    const next = Array.from(new Set([...(row.tags ?? []).map((t: string) => String(t)), value]));
    setTagDraft({ ...tagDraft, [String(row._id)]: "" });
    try {
      await setTags({ motionId: row._id, tags: next });
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update labels");
    }
  };
  const removeTag = async (row: any, tag: string) => {
    const next = (row.tags ?? []).map((t: string) => String(t)).filter((t: string) => t !== tag);
    try {
      await setTags({ motionId: row._id, tags: next });
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update labels");
    }
  };

  const openEdit = (row: any) => {
    setEditing(row);
    setForm({
      title: row.title ?? "",
      text: row.text ?? "",
      status: row.status ?? "Draft",
      outcome: row.outcome ?? "",
      movedBy: row.movedBy ?? "",
      secondedBy: row.secondedBy ?? "",
      votesFor: row.votesFor != null ? String(row.votesFor) : "",
      votesAgainst: row.votesAgainst != null ? String(row.votesAgainst) : "",
      abstentions: row.abstentions != null ? String(row.abstentions) : "",
    });
  };
  const closeEdit = () => {
    setEditing(null);
    setForm(null);
  };
  const saveEdit = async () => {
    if (!editing || !form) return;
    const num = (v: string) => (v.trim() === "" ? undefined : Number(v));
    try {
      await update({
        motionId: editing._id as Id<"motions">,
        patch: {
          title: form.title.trim() || undefined,
          text: form.text.trim(),
          status: form.status,
          outcome: form.outcome || undefined,
          movedBy: form.movedBy.trim() || undefined,
          secondedBy: form.secondedBy.trim() || undefined,
          votesFor: num(form.votesFor),
          votesAgainst: num(form.votesAgainst),
          abstentions: num(form.abstentions),
        },
      });
      toast.success("Motion updated");
      closeEdit();
    } catch (err: any) {
      toast.error(err?.message ?? "Could not update motion");
    }
  };

  return (
    <>
      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society?._id} objectLabel="motion" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="motions"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Id<"objectMetadata">}
            icon={<Gavel size={14} />}
            label="Motions"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Id<"views">)}
            onOpenFilter={() => setFilterOpen((x) => !x)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={tableData.loading || motions === undefined}
            renderCell={({ record: row, field }) => {
              if (field.name === "title") return (
                <div>
                  <strong>{row.title || truncate(row.text, 70)}</strong>
                  {row._hasTitle && row.text && (
                    <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{truncate(row.text, 120)}</div>
                  )}
                </div>
              );
              if (field.name === "meeting") {
                if (!row.primaryMeetingId) return <span className="muted">—</span>;
                return (
                  <Link
                    to={`/app/meetings/${row.primaryMeetingId}?tab=motions&motion=${encodeURIComponent(String(row._id))}`}
                    className="row"
                    style={{ gap: 4, alignItems: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <CalendarPlus size={12} /> {row.meeting || "Open meeting"}
                  </Link>
                );
              }
              if (field.name === "tags") {
                return (
                  <div
                    className="row"
                    style={{ gap: 4, flexWrap: "wrap", alignItems: "center" }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    {(row.tags ?? []).map((tag: string) => (
                      <Badge key={tag} tone="neutral">
                        <span className="row" style={{ gap: 2, alignItems: "center" }}>
                          <TagIcon size={10} /> {tag}
                          <button
                            className="btn btn--ghost btn--icon"
                            style={{ padding: 0, height: 14 }}
                            aria-label={`Remove label ${tag}`}
                            onClick={() => removeTag(row, tag)}
                          >
                            <X size={10} />
                          </button>
                        </span>
                      </Badge>
                    ))}
                    <input
                      className="input"
                      style={{ width: 90, height: 24, fontSize: 12 }}
                      value={tagDraft[String(row._id)] ?? ""}
                      onChange={(e) => setTagDraft({ ...tagDraft, [String(row._id)]: e.target.value })}
                      onKeyDown={(e) => { if (e.key === "Enter") addTag(row); }}
                      placeholder="+ label"
                      aria-label="Add label"
                    />
                    <button className="btn btn--ghost btn--icon" aria-label="Add label" onClick={() => addTag(row)}>
                      <Plus size={12} />
                    </button>
                  </div>
                );
              }
              return undefined;
            }}
            renderRowActions={(row) =>
              canEditMotion(row) ? (
                <button
                  className="btn btn--ghost btn--sm"
                  onClick={(e) => { e.stopPropagation(); openEdit(row); }}
                >
                  <Pencil size={12} /> Edit
                </button>
              ) : row.primaryMeetingId ? (
                <Link
                  className="btn btn--ghost btn--sm"
                  to={`/app/meetings/${row.primaryMeetingId}?tab=motions&motion=${encodeURIComponent(String(row._id))}`}
                  onClick={(e) => e.stopPropagation()}
                >
                  Open meeting
                </Link>
              ) : null
            }
          />
        </RecordTableScope>
      ) : (
        <PageLoading />
      )}

      <Drawer
        open={!!editing}
        onClose={closeEdit}
        title="Edit motion"
        footer={
          <>
            <button className="btn" onClick={closeEdit}>Cancel</button>
            <button className="btn btn--accent" onClick={saveEdit} disabled={!form?.text.trim()}>
              Save
            </button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Title (optional)">
              <input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} />
            </Field>
            <Field label="Motion text" required>
              <textarea
                className="input"
                rows={3}
                value={form.text}
                onChange={(e) => setForm({ ...form, text: e.target.value })}
              />
            </Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select
                  value={form.status}
                  onChange={(value) => setForm({ ...form, status: value })}
                  options={MOTION_STATUSES.map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <Field label="Outcome">
                <Select
                  value={form.outcome}
                  onChange={(value) => setForm({ ...form, outcome: value })}
                  options={MOTION_OUTCOMES}
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Moved by">
                <input className="input" value={form.movedBy} onChange={(e) => setForm({ ...form, movedBy: e.target.value })} />
              </Field>
              <Field label="Seconded by">
                <input className="input" value={form.secondedBy} onChange={(e) => setForm({ ...form, secondedBy: e.target.value })} />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="For">
                <input className="input" type="number" min={0} value={form.votesFor} onChange={(e) => setForm({ ...form, votesFor: e.target.value })} />
              </Field>
              <Field label="Against">
                <input className="input" type="number" min={0} value={form.votesAgainst} onChange={(e) => setForm({ ...form, votesAgainst: e.target.value })} />
              </Field>
              <Field label="Abstain">
                <input className="input" type="number" min={0} value={form.abstentions} onChange={(e) => setForm({ ...form, abstentions: e.target.value })} />
              </Field>
            </div>
          </div>
        )}
      </Drawer>
    </>
  );
}

function truncate(value: string | undefined, max: number) {
  const text = String(value ?? "").trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}
