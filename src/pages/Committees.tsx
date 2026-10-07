import { useMemo, useState } from "react";
import { COMMITTEE_KIND_OPTIONS } from "../features/committees/CommitteeStructureCard";
import { useNavigate } from "react-router-dom";
import { useQuery } from "convex/react";
import { Plus, Users, UsersRound as UsersIcon } from "lucide-react";
import { api } from "@/lib/convexApi";
import {
  RecordTable,
  RecordTableFilterChips,
  RecordTableFilterPopover,
  RecordTableScope,
  RecordTableViewToolbar,
  useObjectRecordTableData,
} from "@/platform/record-engine";
import type { Doc } from "../../convex/_generated/dataModel";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useSociety } from "../hooks/useSociety";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Drawer, EmptyState, Field } from "../components/ui";
import { Select } from "../components/Select";
import { ColorPicker } from "../components/ColorPicker";
import { formatDateTime } from "../lib/format";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { RecordTableMetadataEmpty } from "../components/RecordTableMetadataEmpty";
import { isOpenOperationalTask } from "../../shared/taskStatus";
import { BuildRostersButton } from "../features/committees/BuildRostersButton";
import { useToast } from "../components/Toast";

const CADENCES = ["Weekly", "Biweekly", "Monthly", "Quarterly", "Ad-hoc"];
const COLORS = ["#3b5bdb", "#0a8f4e", "#a86400", "#c9264a", "#6f42c1", "#0e7490"];

type CommitteeForm = {
  name: string;
  description: string;
  mission?: string;
  cadence: string;
  cadenceNotes?: string;
  color: string;
  kind?: string;
};

type CommitteeRecord = Doc<"committees"> & {
  goalCount: number;
  memberCount: number;
  openTaskCount: number;
};

type CommitteeListRecord = Doc<"committees"> & {
  memberCount: number;
};

export function CommitteesPage() {
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("committees:write");
  const navigate = useNavigate();
  const committees = useQuery(
    api.committees.list,
    society ? { societyId: society._id } : "skip",
  ) as CommitteeListRecord[] | undefined;
  const allTasks = useQuery(
    api.tasks.list,
    society ? { societyId: society._id } : "skip",
  ) as Doc<"tasks">[] | undefined;
  const allGoals = useQuery(
    api.goals.list,
    society ? { societyId: society._id } : "skip",
  ) as Doc<"goals">[] | undefined;
  const create = usePermissionedMutation(api.committees.create, canWrite);
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<CommitteeForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [nameError, setNameError] = useState<string | null>(null);
  const [currentViewId, setCurrentViewId] = useState<Doc<"views">["_id"] | undefined>();
  const [filterOpen, setFilterOpen] = useState(false);
  const tableData = useObjectRecordTableData({
    societyId: society?._id,
    nameSingular: "committee",
    viewId: currentViewId,
  });
  const showMetadataWarning = !tableData.loading && !tableData.objectMetadata;

  const records = useMemo<CommitteeRecord[]>(() => {
    return (committees ?? []).map((committee) => ({
      ...committee,
      goalCount: (allGoals ?? []).filter((goal) => goal.committeeId === committee._id).length,
      memberCount: committee.memberCount,
      openTaskCount: (allTasks ?? []).filter(
        (task) => task.committeeId === committee._id && isOpenOperationalTask(task),
      ).length,
    }));
  }, [allGoals, allTasks, committees]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite) return;
    setForm({ name: "", description: "", cadence: "Monthly", color: COLORS[0] });
    setNameError(null);
    setOpen(true);
  };

  const save = async () => {
    if (!canWrite || !form || saving) return;
    const name = form.name.trim();
    if (!name) {
      setNameError("Give the committee a name.");
      return;
    }
    const sameName = (committees ?? []).find((committee) => committee.name.trim().toLowerCase() === name.toLowerCase());
    if (sameName) {
      setNameError(`A committee named “${sameName.name}” already exists.`);
      return;
    }
    setSaving(true);
    try {
      const id = await create({ societyId: society._id, ...form, name });
      setOpen(false);
      toast.success("Committee created", "Set its quorum, cadence and terms of reference under Body, cadence and mandate.");
      if (id) navigate(`/app/committees/${id}`);
    } catch (error) {
      toast.error("Could not create the committee", error instanceof Error ? error.message : "Please try again.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Committees"
        icon={<UsersIcon size={16} />}
        iconColor="pink"
        subtitle="Standing and ad-hoc committees — each with its own cadence, roster, tasks, and goals."
        actions={
          <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
            <BuildRostersButton societyId={society._id} disabled={!canWrite} />
            <button className="btn-action btn-action--primary" disabled={!canWrite} onClick={openNew}>
              <Plus size={12} /> New committee
            </button>
          </div>
        }
      />

      {showMetadataWarning ? (
        <RecordTableMetadataEmpty societyId={society._id} objectLabel="committee" />
      ) : tableData.objectMetadata ? (
        <RecordTableScope
          tableId="committees"
          objectMetadata={tableData.objectMetadata}
          hydratedView={tableData.hydratedView}
          records={records}
          onRecordClick={(recordId) => navigate(`/app/committees/${recordId}`)}
          onCreate={canWrite ? openNew : undefined}
        >
          <RecordTableViewToolbar
            societyId={society._id}
            objectMetadataId={tableData.objectMetadata._id as Doc<"objectMetadata">["_id"]}
            icon={<Users size={14} />}
            label="All committees"
            views={tableData.views}
            currentViewId={currentViewId ?? tableData.views[0]?._id ?? null}
            onChangeView={(viewId) => setCurrentViewId(viewId as Doc<"views">["_id"])}
            onOpenFilter={() => setFilterOpen((value) => !value)}
          />
          <RecordTableFilterPopover open={filterOpen} onClose={() => setFilterOpen(false)} />
          <RecordTableFilterChips />
          <RecordTable
            loading={
              tableData.loading ||
              committees === undefined ||
              allTasks === undefined ||
              allGoals === undefined
            }
            emptyState={
              <EmptyState
                icon={<Users size={18} />}
                title="No committees yet"
                description="Create a committee to start tracking its mission, roster, meetings, tasks, and goals."
                action={
                  <button className="btn btn--accent" type="button" disabled={!canWrite} onClick={openNew}>
                    <Plus size={12} /> New committee
                  </button>
                }
              />
            }
            renderCell={({ record, field }) => {
              if (field.name === "name") {
                return (
                  <div title={record.description || undefined}>
                    <div className="row">
                      <span className="color-chip" style={{ background: record.color }} />
                      <strong>{record.name}</strong>
                    </div>
                    <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      {truncate(record.description || "No description yet.", 72)}
                    </div>
                  </div>
                );
              }
              if (field.name === "nextMeetingAt" && record.nextMeetingAt) {
                const overdue = new Date(record.nextMeetingAt).getTime() < Date.now();
                return (
                  <span
                    className={overdue ? undefined : "muted"}
                    style={overdue ? { color: "var(--danger)", fontWeight: 600 } : undefined}
                    title={overdue ? "Overdue — schedule the next meeting" : undefined}
                  >
                    {overdue ? "Overdue — " : ""}
                    {formatDateTime(record.nextMeetingAt)}
                  </span>
                );
              }
              return undefined;
            }}
          />
        </RecordTableScope>
      ) : null}

      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title="New committee"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" disabled={!canWrite || saving} onClick={save}>{saving ? "Creating…" : "Create"}</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Name" required error={nameError ?? undefined}>
              <input
                disabled={!canWrite}
                className="input"
                value={form.name}
                onChange={(event) => { setForm({ ...form, name: event.target.value }); setNameError(null); }}
              />
            </Field>
            <Field label="Mission">
              <input
                disabled={!canWrite}
                className="input"
                value={form.mission ?? ""}
                onChange={(event) => setForm({ ...form, mission: event.target.value })}
              />
            </Field>
            <Field label="Description">
              <MarkdownEditor
                readOnly={!canWrite}
                rows={4}
                value={form.description}
                onChange={(markdown) => setForm({ ...form, description: markdown })}
              />
            </Field>
            <Field label="Kind">
              <Select
                disabled={!canWrite}
                value={form.kind ?? ""}
                onChange={(value) => setForm({ ...form, kind: value || undefined })}
                options={COMMITTEE_KIND_OPTIONS}
                placeholder="Not set"
                clearable
              />
            </Field>
            <Field label="Cadence">
              <Select
                disabled={!canWrite}
                value={form.cadence}
                onChange={(value) => setForm({ ...form, cadence: value })}
                options={CADENCES.map((cadence) => ({ value: cadence, label: cadence }))}
              />
            </Field>
            <Field label="Cadence notes">
              <input
                disabled={!canWrite}
                className="input"
                placeholder="e.g. 2nd Tuesday of each month at 6:30pm"
                value={form.cadenceNotes ?? ""}
                onChange={(event) => setForm({ ...form, cadenceNotes: event.target.value })}
              />
            </Field>
            <Field label="Color">
              <ColorPicker
                disabled={!canWrite}
                value={form.color}
                onChange={(color) => setForm({ ...form, color })}
                palette={COLORS}
              />
            </Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function truncate(value: string, maxLength: number): string {
  return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}
