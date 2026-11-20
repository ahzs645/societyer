import { useMemo, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import type { Doc } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { usePermissions } from "../hooks/usePermissions";
import { PageHeader, PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Progress } from "../components/primitives";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useToast } from "../components/Toast";
import { ListTodo, Plus, Target } from "lucide-react";
import { formatDate } from "../lib/format";
import { patchInList } from "../lib/optimistic";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { todayDateOnly } from "../../shared/dateOnly";
import { effectiveGoalStatus, goalTone, labelStatus } from "../lib/goalStatus";
import {
  FIELD_TYPES,
  RecordListTable,
  RecordTableEmpty,
  RecordTablePhoneCard,
  staticRecordTable,
  type FieldMetadata,
  type RecordTableCardHelpers,
} from "@/platform/record-engine";

const STATUSES = ["NotStarted", "OnTrack", "AtRisk", "OffTrack", "Completed"];
const CATEGORIES = ["Strategic", "Operational", "Program", "Fundraising", "Governance"];

const STATUS_COLORS: Record<string, string> = {
  NotStarted: "gray",
  OnTrack: "blue",
  AtRisk: "amber",
  OffTrack: "red",
  Completed: "green",
};

type Goal = Doc<"goals">;
type GoalForm = {
  title: string;
  description?: string;
  category: string;
  status: string;
  startDate: string;
  targetDate: string;
  progressPercent: number;
  milestones: Goal["milestones"];
  keyResults: Goal["keyResults"];
  committeeId?: string;
  ownerName?: string;
};

/**
 * A goal as the list reads it. `status` is the status the goal shows
 * everywhere (a goal past its target date reads "At risk"), so the status
 * filter and the board match the badges; moving a card saves the stored status.
 */
type GoalRecord = {
  _id: string;
  title: string;
  status: string;
  category: string;
  committee: string | null;
  progressPercent: number;
  milestones: string;
  openTasks: number;
  targetDate: string;
  startDate: string;
  ownerName: string | null;
  description: string | null;
  doneTasks: number;
  goal: Goal;
};

const GOALS_TABLE = staticRecordTable({
  id: "goals",
  nameSingular: "goal",
  namePlural: "goals",
  labelSingular: "Goal",
  labelPlural: "Goals",
  labelIdentifierFieldName: "title",
  routePath: "/app/goals",
  sorts: [{ field: "targetDate", direction: "asc" }],
  fields: [
    { name: "title", label: "Goal", fieldType: FIELD_TYPES.TEXT, size: 280, config: { groupable: false } },
    {
      name: "status",
      label: "Status",
      fieldType: FIELD_TYPES.SELECT,
      size: 130,
      // Editable so the board can move cards between status columns.
      isReadOnly: false,
      config: { options: STATUSES.map((status) => ({ value: status, label: labelStatus(status), color: STATUS_COLORS[status] })) },
    },
    {
      name: "category",
      label: "Category",
      fieldType: FIELD_TYPES.SELECT,
      size: 140,
      config: { options: CATEGORIES.map((category) => ({ value: category, label: category, color: "gray" })) },
    },
    // Board cards show the first few columns after the status: category, progress, target.
    { name: "progressPercent", label: "Progress", fieldType: FIELD_TYPES.NUMBER, size: 170, config: { groupable: false, suffix: "%" } },
    { name: "targetDate", label: "Target", fieldType: FIELD_TYPES.DATE, size: 130 },
    { name: "committee", label: "Committee", fieldType: FIELD_TYPES.TEXT, size: 170 },
    { name: "milestones", label: "Milestones", fieldType: FIELD_TYPES.TEXT, size: 120, config: { groupable: false } },
    { name: "openTasks", label: "Open tasks", fieldType: FIELD_TYPES.NUMBER, size: 150, config: { groupable: false } },
    { name: "startDate", label: "Start", fieldType: FIELD_TYPES.DATE, size: 130, isVisible: false },
    { name: "ownerName", label: "Owner", fieldType: FIELD_TYPES.TEXT, size: 150, isVisible: false },
    { name: "description", label: "Description", fieldType: FIELD_TYPES.TEXT, size: 260, isVisible: false, config: { groupable: false } },
  ],
});

export function GoalsPage() {
  const navigate = useNavigate();
  const toast = useToast();
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("commitments:write");
  const goals = useQuery(api.goals.list, society ? { societyId: society._id } : "skip") as Goal[] | undefined;
  const tasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip") as Doc<"tasks">[] | undefined;
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip") as Doc<"committees">[] | undefined;
  const create = useMutation(api.goals.create);
  const update = useMutation(api.goals.update).withOptimisticUpdate(
    (store, args) => {
      patchInList(store, api.goals.list, String(args.id), args.patch);
    },
  );
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<GoalForm | null>(null);

  const records = useMemo<GoalRecord[]>(() => {
    const committeeNames = new Map((committees ?? []).map((committee) => [String(committee._id), committee.name]));
    return (goals ?? []).map((goal) => {
      const linkedTasks = (tasks ?? []).filter((task) => task.goalId === goal._id);
      const openTasks = linkedTasks.filter((task) => task.status !== "Done").length;
      return {
        _id: goal._id,
        title: goal.title,
        status: effectiveGoalStatus(goal),
        category: goal.category,
        committee: goal.committeeId ? committeeNames.get(String(goal.committeeId)) ?? null : null,
        progressPercent: goal.progressPercent,
        milestones: `${goal.milestones.filter((milestone) => milestone.done).length}/${goal.milestones.length}`,
        openTasks,
        targetDate: goal.targetDate,
        startDate: goal.startDate,
        ownerName: goal.ownerName ?? null,
        description: goal.description ?? null,
        doneTasks: linkedTasks.length - openTasks,
        goal,
      };
    });
  }, [goals, tasks, committees]);

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;

  const openNew = () => {
    if (!canWrite) return;
    setForm({
      title: "",
      category: "Strategic",
      status: "NotStarted",
      startDate: todayDateOnly(),
      targetDate: new Date(Date.now() + 365 * 864e5).toISOString().slice(0, 10),
      progressPercent: 0,
      milestones: [],
      keyResults: [],
    });
    setOpen(true);
  };
  const save = async () => {
    if (!canWrite || !form) return;
    await create({ societyId: society._id, ...form });
    setOpen(false);
  };

  // The board moves a card to another status column; inline edits arrive the same way.
  const saveStatus = async ({ recordId, fieldName, value }: { recordId: string; fieldName: string; value: unknown }) => {
    const goal = goals?.find((row) => row._id === recordId);
    if (!canWrite || !goal || fieldName !== "status" || typeof value !== "string") return;
    await update({ id: goal._id, patch: { status: value } });
    const shown = effectiveGoalStatus({ ...goal, status: value });
    if (shown !== value) toast.info(`Saved as ${labelStatus(value)}`, `It still shows ${labelStatus(shown)} because its target date has passed.`);
  };

  const renderCell = ({ record, field }: { record: GoalRecord; field: FieldMetadata }) => {
    switch (field.name) {
      case "title":
        return <strong>{record.title}</strong>;
      case "status":
        return <Badge tone={goalTone(record.status)}>{labelStatus(record.status)}</Badge>;
      case "progressPercent":
        return (
          <span className="goals-progress">
            <Progress value={record.progressPercent} tone={record.status === "AtRisk" || record.status === "OffTrack" ? "warn" : undefined} />
            <span className="goals-progress__value">{record.progressPercent}%</span>
          </span>
        );
      case "openTasks":
        return (
          <Link to={`/app/tasks?goalId=${encodeURIComponent(record._id)}`} className="badge badge--info goals-tasks-link">
            <ListTodo size={12} />
            {record.openTasks} open task{record.openTasks === 1 ? "" : "s"}
            {record.doneTasks > 0 && <span className="muted"> · {record.doneTasks} done</span>}
          </Link>
        );
      default:
        return undefined;
    }
  };

  const renderPhoneCard = (record: GoalRecord, { selecting, open: openGoal }: RecordTableCardHelpers) => (
    <RecordTablePhoneCard
      title={record.title}
      badge={<Badge tone={goalTone(record.status)}>{labelStatus(record.status)}</Badge>}
      meta={[record.category, `${record.progressPercent}%`, `Target ${formatDate(record.targetDate)}`]}
      detail={[record.committee ?? "", `${record.milestones} milestones`, `${record.openTasks} open task${record.openTasks === 1 ? "" : "s"}`]}
      onOpen={openGoal}
      selecting={selecting}
    />
  );

  return (
    <div className="page">
      <PageHeader
        title="Goals"
        icon={<Target size={16} />}
        iconColor="red"
        subtitle="Goals tracked with milestones and key results."
        actions={
          <button className="btn-action btn-action--primary" onClick={openNew} disabled={!canWrite}>
            <Plus size={12} /> New goal
          </button>
        }
      />

      <RecordListTable<GoalRecord>
        table={GOALS_TABLE}
        tableId="goals"
        label="Goals"
        icon={<Target size={14} />}
        records={records}
        loading={goals === undefined}
        onOpen={(record) => navigate(`/app/goals/${record._id}`)}
        onUpdate={canWrite ? saveStatus : undefined}
        renderCell={renderCell}
        renderPhoneCard={renderPhoneCard}
        showTotals={false}
        emptyState={
          <RecordTableEmpty
            title="No goals yet"
            description={canWrite ? "Set a goal with a target date, then track its milestones and key results." : undefined}
          />
        }
      />

      <Drawer
        open={open && canWrite}
        onClose={() => setOpen(false)}
        title="New goal"
        footer={
          <>
            <button className="btn" onClick={() => setOpen(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={save} disabled={!canWrite}>Create</button>
          </>
        }
      >
        {form && (
          <div>
            <Field label="Title"><input className="input" value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })} /></Field>
            <Field label="Description"><MarkdownEditor rows={4} value={form.description ?? ""} onChange={(markdown) => setForm({ ...form, description: markdown })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Category">
                <Select
                  value={form.category}
                  onChange={(v) => setForm({ ...form, category: v })}
                  options={CATEGORIES.map((c) => ({ value: c, label: c }))}
                />
              </Field>
              <Field label="Status">
                <Select
                  value={form.status}
                  onChange={(v) => setForm({ ...form, status: v })}
                  options={STATUSES.map((s) => ({ value: s, label: labelStatus(s) }))}
                />
              </Field>
            </div>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Start">
                <DatePicker value={form.startDate} onChange={(v) => setForm({ ...form, startDate: v })} />
              </Field>
              <Field label="Target">
                <DatePicker value={form.targetDate} onChange={(v) => setForm({ ...form, targetDate: v })} />
              </Field>
            </div>
            <Field label="Committee (optional)">
              <Select
                value={form.committeeId ?? ""}
                onChange={(v) => setForm({ ...form, committeeId: v || undefined })}
                clearable
                searchable
                options={(committees ?? []).map((c) => ({ value: c._id, label: c.name }))}
              />
            </Field>
            <Field label="Owner"><input className="input" value={form.ownerName ?? ""} onChange={(e) => setForm({ ...form, ownerName: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

export { effectiveGoalStatus, goalTone, labelStatus };
