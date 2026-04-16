import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "../../convex/_generated/api";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge, Drawer, Field } from "../components/ui";
import { Tabs, Progress, AvatarGroup } from "../components/primitives";
import { Select } from "../components/Select";
import { DatePicker } from "../components/DatePicker";
import { useConfirm } from "../components/Modal";
import { useToast } from "../components/Toast";
import { ArrowLeft, Users, ListTodo, Target, Calendar, Plus, FileText, Trash2 } from "lucide-react";
import { formatDateTime, formatDate, initials } from "../lib/format";

type Tab = "overview" | "members" | "meetings" | "tasks" | "goals";

export function CommitteeDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const detail = useQuery(api.committees.detail, id ? { id: id as Id<"committees"> } : "skip");
  const directors = useQuery(api.directors.list, society ? { societyId: society._id } : "skip");
  const update = useMutation(api.committees.update);
  const addMember = useMutation(api.committees.addMember);
  const removeMember = useMutation(api.committees.removeMember);
  const createTask = useMutation(api.tasks.create);
  const updateTask = useMutation(api.tasks.update);
  const confirm = useConfirm();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("overview");
  const [memberDrawer, setMemberDrawer] = useState(false);
  const [memberForm, setMemberForm] = useState<any>(null);
  const [taskDrawer, setTaskDrawer] = useState(false);
  const [taskForm, setTaskForm] = useState<any>(null);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!detail) return <div className="page">Loading…</div>;

  const { committee, members, meetings, tasks, goals } = detail;
  const openTasks = tasks.filter((t: any) => t.status !== "Done").length;

  const saveMember = async () => {
    await addMember({
      committeeId: committee._id,
      societyId: society._id,
      name: memberForm.name,
      email: memberForm.email,
      role: memberForm.role,
      directorId: memberForm.directorId || undefined,
    });
    setMemberDrawer(false);
  };
  const saveTask = async () => {
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

  return (
    <div className="page">
      <Link to="/app/committees" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All committees
      </Link>
      <PageHeader
        title={
          (
            <span className="row" style={{ gap: 10 }}>
              <span className="color-chip" style={{ background: committee.color, width: 14, height: 14 }} />
              {committee.name}
            </span>
          ) as any
        }
        subtitle={committee.description}
        actions={
          <>
            <Badge>{committee.cadence}</Badge>
            <Badge tone={committee.status === "Active" ? "success" : "warn"}>{committee.status}</Badge>
          </>
        }
      />

      <Tabs<Tab>
        value={tab}
        onChange={setTab}
        items={[
          { id: "overview", label: "Overview" },
          { id: "members", label: "Members", count: members.length, icon: <Users size={12} /> },
          { id: "meetings", label: "Meetings", count: meetings.length, icon: <Calendar size={12} /> },
          { id: "tasks", label: "Tasks", count: openTasks || null, icon: <ListTodo size={12} /> },
          { id: "goals", label: "Goals", count: goals.length, icon: <Target size={12} /> },
        ]}
      />

      {tab === "overview" && (
        <div className="two-col">
          <div className="col" style={{ gap: 16 }}>
            <div className="card">
              <div className="card__head"><h2 className="card__title">Mission</h2></div>
              <div className="card__body">{committee.mission || <span className="muted">No mission set.</span>}</div>
            </div>
            <div className="card">
              <div className="card__head"><h2 className="card__title">Cadence</h2></div>
              <div className="card__body col">
                <div className="row" style={{ gap: 10 }}>
                  <Badge tone="accent">{committee.cadence}</Badge>
                  {committee.nextMeetingAt && (
                    <span className="muted">Next: {formatDateTime(committee.nextMeetingAt)}</span>
                  )}
                </div>
                {committee.cadenceNotes && <div className="muted">{committee.cadenceNotes}</div>}
              </div>
            </div>
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
                <AvatarGroup names={members.map((m: any) => m.name)} max={8} />
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{members.length} member{members.length === 1 ? "" : "s"}</div>
              </div>
            </div>
            <div className="card">
              <div className="card__head"><h2 className="card__title">Open tasks</h2></div>
              <div className="card__body col">
                {tasks.filter((t: any) => t.status !== "Done").slice(0, 5).map((t: any) => (
                  <div key={t._id} className="row" style={{ padding: 6, border: "1px solid var(--border)", borderRadius: 4 }}>
                    <span className={`priority-dot priority-${t.priority}`} />
                    <span style={{ flex: 1 }}>{t.title}</span>
                    <Badge>{t.status}</Badge>
                  </div>
                ))}
                {tasks.filter((t: any) => t.status !== "Done").length === 0 && <div className="muted">Nothing open.</div>}
              </div>
            </div>
          </div>
        </div>
      )}

      {tab === "members" && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Members</h2>
            <div style={{ marginLeft: "auto" }}>
              <button className="btn btn--accent btn--sm" onClick={() => {
                setMemberForm({ name: "", email: "", role: "Member", directorId: "" });
                setMemberDrawer(true);
              }}>
                <Plus size={12} /> Add member
              </button>
            </div>
          </div>
          <table className="table">
            <thead><tr><th>Name</th><th>Role</th><th>Joined</th><th>Email</th><th /></tr></thead>
            <tbody>
              {members.map((m: any) => (
                <tr key={m._id}>
                  <td>
                    <div className="row">
                      <span className="avatar">{initials(m.name.split(" ")[0], m.name.split(" ")[1])}</span>
                      <strong>{m.name}</strong>
                    </div>
                  </td>
                  <td><Badge tone={m.role === "Chair" ? "accent" : "neutral"}>{m.role}</Badge></td>
                  <td className="table__cell--mono">{formatDate(m.joinedAt)}</td>
                  <td className="muted">{m.email ?? "—"}</td>
                  <td className="table__actions">
                    <button
                      className="btn btn--ghost btn--sm btn--icon"
                      aria-label={`Remove ${m.name} from committee`}
                      onClick={async () => {
                        const ok = await confirm({
                          title: "Remove member?",
                          message: `${m.name} will no longer be a committee member.`,
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
              {members.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No members yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "meetings" && (
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
                    <td className="table__cell--mono">{formatDateTime(m.scheduledAt)}</td>
                    <td>{m.location ?? "—"} {m.electronic && <Badge tone="info">Electronic</Badge>}</td>
                    <td><Badge tone={m.status === "Held" ? "success" : "warn"}>{m.status}</Badge></td>
                    <td>{m.minutesId ? <Badge tone="success">Recorded</Badge> : <span className="muted">—</span>}</td>
                  </tr>
                ))}
              {meetings.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No meetings yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "tasks" && (
        <div className="card">
          <div className="card__head">
            <h2 className="card__title">Tasks</h2>
            <div style={{ marginLeft: "auto" }}>
              <button className="btn btn--accent btn--sm" onClick={() => {
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
              {tasks.map((t: any) => (
                <tr key={t._id}>
                  <td><span className={`priority-dot priority-${t.priority}`} /></td>
                  <td><strong>{t.title}</strong>{t.description && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{t.description}</div>}</td>
                  <td>{t.assignee ?? "—"}</td>
                  <td className="table__cell--mono">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                  <td>
                    <Select
                      size="sm"
                      value={t.status}
                      onChange={(v) => updateTask({ id: t._id, patch: { status: v } })}
                      style={{ width: 120 }}
                      options={["Todo", "InProgress", "Blocked", "Done"].map((s) => ({ value: s, label: s }))}
                    />
                  </td>
                </tr>
              ))}
              {tasks.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No tasks yet.</td></tr>}
            </tbody>
          </table>
        </div>
      )}

      {tab === "goals" && (
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
      )}

      <Drawer
        open={memberDrawer}
        onClose={() => setMemberDrawer(false)}
        title="Add committee member"
        footer={
          <>
            <button className="btn" onClick={() => setMemberDrawer(false)}>Cancel</button>
            <button className="btn btn--accent" onClick={saveMember}>Add</button>
          </>
        }
      >
        {memberForm && (
          <div>
            <Field label="Link to existing director (optional)">
              <Select
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
            <Field label="Name"><input className="input" value={memberForm.name} onChange={(e) => setMemberForm({ ...memberForm, name: e.target.value })} /></Field>
            <Field label="Email"><input className="input" value={memberForm.email} onChange={(e) => setMemberForm({ ...memberForm, email: e.target.value })} /></Field>
            <Field label="Role">
              <Select
                value={memberForm.role}
                onChange={(v) => setMemberForm({ ...memberForm, role: v })}
                options={["Chair", "Vice-Chair", "Secretary", "Treasurer", "Member", "Volunteer"].map((r) => ({ value: r, label: r }))}
              />
            </Field>
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
            <button className="btn btn--accent" onClick={saveTask}>Create</button>
          </>
        }
      >
        {taskForm && (
          <div>
            <Field label="Title"><input className="input" value={taskForm.title} onChange={(e) => setTaskForm({ ...taskForm, title: e.target.value })} /></Field>
            <Field label="Description"><textarea className="textarea" value={taskForm.description ?? ""} onChange={(e) => setTaskForm({ ...taskForm, description: e.target.value })} /></Field>
            <div className="row" style={{ gap: 12 }}>
              <Field label="Status">
                <Select
                  value={taskForm.status}
                  onChange={(v) => setTaskForm({ ...taskForm, status: v })}
                  options={["Todo", "InProgress", "Blocked", "Done"].map((s) => ({ value: s, label: s }))}
                />
              </Field>
              <Field label="Priority">
                <Select
                  value={taskForm.priority}
                  onChange={(v) => setTaskForm({ ...taskForm, priority: v })}
                  options={["Low", "Medium", "High", "Urgent"].map((p) => ({ value: p, label: p }))}
                />
              </Field>
              <Field label="Due">
                <DatePicker value={taskForm.dueDate ?? ""} onChange={(v) => setTaskForm({ ...taskForm, dueDate: v })} />
              </Field>
            </div>
            <Field label="Assignee"><input className="input" value={taskForm.assignee ?? ""} onChange={(e) => setTaskForm({ ...taskForm, assignee: e.target.value })} /></Field>
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
