import { useMemo, useState } from "react";
import { ChevronDown, FileText, Save, Sparkles } from "lucide-react";
import { Badge, Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { LegalGuideInline } from "../../../components/LegalGuide";
import type { Motion } from "../../../components/MotionEditor";
import { SignaturePanel } from "../../../components/SignaturePanel";
import {
  AttendanceDetails,
  StructuredMinutesEditor,
  StructuredMinutesSummary,
  formatSourceReferences,
  personLinkCandidates,
} from "./MeetingDetailSupport";

export function MeetingMinutesColumn({
  meeting,
  minutes,
  agenda,
  agendaEdit,
  setAgendaEdit,
  saveAgenda,
  attendanceEdit,
  setAttendanceEdit,
  startAttendanceEdit,
  saveAttendance,
  structuredEdit,
  setStructuredEdit,
  startStructuredEdit,
  saveStructuredDetails,
  quorumSnapshot,
  quorumLegalGuides,
  members,
  directors,
  saveMinuteSections,
  addSectionToBacklog,
  transcript,
  setTranscript,
  transcriptOnFile,
  busy,
  runGenerate,
}: {
  meeting: any;
  minutes: any;
  agenda: string[];
  agendaEdit: string | null;
  setAgendaEdit: (value: string | null) => void;
  saveAgenda: () => void | Promise<void>;
  attendanceEdit: any;
  setAttendanceEdit: (value: any) => void;
  startAttendanceEdit: () => void;
  saveAttendance: () => void | Promise<void>;
  structuredEdit: any;
  setStructuredEdit: (value: any) => void;
  startStructuredEdit: () => void;
  saveStructuredDetails: () => void | Promise<void>;
  quorumSnapshot: any;
  quorumLegalGuides: any[];
  members: any;
  directors: any;
  saveMinuteSections: (next: any[]) => void | Promise<void> | undefined;
  addSectionToBacklog: (section: any) => void | Promise<void>;
  transcript: string;
  setTranscript: (value: string) => void;
  transcriptOnFile: string;
  busy: boolean;
  runGenerate: () => void | Promise<void>;
}) {
  const sections = Array.isArray(minutes?.sections) ? minutes.sections : [];
  const motions = Array.isArray(minutes?.motions) ? minutes.motions as Motion[] : [];
  const sectionsWithDetailCount = sections.filter((section: any) =>
    section?.discussion ||
    section?.presenter ||
    section?.reportSubmitted ||
    (section?.decisions ?? []).length ||
    (section?.actionItems ?? []).length
  ).length;
  const [sectionEditIndex, setSectionEditIndex] = useState<number | null>(null);
  const [sectionDraft, setSectionDraft] = useState<SectionDraft | null>(null);
  const [openSectionIndexes, setOpenSectionIndexes] = useState<Set<number>>(() => new Set([0, 1]));
  const motionMatchesBySection = useMemo(
    () => sections.map((section: any) => relatedMotionsForSection(section, motions)),
    [sections, motions],
  );

  const startSectionEdit = (index: number) => {
    const section = sections[index] ?? {};
    setSectionEditIndex(index);
    setSectionDraft({
      title: section.title ?? "",
      type: section.type ?? "discussion",
      presenter: section.presenter ?? "",
      discussion: section.discussion ?? "",
      decisions: (section.decisions ?? []).join("\n"),
      actionItems: (section.actionItems ?? []).map((item: any) => `${item.assignee ? `${item.assignee}: ` : ""}${item.text ?? ""}`).join("\n"),
      reportSubmitted: !!section.reportSubmitted,
    });
  };

  const saveSectionEdit = async () => {
    if (sectionEditIndex == null || !sectionDraft) return;
    const next = [...sections];
    next[sectionEditIndex] = {
      ...next[sectionEditIndex],
      title: sectionDraft.title.trim() || next[sectionEditIndex]?.title || "Untitled section",
      type: sectionDraft.type.trim() || undefined,
      presenter: cleanOptional(sectionDraft.presenter),
      discussion: cleanOptional(sectionDraft.discussion),
      decisions: parseMultiline(sectionDraft.decisions),
      actionItems: parseActionRows(sectionDraft.actionItems),
      reportSubmitted: sectionDraft.reportSubmitted || undefined,
    };
    await saveMinuteSections(next);
    setSectionEditIndex(null);
    setSectionDraft(null);
  };

  const toggleSection = (index: number, open: boolean) => {
    setOpenSectionIndexes((current) => {
      const next = new Set(current);
      if (open) next.add(index);
      else next.delete(index);
      return next;
    });
  };

  const openAgendaSection = (index: number) => {
    setOpenSectionIndexes((current) => new Set(current).add(index));
    window.requestAnimationFrame(() => {
      document.getElementById(`meeting-minutes-section-${index}`)?.scrollIntoView({
        behavior: "smooth",
        block: "start",
      });
    });
  };

  return (
    <div className="meeting-minutes-layout">
      <aside className="meeting-minutes-side">
        <div className="card meeting-minutes-agenda-card">
          <div className="card__head">
            <h2 className="card__title">Agenda</h2>
            <span className="card__subtitle">
              {agenda.length ? `${agenda.length} item${agenda.length === 1 ? "" : "s"}` : "No agenda items yet"}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {agendaEdit === null ? (
                <button className="btn-action" onClick={() => setAgendaEdit(agenda.join("\n"))}>
                  Edit
                </button>
              ) : (
                <>
                  <button className="btn-action" onClick={() => setAgendaEdit(null)}>Cancel</button>
                  <button className="btn-action btn-action--primary" onClick={saveAgenda}>
                    <Save size={12} /> Save
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="card__body">
            {agendaEdit !== null ? (
              <Field label="Agenda items" hint="One item per line. These are stored on the meeting record and can be changed without changing the source document.">
                <textarea
                  className="textarea"
                  rows={Math.max(8, Math.min(agenda.length + 2, 14))}
                  value={agendaEdit}
                  onChange={(event) => setAgendaEdit(event.target.value)}
                  placeholder="Call to order&#10;Confirm attendance and quorum&#10;Approve agenda"
                />
              </Field>
            ) : agenda.length > 0 ? (
              <ol className="meeting-minutes-agenda-list">
                {agenda.map((a, i) => (
                  <li key={i}>
                    <button
                      type="button"
                      className={`meeting-minutes-agenda-link${openSectionIndexes.has(i) ? " is-active" : ""}`}
                      onClick={() => openAgendaSection(i)}
                    >
                      {formatSourceReferences(a)}
                    </button>
                  </li>
                ))}
              </ol>
            ) : (
              <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                Add the meeting agenda here. Imported minutes can use this as an editable reconstruction of the source document's structure.
              </div>
            )}
          </div>
        </div>
      </aside>

      <div className="meeting-minutes-main">
        {minutes ? (
          <>
            <div className="card meeting-minutes-summary-card">
              <div className="card__head">
                <h2 className="card__title"><FileText size={14} style={{ display: "inline-block", marginRight: 6, verticalAlign: -2 }} />Minutes</h2>
                <span className="card__subtitle">
                  Quorum {minutes.quorumMet ? "met" : "not met"} · {minutes.attendees.length} present
                  {quorumSnapshot.required != null ? ` / ${quorumSnapshot.required} required` : ""}
                </span>
              </div>
              <div className="card__body">
                <div className="meeting-minutes-overview-grid">
                  <section className="minutes-section minutes-section--panel">
                    <h3>Attendance</h3>
                    {attendanceEdit ? (
                      <div className="col" style={{ gap: 12 }}>
                        <div className="row" style={{ gap: 12, alignItems: "flex-start" }}>
                          <Field label="Present" hint="One person per line.">
                            <textarea
                              className="textarea"
                              value={attendanceEdit.attendees}
                              onChange={(event) => setAttendanceEdit({ ...attendanceEdit, attendees: event.target.value })}
                              rows={6}
                            />
                          </Field>
                          <Field label="Absent / regrets" hint="One person per line.">
                            <textarea
                              className="textarea"
                              value={attendanceEdit.absent}
                              onChange={(event) => setAttendanceEdit({ ...attendanceEdit, absent: event.target.value })}
                              rows={6}
                            />
                          </Field>
                        </div>
                        <Checkbox
                          checked={attendanceEdit.quorumMet}
                          onChange={(quorumMet) => setAttendanceEdit({ ...attendanceEdit, quorumMet })}
                          label="Quorum met"
                        />
                        <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                          <button className="btn-action" onClick={() => setAttendanceEdit(null)}>Cancel</button>
                          <button className="btn-action btn-action--primary" onClick={saveAttendance}>
                            <Save size={12} /> Save attendance
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="col" style={{ gap: 8 }}>
                        <div className="row" style={{ gap: 8, flexWrap: "wrap" }}>
                          <Badge tone={minutes.quorumMet ? "success" : "warn"}>
                            Quorum {minutes.quorumMet ? "met" : "not met"}
                          </Badge>
                          <Badge tone="info">{minutes.attendees.length} present</Badge>
                          {quorumSnapshot.required != null && (
                            <Badge tone="neutral">{quorumSnapshot.required} required</Badge>
                          )}
                          <Badge tone="neutral">{minutes.absent.length} absent/regrets</Badge>
                          {quorumSnapshot.label && (
                            <span className="muted" style={{ flexBasis: "100%", fontSize: "var(--fs-sm)" }}>
                              Rule: {quorumSnapshot.label}
                            </span>
                          )}
                          <div style={{ flexBasis: "100%" }}>
                            <LegalGuideInline rules={quorumLegalGuides} />
                          </div>
                          <button className="btn-action" onClick={startAttendanceEdit}>
                            Edit attendance
                          </button>
                        </div>
                        <AttendanceDetails
                          present={minutes.attendees}
                          absent={minutes.absent}
                          people={personLinkCandidates(members, directors)}
                        />
                      </div>
                    )}
                  </section>

                  <section className="minutes-section minutes-section--panel">
                    <div className="row" style={{ justifyContent: "space-between", gap: 8, alignItems: "center" }}>
                      <h3>Structured details</h3>
                      {structuredEdit ? (
                        <div className="row" style={{ gap: 6 }}>
                          <button className="btn-action" onClick={() => setStructuredEdit(null)}>Cancel</button>
                          <button className="btn-action btn-action--primary" onClick={saveStructuredDetails}>
                            <Save size={12} /> Save details
                          </button>
                        </div>
                      ) : (
                        <button className="btn-action" onClick={startStructuredEdit}>Edit details</button>
                      )}
                    </div>
                    {structuredEdit ? (
                      <StructuredMinutesEditor
                        value={structuredEdit}
                        onChange={setStructuredEdit}
                        isAgm={meeting.type === "AGM"}
                      />
                    ) : (
                      <StructuredMinutesSummary minutes={minutes} />
                    )}
                  </section>
                </div>
              </div>
            </div>

            <div className="meeting-minutes-content-grid">
              <div className="meeting-minutes-primary">
                <div className="card">
                  <div className="card__head">
                    <h2 className="card__title">Agenda record</h2>
                    <span className="card__subtitle">
                      {sections.length ? `${sectionsWithDetailCount}/${sections.length} detailed` : "No sections"}
                    </span>
                    <div style={{ marginLeft: "auto" }}>
                      <button className="btn-action" onClick={startStructuredEdit}>
                        Edit section details
                      </button>
                    </div>
                  </div>
                  <div className="card__body">
                    {minutes.discussion && (
                      <details className="meeting-minutes-narrative" open>
                        <summary>Overall discussion summary</summary>
                        <div className="meeting-minutes-discussion">
                          {minutes.discussion}
                        </div>
                      </details>
                    )}
                    {sections.length ? (
                      <div className="meeting-minutes-section-list">
                        {sections.map((section: any, index: number) => (
                          <details
                            id={`meeting-minutes-section-${index}`}
                            className="meeting-minutes-section-item"
                            key={`${section.title ?? "section"}-${index}`}
                            open={openSectionIndexes.has(index)}
                            onToggle={(event) => toggleSection(index, event.currentTarget.open)}
                          >
                            <summary className="meeting-minutes-section-item__summary">
                              <span className="meeting-minutes-section-item__title">
                                <ChevronDown size={13} aria-hidden="true" />
                                <strong>{index + 1}. {section.title || "Untitled section"}</strong>
                              </span>
                              <span className="meeting-minutes-section-item__meta">
                                {section.type && <Badge tone="neutral">{section.type}</Badge>}
                                {motionMatchesBySection[index]?.length ? <Badge tone="info">{motionMatchesBySection[index].length} motion{motionMatchesBySection[index].length === 1 ? "" : "s"}</Badge> : null}
                                {(section.decisions ?? []).length ? <Badge tone="success">{section.decisions.length} decision{section.decisions.length === 1 ? "" : "s"}</Badge> : null}
                                {(section.actionItems ?? []).length ? <Badge tone="neutral">{section.actionItems.length} action{section.actionItems.length === 1 ? "" : "s"}</Badge> : null}
                              </span>
                            </summary>

                            <div className="meeting-minutes-section-item__body">
                              {sectionEditIndex === index && sectionDraft ? (
                                <div className="meeting-minutes-section-editor">
                                  <div className="structured-minutes-editor__grid">
                                    <Field label="Title">
                                      <input className="input" value={sectionDraft.title} onChange={(event) => setSectionDraft({ ...sectionDraft, title: event.target.value })} />
                                    </Field>
                                    <Field label="Type">
                                      <input className="input" value={sectionDraft.type} onChange={(event) => setSectionDraft({ ...sectionDraft, type: event.target.value })} />
                                    </Field>
                                    <Field label="Presenter">
                                      <input className="input" value={sectionDraft.presenter} onChange={(event) => setSectionDraft({ ...sectionDraft, presenter: event.target.value })} />
                                    </Field>
                                  </div>
                                  <Field label="Discussion bullets" hint="One bullet per line. These render under this agenda item.">
                                    <textarea className="textarea" rows={5} value={sectionDraft.discussion} onChange={(event) => setSectionDraft({ ...sectionDraft, discussion: event.target.value })} />
                                  </Field>
                                  <div className="structured-minutes-editor__grid">
                                    <Field label="Decisions" hint="One per line.">
                                      <textarea className="textarea" rows={4} value={sectionDraft.decisions} onChange={(event) => setSectionDraft({ ...sectionDraft, decisions: event.target.value })} />
                                    </Field>
                                    <Field label="Action items" hint="Use Assignee: action or one action per line.">
                                      <textarea className="textarea" rows={4} value={sectionDraft.actionItems} onChange={(event) => setSectionDraft({ ...sectionDraft, actionItems: event.target.value })} />
                                    </Field>
                                  </div>
                                  <Checkbox
                                    checked={sectionDraft.reportSubmitted}
                                    onChange={(reportSubmitted) => setSectionDraft({ ...sectionDraft, reportSubmitted })}
                                    label="Report submitted"
                                  />
                                  <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                                    <button className="btn-action" onClick={() => { setSectionEditIndex(null); setSectionDraft(null); }}>Cancel</button>
                                    <button className="btn-action btn-action--primary" onClick={saveSectionEdit}>
                                      <Save size={12} /> Save section
                                    </button>
                                  </div>
                                </div>
                              ) : (
                                <>
                                  {section.presenter && <p><strong>Presenter:</strong> {section.presenter}</p>}
                                  {section.reportSubmitted && <p><strong>Report:</strong> submitted</p>}
                                  {section.discussion ? (
                                    <ul className="meeting-minutes-section-bullets">
                                      {discussionBullets(section.discussion).map((bullet, bulletIndex) => (
                                        <li key={bulletIndex}>{bullet}</li>
                                      ))}
                                    </ul>
                                  ) : (
                                    <p className="muted">No section notes recorded yet.</p>
                                  )}
                                  {(section.decisions ?? []).length > 0 && (
                                    <div className="meeting-minutes-section-block">
                                      <strong>Decisions</strong>
                                      <ul>
                                        {section.decisions.map((decision: string, decisionIndex: number) => (
                                          <li key={decisionIndex}>{decision}</li>
                                        ))}
                                      </ul>
                                    </div>
                                  )}
                                  {motionMatchesBySection[index]?.length > 0 && (
                                    <div className="meeting-minutes-section-block">
                                      <strong>Related motions</strong>
                                      <div className="meeting-minutes-section-motions">
                                        {motionMatchesBySection[index].map((motion: Motion, motionIndex: number) => (
                                          <div className="meeting-minutes-section-motion" key={`${motion.text}-${motionIndex}`}>
                                            <span>{motion.text}</span>
                                            <span className="meeting-minutes-section-motion__meta">
                                              {motion.movedBy && <>Moved by {motion.movedBy}</>}
                                              {motion.secondedBy && <> · Seconded by {motion.secondedBy}</>}
                                              {motion.outcome && <Badge tone={motion.outcome === "Carried" ? "success" : motion.outcome === "Tabled" ? "warn" : "neutral"}>{motion.outcome}</Badge>}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {(section.actionItems ?? []).length > 0 && (
                                    <div className="meeting-minutes-section-actions">
                                      {section.actionItems.map((item: any, actionIndex: number) => (
                                        <span className="badge" key={actionIndex}>
                                          {item.assignee ? `${item.assignee}: ` : ""}{item.text}
                                        </span>
                                      ))}
                                    </div>
                                  )}
                                  <div className="row" style={{ gap: 6, justifyContent: "space-between", flexWrap: "wrap" }}>
                                    <button className="btn-action" onClick={() => startSectionEdit(index)}>
                                      Edit agenda item
                                    </button>
                                    {isDeferredSection(section) && (
                                      <button className="btn-action" onClick={() => addSectionToBacklog(section)}>
                                        Add to backlog
                                      </button>
                                    )}
                                  </div>
                                </>
                              )}
                            </div>
                          </details>
                        ))}
                      </div>
                    ) : (
                      <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                        No per-agenda record is saved yet.
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="meeting-minutes-secondary">
                <div className="card">
                  <div className="card__head">
                    <h2 className="card__title">Decisions</h2>
                    <span className="card__subtitle">{minutes.decisions.length}</span>
                  </div>
                  <div className="card__body">
                    <ul className="meeting-minutes-compact-list">
                      {minutes.decisions.map((d, i) => <li key={i}>{d}</li>)}
                    </ul>
                  </div>
                </div>

                <div className="card">
                  <div className="card__head">
                    <h2 className="card__title">Action items</h2>
                    <span className="card__subtitle">{minutes.actionItems.length}</span>
                  </div>
                  <div className="card__body">
                    <div className="action-list action-list--compact">
                      {minutes.actionItems.map((a, i) => (
                        <div className="action-item" key={i}>
                          <Checkbox checked={!!a.done} onChange={() => {}} bare disabled />
                          <span className={`action-item__text${a.done ? " done" : ""}`}>{a.text}</span>
                          {a.assignee && <Badge>{a.assignee}</Badge>}
                          {a.dueDate && <span className="action-item__due">{a.dueDate}</span>}
                        </div>
                      ))}
                    </div>
                  </div>
                </div>

                <SignaturePanel
                  societyId={meeting.societyId}
                  entityType="minutes"
                  entityId={minutes._id}
                  title="Minutes signatures"
                />
              </div>
            </div>
          </>
        ) : (
          <div className="card">
            <div className="card__head">
              <h2 className="card__title">Generate minutes</h2>
              <span className="card__subtitle">
                {transcriptOnFile
                  ? "Use the saved transcript below, or paste rough notes to override it for this draft."
                  : "Paste a rough transcript or notes — the AI helper will structure them."}
              </span>
            </div>
            <div className="card__body">
              <Field label="Raw transcript / rough notes">
                <textarea
                  className="textarea"
                  style={{ minHeight: 200 }}
                  value={transcript}
                  onChange={(e) => setTranscript(e.target.value)}
                  placeholder="e.g.&#10;Meeting opened at 7:02pm by Elena. Quorum met.&#10;Treasurer reported Q1 revenue up 8%.&#10;Motion by Jordan to approve Q1 statements, seconded by Priya. Carried 6-0.&#10;Action: Amara to draft fundraising plan by March 1."
                />
              </Field>
              <button
                className="btn btn--accent"
                disabled={(!transcript.trim() && !transcriptOnFile.trim()) || busy}
                onClick={runGenerate}
              >
                <Sparkles size={14} /> {busy ? "Generating…" : transcriptOnFile && !transcript.trim() ? "Generate from saved transcript" : "Generate draft minutes"}
              </button>
              <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 8 }}>
                Demo uses a heuristic parser. Wire to an LLM in <code className="mono">convex/minutes.ts</code> for production.
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

type SectionDraft = {
  title: string;
  type: string;
  presenter: string;
  discussion: string;
  decisions: string;
  actionItems: string;
  reportSubmitted: boolean;
};

function cleanOptional(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  return text || undefined;
}

function parseMultiline(value: string) {
  return String(value ?? "")
    .split(/\r?\n/)
    .map((line) => line.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
}

function parseActionRows(value: string) {
  return parseMultiline(value).map((line) => {
    const match = line.match(/^([^:]{2,60}):\s*(.+)$/);
    return {
      text: (match ? match[2] : line).trim(),
      assignee: match ? match[1].trim() : undefined,
      done: false,
    };
  });
}

function discussionBullets(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return [];
  const explicit = text
    .split(/\r?\n|(?:^|\s)[•]\s+/)
    .map((part) => part.trim().replace(/^[-*•]\s*/, ""))
    .filter(Boolean);
  if (explicit.length > 1) return explicit;
  return text
    .split(/(?<=[.!?])\s+(?=[A-Z0-9$])/)
    .map((part) => part.trim())
    .filter(Boolean);
}

function relatedMotionsForSection(section: any, motions: Motion[]) {
  const haystack = normalize(`${section?.title ?? ""} ${section?.discussion ?? ""} ${(section?.decisions ?? []).join(" ")}`);
  if (!haystack) return [];
  return motions.filter((motion) => {
    const motionText = normalize(motion.text);
    if (!motionText) return false;
    if (haystack.includes(motionText.slice(0, 32))) return true;
    const words = motionText.split(" ").filter((word) => word.length > 3);
    if (!words.length) return false;
    const hits = words.filter((word) => haystack.includes(word)).length;
    return hits >= Math.min(3, words.length);
  });
}

function isDeferredSection(section: any) {
  const text = normalize(`${section?.title ?? ""} ${section?.discussion ?? ""} ${(section?.decisions ?? []).join(" ")}`);
  return /\b(table|tabled|defer|deferred|future meeting|next meeting|no decision)\b/.test(text);
}

function normalize(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
