import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery } from "convex/react";
import { api } from "@/lib/convexApi";
import { Id } from "../../convex/_generated/dataModel";
import { useSociety } from "../hooks/useSociety";
import { SeedPrompt, PageHeader } from "./_helpers";
import { Badge } from "../components/ui";
import { Progress } from "../components/primitives";
import { Select } from "../components/Select";
import { Checkbox } from "../components/Controls";
import { ArrowLeft, Target } from "lucide-react";
import { formatDate } from "../lib/format";
import { goalTone, labelStatus } from "./Goals";

export function GoalDetailPage() {
  const { id } = useParams<{ id: string }>();
  const society = useSociety();
  const goal = useQuery(api.goals.get, id ? { id: id as Id<"goals"> } : "skip");
  const committees = useQuery(api.committees.list, society ? { societyId: society._id } : "skip");
  const allTasks = useQuery(api.tasks.list, society ? { societyId: society._id } : "skip");
  const toggleMilestone = useMutation(api.goals.toggleMilestone);
  const update = useMutation(api.goals.update);

  if (society === undefined) return <div className="page">Loading…</div>;
  if (society === null) return <SeedPrompt />;
  if (!goal) return <div className="page">Loading…</div>;

  const committee = (committees ?? []).find((c: any) => c._id === goal.committeeId);
  const tasks = (allTasks ?? []).filter((t: any) => t.goalId === goal._id);
  const doneMs = goal.milestones.filter((m: any) => m.done).length;

  return (
    <div className="page">
      <Link to="/app/goals" className="row muted" style={{ marginBottom: 12, fontSize: "var(--fs-sm)" }}>
        <ArrowLeft size={12} /> All goals
      </Link>
      <PageHeader
        title={goal.title}
        subtitle={goal.description}
        actions={
          <>
            <Badge>{goal.category}</Badge>
            <Badge tone={goalTone(goal.status)}>{labelStatus(goal.status)}</Badge>
          </>
        }
      />

      <div className="two-col">
        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Progress</h2>
              <span className="card__subtitle">{goal.progressPercent}% · {doneMs}/{goal.milestones.length} milestones</span>
            </div>
            <div className="card__body">
              <Progress value={goal.progressPercent} tone={goal.status === "AtRisk" || goal.status === "OffTrack" ? "warn" : undefined} />
              <div className="row" style={{ marginTop: 10, gap: 6 }}>
                <input
                  type="range"
                  min={0}
                  max={100}
                  step={5}
                  value={goal.progressPercent}
                  onChange={(e) => update({ id: goal._id, patch: { progressPercent: Number(e.target.value) } })}
                  style={{ flex: 1 }}
                />
                <span className="mono" style={{ minWidth: 40, textAlign: "right" }}>{goal.progressPercent}%</span>
              </div>
            </div>
          </div>

          <div className="card">
            <div className="card__head"><h2 className="card__title">Milestones</h2></div>
            <div className="card__body col">
              {goal.milestones.map((m: any, i: number) => (
                <div key={i} className="row" style={{ padding: 8, border: "1px solid var(--border)", borderRadius: 4, gap: 8 }}>
                  <Checkbox
                    checked={!!m.done}
                    onChange={() => toggleMilestone({ id: goal._id, index: i })}
                    bare
                  />
                  <span style={{ flex: 1, textDecoration: m.done ? "line-through" : "none", color: m.done ? "var(--text-tertiary)" : undefined }}>{m.title}</span>
                  {m.dueDate && <span className="mono muted" style={{ fontSize: "var(--fs-sm)" }}>{formatDate(m.dueDate)}</span>}
                </div>
              ))}
              {goal.milestones.length === 0 && <div className="muted">No milestones yet.</div>}
            </div>
          </div>

          {goal.keyResults.length > 0 && (
            <div className="card">
              <div className="card__head"><h2 className="card__title">Key results</h2></div>
              <div className="card__body col">
                {goal.keyResults.map((kr: any, i: number) => {
                  const pct = Math.round((kr.currentValue / Math.max(kr.targetValue, 1)) * 100);
                  return (
                    <div key={i} className="col" style={{ gap: 6 }}>
                      <div className="row">
                        <span style={{ flex: 1 }}>{kr.description}</span>
                        <span className="mono">{kr.currentValue.toLocaleString()} / {kr.targetValue.toLocaleString()} {kr.unit}</span>
                      </div>
                      <Progress value={pct} />
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          <div className="card">
            <div className="card__head"><h2 className="card__title">Linked tasks</h2></div>
            <table className="table">
              <thead><tr><th /><th>Title</th><th>Assignee</th><th>Status</th><th>Due</th></tr></thead>
              <tbody>
                {tasks.map((t: any) => (
                  <tr key={t._id}>
                    <td><span className={`priority-dot priority-${t.priority}`} /></td>
                    <td>{t.title}</td>
                    <td>{t.assignee ?? "—"}</td>
                    <td><Badge tone={t.status === "Done" ? "success" : t.status === "Blocked" ? "danger" : "info"}>{t.status}</Badge></td>
                    <td className="table__cell--mono">{t.dueDate ? formatDate(t.dueDate) : "—"}</td>
                  </tr>
                ))}
                {tasks.length === 0 && <tr><td colSpan={5} className="muted" style={{ textAlign: "center", padding: 24 }}>No tasks linked.</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        <div className="col" style={{ gap: 16 }}>
          <div className="card">
            <div className="card__head"><h2 className="card__title">Details</h2></div>
            <div className="card__body col">
              <Row label="Owner">{goal.ownerName ?? "—"}</Row>
              <Row label="Start">{formatDate(goal.startDate)}</Row>
              <Row label="Target">{formatDate(goal.targetDate)}</Row>
              <Row label="Category">{goal.category}</Row>
              <Row label="Status">
                <Select
                  size="sm"
                  value={goal.status}
                  onChange={(v) => update({ id: goal._id, patch: { status: v } })}
                  style={{ width: 140, maxWidth: "100%" }}
                  options={[
                    { value: "NotStarted", label: "Not started" },
                    { value: "OnTrack", label: "On track" },
                    { value: "AtRisk", label: "At risk" },
                    { value: "OffTrack", label: "Off track" },
                    { value: "Completed", label: "Completed" },
                  ]}
                />
              </Row>
              {committee && (
                <Row label="Committee">
                  <Link to={`/app/committees/${committee._id}`} className="row" style={{ gap: 6 }}>
                    <span className="color-chip" style={{ background: committee.color }} />
                    {committee.name}
                  </Link>
                </Row>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="row">
      <span className="muted" style={{ minWidth: 100 }}>{label}</span>
      <span style={{ flex: 1 }}>{children}</span>
    </div>
  );
}
