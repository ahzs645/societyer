import { useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, ChevronDown, ClipboardList, FileText, ListChecks, Mic, MinusCircle, Pencil, Plus, Save, Trash2, Unlink, X } from "lucide-react";
import { Badge, Field } from "../../../components/ui";
import { Checkbox } from "../../../components/Controls";
import { LegalGuideInline } from "../../../components/LegalGuide";
import { Segmented } from "../../../components/primitives";
import { isAdjournmentMotion, motionPersonDisplayName, type Motion, type MotionPerson } from "../../../components/MotionEditor";
import { NameAutocomplete } from "../../../components/NameAutocomplete";
import { SignaturePanel } from "../../../components/SignaturePanel";
import {
  AttendanceDetails,
  formatSourceReferences,
  personLinkCandidates,
} from "./MeetingDetailSupport";

const SECTION_TASK_STATUS_ITEMS: { id: string; label: string }[] = [
  { id: "Todo", label: "To do" },
  { id: "InProgress", label: "In progress" },
  { id: "Blocked", label: "Blocked" },
  { id: "Done", label: "Done" },
];

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
  meetingTasks,
  applyTaskUpdate,
  transcriptOnFile,
  transcriptEdit,
  setTranscriptEdit,
  saveTranscriptEditText,
  savingTranscript,
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
  meetingTasks: any[];
  applyTaskUpdate: (taskId: string, patch: { status?: string; completionNote?: string }) => void | Promise<void>;
  transcriptOnFile: string;
  transcriptEdit: string | null;
  setTranscriptEdit: (value: string | null) => void;
  saveTranscriptEditText: () => Promise<void> | void;
  savingTranscript: boolean;
}) {
  const sections = Array.isArray(minutes?.sections) ? minutes.sections : [];
  const motions = Array.isArray(minutes?.motions) ? minutes.motions as Motion[] : [];
  const sectionHasDetails = (section: any) =>
    !!(
      section?.discussion ||
      section?.presenter ||
      (section?.decisions ?? []).length ||
      (section?.actionItems ?? []).length ||
      (section?.linkedTaskIds ?? []).length
    );
  const sectionsWithDetailCount = sections.filter((section: any) => sectionHasDetails(section)).length;
  const detailedSectionTitles = useMemo(() => {
    const set = new Set<string>();
    for (const section of sections) {
      if (!sectionHasDetails(section)) continue;
      const title = String(section?.title ?? "").trim().toLowerCase();
      if (title) set.add(title);
    }
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections]);
  const [sectionEditIndex, setSectionEditIndex] = useState<number | null>(null);
  const [sectionDraft, setSectionDraft] = useState<SectionDraft | null>(null);
  const [sectionEditorTab, setSectionEditorTab] = useState<SectionEditorTab>("notes");
  const [agendaDeleteIndex, setAgendaDeleteIndex] = useState<number | null>(null);
  const [sectionDeleteIndex, setSectionDeleteIndex] = useState<number | null>(null);
  const [newAgendaIndices, setNewAgendaIndices] = useState<Set<number>>(() => new Set());
  const agendaInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocusIndex = useRef<number | null>(null);
  const sectionTitleRef = useRef<HTMLInputElement | null>(null);
  const focusSectionTitleOnEdit = useRef(false);

  useEffect(() => {
    if (agendaEdit === null) setNewAgendaIndices(new Set());
  }, [agendaEdit]);

  useEffect(() => {
    if (pendingFocusIndex.current == null) return;
    const target = agendaInputRefs.current[pendingFocusIndex.current];
    pendingFocusIndex.current = null;
    target?.focus();
  });

  useEffect(() => {
    if (!focusSectionTitleOnEdit.current) return;
    if (sectionEditIndex == null) return;
    const node = sectionTitleRef.current;
    if (!node) return;
    focusSectionTitleOnEdit.current = false;
    node.focus();
    node.select();
  });

  const addSection = async () => {
    const newIndex = sections.length;
    const next = [
      ...sections,
      {
        title: "New section",
        type: "discussion",
        discussion: "",
        decisions: [],
        actionItems: [],
      },
    ];
    await saveMinuteSections(next);
    setOpenSectionIndexes((current) => new Set(current).add(newIndex));
    focusSectionTitleOnEdit.current = true;
    setSectionEditIndex(newIndex);
    setSectionEditorTab("notes");
    setSectionDraft({
      title: "New section",
      type: "discussion",
      presenter: "",
      discussion: "",
      decisions: "",
      actionItems: [],
      linkedTaskIds: [],
      taskUpdates: {},
    });
  };

  const removeSection = async (index: number) => {
    const removed = sections[index];
    const removedTitle = String(removed?.title ?? "").trim().toLowerCase();
    const next = sections.slice();
    next.splice(index, 1);
    await saveMinuteSections(next);

    // Motions live on minutes.motions, not inside the section, so we have to
    // clean them up explicitly: drop motions assigned to the removed section
    // and shift sectionIndex down by one for motions on later sections.
    const cleanedMotions = motions
      .filter((motion) => {
        if (motion.sectionIndex === index) return false;
        if (
          motion.sectionTitle &&
          String(motion.sectionTitle).trim().toLowerCase() === removedTitle &&
          (motion.sectionIndex == null || motion.sectionIndex === index)
        ) return false;
        return true;
      })
      .map((motion) =>
        motion.sectionIndex != null && motion.sectionIndex > index
          ? { ...motion, sectionIndex: motion.sectionIndex - 1 }
          : motion,
      );
    const motionsChanged =
      cleanedMotions.length !== motions.length ||
      cleanedMotions.some((m, i) => m !== motions[i]);
    if (motionsChanged) await saveMinuteMotions(cleanedMotions);

    setSectionDeleteIndex(null);
    if (sectionEditIndex === index) {
      setSectionEditIndex(null);
      setSectionDraft(null);
    }
  };

  const agendaItems = agendaEdit === null ? [] : agendaEdit.split(/\r?\n/);
  const writeAgendaItems = (next: string[]) => setAgendaEdit(next.join("\n"));
  const updateAgendaItem = (index: number, value: string) => {
    const next = agendaItems.slice();
    next[index] = value;
    writeAgendaItems(next);
  };
  const addAgendaItem = (afterIndex?: number) => {
    const next = agendaItems.slice();
    const insertAt = afterIndex == null ? next.length : afterIndex + 1;
    next.splice(insertAt, 0, "");
    writeAgendaItems(next);
    setNewAgendaIndices((prev) => {
      const out = new Set<number>();
      for (const i of prev) out.add(i >= insertAt ? i + 1 : i);
      out.add(insertAt);
      return out;
    });
    pendingFocusIndex.current = insertAt;
  };
  const removeAgendaItem = (index: number) => {
    const next = agendaItems.slice();
    next.splice(index, 1);
    writeAgendaItems(next);
    setAgendaDeleteIndex(null);
    setNewAgendaIndices((prev) => {
      const out = new Set<number>();
      for (const i of prev) {
        if (i === index) continue;
        out.add(i > index ? i - 1 : i);
      }
      return out;
    });
  };
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
      linkedTaskIds: Array.isArray(section.linkedTaskIds) ? section.linkedTaskIds : [],
      taskUpdates: {},
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
      linkedTaskIds: sectionDraft.linkedTaskIds.length ? sectionDraft.linkedTaskIds : undefined,
    };
    await saveMinuteSections(next);
    for (const [taskId, patch] of Object.entries(sectionDraft.taskUpdates)) {
      const cleanPatch: { status?: string; completionNote?: string } = {};
      if (patch.status) cleanPatch.status = patch.status;
      if (patch.completionNote !== undefined) cleanPatch.completionNote = patch.completionNote;
      if (Object.keys(cleanPatch).length) {
        await applyTaskUpdate(taskId, cleanPatch);
      }
    }
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

  const attachLinkedTask = (taskId: string) => {
    if (!sectionDraft || !taskId) return;
    if (sectionDraft.linkedTaskIds.includes(taskId)) return;
    setSectionDraft({
      ...sectionDraft,
      linkedTaskIds: [...sectionDraft.linkedTaskIds, taskId],
    });
  };
  const detachLinkedTask = (taskId: string) => {
    if (!sectionDraft) return;
    const nextUpdates = { ...sectionDraft.taskUpdates };
    delete nextUpdates[taskId];
    setSectionDraft({
      ...sectionDraft,
      linkedTaskIds: sectionDraft.linkedTaskIds.filter((id) => id !== taskId),
      taskUpdates: nextUpdates,
    });
  };
  const updateTaskDraft = (taskId: string, patch: { status?: string; completionNote?: string }) => {
    if (!sectionDraft) return;
    setSectionDraft({
      ...sectionDraft,
      taskUpdates: {
        ...sectionDraft.taskUpdates,
        [taskId]: { ...sectionDraft.taskUpdates[taskId], ...patch },
      },
    });
  };

  const meetingTaskById = useMemo(
    () => new Map<string, any>((meetingTasks ?? []).map((task: any) => [task._id, task])),
    [meetingTasks],
  );

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

  if (transcriptEdit !== null) {
    return (
      <div className="meeting-minutes-layout meeting-minutes-layout--transcript-focus">
        <div className="card meeting-minutes-transcript-focus">
          <div className="card__head">
            <h2 className="card__title">
              <Mic size={14} style={{ verticalAlign: -2, marginRight: 6 }} />
              Edit transcript
            </h2>
            <span className="card__subtitle">
              {transcriptEdit.length.toLocaleString()} characters
              {transcriptOnFile ? ` · ${transcriptOnFile.length.toLocaleString()} on file` : ""}
            </span>
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              <button
                className="btn-action"
                disabled={savingTranscript}
                onClick={() => setTranscriptEdit(null)}
              >
                Cancel
              </button>
              <button
                className="btn-action btn-action--primary"
                disabled={savingTranscript}
                onClick={() => { void saveTranscriptEditText(); }}
              >
                <Save size={12} /> {savingTranscript ? "Saving..." : "Save"}
              </button>
            </div>
          </div>
          <div className="card__body">
            <textarea
              className="textarea meeting-minutes-transcript-focus__editor"
              value={transcriptEdit}
              onChange={(event) => setTranscriptEdit(event.target.value)}
              placeholder="Paste or type the meeting transcript here."
              autoFocus
            />
          </div>
        </div>
      </div>
    );
  }

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
                <button
                  className="btn-action btn-action--icon"
                  onClick={() => setAgendaEdit(agenda.join("\n"))}
                  title="Edit agenda"
                  aria-label="Edit agenda"
                >
                  <Pencil size={12} />
                </button>
              ) : (
                <>
                  <button
                    className="btn-action btn-action--icon"
                    onClick={() => { setAgendaEdit(null); setAgendaDeleteIndex(null); }}
                    title="Cancel"
                    aria-label="Cancel"
                  >
                    <X size={12} />
                  </button>
                  <button
                    className="btn-action btn-action--icon btn-action--primary"
                    onClick={() => { setAgendaDeleteIndex(null); void saveAgenda(); }}
                    title="Save agenda"
                    aria-label="Save agenda"
                  >
                    <Save size={12} />
                  </button>
                </>
              )}
            </div>
          </div>
          <div className="card__body">
            {agendaEdit !== null ? (
              <div className="meeting-minutes-agenda-editor">
                {agendaItems.length === 0 && (
                  <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                    No agenda items yet. Click Add item to start.
                  </div>
                )}
                {agendaItems.map((item, index) => {
                  const trimmed = item.trim();
                  const isEmpty = !trimmed;
                  const isNew = newAgendaIndices.has(index);
                  const linkedSectionDetailed = trimmed ? detailedSectionTitles.has(trimmed.toLowerCase()) : false;
                  const canRemove = isEmpty || isNew || !linkedSectionDetailed;
                  return (
                    <div className={`meeting-minutes-agenda-editor__row${canRemove ? "" : " is-locked"}`} key={index}>
                      <input
                        ref={(el) => { agendaInputRefs.current[index] = el; }}
                        className="input"
                        value={item}
                        onChange={(event) => updateAgendaItem(index, event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addAgendaItem(index);
                          }
                        }}
                        placeholder={index === 0 ? "Call to order" : "Agenda item"}
                      />
                      {canRemove && (
                        <button
                          className="btn-action btn-action--icon"
                          type="button"
                          tabIndex={-1}
                          title="Remove item"
                          aria-label="Remove item"
                          onClick={() => removeAgendaItem(index)}
                        >
                          <MinusCircle size={12} />
                        </button>
                      )}
                    </div>
                  );
                })}
                <button
                  className="btn-action"
                  type="button"
                  onClick={() => addAgendaItem()}
                >
                  <Plus size={12} /> Add item
                </button>
              </div>
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
                      <Badge tone="neutral">{minutes.absent.length} Absent/Regrets</Badge>
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
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      {!sections.length && agenda.length > 0 && (
                        <button className="btn-action btn-action--primary" type="button" onClick={createMinutesFromAgenda}>
                          <ClipboardList size={12} /> Create from agenda
                        </button>
                      )}
                      {sections.length > 0 && (
                        <button
                          className="btn-action btn-action--icon"
                          type="button"
                          title="Add section"
                          aria-label="Add section"
                          onClick={addSection}
                        >
                          <Plus size={12} />
                        </button>
                      )}
                    </div>
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
                              <button
                                className="btn-action btn-action--icon"
                                type="button"
                                title="Remove section"
                                aria-label="Remove section"
                                onClick={(event) => {
                                  event.preventDefault();
                                  event.stopPropagation();
                                  const isEmpty =
                                    !section?.discussion &&
                                    !section?.presenter &&
                                    !(section?.decisions ?? []).length &&
                                    !(section?.actionItems ?? []).length &&
                                    !(motionMatchesBySection[index]?.length);
                                  if (isEmpty) {
                                    removeSection(index);
                                    return;
                                  }
                                  setOpenSectionIndexes((current) => new Set(current).add(index));
                                  setSectionDeleteIndex(index);
                                }}
                              >
                                <MinusCircle size={12} />
                              </button>
                            </summary>

                            <div className="meeting-minutes-section-item__body">
                              {sectionDeleteIndex === index && (
                                <div className="meeting-minutes-agenda-editor__confirm" role="alertdialog" style={{ marginBottom: 12 }}>
                                  <AlertTriangle size={12} aria-hidden="true" />
                                  <span>
                                    Delete "{section.title || "Untitled section"}"? Notes, decisions, and action items in this section will be removed.
                                  </span>
                                  <button
                                    className="btn-action btn-action--danger"
                                    type="button"
                                    onClick={() => removeSection(index)}
                                  >
                                    Delete section
                                  </button>
                                  <button
                                    className="btn-action"
                                    type="button"
                                    onClick={() => setSectionDeleteIndex(null)}
                                  >
                                    Cancel
                                  </button>
                                </div>
                              )}
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
                                const linkedTaskRecords = sectionDraft.linkedTaskIds
                                  .map((taskId) => meetingTaskById.get(taskId))
                                  .filter(Boolean);
                                const availableMeetingTasks = (meetingTasks ?? []).filter(
                                  (task: any) => !sectionDraft.linkedTaskIds.includes(task._id),
                                );
                                return (
                                  <div className="meeting-minutes-section-editor">
                                    <div className="meeting-minutes-section-editor__top">
                                      <Field label="Title">
                                        <input
                                          ref={sectionEditIndex === index ? sectionTitleRef : undefined}
                                          className="input"
                                          value={sectionDraft.title}
                                          onChange={(event) => setSectionDraft({ ...sectionDraft, title: event.target.value })}
                                        />
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
                                        <NameAutocomplete
                                          value={sectionDraft.presenter}
                                          onChange={(next) => setSectionDraft({ ...sectionDraft, presenter: next })}
                                          options={assigneeOptions}
                                          placeholder="Type a name and press Enter…"
                                        />
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
                                      <button type="button" className={`meeting-minutes-section-editor-tab${sectionEditorTab === "tasks" ? " is-active" : ""}`} onClick={() => setSectionEditorTab("tasks")}>
                                        Tasks{linkedTaskRecords.length ? ` (${linkedTaskRecords.length})` : ""}
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
                                        <Field label="Decisions" hint="One per line.">
                                          <textarea className="textarea" rows={8} value={sectionDraft.decisions} onChange={(event) => setSectionDraft({ ...sectionDraft, decisions: event.target.value })} />
                                        </Field>
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

                                    {sectionEditorTab === "tasks" && (
                                      <div className="meeting-minutes-section-editor__panel">
                                        <div className="meeting-minutes-section-tasks">
                                          {linkedTaskRecords.length === 0 ? (
                                            <div className="muted">
                                              Link a task from this meeting to capture status updates and a completion note here. Status changes apply to the kanban when you save the section.
                                            </div>
                                          ) : (
                                            linkedTaskRecords.map((task) => {
                                              const draft = sectionDraft.taskUpdates[task._id] ?? {};
                                              const currentStatus = draft.status ?? task.status ?? "Todo";
                                              const noteValue = draft.completionNote ?? task.completionNote ?? "";
                                              return (
                                                <div className="meeting-minutes-section-task" key={task._id}>
                                                  <div className="meeting-minutes-section-task__head">
                                                    <strong>{task.title}</strong>
                                                    <div className="row" style={{ gap: 6, alignItems: "center", marginLeft: "auto" }}>
                                                      {task.priority && <Badge tone={task.priority === "High" ? "danger" : task.priority === "Medium" ? "warn" : "neutral"}>{task.priority}</Badge>}
                                                      <button
                                                        className="btn-action btn-action--icon"
                                                        type="button"
                                                        title="Unlink from this section"
                                                        aria-label={`Unlink ${task.title}`}
                                                        onClick={() => detachLinkedTask(task._id)}
                                                      >
                                                        <Unlink size={12} />
                                                      </button>
                                                    </div>
                                                  </div>
                                                  <Segmented
                                                    value={currentStatus}
                                                    onChange={(next) => updateTaskDraft(task._id, { status: next })}
                                                    items={SECTION_TASK_STATUS_ITEMS}
                                                  />
                                                  <Field label="Completion note" hint="Saved to the task when this section is saved.">
                                                    <textarea
                                                      className="textarea"
                                                      rows={2}
                                                      value={noteValue}
                                                      onChange={(event) => updateTaskDraft(task._id, { completionNote: event.target.value })}
                                                      placeholder="Outcome, blockers, or notes for the kanban card."
                                                    />
                                                  </Field>
                                                </div>
                                              );
                                            })
                                          )}

                                          {availableMeetingTasks.length > 0 ? (
                                            <select
                                              className="input"
                                              value=""
                                              onChange={(event) => {
                                                attachLinkedTask(event.target.value);
                                                event.target.value = "";
                                              }}
                                            >
                                              <option value="">Link a meeting task…</option>
                                              {availableMeetingTasks.map((task: any) => (
                                                <option key={task._id} value={task._id}>
                                                  {task.title}{task.status ? ` · ${task.status}` : ""}
                                                </option>
                                              ))}
                                            </select>
                                          ) : (meetingTasks?.length ?? 0) === 0 ? (
                                            <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                                              No tasks linked to this meeting yet. Add tasks on the Package tab to make them available here.
                                            </div>
                                          ) : (
                                            <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                                              All meeting tasks are linked to this section.
                                            </div>
                                          )}
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
                                  {(() => {
                                    const linkedTaskIds: string[] = Array.isArray(section.linkedTaskIds) ? section.linkedTaskIds : [];
                                    const linkedTaskRows = linkedTaskIds
                                      .map((taskId) => meetingTaskById.get(taskId))
                                      .filter(Boolean);
                                    if (linkedTaskRows.length === 0) return null;
                                    return (
                                      <div className="meeting-minutes-section-block">
                                        <strong>
                                          <ListChecks size={12} style={{ verticalAlign: -2, marginRight: 4 }} />
                                          Linked tasks
                                        </strong>
                                        <ul className="meeting-minutes-section-actions">
                                          {linkedTaskRows.map((task: any) => (
                                            <li key={task._id}>
                                              {task.title}
                                              <span className="muted"> · {task.status || "Todo"}</span>
                                              {task.dueDate && <span className="muted"> · Due {task.dueDate}</span>}
                                            </li>
                                          ))}
                                        </ul>
                                      </div>
                                    );
                                  })()}
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
              <h2 className="card__title">Agenda record</h2>
              <span className="card__subtitle">
                {agenda.length
                  ? `${agenda.length} agenda item${agenda.length === 1 ? "" : "s"} ready to become sections`
                  : "Add agenda items in the sidebar to start"}
              </span>
              {agenda.length > 0 && (
                <button className="btn-action btn-action--primary" type="button" onClick={createMinutesFromAgenda}>
                  <ClipboardList size={12} /> Create from agenda
                </button>
              )}
            </div>
            <div className="card__body col" style={{ gap: 16 }}>
              {agenda.length > 0 ? (
                <div className="meeting-minutes-section-list">
                  {agenda.map((item, index) => (
                    <div className="meeting-minutes-section-item" key={index}>
                      <div className="meeting-minutes-section-item__summary">
                        <span className="meeting-minutes-section-item__title">
                          <strong>{index + 1}. {item || "Untitled item"}</strong>
                        </span>
                        <span className="meeting-minutes-section-item__meta muted">Pending</span>
                      </div>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="meeting-package-empty">
                  <ClipboardList size={14} />
                  <div>
                    <strong>No agenda yet.</strong>
                    <p>Add agenda items in the Agenda card on the left, then click Create from agenda to start the minutes record.</p>
                  </div>
                </div>
              )}

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
  linkedTaskIds: string[];
  taskUpdates: Record<string, { status?: string; completionNote?: string }>;
};

type SectionEditorTab = "notes" | "motions" | "actions" | "tasks";

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
