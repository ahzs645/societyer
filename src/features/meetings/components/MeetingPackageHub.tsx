import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, Download, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "../../../components/ui";
import { formatDate } from "../../../lib/format";
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
  openPackageTasks,
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
  completeSourceReview,
  reopenSourceReview,
  markPackageReady,
  sendPackageBackToReview,
  removeMeetingMaterial,
}: {
  meeting: any;
  minutes: any;
  agenda: string[];
  packageMaterials: any[];
  openPackageTasks: any[];
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
  completeSourceReview: () => void | Promise<void>;
  reopenSourceReview: () => void | Promise<void>;
  markPackageReady: () => void | Promise<void>;
  sendPackageBackToReview: () => void | Promise<void>;
  removeMeetingMaterial: (args: { id: any }) => void | Promise<void>;
}) {
  const topics = agenda.length ? agenda : ["General materials"];
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
          </div>
        </div>
        <div className="card__body meeting-package-body">
          <div className="meeting-package-grid">
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
                <Badge tone={sourceReviewTone(sourceReviewStatus)}>{sourceReviewLabel(sourceReviewStatus)}</Badge>
                <Badge tone={packageReviewTone(packageReviewStatus)}>{packageReviewLabel(packageReviewStatus)}</Badge>
                {packageReviewBlockers.length > 0 && (
                  <Badge tone="warn">
                    <AlertTriangle size={10} style={{ marginRight: 3, verticalAlign: -1 }} />
                    {packageReviewBlockers.length} blocker{packageReviewBlockers.length === 1 ? "" : "s"}
                  </Badge>
                )}
              </div>
            </div>

            <div className="meeting-package-review-grid">
              <div className="col" style={{ gap: 8 }}>
                <Detail label="Source review">
                  <Badge tone={sourceReviewTone(sourceReviewStatus)}>{sourceReviewLabel(sourceReviewStatus)}</Badge>
                </Detail>
                {(meeting.sourceReviewNotes || minutes?.sourceReviewNotes) && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", whiteSpace: "pre-wrap" }}>
                    {meeting.sourceReviewNotes ?? minutes?.sourceReviewNotes}
                  </div>
                )}
                {sourceReviewStatus === "imported_needs_review" || sourceReviewStatus === "rejected" ? (
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
                ) : sourceReviewStatus === "source_reviewed" ? (
                  <button className="btn-action" onClick={reopenSourceReview}>
                    Reopen source review
                  </button>
                ) : (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No imported source review is open.</div>
                )}
              </div>

              <div className="col" style={{ gap: 8 }}>
                <Detail label="Package review">
                  <Badge tone={packageReviewTone(packageReviewStatus)}>{packageReviewLabel(packageReviewStatus)}</Badge>
                </Detail>
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
                  {packageReviewStatus === "ready" || packageReviewStatus === "released" ? (
                    <button className="btn-action" onClick={sendPackageBackToReview}>Return to review</button>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="col" style={{ gap: 10 }}>
              <div className="panel meeting-package-side-card">
                <div className="row" style={{ justifyContent: "space-between" }}>
                  <strong>Join meeting</strong>
                  {joinDetails.provider && <Badge tone="info">{joinDetails.provider}</Badge>}
                </div>
                {joinDetails.url ? (
                  <div className="col" style={{ gap: 6, marginTop: 8 }}>
                    <a className="btn btn--accent btn--sm" href={joinDetails.url} target="_blank" rel="noreferrer">
                      <ExternalLink size={12} /> Join meeting
                    </a>
                    {joinDetails.meetingId && <Detail label="Meeting ID">{joinDetails.meetingId}</Detail>}
                    {joinDetails.passcode && <Detail label="Passcode">{joinDetails.passcode}</Detail>}
                    {joinDetails.instructions && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>{joinDetails.instructions}</div>}
                  </div>
                ) : (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>No remote meeting link saved.</div>
                )}
              </div>
              <div className="panel meeting-package-side-card">
                <strong>Open actions</strong>
                <div className="col" style={{ gap: 6, marginTop: 8 }}>
                  {openPackageTasks.slice(0, 5).map((task: any) => (
                    <Link key={task._id} to="/app/tasks" className="row" style={{ gap: 6 }}>
                      <Badge tone={task.priority === "High" ? "danger" : task.priority === "Medium" ? "warn" : "neutral"}>{task.priority}</Badge>
                      <span>{task.title}</span>
                    </Link>
                  ))}
                  {openPackageTasks.length === 0 && <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>No open tasks linked to this meeting.</div>}
                </div>
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
