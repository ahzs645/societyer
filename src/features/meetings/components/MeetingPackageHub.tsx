import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardCheck, Download, ExternalLink, FileText, ShieldCheck } from "lucide-react";
import { Badge } from "../../../components/ui";
import { Menu } from "../../../components/Menu";
import { MarkdownEditor } from "../../../components/MarkdownEditor";
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
  packageReviewLabel,
  packageReviewTone,
  sourceReviewLabel,
  sourceReviewTone,
} from "./MeetingDetailSupport";

/**
 * The meeting Materials tab: per-agenda-topic documents with access control,
 * a compact review-status strip (source + board package readiness), and the
 * distribution downloads. Task linking intentionally does NOT live here —
 * tasks are managed from the minutes section editor and the Tasks page.
 */
export function MeetingPackageHub({
  meeting,
  minutes,
  agenda,
  packageMaterials,
  joinDetails,
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
}: {
  meeting: any;
  minutes: any;
  agenda: string[];
  packageMaterials: any[];
  joinDetails: any;
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
}) {
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
            <h2 className="card__title">Meeting materials</h2>
            <p className="card__subtitle">
              Documents for this meeting's board package, grouped by agenda topic, plus review status and distribution.
            </p>
          </div>
          <div className="row" style={{ gap: 6, flexWrap: "wrap", marginLeft: "auto" }}>
            <button className="btn-action" onClick={() => openMaterialDrawer()}>
              <FileText size={12} /> Add material
            </button>
            <button className="btn-action" onClick={startJoinEdit}>
              <ExternalLink size={12} /> {joinDetails.url ? "Edit join link" : "Add join link"}
            </button>
            <Menu
              align="right"
              minWidth={280}
              sections={[
                {
                  id: "distribute",
                  items: [
                    {
                      id: "pack",
                      label: "Meeting pack (ZIP)",
                      hint: "Printable HTML pack, agenda text, and an attachment manifest.",
                      icon: <Download size={14} />,
                      onSelect: downloadMeetingPack,
                    },
                    {
                      id: "outbox",
                      label: "Email outbox (ZIP)",
                      hint: "Openable .eml email draft with the materials attached, ready to send.",
                      icon: <Download size={14} />,
                      onSelect: downloadOutboxPackage,
                    },
                  ],
                },
              ]}
              trigger={
                <button className="btn-action btn-action--primary" type="button">
                  <Download size={12} /> Distribute
                </button>
              }
            />
          </div>
        </div>
        <div className="card__body meeting-package-body">
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
                  <strong>No materials linked yet.</strong>
                  <p>Add only the documents needed for this meeting. Agenda topics stay collapsed until you need to map materials.</p>
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

          <div className="panel meeting-package-gate">
            <div className="row" style={{ gap: 8, justifyContent: "space-between", alignItems: "flex-start", flexWrap: "wrap" }}>
              <div>
                <strong>
                  <ShieldCheck size={13} style={{ verticalAlign: -2, marginRight: 4 }} />
                  Review status
                </strong>
                <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                  Imported source data and board-package readiness before distribution.
                </div>
              </div>
              {/* Per-review status chips live on the drawer rows below — only the
                  blockers count (shown nowhere else) belongs up here. */}
              {packageReviewBlockers.length > 0 && (
                <Badge tone="warn">
                  <AlertTriangle size={10} style={{ marginRight: 3, verticalAlign: -1 }} />
                  {packageReviewBlockers.length} blocker{packageReviewBlockers.length === 1 ? "" : "s"}
                </Badge>
              )}
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
                        <MarkdownEditor
                          rows={2}
                          value={sourceReviewNote}
                          onChange={(markdown) => setSourceReviewNote(markdown)}
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
                  <MarkdownEditor
                    rows={2}
                    value={packageReviewNote}
                    onChange={(markdown) => setPackageReviewNote(markdown)}
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
            </div>
          </div>
        </div>
      </div>
  );
}
