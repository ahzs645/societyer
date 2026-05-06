import { useMemo, useState } from "react";
import { ChevronDown, ClipboardList, FileText, MinusCircle, Plus, Save, Sparkles, Trash2 } from "lucide-react";
import { Badge, Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { LegalGuideInline } from "../../../components/LegalGuide";
import { isAdjournmentMotion, motionPersonDisplayName, type Motion, type MotionPerson } from "../../../components/MotionEditor";
import { NameAutocomplete } from "../../../components/NameAutocomplete";
import { SignaturePanel } from "../../../components/SignaturePanel";
import {
  AttendanceDetails,
  formatSourceReferences,
  personLinkCandidates,
} from "./MeetingDetailSupport";

export function MeetingMinutesColumn({
  minutes,
  agenda,
  agendaEdit,
  setAgendaEdit,
  saveAgenda,
  attendanceEdit,
  setAttendanceEdit,
  startAttendanceEdit,
  saveAttendance,
  quorumSnapshot,
  quorumLegalGuides,
  members,
  directors,
  saveMinuteSections,
  saveMinuteMotions,
  createMinutesFromAgenda,
  addSectionToBacklog,
  onOpenMotions,
  transcript,
  setTranscript,
  transcriptOnFile,
  busy,
  runGenerate,
}: {
  minutes: any;
  agenda: string[];
  agendaEdit: string | null;
  setAgendaEdit: (value: string | null) => void;
  saveAgenda: () => void | Promise<void>;
  attendanceEdit: any;
  setAttendanceEdit: (value: any) => void;
  startAttendanceEdit: () => void;
  saveAttendance: () => void | Promise<void>;
  quorumSnapshot: any;
  quorumLegalGuides: any[];
  members: any;
  directors: any;
  saveMinuteSections: (next: any[]) => void | Promise<void> | undefined;
  saveMinuteMotions: (next: Motion[]) => void | Promise<void> | undefined;
  createMinutesFromAgenda: () => void | Promise<void>;
  addSectionToBacklog: (section: any) => void | Promise<void>;
  onOpenMotions?: () => void;
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
  const [sectionEditorTab, setSectionEditorTab] = useState<SectionEditorTab>("notes");
  const [openSectionIndexes, setOpenSectionIndexes] = useState<Set<number>>(() => new Set([0, 1]));
  const motionPeople = useMemo(() => personLinkCandidates(members, directors), [members, directors]);
  const assigneeOptions = useMemo(
    () => Array.from(new Set(motionPeople.map((p) => p.name))).filter(Boolean).sort(),
    [motionPeople],
  );
  const motionMatchesBySection = useMemo(
    () => sections.map((section: any, index: number) => relatedMotionsForSection(section, index, motions)),
    [sections, motions],
  );
  const agendaActionItems = useMemo(
    () => sections.flatMap((section: any, sectionIndex: number) =>
      (section.actionItems ?? [])
        // Map first so actionIndex stays the original index in section.actionItems
        // — we need that for write-backs (toggling done) regardless of what the
        // empty-text filter drops from the visible list.
        .map((item: any, actionIndex: number) => ({
          ...item,
          sectionIndex,
          actionIndex,
          sectionTitle: section.title || `Agenda item ${sectionIndex + 1}`,
        }))
        .filter((item: any) => String(item?.text ?? "").trim()),
    ),
    [sections],
  );

  const toggleActionItemDone = (sectionIndex: number, actionIndex: number) => {
    const next = sections.map((section: any, idx: number) => {
      if (idx !== sectionIndex) return section;
      const items = (section.actionItems ?? []).map((item: any, aIdx: number) =>
        aIdx === actionIndex ? { ...item, done: !item.done } : item,
      );
      return { ...section, actionItems: items };
    });
    void saveMinuteSections(next);
  };

  const startSectionEdit = (index: number) => {
    const section = sections[index] ?? {};
    setSectionEditIndex(index);
    setSectionEditorTab("notes");
    setSectionDraft({
      title: section.title ?? "",
      type: section.type ?? "discussion",
      presenter: section.presenter ?? "",
      discussion: section.discussion ?? "",
      decisions: (section.decisions ?? []).join("\n"),
      actionItems: normalizeActionDrafts(section.actionItems ?? []),
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
      actionItems: sectionDraft.actionItems
        .map((item) => ({
          text: item.text.trim(),
          assignee: cleanOptional(item.assignee),
          dueDate: cleanOptional(item.dueDate),
          done: !!item.done,
        }))
        .filter((item) => item.text),
      reportSubmitted: sectionDraft.reportSubmitted || undefined,
    };
    await saveMinuteSections(next);
    setSectionEditIndex(null);
    setSectionDraft(null);
  };

  const assignMotionToSection = async (motionIndex: number, targetIndexValue: string) => {
    if (targetIndexValue === "") {
      const next = motions.map((motion, index) => {
        if (index !== motionIndex) return motion;
        const { sectionIndex: _sectionIndex, sectionTitle: _sectionTitle, ...rest } = motion;
        return rest;
      });
      await saveMinuteMotions(next);
      return;
    }
    const targetIndex = Number(targetIndexValue);
    if (!Number.isInteger(targetIndex) || targetIndex < 0 || targetIndex >= sections.length) return;
    const target = sections[targetIndex] ?? {};
    const next = motions.map((motion, index) =>
      index === motionIndex
        ? {
            ...motion,
            sectionIndex: targetIndex,
            sectionTitle: cleanOptional(target.title) ?? undefined,
          }
        : motion,
    );
    await saveMinuteMotions(next);
  };

  const updateActionDraft = (actionIndex: number, patch: Partial<SectionActionDraft>) => {
    if (!sectionDraft) return;
    setSectionDraft({
      ...sectionDraft,
      actionItems: sectionDraft.actionItems.map((item, index) =>
        index === actionIndex ? { ...item, ...patch } : item,
      ),
    });
  };

  const addActionDraft = () => {
    if (!sectionDraft) return;
    setSectionDraft({
      ...sectionDraft,
      actionItems: [...sectionDraft.actionItems, emptyActionDraft()],
    });
  };

  const removeActionDraft = (actionIndex: number) => {
    if (!sectionDraft) return;
    setSectionDraft({
      ...sectionDraft,
      actionItems: sectionDraft.actionItems.filter((_, index) => index !== actionIndex),
    });
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
                  <button
                    className="btn-action"
                    onClick={() =>
                      setAgendaEdit(
                        (agendaEdit ?? "")
                          .split(/\r?\n/)
                          .filter((line) => line.trim())
                          .join("\n"),
                      )
                    }
                    title="Strip blank lines from the agenda — leaves filled items as-is"
                  >
                    <Trash2 size={12} /> Remove empty
                  </button>
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
                  style={{ resize: "none" }}
                />
              </Field>
            ) : (
              <>
                {agenda.length > 0 ? (
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
                {minutes?.discussion && (
                  <details className="meeting-minutes-narrative meeting-minutes-narrative--agenda" open>
                    <summary>Overall discussion summary</summary>
                    <div className="meeting-minutes-discussion">
                      {minutes.discussion}
                    </div>
                  </details>
                )}
              </>
            )}
          </div>
        </div>

        {minutes && (
          <>
            <div className="card">
              <div className="card__head">
                <h2 className="card__title">
                  <FileText size={14} style={{ display: "inline-block", marginRight: 6, verticalAlign: -2 }} />
                  Attendance
                </h2>
                <span className="card__subtitle">
                  Quorum {minutes.quorumMet ? "met" : "not met"} · {minutes.attendees.length} present
                  {quorumSnapshot.required != null ? ` / ${quorumSnapshot.required} required` : ""}
                </span>
              </div>
              <div className="card__body">
                {attendanceEdit ? (
                  <div className="col" style={{ gap: 12 }}>
                    <AttendanceRoster
                      people={attendanceEdit.people}
                      peopleNames={personLinkCandidates(members, directors).map((p) => p.name)}
                      onChange={(next) => setAttendanceEdit({ ...attendanceEdit, people: next })}
                    />
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
              </div>
            </div>

            {minutes.decisions.length > 0 && (
              <div className="card" id="meeting-minutes-decisions">
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
            )}

            {agendaActionItems.length > 0 && (
              <div className="card" id="meeting-minutes-action-items">
                <div className="card__head">
                  <h2 className="card__title">Action items</h2>
                  <span className="card__subtitle">{agendaActionItems.length}</span>
                </div>
                <div className="card__body">
                  <div className="action-list action-list--compact">
                    {agendaActionItems.map((a) => (
                      <div className="action-item" key={`${a.sectionIndex}-${a.actionIndex}`}>
                        <Checkbox
                          checked={!!a.done}
                          onChange={() => toggleActionItemDone(a.sectionIndex, a.actionIndex)}
                          bare
                        />
                        <span className={`action-item__text${a.done ? " done" : ""}`}>
                          <span>{a.text}</span>
                          <span className="action-item__context">{a.sectionIndex + 1}. {a.sectionTitle}</span>
                        </span>
                        {a.assignee && <Badge>{a.assignee}</Badge>}
                        {a.dueDate && <span className="action-item__due">{a.dueDate}</span>}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <SignaturePanel
              societyId={minutes.societyId}
              entityType="minutes"
              entityId={minutes._id}
              title="Minutes signatures"
            />
          </>
        )}
      </aside>

      <div className="meeting-minutes-main">
        {minutes ? (
          <>
                <div className="card">
                  <div className="card__head">
                    <h2 className="card__title">Agenda record</h2>
                    <span className="card__subtitle">
                      {sections.length ? `${sectionsWithDetailCount}/${sections.length} detailed` : "No sections"}
                    </span>
                    {!sections.length && agenda.length > 0 && (
                      <button className="btn-action btn-action--primary" type="button" onClick={createMinutesFromAgenda}>
                        <ClipboardList size={12} /> Create from agenda
                      </button>
                    )}
                  </div>
                  <div className="card__body">
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
                                {sectionSummaryMeta(section, motionMatchesBySection[index]?.length ?? 0)}
                              </span>
                            </summary>

                            <div className="meeting-minutes-section-item__body">
                              {sectionEditIndex === index && sectionDraft ? (() => {
                                const motionRows = motions
                                  .map((motion, motionIndex) => ({
                                    motion,
                                    motionIndex,
                                    selectedIndex: assignedSectionIndexForMotion(motion, sections),
                                  }))
                                  .filter(({ motion }) => !isAdjournmentMotion(motion));
                                const assignedMotionRows = motionRows.filter((row) => row.selectedIndex === index);
                                const availableMotionRows = motionRows.filter((row) => row.selectedIndex !== index);
                                const actionCount = sectionDraft.actionItems.filter((item) => item.text.trim()).length;
                                return (
                                  <div className="meeting-minutes-section-editor">
                                    <div className="meeting-minutes-section-editor__top">
                                      <Field label="Title">
                                        <input className="input" value={sectionDraft.title} onChange={(event) => setSectionDraft({ ...sectionDraft, title: event.target.value })} />
                                      </Field>
                                      <Field label="Type">
                                        <select className="input" value={sectionDraft.type} onChange={(event) => setSectionDraft({ ...sectionDraft, type: event.target.value })}>
                                          <option value="discussion">Discussion</option>
                                          <option value="motion">Motion</option>
                                          <option value="report">Report</option>
                                          <option value="decision">Decision</option>
                                          <option value="other">Other</option>
                                        </select>
                                      </Field>
                                      <Field label="Presenter">
                                        <input className="input" value={sectionDraft.presenter} onChange={(event) => setSectionDraft({ ...sectionDraft, presenter: event.target.value })} />
                                      </Field>
                                    </div>

                                    <div className="meeting-minutes-section-editor__tabs" role="tablist" aria-label="Section editor areas">
                                      <button type="button" className={`meeting-minutes-section-editor-tab${sectionEditorTab === "notes" ? " is-active" : ""}`} onClick={() => setSectionEditorTab("notes")}>
                                        Notes
                                      </button>
                                      <button type="button" className={`meeting-minutes-section-editor-tab${sectionEditorTab === "motions" ? " is-active" : ""}`} onClick={() => setSectionEditorTab("motions")}>
                                        Motions{assignedMotionRows.length ? ` (${assignedMotionRows.length})` : ""}
                                      </button>
                                      <button type="button" className={`meeting-minutes-section-editor-tab${sectionEditorTab === "actions" ? " is-active" : ""}`} onClick={() => setSectionEditorTab("actions")}>
                                        Actions{actionCount ? ` (${actionCount})` : ""}
                                      </button>
                                    </div>

                                    {sectionEditorTab === "notes" && (
                                      <div className="meeting-minutes-section-editor__panel">
                                        <Field label="Discussion notes" hint="Discussion/report points only. Use - for bullets and two spaces for nested details.">
                                          <textarea
                                            className="textarea mono"
                                            rows={8}
                                            value={sectionDraft.discussion}
                                            onChange={(event) => setSectionDraft({ ...sectionDraft, discussion: event.target.value })}
                                            placeholder="- **Expenses incurred by Ahmad:**&#10;  - $80.00 for notary signing&#10;  - $33.01 for posters&#10;- Receipts are recorded on Teams under Expenses."
                                          />
                                        </Field>
                                        <div className="meeting-minutes-section-editor__note-options">
                                          <Field label="Decisions" hint="One per line.">
                                            <textarea className="textarea" rows={3} value={sectionDraft.decisions} onChange={(event) => setSectionDraft({ ...sectionDraft, decisions: event.target.value })} />
                                          </Field>
                                          <Checkbox
                                            checked={sectionDraft.reportSubmitted}
                                            onChange={(reportSubmitted) => setSectionDraft({ ...sectionDraft, reportSubmitted })}
                                            label="Report submitted"
                                          />
                                        </div>
                                      </div>
                                    )}

                                    {sectionEditorTab === "motions" && (
                                      <div className="meeting-minutes-section-editor__panel">
                                        <div className="meeting-minutes-motion-assignment">
                                          <div className="meeting-minutes-motion-assignment__head">
                                            <strong>Assigned motions</strong>
                                            <span className="muted">{assignedMotionRows.length} of {motions.length}</span>
                                          </div>
                                          {assignedMotionRows.length ? (
                                            <div className="meeting-minutes-motion-assignment__list">
                                              {assignedMotionRows.map(({ motion, motionIndex, selectedIndex }) => (
                                                <MotionAssignmentRow
                                                  key={`${motion.text}-${motionIndex}`}
                                                  motion={motion}
                                                  motionIndex={motionIndex}
                                                  selectedIndex={selectedIndex}
                                                  sections={sections}
                                                  people={motionPeople}
                                                  onAssign={assignMotionToSection}
                                                  current
                                                />
                                              ))}
                                            </div>
                                          ) : (
                                            <div className="muted">No motions are assigned to this agenda item yet.</div>
                                          )}
                                          <div className="row" style={{ gap: 6, flexWrap: "wrap" }}>
                                            <button className="btn-action" type="button" onClick={onOpenMotions}>
                                              <Plus size={12} /> Add motion in Motions tab
                                            </button>
                                          </div>
                                        </div>
                                        {availableMotionRows.length > 0 && (
                                          <details className="meeting-minutes-motion-picklist">
                                            <summary>Assign existing motion</summary>
                                            <div className="meeting-minutes-motion-assignment__list">
                                              {availableMotionRows.map(({ motion, motionIndex, selectedIndex }) => (
                                                <MotionAssignmentRow
                                                  key={`${motion.text}-${motionIndex}`}
                                                  motion={motion}
                                                  motionIndex={motionIndex}
                                                  selectedIndex={selectedIndex}
                                                  sections={sections}
                                                  people={motionPeople}
                                                  onAssign={assignMotionToSection}
                                                />
                                              ))}
                                            </div>
                                          </details>
                                        )}
                                      </div>
                                    )}

                                    {sectionEditorTab === "actions" && (
                                      <div className="meeting-minutes-section-editor__panel">
                                        <div className="meeting-minutes-action-editor">
                                          {sectionDraft.actionItems.length ? (
                                            sectionDraft.actionItems.map((item, actionIndex) => (
                                              <div className="meeting-minutes-action-editor__row" key={actionIndex}>
                                                <Field label="Action">
                                                  <input
                                                    className="input"
                                                    value={item.text}
                                                    onChange={(event) => updateActionDraft(actionIndex, { text: event.target.value })}
                                                    placeholder="Follow up on insurance renewal"
                                                  />
                                                </Field>
                                                <Field label="Assignee">
                                                  <NameAutocomplete
                                                    value={item.assignee}
                                                    onChange={(next) => updateActionDraft(actionIndex, { assignee: next })}
                                                    options={assigneeOptions}
                                                    placeholder="First name Last name"
                                                  />
                                                </Field>
                                                <Field label="Due">
                                                  <input
                                                    className="input"
                                                    type="date"
                                                    value={item.dueDate}
                                                    onChange={(event) => updateActionDraft(actionIndex, { dueDate: event.target.value })}
                                                  />
                                                </Field>
                                                <Checkbox
                                                  checked={item.done}
                                                  onChange={(done) => updateActionDraft(actionIndex, { done })}
                                                  label="Done"
                                                />
                                                <button className="btn-action" type="button" title="Remove action" onClick={() => removeActionDraft(actionIndex)}>
                                                  <Trash2 size={12} />
                                                </button>
                                              </div>
                                            ))
                                          ) : (
                                            <div className="muted">No section-specific action rows yet.</div>
                                          )}
                                          <button className="btn-action" type="button" onClick={addActionDraft}>
                                            <Plus size={12} /> Add action
                                          </button>
                                        </div>
                                      </div>
                                    )}

                                    <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
                                      <button className="btn-action" onClick={() => { setSectionEditIndex(null); setSectionDraft(null); }}>Cancel</button>
                                      <button className="btn-action btn-action--primary" onClick={saveSectionEdit}>
                                        <Save size={12} /> Save section
                                      </button>
                                    </div>
                                  </div>
                                );
                              })() : (
                                <>
                                  {section.presenter && <p><strong>Presenter:</strong> {section.presenter}</p>}
                                  {section.reportSubmitted && <p><strong>Report:</strong> submitted</p>}
                                  {section.discussion ? (
                                    <div className="meeting-minutes-section-markdown">
                                      {renderMinutesMarkdown(section.discussion)}
                                    </div>
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
                                        {motionMatchesBySection[index].map(({ motion, index: motionIndex }) => (
                                          <div className="meeting-minutes-section-motion" key={`${motion.text}-${motionIndex}`}>
                                            <span>{motion.text}</span>
                                            <span className="meeting-minutes-section-motion__meta">
                                              {motion.movedBy && <>Moved by {motionPersonDisplayName(motion.movedBy, motionPeople, { memberId: motion.movedByMemberId, directorId: motion.movedByDirectorId })}</>}
                                              {motion.secondedBy && <> · Seconded by {motionPersonDisplayName(motion.secondedBy, motionPeople, { memberId: motion.secondedByMemberId, directorId: motion.secondedByDirectorId })}</>}
                                              {motion.outcome && <> · {motion.outcome}</>}
                                            </span>
                                          </div>
                                        ))}
                                      </div>
                                    </div>
                                  )}
                                  {(section.actionItems ?? []).length > 0 && (
                                    <ul className="meeting-minutes-section-actions">
                                      {section.actionItems.map((item: any, actionIndex: number) => (
                                        <li key={actionIndex}>
                                          {item.assignee ? `${item.assignee}: ` : ""}{item.text}
                                        </li>
                                      ))}
                                    </ul>
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
                      <div className="meeting-package-empty">
                        <ClipboardList size={14} />
                        <div>
                          <strong>No per-agenda record is saved yet.</strong>
                          <p>
                            {agenda.length
                              ? "Copy the agenda into minute sections, then add notes, motions, decisions, and actions under each item."
                              : "Add agenda items first, then copy them into minute sections."}
                          </p>
                        </div>
                      </div>
                    )}
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
            <div className="card__body col" style={{ gap: 16 }}>
              {agenda.length > 0 && (
                <div className="panel" style={{ padding: 12, borderRadius: 8 }}>
                  <div className="row" style={{ justifyContent: "space-between", gap: 12, alignItems: "flex-start", flexWrap: "wrap" }}>
                    <div>
                      <strong>Start from agenda</strong>
                      <div className="muted" style={{ fontSize: "var(--fs-sm)", marginTop: 2 }}>
                        Create a minutes draft with {agenda.length} agenda section{agenda.length === 1 ? "" : "s"} ready for notes, motions, decisions, and actions.
                      </div>
                    </div>
                    <button className="btn-action btn-action--primary" type="button" onClick={createMinutesFromAgenda}>
                      <ClipboardList size={12} /> Create minutes from agenda
                    </button>
                  </div>
                </div>
              )}
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
  actionItems: SectionActionDraft[];
  reportSubmitted: boolean;
};

type SectionEditorTab = "notes" | "motions" | "actions";

type SectionActionDraft = {
  text: string;
  assignee: string;
  dueDate: string;
  done: boolean;
};

function MotionAssignmentRow({
  motion,
  motionIndex,
  selectedIndex,
  sections,
  people,
  onAssign,
  current = false,
}: {
  motion: Motion;
  motionIndex: number;
  selectedIndex: number | null;
  sections: any[];
  people: MotionPerson[];
  onAssign: (motionIndex: number, targetIndexValue: string) => void | Promise<void>;
  current?: boolean;
}) {
  return (
    <div className={`meeting-minutes-motion-assignment__row${current ? " is-current" : ""}`}>
      <div className="meeting-minutes-motion-assignment__text">
        <strong>{motion.text}</strong>
        <span>
          {motion.outcome || "Pending"}
          {motion.movedBy ? ` · Moved by ${motionPersonDisplayName(motion.movedBy, people, { memberId: motion.movedByMemberId, directorId: motion.movedByDirectorId })}` : ""}
          {motion.secondedBy ? ` · Seconded by ${motionPersonDisplayName(motion.secondedBy, people, { memberId: motion.secondedByMemberId, directorId: motion.secondedByDirectorId })}` : ""}
        </span>
      </div>
      <select
        className="input"
        aria-label={`Assign motion ${motionIndex + 1} to agenda item`}
        value={selectedIndex == null ? "" : String(selectedIndex)}
        onChange={(event) => onAssign(motionIndex, event.target.value)}
      >
        <option value="">Unassigned</option>
        {sections.map((targetSection: any, targetIndex: number) => (
          <option key={targetIndex} value={targetIndex}>
            {targetIndex + 1}. {targetSection.title || "Untitled section"}
          </option>
        ))}
      </select>
    </div>
  );
}

type AttendancePerson = { name: string; status: "present" | "absent" };

function AttendanceRoster({
  people,
  peopleNames,
  onChange,
}: {
  people: AttendancePerson[];
  peopleNames: string[];
  onChange: (next: AttendancePerson[]) => void;
}) {
  const [draft, setDraft] = useState("");
  const suggestions = useMemo(
    () => Array.from(new Set(peopleNames)).filter(Boolean).sort(),
    [peopleNames],
  );
  const takenNames = useMemo(
    () => new Set(people.map((p) => p.name.trim().toLowerCase())),
    [people],
  );

  const commit = (nameOverride?: string) => {
    const trimmed = (nameOverride ?? draft).trim();
    if (!trimmed) return;
    if (takenNames.has(trimmed.toLowerCase())) {
      setDraft("");
      return;
    }
    onChange([...people, { name: trimmed, status: "present" }]);
    setDraft("");
  };

  const setStatus = (index: number, status: AttendancePerson["status"]) => {
    onChange(people.map((p, i) => (i === index ? { ...p, status } : p)));
  };

  const remove = (index: number) => {
    onChange(people.filter((_, i) => i !== index));
  };

  const presentCount = people.filter((p) => p.status === "present").length;
  const absentCount = people.length - presentCount;

  return (
    <div className="attendance-roster">
      <div className="attendance-roster__head">
        <strong>Attendance</strong>
        <span className="muted" style={{ fontSize: "var(--fs-sm)" }}>
          {presentCount} present · {absentCount} absent / regrets
        </span>
      </div>
      {people.length > 0 && (
        <ul className="attendance-roster__list">
          {people.map((person, index) => (
            <li key={`${index}-${person.name}`} className="attendance-roster__row">
              <button
                type="button"
                className="attendance-roster__remove"
                onClick={() => remove(index)}
                aria-label={`Remove ${person.name}`}
                title={`Remove ${person.name}`}
              >
                <MinusCircle size={16} />
              </button>
              <span className="attendance-roster__name">{person.name}</span>
              <div className="attendance-roster__status segmented">
                <button
                  type="button"
                  className={`segmented__btn${person.status === "present" ? " is-active" : ""}`}
                  onClick={() => setStatus(index, "present")}
                >
                  Present
                </button>
                <button
                  type="button"
                  className={`segmented__btn${person.status === "absent" ? " is-active" : ""}`}
                  onClick={() => setStatus(index, "absent")}
                >
                  Absent / regrets
                </button>
              </div>
            </li>
          ))}
        </ul>
      )}
      <div className="attendance-roster__add">
        <NameAutocomplete
          value={draft}
          onChange={setDraft}
          options={suggestions}
          excludeOptions={takenNames}
          placeholder="Type a name and press Enter…"
          onCommit={(name) => commit(name)}
        />
        <button
          type="button"
          className="btn-action"
          onClick={() => commit()}
          disabled={!draft.trim()}
        >
          <Plus size={12} /> Add
        </button>
      </div>
    </div>
  );
}

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

function normalizeActionDrafts(items: any[]): SectionActionDraft[] {
  return items
    .map((item) => ({
      text: String(item?.text ?? "").trim(),
      assignee: String(item?.assignee ?? "").trim(),
      dueDate: String(item?.dueDate ?? "").trim(),
      done: !!item?.done,
    }))
    .filter((item) => item.text);
}

function emptyActionDraft(): SectionActionDraft {
  return {
    text: "",
    assignee: "",
    dueDate: "",
    done: false,
  };
}

function renderMinutesMarkdown(value: string) {
  const text = String(value ?? "").trim();
  if (!text) return <p className="muted">Nothing recorded yet.</p>;
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const hasMarkdownList = lines.some((line) => /^\s*(?:[-*+]|[o○●]|\d+[.)])\s+/.test(line));
  const nonEmptyLines = lines.map((line) => line.trim()).filter(Boolean);

  if (!hasMarkdownList && nonEmptyLines.length > 1) {
    return (
      <ul className="meeting-minutes-section-bullets">
        {nonEmptyLines.map((line, index) => <li key={index}>{renderInlineMarkdown(line)}</li>)}
      </ul>
    );
  }

  const blocks: Array<
    | { kind: "heading"; text: string; level: number }
    | { kind: "paragraph"; text: string }
    | { kind: "list"; items: Array<{ text: string; children: string[] }> }
  > = [];
  let currentList: { kind: "list"; items: Array<{ text: string; children: string[] }> } | null = null;

  const closeList = () => {
    if (currentList) {
      blocks.push(currentList);
      currentList = null;
    }
  };

  for (const rawLine of lines) {
    const trimmed = rawLine.trim();
    if (!trimmed) {
      closeList();
      continue;
    }
    const heading = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (heading) {
      closeList();
      blocks.push({ kind: "heading", level: heading[1].length, text: heading[2] });
      continue;
    }
    const bullet = rawLine.match(/^(\s*)(?:[-*+]|[o○●]|\d+[.)])\s+(.+)$/);
    if (bullet) {
      const level = bullet[1].replace(/\t/g, "  ").length >= 2 ? 1 : 0;
      if (!currentList) currentList = { kind: "list", items: [] };
      if (level > 0 && currentList.items.length) {
        currentList.items[currentList.items.length - 1].children.push(bullet[2].trim());
      } else {
        currentList.items.push({ text: bullet[2].trim(), children: [] });
      }
      continue;
    }
    closeList();
    blocks.push({ kind: "paragraph", text: trimmed });
  }
  closeList();

  return (
    <>
      {blocks.map((block, index) => {
        if (block.kind === "heading") {
          const Tag = block.level <= 2 ? "h4" : "h5";
          return <Tag key={index}>{renderInlineMarkdown(block.text)}</Tag>;
        }
        if (block.kind === "paragraph") {
          return <p key={index}>{renderInlineMarkdown(block.text)}</p>;
        }
        return (
          <ul className="meeting-minutes-section-bullets" key={index}>
            {block.items.map((item, itemIndex) => (
              <li key={itemIndex}>
                {renderInlineMarkdown(item.text)}
                {item.children.length > 0 && (
                  <ul>
                    {item.children.map((child, childIndex) => (
                      <li key={childIndex}>{renderInlineMarkdown(child)}</li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        );
      })}
    </>
  );
}

function renderInlineMarkdown(value: string) {
  const parts = String(value ?? "").split(/(\*\*[^*]+\*\*)/g);
  return parts.map((part, index) => {
    if (part.startsWith("**") && part.endsWith("**")) {
      return <strong key={index}>{part.slice(2, -2)}</strong>;
    }
    return <span key={index}>{part}</span>;
  });
}

function relatedMotionsForSection(section: any, sectionIndex: number, motions: Motion[]) {
  const haystack = normalize(`${section?.title ?? ""} ${section?.discussion ?? ""} ${(section?.decisions ?? []).join(" ")}`);
  if (!haystack) return [];
  return motions.map((motion, index) => ({ motion, index })).filter(({ motion }) => {
    if (isAdjournmentMotion(motion)) return false;
    if (motion.sectionIndex === sectionIndex) return true;
    if (motion.sectionTitle && normalize(motion.sectionTitle) === normalize(section?.title ?? "")) return true;
    if (motion.sectionIndex != null || motion.sectionTitle) return false;
    const motionText = normalize(motion.text);
    if (!motionText) return false;
    if (haystack.includes(motionText.slice(0, 32))) return true;
    const amounts = moneyAmounts(motion.text);
    if (amounts.length && !amounts.some((amount) => `${section?.title ?? ""} ${section?.discussion ?? ""} ${(section?.decisions ?? []).join(" ")}`.includes(amount))) {
      return false;
    }
    const words = motionText.split(" ").filter((word) => word.length > 3);
    if (!words.length) return false;
    const hits = words.filter((word) => haystack.includes(word)).length;
    return hits >= Math.min(3, words.length);
  });
}

function assignedSectionIndexForMotion(motion: Motion, sections: any[]): number | null {
  if (motion.sectionIndex != null && sections[motion.sectionIndex]) return motion.sectionIndex;
  if (motion.sectionTitle) {
    const titleMatch = sections.findIndex((section) => normalize(section?.title ?? "") === normalize(motion.sectionTitle ?? ""));
    if (titleMatch >= 0) return titleMatch;
  }
  const inferred = sections.findIndex((section, sectionIndex) =>
    relatedMotionsForSection(section, sectionIndex, [motion]).length > 0,
  );
  return inferred >= 0 ? inferred : null;
}

function sectionSummaryMeta(section: any, motionCount: number) {
  const parts = [
    section?.type,
    motionCount ? `${motionCount} motion${motionCount === 1 ? "" : "s"}` : "",
    (section?.decisions ?? []).length ? `${section.decisions.length} decision${section.decisions.length === 1 ? "" : "s"}` : "",
    (section?.actionItems ?? []).length ? `${section.actionItems.length} action${section.actionItems.length === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return parts.join(" · ");
}

function isDeferredSection(section: any) {
  const text = normalize(`${section?.title ?? ""} ${section?.discussion ?? ""} ${(section?.decisions ?? []).join(" ")}`);
  return /\b(table|tabled|defer|deferred|future meeting|next meeting|no decision)\b/.test(text);
}

function moneyAmounts(value: string) {
  return String(value ?? "").match(/\$\s?\d[\d,]*(?:\.\d{2})?/g)?.map((amount) => amount.replace(/\s+/g, "")) ?? [];
}

function normalize(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
