import { type DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, ClipboardList, FileText, GripVertical, IndentDecrease, IndentIncrease, ListChecks, Mic, MoreHorizontal, Pencil, Plus, Save, Trash2, Unlink, X } from "lucide-react";
import { Badge, Field, MenuRow } from "../../../components/ui";
import { MarkdownEditor, type MarkdownEditorHandle } from "../../../components/MarkdownEditor";
import { LineListEditor } from "../../../components/LineListEditor";
import { ListEditor } from "../../../components/ListEditor";
import { useConfirm } from "../../../components/Modal";
import { Checkbox } from "../../../components/Controls";
import { LegalGuideInline } from "../../../components/LegalGuide";
import { Segmented } from "../../../components/primitives";
import { MotionEditor, isAdjournmentMotion, motionPersonDisplayName, type Motion, type MotionEditorHandle } from "../../../components/MotionEditor";
import { NameAutocomplete } from "../../../components/NameAutocomplete";
import { Select } from "../../../components/Select";
import { DatePicker } from "../../../components/DatePicker";
import { SignaturePanel } from "../../../components/SignaturePanel";
import { QuickAddTaskForm } from "../../tasks/QuickAddTaskForm";
import {
  AttendanceDetails,
  formatSourceReferences,
  personLinkCandidates,
  type AgendaItemEntry,
} from "./MeetingDetailSupport";

import {
  SECTION_TASK_STATUS_ITEMS,
  AGENDA_NUMBERING_PREF_KEY,
  SECTION_TYPE_OPTIONS,
  AGENDA_NUMBERING_ITEMS,
  readStoredAgendaNumberingMode,
  agendaAlphaLabel,
  agendaNumberingLabel,
  agendaEntryLabel,
  AttendanceRoster,
  cleanOptional,
  normalizeActionDrafts,
  emptyActionDraft,
  renderMinutesMarkdown,
  renderInlineMarkdown,
  relatedMotionsForSection,
  isAdjournmentSection,
  assignedSectionIndexForMotion,
  sectionSummaryMeta,
  isDeferredSection,
  moneyAmounts,
  remapMotionsByIndexOrder,
  normalize,
} from "./MeetingMinutesColumn.internal";
import type {
  SectionTypeId,
  AgendaNumberingMode,
  SectionDraft,
  SectionEditorTab,
  SectionActionDraft,
  AttendancePerson,
} from "./MeetingMinutesColumn.internal";
import { useMeetingMinutesColumn, type MeetingMinutesColumnProps } from "./useMeetingMinutesColumn";

export function MeetingMinutesColumn(props: MeetingMinutesColumnProps) {
  const {
    minutes,
    agenda,
    agendaTree,
    agendaEdit,
    setAgendaEdit,
    saveAgenda,
    attendanceEdit,
    setAttendanceEdit,
    startAttendanceEdit,
    autofillCurrentDirectors,
    saveAttendance,
    quorumSnapshot,
    quorumLegalGuides,
    members,
    directors,
    addSectionToBacklog,
    transcriptOnFile,
    transcriptEdit,
    setTranscriptEdit,
    saveTranscriptEditText,
    savingTranscript,
    sections,
    motions,
    detailedSectionTitles,
    sectionEditIndex,
    setSectionEditIndex,
    sectionDraft,
    setSectionDraft,
    agendaNumberingMode,
    setAgendaNumberingMode,
    dragRootIndex,
    setDragRootIndex,
    dropRootIndex,
    setDropRootIndex,
    sectionContextMenu,
    setSectionContextMenu,
    sectionContextMenuRef,
    sectionEditorTab,
    attendancePresentCount,
    newAgendaIndices,
    agendaInputRefs,
    sectionTitleRef,
    sectionDiscussionRef,
    isMobileSectionEditor,
    addSection,
    agendaItems,
    updateAgendaItem,
    addAgendaItem,
    startFreshAgendaSection,
    removeAgendaItem,
    indentAgendaItem,
    outdentAgendaItem,
    moveAgendaItem,
    agendaDragSourceRef,
    agendaDragIndex,
    agendaDropIndex,
    onAgendaDragStart,
    onAgendaDragOver,
    onAgendaDrop,
    onAgendaDragEnd,
    agendaItemMenu,
    agendaItemMenuRef,
    closeAgendaItemMenu,
    canMoveAgendaUp,
    canMoveAgendaDown,
    openAgendaItemMenu,
    openSectionIndexes,
    motionPeople,
    assigneeOptions,
    motionMatchesBySection,
    mergedSectionRows,
    hiddenRowIndexes,
    rootGroups,
    rootIndexBySectionIndex,
    reorderRoots,
    moveRootUp,
    moveRootDown,
    moveChild,
    confirmAndRemoveSection,
    closeSectionContextMenu,
    agendaPreviewRemovals,
    agendaActionItems,
    toggleActionItemDone,
    startSectionEdit,
    saveSectionEdit,
    meetingTaskById,
    renderSectionEditor,
    toggleSection,
    openAgendaSection,
  } = useMeetingMinutesColumn(props);
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
            {agendaEdit !== null && (
              <div className="meeting-minutes-agenda-numbering">
                <Segmented
                  value={agendaNumberingMode}
                  onChange={setAgendaNumberingMode}
                  items={AGENDA_NUMBERING_ITEMS}
                />
              </div>
            )}
            <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
              {agendaEdit === null ? (
                <button
                  className="btn-action btn-action--icon"
                  onClick={() => setAgendaEdit(agendaTree.length ? agendaTree.map((entry) => ({ ...entry })) : [])}
                  // Disabled while a section is mid-edit: the two editors
                  // hold independent optimistic copies and saving either while
                  // the other is dirty silently overwrites the live record.
                  disabled={sectionEditIndex !== null}
                  title={sectionEditIndex !== null ? "Finish editing the open section first" : "Edit agenda"}
                  aria-label="Edit agenda"
                >
                  <Pencil size={12} />
                </button>
              ) : (
                <>
                  <button
                    className="btn-action btn-action--icon"
                    onClick={() => setAgendaEdit(null)}
                    title="Cancel"
                    aria-label="Cancel"
                  >
                    <X size={12} />
                  </button>
                  <button
                    className="btn-action btn-action--icon btn-action--primary"
                    onClick={() => { void saveAgenda(); }}
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
                  const trimmed = item.title.trim();
                  const isEmpty = !trimmed;
                  const isNew = newAgendaIndices.has(index);
                  // Children get real sections too now, so the "this section
                  // already has notes/decisions/actions" lock applies to them
                  // identically — removing it from the agenda would orphan
                  // the recorded content.
                  const linkedSectionDetailed = trimmed
                    ? detailedSectionTitles.has(trimmed.toLowerCase())
                    : false;
                  const canRemove = isEmpty || isNew || !linkedSectionDetailed;
                  const itemLabel = agendaEntryLabel(agendaItems, index, agendaNumberingMode);
                  const placeholder = index === 0
                    ? "Call to order"
                    : item.depth === 1
                      ? "Sub-item"
                      : "Agenda item";
                  const isRoot = item.depth === 0;
                  const isDragging = agendaDragIndex === index;
                  const isDropTarget = agendaDropIndex === index;
                  const isChild = item.depth === 1;
                  const isDraggableRow = isRoot || isChild;
                  return (
                    <div
                      className={`meeting-minutes-agenda-editor__row${canRemove ? "" : " is-locked"}${isChild ? " meeting-minutes-agenda-editor__row--child" : ""}${isDragging ? " is-dragging" : ""}${isDropTarget ? " is-drop-above" : ""}`}
                      key={index}
                      draggable={isDraggableRow}
                      onDragStart={onAgendaDragStart(index)}
                      onDragOver={onAgendaDragOver(index)}
                      onDrop={onAgendaDrop}
                      onDragEnd={onAgendaDragEnd}
                    >
                      <span
                        className={`meeting-minutes-agenda-editor__index${isDraggableRow ? " is-drag-handle" : ""}`}
                        aria-label={isDraggableRow ? `Drag item ${itemLabel} to reorder` : undefined}
                        title={isDraggableRow ? (isChild ? "Drag to reorder within group" : "Drag to reorder") : undefined}
                        onMouseDown={isDraggableRow ? () => { agendaDragSourceRef.current = true; } : undefined}
                      >
                        <span aria-hidden="true">{itemLabel}</span>
                      </span>
                      <input
                        ref={(el) => { agendaInputRefs.current[index] = el; }}
                        className="input"
                        value={item.title}
                        onChange={(event) => updateAgendaItem(index, event.target.value)}
                        onKeyDown={(event) => {
                          // Cmd/Ctrl+Enter saves the whole agenda; Esc cancels.
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault();
                            void saveAgenda();
                            return;
                          }
                          if (event.key === "Escape") {
                            event.preventDefault();
                            setAgendaEdit(null);
                            return;
                          }
                          if (event.key === "Enter") {
                            event.preventDefault();
                            addAgendaItem(index);
                            return;
                          }
                          if (event.key === "Tab") {
                            event.preventDefault();
                            if (event.shiftKey) outdentAgendaItem(index);
                            else indentAgendaItem(index);
                            return;
                          }
                          if (event.key === "Backspace" && !item.title) {
                            event.preventDefault();
                            const prev = index - 1;
                            removeAgendaItem(index);
                            if (prev >= 0) {
                              const target = agendaInputRefs.current[prev];
                              if (target) {
                                target.focus();
                                const len = target.value.length;
                                target.setSelectionRange(len, len);
                              }
                            }
                            return;
                          }
                          if (event.key === "ArrowUp" || event.key === "ArrowDown") {
                            const offset = event.key === "ArrowUp" ? -1 : 1;
                            if (event.altKey) {
                              event.preventDefault();
                              moveAgendaItem(index, offset as -1 | 1);
                              return;
                            }
                            const target = agendaInputRefs.current[index + offset];
                            if (target) {
                              event.preventDefault();
                              target.focus();
                              const len = target.value.length;
                              target.setSelectionRange(len, len);
                            }
                          }
                        }}
                        placeholder={placeholder}
                      />
                      {isMobileSectionEditor ? (
                        // On phones a popover submenu is awkward to operate, so
                        // surface the same agenda-row actions inline as direct
                        // icon buttons. Desktop keeps the compact "…" menu.
                        <div className="meeting-minutes-agenda-editor__actions">
                          <button
                            type="button"
                            className="btn-action btn-action--icon"
                            onClick={() => moveAgendaItem(index, -1)}
                            disabled={!canMoveAgendaUp(index)}
                            title="Move up"
                            aria-label="Move up"
                          >
                            <ArrowUp size={12} />
                          </button>
                          <button
                            type="button"
                            className="btn-action btn-action--icon"
                            onClick={() => moveAgendaItem(index, 1)}
                            disabled={!canMoveAgendaDown(index)}
                            title="Move down"
                            aria-label="Move down"
                          >
                            <ArrowDown size={12} />
                          </button>
                          {isRoot ? (
                            <button
                              type="button"
                              className="btn-action btn-action--icon"
                              onClick={() => indentAgendaItem(index)}
                              disabled={!agendaItems.slice(0, index).some((entry) => entry.depth === 0)}
                              title="Make sub-item"
                              aria-label="Make sub-item"
                            >
                              <IndentIncrease size={12} />
                            </button>
                          ) : (
                            <button
                              type="button"
                              className="btn-action btn-action--icon"
                              onClick={() => outdentAgendaItem(index)}
                              title="Promote item"
                              aria-label="Promote item"
                            >
                              <IndentDecrease size={12} />
                            </button>
                          )}
                          <button
                            type="button"
                            className="btn-action btn-action--icon"
                            onClick={() => removeAgendaItem(index)}
                            disabled={!canRemove}
                            title="Remove item"
                            aria-label="Remove item"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      ) : (
                        <button
                          className="btn-action btn-action--icon meeting-minutes-agenda-editor__more"
                          type="button"
                          tabIndex={-1}
                          title="More actions"
                          aria-label="More actions for this item"
                          aria-haspopup="menu"
                          aria-expanded={agendaItemMenu?.index === index}
                          onClick={(event) => openAgendaItemMenu(index, event.currentTarget)}
                        >
                          <MoreHorizontal size={12} />
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
                {agendaTree.length > 0 ? (
                  <ol className="meeting-minutes-agenda-list">
                    {(() => {
                      // Each agenda entry now maps 1:1 to a minute section by
                      // position, so both roots and children are clickable
                      // links that scroll the matching section into view.
                      const rendered: JSX.Element[] = [];
                      let rootIndex = -1;
                      let childIndex = 0;
                      agendaTree.forEach((entry, i) => {
                        if (entry.depth === 0) {
                          rootIndex += 1;
                          childIndex = 0;
                          // Collect contiguous following children for this root.
                          const children: { entry: AgendaItemEntry; sectionIndex: number; letter: string }[] = [];
                          for (let j = i + 1; j < agendaTree.length && agendaTree[j].depth === 1; j += 1) {
                            childIndex += 1;
                            children.push({
                              entry: agendaTree[j],
                              sectionIndex: j,
                              letter: String.fromCharCode(96 + childIndex),
                            });
                          }
                          rendered.push(
                            <li key={i}>
                              <button
                                type="button"
                                className={`meeting-minutes-agenda-link${openSectionIndexes.has(i) ? " is-active" : ""}`}
                                onClick={() => openAgendaSection(i)}
                              >
                                {formatSourceReferences(entry.title)}
                              </button>
                              {children.length > 0 && (
                                <ol className="meeting-minutes-agenda-list__children">
                                  {children.map((child) => (
                                    <li key={child.sectionIndex}>
                                      <button
                                        type="button"
                                        className={`meeting-minutes-agenda-link${openSectionIndexes.has(child.sectionIndex) ? " is-active" : ""}`}
                                        onClick={() => openAgendaSection(child.sectionIndex)}
                                      >
                                        <span className="meeting-minutes-agenda-list__child-index">
                                          {`${rootIndex + 1}${child.letter}.`}
                                        </span>
                                        {" "}{formatSourceReferences(child.entry.title)}
                                      </button>
                                    </li>
                                  ))}
                                </ol>
                              )}
                            </li>,
                          );
                        }
                      });
                      return rendered;
                    })()}
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
                  {attendancePresentCount} present
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
                    <button className="btn-action" type="button" onClick={autofillCurrentDirectors}>
                      Add current directors
                    </button>
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
              signerScope="directors"
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
                    <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                      <button
                        className="btn-action btn-action--icon"
                        type="button"
                        // Adding from here also opens the inline section
                        // editor; while the agenda is mid-edit, that would
                        // hold both editors open at once. The agenda editor
                        // already has its own "Add item" affordance.
                        disabled={agendaEdit !== null}
                        title={agendaEdit !== null ? "Use the agenda editor to add items" : "Add section"}
                        aria-label="Add section"
                        onClick={addSection}
                      >
                        <Plus size={12} />
                      </button>
                    </div>
                  </div>
                  <div className="card__body">
                    {mergedSectionRows.length ? (
                      <div className="meeting-minutes-section-list">
                        {mergedSectionRows.map((row, rowIndex) => {
                          if (hiddenRowIndexes.has(rowIndex)) return null;
                          if (row.kind === "preview") {
                            return (
                              <div
                                className={`meeting-minutes-section-item meeting-minutes-section-item--preview${row.depth === 1 ? " meeting-minutes-section-item--child" : ""}`}
                                key={`preview-${rowIndex}-${row.title}`}
                              >
                                <div className="meeting-minutes-section-item__summary">
                                  <span className="meeting-minutes-section-item__title">
                                    <strong>{row.label} {row.title}</strong>
                                  </span>
                                </div>
                              </div>
                            );
                          }
                          const section = row.section;
                          const index = row.sectionIndex;
                          const isChild = row.depth === 1;
                          const label = row.label;
                          const rootIndex = isChild ? null : (rootIndexBySectionIndex.get(index) ?? null);
                          // Drag/menu only on roots, and only when neither
                          // editor is active — otherwise the optimistic state
                          // could race the reorder save.
                          const reorderEnabled =
                            rootIndex != null && agendaEdit === null && sectionEditIndex === null;
                          const isDragging = dragRootIndex != null && rootIndex === dragRootIndex;
                          const showDropAbove =
                            reorderEnabled && rootIndex != null && dropRootIndex === rootIndex;
                          const showDropBelow =
                            reorderEnabled
                            && rootIndex != null
                            && rootIndex === rootGroups.length - 1
                            && dropRootIndex === rootGroups.length;
                          const isEditingThis = sectionEditIndex === index && !!sectionDraft;
                          return (
                          <details
                            key={`${section.title ?? "section"}-${index}`}
                            id={`meeting-minutes-section-${index}`}
                            className={`meeting-minutes-section-item${agendaPreviewRemovals.has(index) ? " meeting-minutes-section-item--pending-remove" : ""}${isChild ? " meeting-minutes-section-item--child" : ""}${isDragging ? " is-dragging" : ""}${showDropAbove ? " is-drop-above" : ""}${showDropBelow ? " is-drop-below" : ""}${isEditingThis ? " is-editing" : ""}`}
                            open={isEditingThis || (sectionEditIndex == null && openSectionIndexes.has(index))}
                            onToggle={(event) => {
                              // Lock the section open while the inline editor is
                              // mounted inside it — collapsing would hide every
                              // field the user is currently filling out.
                              if (isEditingThis && !event.currentTarget.open) {
                                event.currentTarget.open = true;
                                return;
                              }
                              // While another section is being edited, ignore
                              // open toggles — focus stays on the edited section
                              // so the editor isn't competing with adjacent
                              // expanded rows for attention.
                              if (sectionEditIndex != null && !isEditingThis) {
                                if (event.currentTarget.open) event.currentTarget.open = false;
                                return;
                              }
                              toggleSection(index, event.currentTarget.open);
                            }}
                            draggable={reorderEnabled}
                            onDragStart={(event) => {
                              if (!reorderEnabled || rootIndex == null) {
                                event.preventDefault();
                                return;
                              }
                              event.dataTransfer.effectAllowed = "move";
                              event.dataTransfer.setData("text/plain", String(rootIndex));
                              setDragRootIndex(rootIndex);
                            }}
                            onDragOver={(event) => {
                              if (!reorderEnabled || rootIndex == null) return;
                              if (dragRootIndex == null) return;
                              event.preventDefault();
                              event.dataTransfer.dropEffect = "move";
                              const rect = event.currentTarget.getBoundingClientRect();
                              const inLowerHalf = event.clientY > rect.top + rect.height / 2;
                              // Drop position is the slot index — drop above
                              // target = target's index, below = next index.
                              // Clamp to total root count so dropping past the
                              // last root puts the group at the end.
                              const dropAt =
                                inLowerHalf && rootIndex === rootGroups.length - 1
                                  ? rootGroups.length
                                  : inLowerHalf
                                    ? rootIndex + 1
                                    : rootIndex;
                              if (dropRootIndex !== dropAt) setDropRootIndex(dropAt);
                            }}
                            onDrop={(event) => {
                              event.preventDefault();
                              const from = dragRootIndex;
                              const to = dropRootIndex;
                              setDragRootIndex(null);
                              setDropRootIndex(null);
                              if (from == null || to == null) return;
                              void reorderRoots(from, to);
                            }}
                            onDragEnd={() => {
                              setDragRootIndex(null);
                              setDropRootIndex(null);
                            }}
                            onContextMenu={(event) => {
                              // Block during agenda edit (cross-editor desync
                              // risk), and on OTHER sections during a section
                              // edit (would race the open draft). On the same
                              // section being edited, the menu opens with a
                              // Save action so right-click → save works.
                              if (agendaEdit !== null) return;
                              if (sectionEditIndex !== null && sectionEditIndex !== index) return;
                              event.preventDefault();
                              event.stopPropagation();
                              const x = Math.min(event.clientX, window.innerWidth - 200);
                              const y = Math.min(event.clientY, window.innerHeight - 220);
                              setSectionContextMenu({ sectionIndex: index, top: y, left: x });
                            }}
                          >
                            <summary className="meeting-minutes-section-item__summary">
                              <span className="meeting-minutes-section-item__title">
                                {reorderEnabled && (
                                  <span
                                    className="meeting-minutes-section-item__grip"
                                    aria-hidden="true"
                                    title="Drag to reorder"
                                  >
                                    <GripVertical size={12} />
                                  </span>
                                )}
                                {!isEditingThis && <ChevronDown size={13} aria-hidden="true" />}
                                {sectionEditIndex === index && sectionDraft && !isMobileSectionEditor ? (
                                  <span
                                    className="meeting-minutes-section-item__title-edit"
                                    onClick={(event) => event.stopPropagation()}
                                  >
                                    <span className="meeting-minutes-section-item__title-index">{label}</span>
                                    <input
                                      ref={sectionTitleRef}
                                      className="meeting-minutes-section-item__title-input"
                                      value={sectionDraft.title}
                                      onChange={(event) => setSectionDraft({ ...sectionDraft, title: event.target.value })}
                                      onKeyDown={(event) => {
                                        if (event.key === "Enter") {
                                          event.preventDefault();
                                          // Hand focus to the notes textarea when the editor is on
                                          // the Notes tab; otherwise just blur so the title
                                          // commits visually without warping the user to a
                                          // hidden field.
                                          if (sectionEditorTab === "notes" && sectionDiscussionRef.current) {
                                            sectionDiscussionRef.current.focus();
                                          } else {
                                            event.currentTarget.blur();
                                          }
                                        } else if (event.key === "Escape") {
                                          event.preventDefault();
                                          setSectionEditIndex(null);
                                          setSectionDraft(null);
                                        }
                                      }}
                                      placeholder="Section title"
                                      aria-label="Title"
                                    />
                                    <span className="meeting-minutes-section-item__title-meta">
                                      <span className="meeting-minutes-section-item__title-type">
                                        <Select
                                          value={sectionDraft.type as SectionTypeId}
                                          onChange={(next) => setSectionDraft({ ...sectionDraft, type: next })}
                                          options={SECTION_TYPE_OPTIONS}
                                        />
                                      </span>
                                      <span className="meeting-minutes-section-item__title-presenter">
                                        <NameAutocomplete
                                          value={sectionDraft.presenter}
                                          onChange={(next) => setSectionDraft({ ...sectionDraft, presenter: next })}
                                          options={assigneeOptions}
                                          placeholder="Presenter…"
                                        />
                                      </span>
                                    </span>
                                  </span>
                                ) : (
                                  <strong>{label} {section.title || "Untitled section"}</strong>
                                )}
                              </span>
                              <span className="meeting-minutes-section-item__meta">
                                {sectionSummaryMeta(section, motionMatchesBySection[index]?.length ?? 0)}
                              </span>
                              <span className="meeting-minutes-section-item__actions">
                                {sectionEditIndex !== index && (
                                  <>
                                    <button
                                      className="btn-action btn-action--icon"
                                      type="button"
                                      disabled={agendaEdit !== null}
                                      aria-label="Edit agenda item"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        startSectionEdit(index);
                                      }}
                                    >
                                      <Pencil size={12} />
                                    </button>
                                    <button
                                      className="btn-action btn-action--icon"
                                      type="button"
                                      disabled={agendaEdit !== null}
                                      aria-label="Remove section"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void confirmAndRemoveSection(index);
                                      }}
                                    >
                                      <Trash2 size={12} />
                                    </button>
                                  </>
                                )}
                              </span>
                            </summary>

                            <div className="meeting-minutes-section-item__body">
                              {sectionEditIndex === index && sectionDraft ? renderSectionEditor("inline") : (
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
                                  {isDeferredSection(section) && (
                                    <div className="row" style={{ gap: 6, justifyContent: "space-between", flexWrap: "wrap" }}>
                                      <button className="btn-action" onClick={() => addSectionToBacklog(section)}>
                                        Add to backlog
                                      </button>
                                    </div>
                                  )}
                                </>
                              )}
                            </div>
                          </details>
                          );
                        })}
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
                  ? "Save the agenda to start the minutes record"
                  : "Add agenda items in the sidebar to start"}
              </span>
              {!agenda.length && (
                <div style={{ marginLeft: "auto", display: "flex", gap: 6 }}>
                  <button
                    className="btn-action btn-action--icon"
                    type="button"
                    disabled={agendaEdit !== null}
                    title={agendaEdit !== null ? "Use the agenda editor to add items" : "Add section"}
                    aria-label="Add section"
                    onClick={startFreshAgendaSection}
                  >
                    <Plus size={12} />
                  </button>
                </div>
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
                    <p>Add agenda items in the Agenda card on the left and save — the minutes record is created automatically with one section per item.</p>
                  </div>
                </div>
              )}

            </div>
          </div>
        )}
      </div>
      {isMobileSectionEditor && sectionEditIndex !== null && sectionDraft && renderSectionEditor("mobile")}
      {agendaItemMenu && (() => {
        const i = agendaItemMenu.index;
        const item = agendaItems[i];
        if (!item) return null;
        const isRoot = item.depth === 0;
        // canIndent/canOutdent mirror the original inline-button gating so we
        // don't permit illegal moves through the menu either.
        const canIndent = isRoot && agendaItems.slice(0, i).some((entry) => entry.depth === 0);
        const canOutdent = !isRoot;
        const trimmed = item.title.trim();
        const isEmpty = !trimmed;
        const isNew = newAgendaIndices.has(i);
        const linkedSectionDetailed = trimmed
          ? detailedSectionTitles.has(trimmed.toLowerCase())
          : false;
        const canRemove = isEmpty || isNew || !linkedSectionDetailed;
        return createPortal(
          <div
            ref={agendaItemMenuRef}
            className="menu menu--actions"
            role="menu"
            style={{ position: "fixed", top: agendaItemMenu.top, left: agendaItemMenu.left, width: 200, zIndex: 1000 }}
          >
            <div className="menu__section">
              <MenuRow
                role="menuitem"
                icon={<ArrowUp size={14} />}
                label="Move up"
                disabled={!canMoveAgendaUp(i)}
                onClick={() => {
                  closeAgendaItemMenu();
                  moveAgendaItem(i, -1);
                }}
              />
              <MenuRow
                role="menuitem"
                icon={<ArrowDown size={14} />}
                label="Move down"
                disabled={!canMoveAgendaDown(i)}
                onClick={() => {
                  closeAgendaItemMenu();
                  moveAgendaItem(i, 1);
                }}
              />
              <div className="menu__separator" />
              {isRoot ? (
                <MenuRow
                  role="menuitem"
                  icon={<IndentIncrease size={14} />}
                  label="Make sub-item"
                  disabled={!canIndent}
                  onClick={() => {
                    closeAgendaItemMenu();
                    indentAgendaItem(i);
                  }}
                />
              ) : (
                <MenuRow
                  role="menuitem"
                  icon={<IndentDecrease size={14} />}
                  label="Promote item"
                  disabled={!canOutdent}
                  onClick={() => {
                    closeAgendaItemMenu();
                    outdentAgendaItem(i);
                  }}
                />
              )}
              <div className="menu__separator" />
              <MenuRow
                role="menuitem"
                icon={<Trash2 size={14} />}
                label="Remove item"
                destructive
                disabled={!canRemove}
                onClick={() => {
                  closeAgendaItemMenu();
                  removeAgendaItem(i);
                }}
              />
            </div>
          </div>,
          document.body,
        );
      })()}
      {sectionContextMenu && (() => {
        const i = sectionContextMenu.sectionIndex;
        const section = sections[i];
        if (!section) return null;
        const isChild = section?.depth === 1;
        // While this section is being edited, swap Edit → Save and lock the
        // move actions: reordering would shift `sectionEditIndex` out from
        // under the open draft.
        const isEditingThis = sectionEditIndex === i;
        let canMoveUp = false;
        let canMoveDown = false;
        let onMoveUp: () => void = () => {};
        let onMoveDown: () => void = () => {};
        if (isChild) {
          // Children move within their parent group only.
          const groupIdx = rootGroups.findIndex((group) => group.includes(i));
          const group = groupIdx >= 0 ? rootGroups[groupIdx] : [];
          const position = group.indexOf(i);
          canMoveUp = position > 1;
          canMoveDown = position > 0 && position < group.length - 1;
          onMoveUp = () => {
            closeSectionContextMenu();
            void moveChild(i, -1);
          };
          onMoveDown = () => {
            closeSectionContextMenu();
            void moveChild(i, 1);
          };
        } else {
          const rootIdx = rootIndexBySectionIndex.get(i);
          canMoveUp = rootIdx != null && rootIdx > 0;
          canMoveDown = rootIdx != null && rootIdx < rootGroups.length - 1;
          onMoveUp = () => {
            closeSectionContextMenu();
            if (rootIdx != null) moveRootUp(rootIdx);
          };
          onMoveDown = () => {
            closeSectionContextMenu();
            if (rootIdx != null) moveRootDown(rootIdx);
          };
        }
        return createPortal(
          <div
            ref={sectionContextMenuRef}
            className="menu menu--actions"
            role="menu"
            style={{ position: "fixed", top: sectionContextMenu.top, left: sectionContextMenu.left, width: 200, zIndex: 1000 }}
          >
            <div className="menu__section">
              <MenuRow
                role="menuitem"
                icon={<ArrowUp size={14} />}
                label="Move up"
                disabled={!canMoveUp || isEditingThis}
                onClick={onMoveUp}
              />
              <MenuRow
                role="menuitem"
                icon={<ArrowDown size={14} />}
                label="Move down"
                disabled={!canMoveDown || isEditingThis}
                onClick={onMoveDown}
              />
              <div className="menu__separator" />
              {isEditingThis ? (
                <MenuRow
                  role="menuitem"
                  icon={<Save size={14} />}
                  label="Save"
                  onClick={() => {
                    closeSectionContextMenu();
                    void saveSectionEdit();
                  }}
                />
              ) : (
                <MenuRow
                  role="menuitem"
                  icon={<Pencil size={14} />}
                  label="Edit"
                  onClick={() => {
                    closeSectionContextMenu();
                    startSectionEdit(i);
                  }}
                />
              )}
              {!isEditingThis && (
                <>
                  <div className="menu__separator" />
                  <MenuRow
                    role="menuitem"
                    icon={<Trash2 size={14} />}
                    label={isChild ? "Remove sub-item" : "Remove section"}
                    destructive
                    onClick={() => {
                      closeSectionContextMenu();
                      void confirmAndRemoveSection(i);
                    }}
                  />
                </>
              )}
            </div>
          </div>,
          document.body,
        );
      })()}
    </div>
  );
}
