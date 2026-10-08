import { calendarDateKey } from "../lib/calendarDates";
import { useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { useQuery } from "convex/react";
import { useRecordQuery } from "../hooks/useRecordQuery";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { usePermissions } from "../hooks/usePermissions";
import { usePermissionedMutation } from "../hooks/usePermissionedMutation";
import { useSociety } from "../hooks/useSociety";
import { PageLoading, SeedPrompt } from "./_helpers";
import { Badge, Drawer, EmptyState, Field } from "../components/ui";
import { RecordShowPage } from "../components/RecordShowPage";
import { ActivityTimeline } from "../components/ActivityTimeline";
import { NotesPanel } from "../components/NotesPanel";
import { useTrackRecentRecord } from "../hooks/useTrackRecentRecord";
import { Progress, AvatarGroup } from "../components/primitives";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { ArrowLeft, Users, ListTodo, Target, Calendar, Plus, FileText, Trash2, Pencil, Activity, MessageSquare } from "lucide-react";
import { formatDateTime, formatDate, initials } from "../lib/format";
import { MarkdownEditor } from "../components/MarkdownEditor";
import { CommitteeStructureCard } from "../features/committees/CommitteeStructureCard";
import { UnsupportedDetailsBadge } from "../components/UnsupportedDetailsBadge";
import { formatMeetingDate } from "../../shared/meetingDates";
import { PersonPicker, useDirectoryPeople } from "../components/PersonPicker";
import { BuildRostersButton } from "../features/committees/BuildRostersButton";
import { TASK_CREATE_STATUSES, TASK_STATUSES, isHistoricalSourceAction, isOpenOperationalTask, taskStatusLabel } from "../../shared/taskStatus";

const isPartialDate = (value?: string) => !value || /^\d{4}(-\d{2}(-\d{2})?)?$/.test(value);
const displayDate = (value?: string) => !value ? "—" : /^\d{4}(-\d{2})?$/.test(value) ? value : formatDate(value);
const committeeStatusLabel = (status: string) => status === "NeedsReview" ? "Needs review" : status;
const cadenceLabel = (cadence?: string) => !cadence || cadence === "Unknown" ? "Cadence not set" : cadence;

export function CommitteeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const { loaded, can } = usePermissions();
  const canWrite = loaded && can("committees:write");
  const canWriteTasks = loaded && can("tasks:write");
  const detail = useRecordQuery<any>(api.committees.detail, id ? { id: id as Id<"committees"> } : "skip");
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const addMember = usePermissionedMutation(api.committees.addMember, canWrite);
  const removeMember = usePermissionedMutation(api.committees.removeMember, canWrite);
  const updateMember = usePermissionedMutation(api.committees.updateMember, canWrite);
  const people = useDirectoryPeople(society?._id);
  const removeCommittee = usePermissionedMutation(api.committees.remove, canWrite);
  const navigate = useNavigate();
  const createTask = usePermissionedMutation(api.tasks.create, canWriteTasks);
  const updateTask = usePermissionedMutation(api.tasks.update, canWriteTasks);
  const confirm = useConfirm();
  const toast = useToast();
  const [memberDrawer, setMemberDrawer] = useState(false);
  const [memberForm, setMemberForm] = useState<any>(null);
  const [taskDrawer, setTaskDrawer] = useState(false);
  const [taskForm, setTaskForm] = useState<any>(null);

  const recentCommittee = detail?.committee;
  useTrackRecentRecord(
    "committee",
    recentCommittee?._id ? String(recentCommittee._id) : null,
    recentCommittee?.name ?? null,
    recentCommittee?._id ? `/app/committees/${recentCommittee._id}` : null,
  );

  if (society === undefined) return <PageLoading />;
  if (society === null) return <SeedPrompt />;
  if (detail === undefined) return <PageLoading />;
  if (detail === null) {
    return (
      <div className="page">
        <EmptyState
          icon={<Users size={18} />}
          title="Committee not found"
          description="This committee may have been deleted, or the link is out of date."
          action={
            <Link className="btn btn--accent" to="/app/committees">
              Back to committees
            </Link>
          }
        />
      </div>
    );
  }

  const { committee, members, meetings, tasks, goals } = detail;
  const operationalTasks = tasks.filter((t: any) => !isHistoricalSourceAction(t));
  const historicalTaskCount = tasks.length - operationalTasks.length;
  const openTaskRows = tasks.filter((t: any) => isOpenOperationalTask(t));
  const openTasks = openTaskRows.length;
  const currentMembers = members.filter((m: any) => !m.leftAt);
  const pendingMembers = members.filter((m: any) => m.reviewStatus === "pending").length;
  const sortedMembers = [...members].sort((a: any, b: any) => Number(!!a.leftAt) - Number(!!b.leftAt) || String(a.name).localeCompare(String(b.name)));
  const memberDatesValid = memberForm ? isPartialDate(memberForm.joinedAt) && isPartialDate(memberForm.leftAt) && (!memberForm.leftAt || !memberForm.joinedAt || memberForm.leftAt >= memberForm.joinedAt) : false;

  const saveMember = async () => {
    if (!canWrite || !memberForm) return;
    if (!memberForm.name.trim()) { toast.error("A committee member needs a name"); return; }
    if (!memberDatesValid) { toast.error("Check the joined and left dates"); return; }
    try {
      if (memberForm._id) {
        await updateMember({
          id: memberForm._id,
          patch: {
            name: memberForm.name,
            email: memberForm.email,
            role: memberForm.role,
            directorId: memberForm.directorId || null,
            personId: memberForm.personId || null,
            representedOrganization: memberForm.representedOrganization,
            joinedAt: memberForm.joinedAt,
            leftAt: memberForm.leftAt || null,
            reviewStatus: memberForm.reviewStatus,
          },
        });
      } else {
        await addMember({
          committeeId: committee._id,
          societyId: society._id,
          name: memberForm.name,
          email: memberForm.email || undefined,
          role: memberForm.role,
          directorId: memberForm.directorId || undefined,
          personId: memberForm.personId || undefined,
          representedOrganization: memberForm.representedOrganization || undefined,
          joinedAt: memberForm.joinedAt || undefined,
          leftAt: memberForm.leftAt || undefined,
        });
      }
      setMemberDrawer(false);
      toast.success(memberForm._id ? "Member updated" : "Member added", memberForm.name);
    } catch (error) {
      toast.error("Could not save member", error instanceof Error ? error.message : "Please try again.");
    }
  };
  const saveTask = async () => {
    if (!canWriteTasks || !taskForm) return;
    await createTask({
      societyId: society._id,
      title: taskForm.title,
      description: taskForm.description,
      status: taskForm.status,
      priority: taskForm.priority,
      assignee: taskForm.assignee,
      dueDate: taskForm.dueDate,
      committeeId: committee._id,
      tags: taskForm.tags ?? [],
    });
    setTaskDrawer(false);
  };

  const overviewContent = (
        <div className="two-col">
          <div className="col" style={{ gap: 16 }}>
            <div className="card">
              <div className="card__head"><h2 className="card__title">Mission</h2></div>
              <div className="card__body">{committee.mission || <span className="muted">No mission set.</span>}</div>
            </div>
            <CommitteeStructureCard committee={committee} canWrite={canWrite} societyId={society._id} />
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">Goals</h2>
                <Link to="/app/goals" className="card__subtitle" style={{ marginLeft: "auto" }}>All goals</Link>
              </div>
              <div className="card__body col">
                {goals.length === 0 && <div className="muted">No goals yet.</div>}
                {goals.map((g: any) => (
                  <Link key={g._id} to={`/app/goals/${g._id}`} className="col" style={{ padding: 10, border: "1px solid var(--border)", borderRadius: 6, gap: 6 }}>
                    <div className="row">
                      <strong>{g.title}</strong>
                      <Badge tone={goalTone(g.status)} >{g.status}</Badge>
                    </div>
                    <div className="row" style={{ gap: 8 }}>
                      <Progress value={g.progressPercent} tone={g.status === "AtRisk" || g.status === "OffTrack" ? "warn" : undefined} />
                      <span className="mono muted" style={{ fontSize: "var(--fs-sm)", minWidth: 36, textAlign: "right" }}>{g.progressPercent}%</span>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          </div>

          <div className="col" style={{ gap: 16 }}>
            <div className="card">
              <div className="card__head"><h2 className="card__title">Roster</h2></div>
              <div className="card__body col">
                <AvatarGroup names={currentMembers.map((m: any) => m.name)} max={8} />
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{currentMembers.length} current member{currentMembers.length === 1 ? "" : "s"}{members.length > currentMembers.length ? ` · ${members.length - currentMembers.length} former` : ""}{pendingMembers ? ` · ${pendingMembers} pending review` : ""}</div>
              </div>
            </div>
            <div className="card">
              <div className="card__head"><h2 className="card__title">Open tasks</h2></div>
              <div className="card__body col">
                {openTaskRows.slice(0, 5).map((t: any) => (
                  <Link
                    key={t._id}
                    to={`/app/tasks?committeeId=${id}`}
                    className="row"
                    style={{ padding: 6, border: "1px solid var(--border)", borderRadius: 4 }}
                  >
                    <span className={`priority-dot priority-${t.priority}`} />
                    <span style={{ flex: 1 }}>{t.title}</span>
                    <Badge>{taskStatusLabel(t.status)}</Badge>
                  </Link>
                ))}
                {openTasks === 0 && <div className="muted">Nothing open.</div>}
                {historicalTaskCount > 0 && <Link className="muted" style={{ fontSize: "var(--fs-sm)" }} to={`/app/tasks?register=historical&committeeId=${committee._id}`}>{historicalTaskCount} historical source action{historicalTaskCount === 1 ? "" : "s"} from this committee's minutes</Link>}
              </div>
            </div>
          </div>
        </div>
  );
  const membersContent = (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title" style={{ whiteSpace: "nowrap" }}>Members</h2>
            <div style={{ marginLeft: "auto", flexWrap: "wrap", justifyContent: "flex-end", gap: 8 }} className="row">
              <BuildRostersButton societyId={society._id} disabled={!canWrite} createMissingCommittees={false} label="Add from roster sheets…" />
              <button className="btn btn--accent btn--sm" disabled={!canWrite} onClick={() => {
                if (!canWrite) return;
                setMemberForm({ name: "", email: "", role: "Member", directorId: "", personId: "", representedOrganization: "", joinedAt: calendarDateKey(new Date()), leftAt: "", reviewStatus: "verified" });
                setMemberDrawer(true);
              }}>
                <Plus size={12} /> Add member
              </button>
            </div>
          </div>
          {pendingMembers > 0 && (
            <p className="card__body muted" style={{ margin: 0 }}>
              {pendingMembers} member{pendingMembers === 1 ? " was" : "s were"} added from a source roster and {pendingMembers === 1 ? "is" : "are"} pending review. Open a row to confirm the person, role and dates.
            </p>
          )}
          <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Organization</th><th>Joined</th><th>Left</th><th>Review</th><th /></tr></thead>
            <tbody>
              {sortedMembers.map((m: any) => (
                <tr key={m._id} style={{ opacity: m.leftAt ? 0.7 : 1 }}>
                  <td>
                    <div className="row">
                      <span className="avatar">{initials(m.name.split(" ")[0], m.name.split(" ")[1])}</span>
                      {m.personId ? (
                        <Link to={`/app/people-directory/${m.personId}`}><strong>{m.name}</strong></Link>
                      ) : m.directorId ? (
                        <Link to="/app/directors"><strong>{m.name}</strong></Link>
                      ) : (
                        <strong>{m.name}</strong>
                      )}
                    </div>
                  </td>
                  <td><Badge tone={m.role === "Chair" ? "accent" : "neutral"}>{m.role}</Badge></td>
                  <td className="muted">{m.representedOrganization ?? "—"}</td>
                  <td className="table__cell--mono">{displayDate(m.joinedAt)}</td>
                  <td className="table__cell--mono">{m.leftAt ? displayDate(m.leftAt) : "—"}</td>
                  <td>{m.reviewStatus === "pending" ? <Badge tone="warn" >From roster · pending</Badge> : <Badge tone="success">Confirmed</Badge>}</td>
                  <td className="table__actions">
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      disabled={!canWrite}
                      aria-label={`Edit ${m.name}`}
                      onClick={() => {
                        setMemberForm({ _id: m._id, name: m.name, email: m.email ?? "", role: m.role, directorId: m.directorId ?? "", personId: m.personId ?? "", representedOrganization: m.representedOrganization ?? "", joinedAt: m.joinedAt ?? "", leftAt: m.leftAt ?? "", reviewStatus: m.reviewStatus ?? "verified", sourceReference: m.sourceReference });
                        setMemberDrawer(true);
                      }}
                    >
                      <Pencil size={12} />
                    </button>
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      disabled={!canWrite}
                      aria-label={`Remove ${m.name} from committee`}
                      onClick={async () => {
                        if (!canWrite) return;
                        const ok = await confirm({
                          title: "Remove member?",
                          message: `${m.name} will be deleted from this committee's roster, including the joined and left dates. To record that they stepped down, edit the member and set a "Left" date instead.`,
                          confirmLabel: "Remove",
                          tone: "danger",
                        });
                        if (!ok) return;
                        await removeMember({ id: m._id });
                        toast.success("Member removed");
                      }}
                    >
                      <Trash2 size={12} />
                    </button>
                  </td>
                </tr>
              ))}
              {members.length === 0 && <tr><td colSpan={7} className="muted" style={{ textAlign: "center", padding: 24 }}>No members yet. Add people, or add them from imported roster sheets.</td></tr>}
            </tbody>
          </table>
          </div>
        </div>
  );
  const meetingsContent = (
        <div className="card">
          <div className="card__head"><h2 className="card__title">Meetings</h2></div>
          <table className="table">
            <thead><tr><th>Title</th><th>When</th><th>Location</th><th>Status</th><th>Minutes</th></tr></thead>
            <tbody>
              {meetings
                .slice()
                .sort((a: any, b: any) => b.scheduledAt.localeCompare(a.scheduledAt))
                .map((m: any) => (
                  <tr key={m._id}>
                    <td><Link to={`/app/meetings/${m._id}`}><strong>{m.title}</strong></Link></td>
                    <td className="table__cell--mono">{formatMeetingDate(m)}</td>
                    <td>{m.location ?? "—"} {m.electronic && <Badge tone="info">Electronic</Badge>}</td>
                    <td><Badge tone={m.status === "Held" ? "success" : "warn"}>{m.status}</Badge></td>
                    <td>{m.status === "Held" ? <Badge tone="success">Recorded</Badge> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              {meetings.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No meetings yet.</td></tr>}
            </tbody>
          </table>
        </div>
  );
  const tasksContent = (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Tasks</h2>
            <div style={{ marginLeft: "auto" }}>
              <button className="btn btn--accent btn--sm" disabled={!canWriteTasks} onClick={() => {
                if (!canWriteTasks) return;
                setTaskForm({ title: "", status: "Todo", priority: "Medium", assignee: "", dueDate: "", tags: [] });
                setTaskDrawer(true);
              }}>
                <Plus size={12} /> Add task
              </button>
            </div>
          </div>
          <table className="table">
            <thead><tr><th /><th>Title</th><th>Assignee</th><th>Due</th><th>Status</th></tr></thead>
            <tbody>
              {operationalTasks.map((t: any) => (
                <tr key={t._id}>
                  <td><span className={`priority-dot priority-${t.priority}`} /></td>
                  <td><strong>{t.title}</strong>{t.description && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{t.description}</div>}</td>
                  <td>{t.assignee ?? "—"}</td>
                  <td className="table__cell--mono">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                  <td>
                    <Select
                      size="sm"
                      disabled={!canWriteTasks}
                      value={t.status}
                      onChange={(v) => { if (canWriteTasks) void updateTask({ id: t._id, patch: { status: v } }); }}
                      style={{ width: 120, maxWidth: "100%" }}
                      options={TASK_STATUSES.map((s) => ({ value: s, label: taskStatusLabel(s) }))}
                    />
                  </td>
                </tr>
              ))}
              {operationalTasks.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No tasks yet.{historicalTaskCount > 0 && <> <Link to={`/app/tasks?register=historical&committeeId=${committee._id}`}>See {historicalTaskCount} historical source actions</Link>.</>}</td></tr>}
            </tbody>
          </table>
        </div>
  );
  const goalsContent = (
        <div className="col" style={{ gap: 12 }}>
          {goals.map((g: any) => (
            <Link key={g._id} to={`/app/goals/${g._id}`} className="card" style={{ display: "block" }}>
              <div className="card__head">
                <h2 className="card__title">{g.title}</h2>
                <Badge tone={goalTone(g.status)}>{g.status}</Badge>
              </div>
              <div className="card__body col">
                <Progress value={g.progressPercent} tone={g.status === "AtRisk" || g.status === "OffTrack" ? "warn" : undefined} />
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{g.progressPercent}% · target {formatDate(g.targetDate)}</div>
              </div>
            </Link>
          ))}
          {goals.length === 0 && <div className="muted">No goals linked yet.</div>}
        </div>
  );

  return (
    <div className="page">
      <Link to="/app/committees" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All committees
      </Link>
      <RecordShowPage
        layout={{ societyId: society._id, pageId: "committee-detail", objectId: String(committee._id) }}
        title={committee.name}
        subtitle={committee.description}
        actions={
          <button
            className="btn-action"
            disabled={!canWrite}
            onClick={async () => {
              if (!canWrite) return;
              const ok = await confirm({
                title: "Delete committee?",
                message: `"${committee.name}" will be permanently deleted along with its membership roster. Linked meetings, tasks, and goals are kept but unlinked.`,
                confirmLabel: "Delete",
                tone: "danger",
              });
              if (!ok) return;
              await removeCommittee({ id: committee._id });
              toast.success("Committee deleted");
              navigate("/app/committees");
            }}
          >
            <Trash2 size={12} /> Delete
          </button>
        }
        // Cadence and status already lead the summary; only keep chips that
        // add something.
        chips={<UnsupportedDetailsBadge table="committees" id={committee._id} />}
        summary={[
          { label: "Cadence", value: cadenceLabel(committee.cadence) },
          { label: "Status", value: committeeStatusLabel(committee.status) },
          { label: "Members", value: currentMembers.length },
          { label: "Open tasks", value: openTasks },
          ...(committee.nextMeetingAt
            ? [{ label: "Next meeting", value: formatDateTime(committee.nextMeetingAt) }]
            : []),
        ]}
        tabs={[
          { id: "overview", label: "Overview", content: overviewContent },
          { id: "members", label: "Members", count: currentMembers.length, icon: <Users size={12} />, content: membersContent },
          { id: "meetings", label: "Meetings", count: meetings.length, icon: <Calendar size={12} />, content: meetingsContent },
          { id: "tasks", label: "Tasks", count: openTasks || null, icon: <ListTodo size={12} />, content: tasksContent },
          { id: "goals", label: "Goals", count: goals.length, icon: <Target size={12} />, content: goalsContent },
          {
            id: "notes",
            label: "Notes",
            icon: <MessageSquare size={12} />,
            content: <NotesPanel entityType="committee" entityId={String(committee._id)} />,
          },
          {
            id: "activity",
            label: "Activity",
            icon: <Activity size={12} />,
            content: <ActivityTimeline entityType="committee" entityId={String(committee._id)} />,
          },
        ]}
      />

      <Drawer
        open={memberDrawer}
        onClose={() => setMemberDrawer(false)}
        title={memberForm?._id ? "Edit committee member" : "Add committee member"}
        footer={
          <>
            <button className="btn" onClick={() => setMemberDrawer(false)}>Cancel</button>
            <button className="btn btn--accent" disabled={!canWrite || !memberForm?.name?.trim() || !memberDatesValid} onClick={saveMember}>{memberForm?._id ? "Save" : "Add"}</button>
          </>
        }
      >
        {memberForm && (
          <div>
            {memberForm.sourceReference && <p className="muted" style={{ marginTop: 0 }}>From roster source: {memberForm.sourceReference}</p>}
            <Field label="Person (people directory)">
              <PersonPicker
                people={people}
                value={memberForm.personId}
                onChange={(v) => setMemberForm({ ...memberForm, personId: v, name: v ? people?.find((p) => p._id === v)?.fullName ?? memberForm.name : memberForm.name })}
                sourceName={memberForm.name || undefined}
                ariaLabel="Committee member person"
                disabled={!canWrite}
              />
            </Field>
            <Field label="Link to existing director (optional)">
              <Select disabled={!canWrite}
                value={memberForm.directorId}
                onChange={(v) => {
                  const d = (directors ?? []).find((d: any) => d._id === v);
                  setMemberForm({
                    ...memberForm,
                    directorId: v,
                    name: d ? `${d.firstName} ${d.lastName}` : memberForm.name,
                    email: d?.email ?? memberForm.email,
                  });
                }}
                clearable
                searchable
                options={(directors ?? []).map((d: any) => ({
                  value: d._id,
                  label: `${d.firstName} ${d.lastName}`,
                  hint: d.position,
                }))}
              />
            </Field>
            <Field label="Name"><input disabled={!canWrite} className="input" value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} /></Field>
            <Field label="Email"><input disabled={!canWrite} className="input" value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} /></Field>
            <Field label="Role">
              <Select disabled={!canWrite}
                value={memberForm.role}
                onChange={(v) => setMemberForm({ ...memberForm, role: v })}
                options={Array.from(new Set(["Chair", "Vice-Chair", "Secretary", "Treasurer", "Member", "Volunteer", "Representative", "Staff", "Observer", memberForm.role].filter(Boolean))).map((r) => ({ value: r, label: r }))}
              />
            </Field>
            <Field label="Represents organization (optional)"><input disabled={!canWrite} className="input" value={memberForm.representedOrganization} onChange={(e) => setMemberForm({ ...memberForm, representedOrganization: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12, flexWrap: "wrap" }}>
              <Field label="Joined (YYYY, YYYY-MM or YYYY-MM-DD)"><input disabled={!canWrite} className="input" aria-invalid={!isPartialDate(memberForm.joinedAt)} value={memberForm.joinedAt} onChange={(e) => setMemberForm({ ...memberForm, joinedAt: e.target.value })} /></Field>
              <Field label="Left (if they stepped down)"><input disabled={!canWrite} className="input" aria-invalid={!isPartialDate(memberForm.leftAt)} value={memberForm.leftAt} onChange={(e) => setMemberForm({ ...memberForm, leftAt: e.target.value })} placeholder="e.g. 2021-12" /></Field>
            </div>
            {!memberDatesValid && <p className="muted" role="alert">Dates must be YYYY, YYYY-MM or YYYY-MM-DD, and the left date cannot be before the joined date.</p>}
            {memberForm._id && (
              <Field label="Review">
                <Select disabled={!canWrite} value={memberForm.reviewStatus} onChange={(v) => setMemberForm({ ...memberForm, reviewStatus: v })} options={[{ value: "pending", label: "Pending (from a source roster)" }, { value: "verified", label: "Confirmed" }]} />
              </Field>
            )}
          </div>
        )}
      </Drawer>

      <Drawer
        open={taskDrawer}
        onClose={() => setTaskDrawer(false)}
        title="New task"
        footer={
          <>
            <button className="btn" onClick={() => setTaskDrawer(false)}>Cancel</button>
            <button className="btn btn--accent" disabled={!canWriteTasks} onClick={saveTask}>Create</button>
          </>
        }
      >
        {taskForm && (
          <div>
            <Field label="Title"><input disabled={!canWriteTasks} className="input" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} /></Field>
            <Field label="Description"><MarkdownEditor readOnly={!canWriteTasks} rows={4} value={taskForm.description ?? ""} onChange={(markdown) => setTaskForm({ ...taskForm, description: markdown })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select disabled={!canWriteTasks}
                  value={taskForm.status}
                  onChange={(v) => setTaskForm({ ...taskForm, status: v })}
                  options={TASK_CREATE_STATUSES.map((s) => ({ value: s, label: taskStatusLabel(s) }))}
                />
              </Field>
              <Field label="Priority">
                <Select disabled={!canWriteTasks}
                  value={taskForm.priority}
                  onChange={(v) => setTaskForm({ ...taskForm, priority: v })}
                  options={["Low", "Medium", "High", "Urgent"].map((p) => ({ value: p, label: p }))}
                />
              </Field>
              <Field label="Due">
                <DatePicker disabled={!canWriteTasks} value={taskForm.dueDate ?? ""} onChange={(v) => setTaskForm({ ...taskForm, dueDate: v })} />
              </Field>
            </div>
            <Field label="Assignee"><input disabled={!canWriteTasks} className="input" value={taskForm.assignee ?? ""} onChange={(e) => setTaskForm({ ...taskForm, assignee: e.target.value })} /></Field>
          </div>
        )}
      </Drawer>
    </div>
  );
}

function goalTone(status: string) {
  return status === "OnTrack" || status === "Completed"
    ? ("success" as const)
    : status === "AtRisk"
      ? ("warn" as const)
      : status === "OffTrack"
        ? ("danger" as const)
        : ("neutral" as const);
}
