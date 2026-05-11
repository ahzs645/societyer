import { useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, Download, ExternalLink, FileText, ListChecks, Plus, ShieldCheck, Unlink, X } from "lucide-react";
import { Badge } from "../../../components/ui";
import { Segmented } from "../../../components/primitives";
import { formatDate } from "../../../lib/format";

const TASK_STATUS_ITEMS: { id: string; label: string }[] = [
  { id: "Todo", label: "To do" },
  { id: "InProgress", label: "In progress" },
  { id: "Blocked", label: "Blocked" },
  { id: "Done", label: "Done" },
];
const TASK_PRIORITIES = ["Low", "Medium", "High"] as const;

function priorityTone(priority?: string) {
  if (priority === "High") return "danger" as const;
  if (priority === "Medium") return "warn" as const;
  return "neutral" as const;
}
import {
  accessLevelLabel,
  availabilityLabel,
  availabilityTone,
  isMaterialExpired,
  materialAccessSummary,
  materialEffectiveStatus,
  syncLabel,
  syncTone,
} from "../lib/meetingMaterialAccess";
import { Select } from "../../../components/Select";
import {
  Detail,
  packageReviewLabel,
  packageReviewTone,
  sourceReviewLabel,
  sourceReviewTone,
} from "./MeetingDetailSupport";

export function MeetingPackageHub({
  meeting,
  minutes,
  agenda,
  packageMaterials,
  linkedTasks,
  linkableTasks,
  joinDetails,
  packageReadiness,
  sourceReviewStatus,
  packageReviewStatus,
  packageReviewBlockers,
  sourceReviewNote,
  packageReviewNote,
  setSourceReviewNote,
  setPackageReviewNote,
  openMaterialDrawer,
  startJoinEdit,
  downloadMeetingPack,
  downloadOutboxPackage,
  completeSourceReview,
  reopenSourceReview,
  markPackageReady,
  sendPackageBackToReview,
  removeMeetingMaterial,
  setLinkedTaskStatus,
  linkTaskToMeeting,
  unlinkTaskFromMeeting,
  createTaskForMeeting,
}: {
  meeting: any;
  minutes: any;
  agenda: string[];
  packageMaterials: any[];
  linkedTasks: any[];
  linkableTasks: any[];
  joinDetails: any;
  packageReadiness: any;
  sourceReviewStatus: string;
  packageReviewStatus: string;
  packageReviewBlockers: string[];
  sourceReviewNote: string;
  packageReviewNote: string;
  setSourceReviewNote: (value: string) => void;
  setPackageReviewNote: (value: string) => void;
  openMaterialDrawer: (agendaLabel?: string, material?: any) => void;
  startJoinEdit: () => void;
  downloadMeetingPack: () => void;
  downloadOutboxPackage: () => void;
  completeSourceReview: () => void | Promise<void>;
  reopenSourceReview: () => void | Promise<void>;
  markPackageReady: () => void | Promise<void>;
  sendPackageBackToReview: () => void | Promise<void>;
  removeMeetingMaterial: (args: { id: any }) => void | Promise<void>;
  setLinkedTaskStatus: (taskId: string, status: string) => void | Promise<void>;
  linkTaskToMeeting: (taskId: string) => void | Promise<void>;
  unlinkTaskFromMeeting: (taskId: string) => void | Promise<void>;
  createTaskForMeeting: (input: { title: string; priority: string; status: string; dueDate?: string }) => void | Promise<void>;
}) {
  const [creatingTask, setCreatingTask] = useState(false);
  const [taskDraft, setTaskDraft] = useState({ title: "", priority: "Medium", status: "Todo", dueDate: "" });
  const [pickerValue, setPickerValue] = useState("");
  const todayISO = new Date().toISOString().slice(0, 10);
  const sortedLinkedTasks = [...linkedTasks].sort((a, b) => {
    if (a.status === "Done" && b.status !== "Done") return 1;
    if (b.status === "Done" && a.status !== "Done") return -1;
    return String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""));
  });
  const taskCounts = {
    Todo: linkedTasks.filter((task) => task.status === "Todo").length,
    InProgress: linkedTasks.filter((task) => task.status === "InProgress").length,
    Blocked: linkedTasks.filter((task) => task.status === "Blocked").length,
    Done: linkedTasks.filter((task) => task.status === "Done").length,
  };
  const submitTaskDraft = async () => {
    const title = taskDraft.title.trim();
    if (!title) return;
    await createTaskForMeeting({
      title,
      priority: taskDraft.priority,
      status: taskDraft.status,
      dueDate: taskDraft.dueDate || undefined,
    });
    setTaskDraft({ ...taskDraft, title: "" });
  };
  const handlePick = async (value: string) => {
    setPickerValue("");
    if (!value) return;
    await linkTaskToMeeting(value);
  };
  const topics = Array.from(new Set(agenda.length ? agenda : ["General materials"]));
  const materialsForTopic = (topic: string) =>
    packageMaterials.filter((material: any) => (material.agendaLabel || "General materials") === topic);
  const topicsWithMaterials = topics.filter((topic) => materialsForTopic(topic).length > 0);
  const emptyTopics = topics.filter((topic) => materialsForTopic(topic).length === 0);
  const unmappedMaterials = packageMaterials.filter((material: any) => {
    const label = material.agendaLabel || "General materials";
    return !topics.includes(label);
  });

  return (
      <div className="card" style={{ marginBottom: 16 }}>
        <div className="card__head">
          <div>
            <h2 className="card__title">Meeting package hub</h2>
            <p className="card__subtitle">
              Agenda topics, linked materials, attendees, join details, minutes, and open actions.
            </p>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
            <button className="btn-action" onClick={() => openMaterialDrawer()}>
              <FileText size={12} /> Add material
            </button>
            <button className="btn-action" onClick={startJoinEdit}>
              <ExternalLink size={12} /> {joinDetails.url ? "Edit join link" : "Add join link"}
            </button>
            <button className="btn-action btn-action--primary" onClick={downloadMeetingPack}>
              <Download size={12} /> Download pack
            </button>
            <button className="btn-action btn-action--primary" onClick={downloadOutboxPackage}>
              <Download size={12} /> Outbox ZIP
            </button>
          </div>
        </div>
        <div className="card__body meeting-package-body">
          <div className="meeting-package-stack">
          <div className="panel meeting-package-gate">
            <div className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <strong>
                  <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                  Governance review gate
                </strong>
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                  Source data, required materials, and board package readiness.
                </div>
              </div>
              <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                {(sourceReviewStatus === "imported_needs_review" ||
                  sourceReviewStatus === "rejected" ||
                  sourceReviewStatus === "source_reviewed") && (
                  <Badge tone={sourceReviewTone(sourceReviewStatus)}>{sourceReviewLabel(sourceReviewStatus)}</Badge>
                )}
                <Badge tone={packageReviewTone(packageReviewStatus)}>{packageReviewLabel(packageReviewStatus)}</Badge>
                {packageReviewBlockers.length > 0 && (
                  <Badge tone="warn">
                    <AlertTriangle size={10} style={{ marginRight: 3, verticalAlign: -1 }} />
                    {packageReviewBlockers.length} blocker{packageReviewBlockers.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            </div>

            <div className="meeting-package-drawers">
              {(sourceReviewStatus === "imported_needs_review" ||
                sourceReviewStatus === "rejected" ||
                sourceReviewStatus === "source_reviewed" ||
                !!meeting.sourceReviewNotes ||
                !!minutes?.sourceReviewNotes) && (
                <details className="meeting-package-drawer">
                  <summary className="meeting-package-drawer__summary">
                    <span className="meeting-package-drawer__title">Source review</span>
                    <Badge tone={sourceReviewTone(sourceReviewStatus)}>{sourceReviewLabel(sourceReviewStatus)}</Badge>
                  </summary>
                  <div className="meeting-package-drawer__body">
                    {(meeting.sourceReviewNotes || minutes?.sourceReviewNotes) && (
                      <div className="muted" style={{ fontSize: "var(--fs-sm)", whiteSpace: "pre-wrap" }}>
                        {meeting.sourceReviewNotes ?? minutes?.sourceReviewNotes}
                      </div>
                    )}
                    {(sourceReviewStatus === "imported_needs_review" || sourceReviewStatus === "rejected") && (
                      <>
                        <textarea
                          className="textarea"
                          rows={2}
                          value={sourceReviewNote}
                          onChange={(event) => setSourceReviewNote(event.target.value)}
                          placeholder="Review note"
                        />
                        <button className="btn-action btn-action--primary" onClick={completeSourceReview}>
                          <ShieldCheck size={12} /> Mark source reviewed
                        </button>
                      </>
                    )}
                    {sourceReviewStatus === "source_reviewed" && (
                      <button className="btn-action" onClick={reopenSourceReview}>
                        Reopen source review
                      </button>
                    )}
                  </div>
                </details>
              )}

              <details className="meeting-package-drawer" open={packageReviewBlockers.length > 0}>
                <summary className="meeting-package-drawer__summary">
                  <span className="meeting-package-drawer__title">Package review</span>
                  <Badge tone={packageReviewTone(packageReviewStatus)}>{packageReviewLabel(packageReviewStatus)}</Badge>
                </summary>
                <div className="meeting-package-drawer__body">
                  {packageReviewBlockers.length > 0 ? (
                    <ul style={{ margin: 0, paddingLeft: 18, color: "var(--text-secondary)", fontSize: "var(--fs-sm)" }}>
                      {packageReviewBlockers.slice(0, 4).map((blocker) => <li key={blocker}>{blocker}</li>)}
                    </ul>
                  ) : (
                    <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No package blockers detected.</div>
                  )}
                  {meeting.packageReviewNotes && (
                    <div className="muted" style={{ fontSize: "var(--fs-sm)", whiteSpace: "pre-wrap" }}>{meeting.packageReviewNotes}</div>
                  )}
                  <textarea
                    className="textarea"
                    rows={2}
                    value={packageReviewNote}
                    onChange={(event) => setPackageReviewNote(event.target.value)}
                    placeholder="Package review note"
                  />
                  <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                    <button
                      className="btn-action btn-action--primary"
                      onClick={markPackageReady}
                      disabled={packageReviewBlockers.length > 0}
                    >
                      <ClipboardCheck size={12} /> Mark package ready
                    </button>
                    {(packageReviewStatus === "ready" || packageReviewStatus === "released") && (
                      <button className="btn-action" onClick={sendPackageBackToReview}>Return to review</button>
                    )}
                  </div>
                </div>
              </details>

              {joinDetails.url && (
                <a className="btn btn--accent btn--sm meeting-package-join" href={joinDetails.url} target="_blank" rel="noreferrer">
                  <ExternalLink size={12} /> Join meeting
                </a>
              )}

              <details className="meeting-package-drawer" open={linkedTasks.length > 0}>
                <summary className="meeting-package-drawer__summary">
                  <span className="meeting-package-drawer__title">
                    <ListChecks size={12} style={{ verticalAlign: -2, marginRight: 6 }} />
                    Linked tasks
                  </span>
                  <span className="meeting-package-task-counts">
                    <Badge tone="neutral">
                      {taskCounts.Todo} To do · {taskCounts.InProgress} In progress · {taskCounts.Blocked} Blocked · {taskCounts.Done} Done
                    </Badge>
                  </span>
                </summary>
                <div className="meeting-package-drawer__body">
                  {sortedLinkedTasks.length === 0 ? (
                    <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                      No tasks linked to this meeting yet. Link an existing task or create a new one — status updates here flow back to the kanban.
                    </div>
                  ) : (
                    <div className="meeting-package-task-list">
                      {sortedLinkedTasks.map((task: any) => {
                        const overdue = task.dueDate && task.status !== "Done" && task.dueDate < todayISO;
                        return (
                          <div key={task._id} className="meeting-package-task-row">
                            <div className="meeting-package-task-row__main">
                              <Link to="/app/tasks" className="meeting-package-task-row__title">
                                {task.title}
                              </Link>
                              <div className="row" style={{ gap: 6, flexWrap: "wrap", fontSize: "var(--fs-sm)" }}>
                                <Badge tone={priorityTone(task.priority)}>{task.priority || "—"}</Badge>
                                {task.assignee && <span className="muted">· {task.assignee}</span>}
                                {task.dueDate && (
                                  <span style={{ color: overdue ? "var(--danger)" : "var(--text-tertiary)" }}>
                                    · Due {formatDate(task.dueDate)}
                                  </span>
                                )}
                              </div>
                            </div>
                            <Segmented
                              value={task.status}
                              onChange={(next) => { void setLinkedTaskStatus(task._id, next); }}
                              items={TASK_STATUS_ITEMS}
                            />
                            <button
                              className="btn-action btn-action--icon"
                              type="button"
                              title="Unlink from meeting"
                              aria-label={`Unlink ${task.title}`}
                              onClick={() => { void unlinkTaskFromMeeting(task._id); }}
                            >
                              <Unlink size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}

                  <div className="row" style={{ gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    {linkableTasks.length > 0 ? (
                      <Select value={pickerValue} onChange={value => {
  void handlePick(value);
}} options={[{
  value: "",
  label: "Link existing task…"
}, ...linkableTasks.map((task: any) => ({
  value: task._id,
  label: [task.title, task.priority ? ` · ${task.priority}` : ""].join(" ")
}))]} className="input" style={{
  flex: 1,
  minWidth: 200
}} />
                    ) : (
                      <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>No unlinked tasks available.</span>
                    )}
                    <button
                      className="btn-action"
                      type="button"
                      onClick={() => setCreatingTask((open) => !open)}
                    >
                      {creatingTask ? <X size={12} /> : <Plus size={12} />}
                      {creatingTask ? "Cancel" : "Create task"}
                    </button>
                  </div>

                  {creatingTask && (
                    <div className="meeting-package-task-create">
                      <input
                        className="input"
                        placeholder="Task title (Enter to add another)"
                        value={taskDraft.title}
                        onChange={(event) => setTaskDraft({ ...taskDraft, title: event.target.value })}
                        onKeyDown={(event) => {
                          if (event.key === "Enter" && taskDraft.title.trim()) {
                            event.preventDefault();
                            void submitTaskDraft();
                          }
                        }}
                        autoFocus
                      />
                      <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                        <Select value={taskDraft.priority} onChange={value => setTaskDraft({
  ...taskDraft,
  priority: value
})} options={[...TASK_PRIORITIES.map(priority => ({
  value: priority,
  label: priority
}))]} className="input" style={{
  width: 130
}} aria-label="Priority" />
                        <Select value={taskDraft.status} onChange={value => setTaskDraft({
  ...taskDraft,
  status: value
})} options={[...TASK_STATUS_ITEMS.map(status => ({
  value: status.id,
  label: status.label
}))]} className="input" style={{
  width: 140
}} aria-label="Status" />
                        <input
                          className="input"
                          type="date"
                          style={{ width: 150 }}
                          value={taskDraft.dueDate}
                          onChange={(event) => setTaskDraft({ ...taskDraft, dueDate: event.target.value })}
                          aria-label="Due date"
                        />
                        <button
                          className="btn-action btn-action--primary"
                          type="button"
                          onClick={submitTaskDraft}
                          disabled={!taskDraft.title.trim()}
                        >
                          <Plus size={12} /> Add task
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              </details>
            </div>
          </div>
          </div>

          <div className="meeting-package-materials">
            <div className="row" style={{ justifyContent: "space-between", gap: 8 }}>
              <div>
                <strong>Agenda materials</strong>
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                  {packageMaterials.length
                    ? `${packageMaterials.length} linked material${packageMaterials.length === 1 ? "" : "s"}`
                    : "No materials linked yet."}
                </div>
              </div>
              <button className="btn-action" onClick={() => openMaterialDrawer()}>
                <FileText size={12} /> Add material
              </button>
            </div>

            {topicsWithMaterials.map((topic, topicIndex) => (
              <div key={`${topicIndex}-${topic}`} className="meeting-package-topic">
                <div className="meeting-package-topic__head">
                  <strong>{topic}</strong>
                  <button className="btn btn--ghost btn--sm" onClick={() => openMaterialDrawer(topic)}>Add</button>
                </div>
                <div className="col" style={{ gap: 6 }}>
                  {materialsForTopic(topic).map((material: any) => {
                    const status = materialEffectiveStatus(material);
                    return (
                      <div key={material._id} className="meeting-package-material-row">
                        <FileText size={12} />
                        <div className="meeting-package-material-row__main">
                          <Link to={`/app/documents/${material.document?._id}`}>
                            {material.label || material.document?.title || "Document"}
                          </Link>
                          <span>{materialAccessSummary(material)}</span>
                        </div>
                        <Badge tone={availabilityTone(status)}>{availabilityLabel(status)}</Badge>
                        {material.syncStatus && <Badge tone={syncTone(material.syncStatus)}>{syncLabel(material.syncStatus)}</Badge>}
                        {material.requiredForMeeting && <Badge tone="warn">Required</Badge>}
                        {material.expiresAtISO && (
                          <Badge tone={isMaterialExpired(material) ? "danger" : "neutral"}>
                            Expires {formatDate(material.expiresAtISO)}
                          </Badge>
                        )}
                        <Badge tone={(material.accessGrants ?? []).length ? "info" : "neutral"}>
                          {(material.accessGrants ?? []).length ? `${material.accessGrants.length} grant${material.accessGrants.length === 1 ? "" : "s"}` : accessLevelLabel(material.accessLevel)}
                        </Badge>
                        <button className="btn btn--ghost btn--sm" onClick={() => openMaterialDrawer(material.agendaLabel, material)}>
                          Edit
                        </button>
                        <button className="btn btn--ghost btn--sm" onClick={() => removeMeetingMaterial({ id: material._id })}>
                          Remove
                        </button>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}

            {unmappedMaterials.length > 0 && (
              <div className="meeting-package-topic">
                <div className="meeting-package-topic__head"><strong>Other materials</strong></div>
                <div className="col" style={{ gap: 6 }}>
                  {unmappedMaterials.map((material: any) => {
                    const status = materialEffectiveStatus(material);
                    return (
                      <div key={material._id} className="meeting-package-material-row">
                        <FileText size={12} />
                        <div className="meeting-package-material-row__main">
                          <Link to={`/app/documents/${material.document?._id}`}>
                            {material.label || material.document?.title || "Document"}
                          </Link>
                          <span>{materialAccessSummary(material)}</span>
                        </div>
                        <Badge tone={availabilityTone(status)}>{availabilityLabel(status)}</Badge>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {packageMaterials.length === 0 && (
              <div className="meeting-package-empty">
                <FileText size={14} />
                <div>
                  <strong>No package materials linked.</strong>
                  <p>Add only the documents needed for this meeting package. Agenda topics stay collapsed until you need to map materials.</p>
                </div>
              </div>
            )}

            {emptyTopics.length > 0 && (
              <details className="meeting-package-empty-topics">
                <summary>{emptyTopics.length} agenda topic{emptyTopics.length === 1 ? "" : "s"} without linked materials</summary>
                <div className="meeting-package-topic-list">
                  {emptyTopics.map((topic, topicIndex) => (
                    <div key={`${topicIndex}-${topic}`} className="meeting-package-topic-pill">
                      <span>{topic}</span>
                      <button className="btn btn--ghost btn--sm" onClick={() => openMaterialDrawer(topic)}>Add</button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        </div>
      </div>
  );
}
