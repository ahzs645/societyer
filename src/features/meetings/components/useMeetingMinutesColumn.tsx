// MeetingMinutesColumn state + behavior extracted into a hook so the component
// file is presentation-focused. Verbatim body move.

import { type DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, ChevronDown, ClipboardList, Eye, EyeOff, FileText, GripVertical, IndentDecrease, IndentIncrease, ListChecks, Mic, MoreHorizontal, Pencil, Plus, Save, Trash2, Unlink, X } from "lucide-react";
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
  SECTION_TYPE_PILLS,
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
import { agendaSequenceLabel } from "../lib/agendaNumbering";
import type {
  AgendaNumberingMode,
  SectionDraft,
  SectionEditorTab,
  SectionActionDraft,
  AttendancePerson,
} from "./MeetingMinutesColumn.internal";

export type MeetingMinutesColumnProps = {
  minutes: any;
  agenda: string[];
  agendaTree: AgendaItemEntry[];
  agendaEdit: AgendaItemEntry[] | null;
  setAgendaEdit: (value: AgendaItemEntry[] | null) => void;
  saveAgenda: () => void | Promise<void>;
  attendanceEdit: any;
  setAttendanceEdit: (value: any) => void;
  startAttendanceEdit: () => void;
  autofillCurrentDirectors: () => void;
  saveAttendance: () => void | Promise<void>;
  quorumSnapshot: any;
  quorumLegalGuides: any[];
  members: any;
  directors: any;
  saveMinuteSections: (next: any[]) => void | Promise<void> | undefined;
  saveMinuteMotions: (next: Motion[]) => void | Promise<void> | undefined;
  addSectionToBacklog: (section: any) => void | Promise<void>;
  onOpenMotions?: () => void;
  meetingTasks: any[];
  applyTaskUpdate: (taskId: string, patch: { status?: string; completionNote?: string }) => void | Promise<void>;
  createTaskForMeeting?: (input: { title: string; priority: string; status: string; dueDate?: string }) => Promise<string | undefined | void> | string | undefined | void;
  transcriptOnFile: string;
  transcriptEdit: string | null;
  setTranscriptEdit: (value: string | null) => void;
  saveTranscriptEditText: () => Promise<void> | void;
  savingTranscript: boolean;
};

export function useMeetingMinutesColumn(props: MeetingMinutesColumnProps) {
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
  saveMinuteSections,
  saveMinuteMotions,
  addSectionToBacklog,
  onOpenMotions,
  meetingTasks,
  applyTaskUpdate,
  createTaskForMeeting,
  transcriptOnFile,
  transcriptEdit,
  setTranscriptEdit,
  saveTranscriptEditText,
  savingTranscript,
  } = props;
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
  const detailedSectionTitles = useMemo(() => {
    const set = new Set<string>();
    sections.forEach((section: any, index: number) => {
      const hasMotion = relatedMotionsForSection(section, index, motions).length > 0;
      if (!sectionHasDetails(section) && !hasMotion) return;
      const title = String(section?.title ?? "").trim().toLowerCase();
      if (title) set.add(title);
    });
    return set;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sections, motions]);
  const [sectionEditIndex, setSectionEditIndex] = useState<number | null>(null);
  const [sectionDraft, setSectionDraft] = useState<SectionDraft | null>(null);
  const [agendaNumberingMode, setAgendaNumberingMode] = useState<AgendaNumberingMode>(readStoredAgendaNumberingMode);
  // Drag-to-reorder + right-click menu state for root sections in the agenda
  // record. Both work on root indices (position in `rootGroups`), not the
  // raw section index, so children move with their parent.
  const [dragRootIndex, setDragRootIndex] = useState<number | null>(null);
  const [dropRootIndex, setDropRootIndex] = useState<number | null>(null);
  // Section index drives the menu — depth/position are derived from it at
  // render time so the menu stays accurate if sections shift while it's open.
  const [sectionContextMenu, setSectionContextMenu] = useState<
    { sectionIndex: number; top: number; left: number } | null
  >(null);
  const sectionContextMenuRef = useRef<HTMLDivElement | null>(null);
  const [sectionEditorTab, setSectionEditorTab] = useState<SectionEditorTab>("notes");
  const confirm = useConfirm();
  const attendancePresentCount = attendanceEdit
    ? attendanceEdit.people.filter((person: AttendancePerson) => person.status === "present").length
    : minutes?.attendees.length;
  const [newAgendaIndices, setNewAgendaIndices] = useState<Set<number>>(() => new Set());
  const agendaInputRefs = useRef<Array<HTMLInputElement | null>>([]);
  const pendingFocusIndex = useRef<number | null>(null);

  useEffect(() => {
    window.localStorage.setItem(AGENDA_NUMBERING_PREF_KEY, agendaNumberingMode);
  }, [agendaNumberingMode]);
  const sectionTitleRef = useRef<HTMLInputElement | null>(null);
  const sectionMobileTitleRef = useRef<HTMLInputElement | null>(null);
  const sectionDiscussionRef = useRef<MarkdownEditorHandle | null>(null);
  const focusSectionTitleOnEdit = useRef(false);
  const [isMobileSectionEditor, setIsMobileSectionEditor] = useState(false);

  useEffect(() => {
    const query = window.matchMedia("(max-width: 760px)");
    const update = () => setIsMobileSectionEditor(query.matches);
    update();
    query.addEventListener("change", update);
    return () => query.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (agendaEdit === null) setNewAgendaIndices(new Set());
  }, [agendaEdit]);

  // Re-runs when the agenda items array changes — that's the only state path
  // that sets pendingFocusIndex, so the previous "no deps" version was firing
  // on every render and just early-returning.
  useEffect(() => {
    if (pendingFocusIndex.current == null) return;
    const target = agendaInputRefs.current[pendingFocusIndex.current];
    pendingFocusIndex.current = null;
    target?.focus();
  }, [agendaEdit]);

  // Same idea: focusSectionTitleOnEdit is only flipped when entering section
  // edit mode, which always coincides with a sectionEditIndex change.
  useEffect(() => {
    if (!focusSectionTitleOnEdit.current) return;
    if (sectionEditIndex == null) return;
    const node = isMobileSectionEditor ? sectionMobileTitleRef.current : sectionTitleRef.current;
    if (!node) return;
    focusSectionTitleOnEdit.current = false;
    node.focus();
    node.select();
  }, [isMobileSectionEditor, sectionEditIndex]);

  const addSection = async () => {
    const newTitle = "New section";
    const newIndex = sections.length;
    const next = [
      ...sections,
      {
        title: newTitle,
        type: "discussion",
        discussion: "",
        decisions: [],
        actionItems: [],
      },
    ];
    await saveMinuteSections(next);
    if (agendaEdit !== null) {
      // Sections are root agenda items; never auto-add as a child.
      setAgendaEdit([...agendaEdit, { title: newTitle, depth: 0 }]);
    }
    setOpenSectionIndexes((current) => new Set(current).add(newIndex));
    focusSectionTitleOnEdit.current = true;
    setSectionEditIndex(newIndex);
    setSectionEditorTab("notes");
    setSectionDraft({
      title: "New section",
      type: "discussion",
      presenter: "",
      discussion: "",
      decisions: [],
      actionItems: [],
      linkedTaskIds: [],
      taskUpdates: {},
      publicVisible: true,
    });
  };

  const removeSection = async (index: number) => {
    const removed = sections[index];
    // Removing a root drops its trailing children too — leaving them parentless
    // would break the agenda invariant on the next save and surprise the user.
    let removeCount = 1;
    if ((removed?.depth ?? 0) === 0) {
      while ((sections[index + removeCount]?.depth ?? 0) === 1) removeCount += 1;
    }
    const removedTitleSet = new Set<string>();
    const removedIndexSet = new Set<number>();
    for (let i = index; i < index + removeCount; i += 1) {
      const t = String(sections[i]?.title ?? "").trim().toLowerCase();
      if (t) removedTitleSet.add(t);
      removedIndexSet.add(i);
    }
    const next = sections.slice();
    next.splice(index, removeCount);
    await saveMinuteSections(next);

    // Motions live on minutes.motions, not inside the section, so we have to
    // clean them up explicitly: drop motions assigned to a removed section
    // and shift sectionIndex down for motions on later sections.
    const cleanedMotions = motions
      .filter((motion) => {
        if (motion.sectionIndex != null && removedIndexSet.has(motion.sectionIndex)) return false;
        if (
          motion.sectionTitle &&
          removedTitleSet.has(String(motion.sectionTitle).trim().toLowerCase()) &&
          (motion.sectionIndex == null || removedIndexSet.has(motion.sectionIndex))
        ) return false;
        return true;
      })
      .map((motion) =>
        motion.sectionIndex != null && motion.sectionIndex >= index + removeCount
          ? { ...motion, sectionIndex: motion.sectionIndex - removeCount }
          : motion,
      );
    const motionsChanged =
      cleanedMotions.length !== motions.length ||
      cleanedMotions.some((m, i) => m !== motions[i]);
    if (motionsChanged) await saveMinuteMotions(cleanedMotions);

    if (sectionEditIndex === index) {
      setSectionEditIndex(null);
      setSectionDraft(null);
    }
  };

  const agendaItems: AgendaItemEntry[] = agendaEdit ?? [];
  const writeAgendaItems = (next: AgendaItemEntry[]) => setAgendaEdit(next);
  const updateAgendaItem = (index: number, value: string) => {
    const next = agendaItems.slice();
    if (!next[index]) return;
    next[index] = { ...next[index], title: value };
    writeAgendaItems(next);
  };
  const addAgendaItem = (afterIndex?: number, depth?: 0 | 1) => {
    const next = agendaItems.slice();
    const insertAt = afterIndex == null ? next.length : afterIndex + 1;
    // New row inherits the depth of the row it's spawned from when not
    // explicitly told otherwise — Enter on a sub-item makes another sub-item.
    const inferredDepth: 0 | 1 = depth ?? (afterIndex != null ? next[afterIndex]?.depth ?? 0 : 0);
    // A child is only legal if a root precedes it; otherwise demote.
    const safeDepth: 0 | 1 = inferredDepth === 1 && next.slice(0, insertAt).some((item) => item.depth === 0) ? 1 : 0;
    next.splice(insertAt, 0, { title: "", depth: safeDepth });
    writeAgendaItems(next);
    setNewAgendaIndices((prev) => {
      const out = new Set<number>();
      for (const i of prev) out.add(i >= insertAt ? i + 1 : i);
      out.add(insertAt);
      return out;
    });
    pendingFocusIndex.current = insertAt;
  };
  const startFreshAgendaSection = () => {
    pendingFocusIndex.current = 0;
    setNewAgendaIndices(new Set([0]));
    setAgendaEdit([{ title: "", depth: 0 }]);
  };
  const removeAgendaItem = (index: number) => {
    const next = agendaItems.slice();
    const target = next[index];
    if (!target) return;
    // Removing a root drops its trailing children too — children without a
    // parent would otherwise re-promote on save and silently change order.
    let removedCount = 1;
    if (target.depth === 0) {
      while (next[index + removedCount]?.depth === 1) removedCount += 1;
    }
    next.splice(index, removedCount);
    writeAgendaItems(next);
    setNewAgendaIndices((prev) => {
      const out = new Set<number>();
      const removeRange = new Set<number>();
      for (let i = index; i < index + removedCount; i += 1) removeRange.add(i);
      for (const i of prev) {
        if (removeRange.has(i)) continue;
        out.add(i > index ? i - removedCount : i);
      }
      return out;
    });
  };
  const indentAgendaItem = (index: number) => {
    const item = agendaItems[index];
    if (!item || item.depth === 1) return;
    // Need a root above to attach to.
    const hasRootAbove = agendaItems.slice(0, index).some((entry) => entry.depth === 0);
    if (!hasRootAbove) return;
    const next = agendaItems.slice();
    next[index] = { ...item, depth: 1 };
    writeAgendaItems(next);
    pendingFocusIndex.current = index;
  };
  const outdentAgendaItem = (index: number) => {
    const item = agendaItems[index];
    if (!item || item.depth === 0) return;
    const next = agendaItems.slice();
    next[index] = { ...item, depth: 0 };
    writeAgendaItems(next);
    pendingFocusIndex.current = index;
  };
  const groupSizeAt = (index: number, list: AgendaItemEntry[]) => {
    // Roots travel with their immediate children when reordered.
    if (!list[index]) return 0;
    if (list[index].depth === 1) return 1;
    let size = 1;
    while (list[index + size]?.depth === 1) size += 1;
    return size;
  };
  /** Walk backwards from a child row to find its owning root. Returns -1 if
   * the index isn't a child or no root precedes it. */
  const findParentRootIndex = (index: number, list: AgendaItemEntry[]) => {
    if (list[index]?.depth !== 1) return -1;
    let parent = index - 1;
    while (parent >= 0 && list[parent].depth === 1) parent -= 1;
    return parent;
  };
  const moveAgendaItem = (index: number, direction: -1 | 1) => {
    const item = agendaItems[index];
    if (!item) return;
    const next = agendaItems.slice();
    if (item.depth === 0) {
      const groupSize = groupSizeAt(index, next);
      if (direction === -1) {
        // Find previous root; swap groups.
        let prev = index - 1;
        while (prev >= 0 && next[prev].depth === 1) prev -= 1;
        if (prev < 0) return;
        const ourGroup = next.splice(index, groupSize);
        next.splice(prev, 0, ...ourGroup);
        pendingFocusIndex.current = prev;
      } else {
        const after = index + groupSize;
        if (after >= next.length) return;
        const nextGroupSize = groupSizeAt(after, next);
        const otherGroup = next.splice(after, nextGroupSize);
        next.splice(index, 0, ...otherGroup);
        pendingFocusIndex.current = index + nextGroupSize;
      }
    } else {
      // Child reorders within its parent's group only — won't escape upward.
      const target = index + direction;
      if (target < 0 || target >= next.length) return;
      if (next[target].depth !== 1) return;
      [next[index], next[target]] = [next[target], next[index]];
      pendingFocusIndex.current = target;
    }
    writeAgendaItems(next);
  };

  // Drag-to-reorder for agenda items. Roots reorder among other roots (their
  // children travel along via groupSizeAt). Children reorder only within their
  // own parent's group — they can't escape upward or jump into a sibling
  // group via drag (Tab/Shift-Tab is still the way to change depth).
  const agendaDragSourceRef = useRef(false);
  const [agendaDragIndex, setAgendaDragIndex] = useState<number | null>(null);
  const [agendaDropIndex, setAgendaDropIndex] = useState<number | null>(null);

  const reorderAgendaRoot = (fromIndex: number, toIndex: number) => {
    const list = agendaItems;
    if (!list[fromIndex] || list[fromIndex].depth !== 0) return;
    const groupSize = groupSizeAt(fromIndex, list);
    // No-op when dropping back into the same slot or onto the slot right after
    // (which is the same position once the source is removed).
    if (toIndex === fromIndex || toIndex === fromIndex + groupSize) return;
    const next = list.slice();
    const removed = next.splice(fromIndex, groupSize);
    let insertAt = toIndex;
    if (toIndex > fromIndex) insertAt -= groupSize;
    next.splice(Math.max(0, Math.min(insertAt, next.length)), 0, ...removed);
    pendingFocusIndex.current = Math.min(insertAt, next.length - 1);
    writeAgendaItems(next);
  };

  const reorderAgendaChild = (fromIndex: number, toIndex: number) => {
    const list = agendaItems;
    if (!list[fromIndex] || list[fromIndex].depth !== 1) return;
    const parent = findParentRootIndex(fromIndex, list);
    if (parent < 0) return;
    // Valid drop slots span from just after the parent (parent + 1) through
    // just after the last child (parent + groupSize). Anything outside that
    // range would migrate the child into another group, which drag mustn't do.
    const parentGroupSize = groupSizeAt(parent, list);
    const minDrop = parent + 1;
    const maxDrop = parent + parentGroupSize;
    if (toIndex < minDrop || toIndex > maxDrop) return;
    if (toIndex === fromIndex || toIndex === fromIndex + 1) return;
    const next = list.slice();
    const [removed] = next.splice(fromIndex, 1);
    let insertAt = toIndex;
    if (toIndex > fromIndex) insertAt -= 1;
    next.splice(insertAt, 0, removed);
    pendingFocusIndex.current = insertAt;
    writeAgendaItems(next);
  };

  const onAgendaDragStart = (index: number) => (event: ReactDragEvent) => {
    // Only the grip mousedown sets the source flag — clicking inside the input
    // shouldn't trigger a drag, even though the row is `draggable`.
    const depth = agendaItems[index]?.depth;
    if (!agendaDragSourceRef.current || (depth !== 0 && depth !== 1)) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", String(index));
    setAgendaDragIndex(index);
  };

  const onAgendaDragOver = (rowIndex: number) => (event: ReactDragEvent) => {
    if (agendaDragIndex === null) return;
    // Always preventDefault while a drag is active so the browser doesn't
    // flash the "not allowed" cursor whenever we cross a row we can't drop
    // onto. Whether the row is actually a valid drop is decided below by
    // looking at whether we set agendaDropIndex.
    event.preventDefault();

    const sourceDepth = agendaItems[agendaDragIndex]?.depth;
    const rowDepth = agendaItems[rowIndex]?.depth;
    const rect = (event.currentTarget as HTMLElement).getBoundingClientRect();
    const isTopHalf = event.clientY < rect.top + rect.height / 2;

    if (sourceDepth === 0) {
      // Roots ride with their whole group. When the pointer is over a child
      // row, treat it as "near that child's parent" so the drop indicator
      // still resolves to a sensible slot instead of feeling broken.
      let targetRoot = rowIndex;
      let landAfter = !isTopHalf;
      if (rowDepth === 1) {
        const parent = findParentRootIndex(rowIndex, agendaItems);
        if (parent < 0) return;
        targetRoot = parent;
        landAfter = true; // children inherit a single "after this group" slot
      }
      const targetGroupSize = groupSizeAt(targetRoot, agendaItems);
      const dropIndex = landAfter ? targetRoot + targetGroupSize : targetRoot;
      const sourceGroup = groupSizeAt(agendaDragIndex, agendaItems);
      if (dropIndex === agendaDragIndex || dropIndex === agendaDragIndex + sourceGroup) {
        if (agendaDropIndex !== null) setAgendaDropIndex(null);
        return;
      }
      if (agendaDropIndex !== dropIndex) setAgendaDropIndex(dropIndex);
      return;
    }

    if (sourceDepth === 1) {
      const sourceParent = findParentRootIndex(agendaDragIndex, agendaItems);
      if (sourceParent < 0) return;
      // Hovering the child's own parent row → drop at the top of the group.
      // Any other root is ignored (leaves the last valid drop slot in place).
      if (rowDepth === 0) {
        if (rowIndex !== sourceParent) return;
        const dropIndex = sourceParent + 1;
        if (dropIndex === agendaDragIndex || dropIndex === agendaDragIndex + 1) {
          if (agendaDropIndex !== null) setAgendaDropIndex(null);
          return;
        }
        if (agendaDropIndex !== dropIndex) setAgendaDropIndex(dropIndex);
        return;
      }
      if (rowDepth === 1) {
        const targetParent = findParentRootIndex(rowIndex, agendaItems);
        if (sourceParent !== targetParent) return;
        const dropIndex = isTopHalf ? rowIndex : rowIndex + 1;
        if (dropIndex === agendaDragIndex || dropIndex === agendaDragIndex + 1) {
          if (agendaDropIndex !== null) setAgendaDropIndex(null);
          return;
        }
        if (agendaDropIndex !== dropIndex) setAgendaDropIndex(dropIndex);
      }
    }
  };

  const onAgendaDrop = (event: ReactDragEvent) => {
    event.preventDefault();
    const from = agendaDragIndex;
    const to = agendaDropIndex;
    setAgendaDragIndex(null);
    setAgendaDropIndex(null);
    agendaDragSourceRef.current = false;
    if (from === null || to === null) return;
    const depth = agendaItems[from]?.depth;
    if (depth === 0) reorderAgendaRoot(from, to);
    else if (depth === 1) reorderAgendaChild(from, to);
  };

  const onAgendaDragEnd = () => {
    setAgendaDragIndex(null);
    setAgendaDropIndex(null);
    agendaDragSourceRef.current = false;
  };

  // Per-row overflow menu — replaces the inline outdent/indent/remove buttons
  // with a single "More" button that opens a menu with Move up / Move down /
  // Indent or Outdent / Remove. Keeps the row chrome quiet.
  const [agendaItemMenu, setAgendaItemMenu] = useState<
    { index: number; top: number; left: number } | null
  >(null);
  const agendaItemMenuRef = useRef<HTMLDivElement | null>(null);

  const closeAgendaItemMenu = () => setAgendaItemMenu(null);

  useEffect(() => {
    if (!agendaItemMenu) return;
    const onDown = (event: MouseEvent) => {
      if (agendaItemMenuRef.current?.contains(event.target as Node)) return;
      closeAgendaItemMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeAgendaItemMenu();
    };
    const close = () => closeAgendaItemMenu();
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", close);
    window.addEventListener("scroll", close, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", close);
      window.removeEventListener("scroll", close, true);
    };
  }, [agendaItemMenu]);

  const canMoveAgendaUp = (index: number) => {
    const item = agendaItems[index];
    if (!item) return false;
    if (item.depth === 0) {
      let prev = index - 1;
      while (prev >= 0 && agendaItems[prev].depth === 1) prev -= 1;
      return prev >= 0;
    }
    return index > 0 && agendaItems[index - 1]?.depth === 1;
  };

  const canMoveAgendaDown = (index: number) => {
    const item = agendaItems[index];
    if (!item) return false;
    if (item.depth === 0) {
      const groupSize = groupSizeAt(index, agendaItems);
      return index + groupSize < agendaItems.length;
    }
    return index + 1 < agendaItems.length && agendaItems[index + 1]?.depth === 1;
  };

  const openAgendaItemMenu = (index: number, anchor: HTMLElement) => {
    const rect = anchor.getBoundingClientRect();
    const gap = 4;
    const menuWidth = 200;
    const margin = 8;
    let left = rect.right - menuWidth;
    if (left < margin) left = margin;
    if (left + menuWidth > window.innerWidth - margin) {
      left = window.innerWidth - menuWidth - margin;
    }
    setAgendaItemMenu({ index, top: rect.bottom + gap, left });
  };

  const [openSectionIndexes, setOpenSectionIndexes] = useState<Set<number>>(() => new Set([0, 1]));
  // Handle to the section-scoped MotionEditor so saveSectionEdit can flush any
  // in-progress motion draft before persisting the section itself. Without
  // this, hitting "Save section" while typing a new motion would silently
  // discard the draft.
  const sectionMotionEditorRef = useRef<MotionEditorHandle | null>(null);
  const [hasPendingSectionMotion, setHasPendingSectionMotion] = useState(false);
  const motionPeople = useMemo(() => personLinkCandidates(members, directors), [members, directors]);
  const assigneeOptions = useMemo(
    () => Array.from(new Set(motionPeople.map((p) => p.name))).filter(Boolean).sort(),
    [motionPeople],
  );
  const motionMatchesBySection = useMemo(
    () => sections.map((section: any, index: number) => relatedMotionsForSection(section, index, motions)),
    [sections, motions],
  );
  // Merged section list: when the agenda is mid-edit, this reorders existing
  // sections to follow agendaEdit's positions and inserts placeholder rows for
  // not-yet-saved titles where they will land on save. When the agenda isn't
  // being edited, this is just `sections` with computed labels. Labels follow
  // the "1.", "1a.", "2." pattern based on depth in the merged sequence.
  type MergedRow =
    | { kind: "section"; section: any; sectionIndex: number; depth: 0 | 1; label: string }
    | { kind: "preview"; title: string; depth: 0 | 1; label: string };
  const mergedSectionRows = useMemo<MergedRow[]>(() => {
    const computeLabel = (rootCount: number, childCount: number) =>
      agendaSequenceLabel(rootCount, childCount, agendaNumberingMode);

    if (agendaEdit === null) {
      const rows: MergedRow[] = [];
      let rootCount = 0;
      let childCount = 0;
      sections.forEach((section: any, index: number) => {
        const depth: 0 | 1 = section?.depth === 1 ? 1 : 0;
        if (depth === 0 || rootCount === 0) {
          rootCount += 1;
          childCount = 0;
        } else {
          childCount += 1;
        }
        rows.push({
          kind: "section",
          section,
          sectionIndex: index,
          depth,
          label: computeLabel(rootCount, childCount),
        });
      });
      return rows;
    }

    // Agenda-edit mode: walk agendaEdit in order, matching titles to existing
    // sections so reordering shows immediately; insert previews for titles
    // that don't have a section yet. Append unused sections (orphans, plus
    // any that will be deleted on save) at the end.
    const sectionByTitle = new Map<string, number>();
    sections.forEach((section: any, i: number) => {
      const key = String(section?.title ?? "").trim().toLowerCase();
      if (key && !sectionByTitle.has(key)) sectionByTitle.set(key, i);
    });
    const usedSectionIndexes = new Set<number>();
    const rows: MergedRow[] = [];
    let rootCount = 0;
    let childCount = 0;
    let hasRoot = false;
    for (const entry of agendaEdit) {
      const title = entry.title.trim();
      if (!title) continue;
      const depth: 0 | 1 = entry.depth === 1 && hasRoot ? 1 : 0;
      if (depth === 0) {
        rootCount += 1;
        childCount = 0;
        hasRoot = true;
      } else {
        childCount += 1;
      }
      const label = computeLabel(rootCount, childCount);
      const matchIndex = sectionByTitle.get(title.toLowerCase());
      if (matchIndex != null && !usedSectionIndexes.has(matchIndex)) {
        usedSectionIndexes.add(matchIndex);
        rows.push({
          kind: "section",
          section: sections[matchIndex],
          sectionIndex: matchIndex,
          depth,
          label,
        });
      } else {
        rows.push({ kind: "preview", title, depth, label });
      }
    }
    sections.forEach((section: any, index: number) => {
      if (usedSectionIndexes.has(index)) return;
      const depth: 0 | 1 = section?.depth === 1 ? 1 : 0;
      if (depth === 0 || rootCount === 0) {
        rootCount += 1;
        childCount = 0;
      } else {
        childCount += 1;
      }
      rows.push({
        kind: "section",
        section,
        sectionIndex: index,
        depth,
        label: computeLabel(rootCount, childCount),
      });
    });
    return rows;
  }, [agendaEdit, agendaNumberingMode, sections]);
  // Hide children whose parent is collapsed, so the parent's `<details>`
  // disclosure also gates its sub-items — matches outline-tree intuition.
  // Previews (in-flight agenda additions) are always shown since they have no
  // saved open state to consult.
  const hiddenRowIndexes = useMemo(() => {
    const hidden = new Set<number>();
    for (let i = 0; i < mergedSectionRows.length; i += 1) {
      const row = mergedSectionRows[i];
      if (row.depth !== 0) continue;
      const isOpen = row.kind === "section" ? openSectionIndexes.has(row.sectionIndex) : true;
      if (isOpen) continue;
      for (let j = i + 1; j < mergedSectionRows.length && mergedSectionRows[j].depth === 1; j += 1) {
        hidden.add(j);
      }
    }
    return hidden;
  }, [mergedSectionRows, openSectionIndexes]);
  // Root groups for drag-to-reorder: each entry holds the section indices that
  // belong to one root (the root itself plus any depth-1 children that follow
  // it). A leading depth-1 section (which shouldn't normally exist) gets its
  // own group so we never lose track of it.
  const rootGroups = useMemo(() => {
    const groups: number[][] = [];
    sections.forEach((section: any, index: number) => {
      const depth = section?.depth === 1 ? 1 : 0;
      if (depth === 1 && groups.length > 0) {
        groups[groups.length - 1].push(index);
      } else {
        groups.push([index]);
      }
    });
    return groups;
  }, [sections]);
  const rootIndexBySectionIndex = useMemo(() => {
    const map = new Map<number, number>();
    rootGroups.forEach((group, rootIdx) => {
      // Only the first index of a group is a "root" for drag/menu purposes.
      map.set(group[0], rootIdx);
    });
    return map;
  }, [rootGroups]);
  const reorderRoots = async (fromRootIndex: number, toRootIndex: number) => {
    // toRootIndex is a "drop slot" — drop above index N means insert before
    // the group currently at N. Dropping at fromRootIndex (above self) or
    // fromRootIndex+1 (immediately below self) is a no-op.
    if (toRootIndex === fromRootIndex || toRootIndex === fromRootIndex + 1) return;
    if (fromRootIndex < 0 || fromRootIndex >= rootGroups.length) return;
    if (toRootIndex < 0 || toRootIndex > rootGroups.length) return;
    const remaining = rootGroups.filter((_, i) => i !== fromRootIndex);
    // Splicing into `remaining` shifts the target down by one if we removed
    // a group that came before it.
    const adjustedTo = fromRootIndex < toRootIndex ? toRootIndex - 1 : toRootIndex;
    remaining.splice(adjustedTo, 0, rootGroups[fromRootIndex]);
    const finalOldIndexes = remaining.flat();
    const newSections = finalOldIndexes.map((oldIdx) => sections[oldIdx]);
    const { motions: remappedMotions, changed: motionsChanged } =
      remapMotionsByIndexOrder(motions, finalOldIndexes);
    await saveMinuteSections(newSections);
    if (motionsChanged) await saveMinuteMotions(remappedMotions);
  };
  const moveRootUp = (rootIndex: number) => {
    if (rootIndex <= 0) return;
    void reorderRoots(rootIndex, rootIndex - 1);
  };
  const moveRootDown = (rootIndex: number) => {
    if (rootIndex >= rootGroups.length - 1) return;
    void reorderRoots(rootIndex, rootIndex + 2);
  };
  // Reorder a child within its parent's group only — children can't escape
  // their parent here. Same motion-remap logic as reorderRoots.
  const moveChild = async (childSectionIndex: number, direction: -1 | 1) => {
    const groupIdx = rootGroups.findIndex((group) => group.includes(childSectionIndex));
    if (groupIdx < 0) return;
    const group = rootGroups[groupIdx];
    const position = group.indexOf(childSectionIndex);
    // Position 0 is the root; children occupy 1..length-1.
    if (position <= 0) return;
    const target = position + direction;
    if (target <= 0 || target >= group.length) return;
    const newGroup = group.slice();
    [newGroup[position], newGroup[target]] = [newGroup[target], newGroup[position]];
    const newRootGroups = rootGroups.map((g, i) => (i === groupIdx ? newGroup : g));
    const finalOldIndexes = newRootGroups.flat();
    const newSections = finalOldIndexes.map((oldIdx) => sections[oldIdx]);
    const { motions: remappedMotions, changed: motionsChanged } =
      remapMotionsByIndexOrder(motions, finalOldIndexes);
    await saveMinuteSections(newSections);
    if (motionsChanged) await saveMinuteMotions(remappedMotions);
  };
  // Single source for the "delete this section" interaction — empty sections
  // remove silently, populated ones go through the confirm modal first.
  const confirmAndRemoveSection = async (index: number) => {
    const section = sections[index];
    if (!section) return;
    // When the user is mid-edit on this section, evaluate the in-progress
    // draft instead of the persisted section — otherwise unsaved notes,
    // decisions, or task changes would be silently discarded.
    const isEditingThis = sectionEditIndex === index && !!sectionDraft;
    const sectionContentEmpty = (candidate: any, candidateIndex: number) =>
      !candidate?.discussion &&
      !candidate?.presenter &&
      !(candidate?.decisions ?? []).length &&
      !(candidate?.actionItems ?? []).length &&
      !(candidate?.linkedTaskIds ?? []).length &&
      !(motionMatchesBySection[candidateIndex]?.length);
    // Removing a root cascades to its trailing sub-sections (see removeSection),
    // so their content must count toward "is anything being lost?" too.
    const childIndexes: number[] = [];
    if ((section?.depth ?? 0) === 0) {
      for (let i = index + 1; (sections[i]?.depth ?? 0) === 1; i += 1) childIndexes.push(i);
    }
    const childrenWithContent = childIndexes.filter((i) => !sectionContentEmpty(sections[i], i));
    const sectionEmpty = sectionContentEmpty(section, index) && childrenWithContent.length === 0;
    const draftEmpty = !isEditingThis || (
      !sectionDraft?.discussion &&
      !sectionDraft?.presenter &&
      !(sectionDraft?.decisions ?? []).filter((line) => line.trim()).length &&
      !(sectionDraft?.actionItems ?? []).filter((item) => item.text.trim()).length &&
      !(sectionDraft?.linkedTaskIds ?? []).length &&
      Object.keys(sectionDraft?.taskUpdates ?? {}).length === 0
    );
    if (sectionEmpty && draftEmpty) {
      void removeSection(index);
      return;
    }
    const hasUnsavedDraftChanges = isEditingThis && !draftEmpty;
    const titleForPrompt = (isEditingThis ? sectionDraft?.title : section.title) || "Untitled section";
    const childWarning = childIndexes.length
      ? ` Its ${childIndexes.length} sub-item${childIndexes.length === 1 ? "" : "s"} will be removed too${childrenWithContent.length ? ", including recorded content" : ""}.`
      : "";
    const ok = await confirm({
      title: `Delete "${titleForPrompt}"?`,
      message: hasUnsavedDraftChanges
        ? `This section has unsaved changes. Removing it will discard those edits along with any existing notes, decisions, and action items.${childWarning}`
        : `Notes, decisions, and action items in this section will be removed.${childWarning}`,
      confirmLabel: "Delete section",
      tone: "danger",
    });
    if (!ok) return;
    void removeSection(index);
  };
  const closeSectionContextMenu = () => setSectionContextMenu(null);
  // Dismiss the section context menu on outside click or Escape.
  useEffect(() => {
    if (!sectionContextMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (sectionContextMenuRef.current?.contains(event.target as Node)) return;
      closeSectionContextMenu();
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") closeSectionContextMenu();
    };
    window.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [sectionContextMenu]);
  const agendaPreviewRemovals = useMemo(() => {
    if (agendaEdit === null) return new Set<number>();
    const upcoming = new Set<string>(
      agendaEdit
        .map((entry) => entry.title.trim().toLowerCase())
        .filter(Boolean),
    );
    const removals = new Set<number>();
    sections.forEach((section: any, index: number) => {
      const title = String(section?.title ?? "").trim().toLowerCase();
      if (!title) return;
      if (upcoming.has(title)) return;
      if (sectionHasDetails(section)) return;
      removals.add(index);
    });
    return removals;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [agendaEdit, sections]);
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
      decisions: Array.isArray(section.decisions) ? section.decisions : [],
      actionItems: normalizeActionDrafts(section.actionItems ?? []),
      linkedTaskIds: Array.isArray(section.linkedTaskIds) ? section.linkedTaskIds : [],
      taskUpdates: {},
      publicVisible: section.publicVisible !== false,
    });
  };

  const saveSectionEdit = async () => {
    if (sectionEditIndex == null || !sectionDraft) return;
    // Flush any in-progress motion draft first so it lands in motions[] before
    // we close the editor. commitDraft is a no-op when there's nothing to
    // commit (empty text or no open draft), so it's safe to always call.
    sectionMotionEditorRef.current?.commitDraft();
    // Read the editor's current markdown directly — Milkdown's onChange flows
    // through React state, and a fast Save click can land before that
    // re-render has flushed.
    const latestDiscussion =
      sectionDiscussionRef.current?.getMarkdown() ?? sectionDraft.discussion;
    const existing = sections[sectionEditIndex] ?? {};
    const next = [...sections];
    // Build the section explicitly rather than spreading `existing` so we don't
    // pass through fields the `update` mutation validator doesn't accept
    // (motionText/motionTemplateId/motionId etc. live on storage but not
    // on the mutation arg). `depth` and `reportSubmitted` are the only legacy
    // fields we need to preserve.
    next[sectionEditIndex] = {
      title: sectionDraft.title.trim() || existing.title || "Untitled section",
      type: sectionDraft.type.trim() || undefined,
      presenter: cleanOptional(sectionDraft.presenter),
      discussion: cleanOptional(latestDiscussion),
      reportSubmitted: existing.reportSubmitted,
      depth: existing.depth,
      decisions: sectionDraft.decisions.map((d) => d.trim()).filter(Boolean),
      actionItems: sectionDraft.actionItems
        .map((item) => ({
          text: item.text.trim(),
          assignee: cleanOptional(item.assignee),
          dueDate: cleanOptional(item.dueDate),
          done: !!item.done,
        }))
        .filter((item) => item.text),
      linkedTaskIds: sectionDraft.linkedTaskIds.length ? sectionDraft.linkedTaskIds : undefined,
      publicVisible: sectionDraft.publicVisible ? undefined : false,
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

  const cancelSectionEdit = () => {
    setSectionEditIndex(null);
    setSectionDraft(null);
  };

  // Belt-and-suspenders: even though MotionEditor fires onPendingDraftChange
  // on unmount, clear the flag here too so the button label resets the moment
  // the section editor closes for any reason.
  useEffect(() => {
    if (sectionEditIndex == null) setHasPendingSectionMotion(false);
  }, [sectionEditIndex]);

  const assignMotionToSection = async (motionIndex: number, targetIndexValue: string) => {
    const existingMotion = motions[motionIndex];
    const existingIndex = assignedSectionIndexForMotion(existingMotion, sections);
    if (targetIndexValue === "") {
      if (existingIndex != null) {
        const ok = await confirm({
          title: "Unassign motion?",
          message: "This removes the agenda link from the motion. The motion itself will stay in the minutes.",
          confirmLabel: "Unassign",
          tone: "warn",
        });
        if (!ok) return;
      }
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
    if (existingIndex != null && existingIndex !== targetIndex) {
      const currentTitle = sections[existingIndex]?.title || "the current agenda item";
      const targetTitle = sections[targetIndex]?.title || "the new agenda item";
      const ok = await confirm({
        title: "Reassign motion?",
        message: `Move this motion from "${currentTitle}" to "${targetTitle}"? A motion can only belong to one agenda item.`,
        confirmLabel: "Reassign",
        tone: "warn",
      });
      if (!ok) return;
    }
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

  const renderSectionEditor = (mode: "inline" | "mobile" = "inline") => {
    if (sectionEditIndex == null || !sectionDraft) return null;
    const index = sectionEditIndex;
    const motionRows = motions
      .map((motion, motionIndex) => ({
        motion,
        motionIndex,
        selectedIndex: assignedSectionIndexForMotion(motion, sections),
      }))
      .filter(({ motion, selectedIndex }) =>
        !isAdjournmentMotion(motion) || (selectedIndex != null && isAdjournmentSection(sections[selectedIndex])),
      );
    const assignedMotionRows = motionRows.filter((row) => row.selectedIndex === index);
    const availableMotionRows = motionRows.filter((row) => row.selectedIndex !== index);
    const linkedTaskRecords = sectionDraft.linkedTaskIds
      .map((taskId) => meetingTaskById.get(taskId))
      .filter(Boolean);
    const isMobile = mode === "mobile";

    const editor = (
      <div className={`meeting-minutes-section-editor${isMobile ? " meeting-minutes-section-editor--mobile" : ""}`}>
        {isMobile && (
          <>
            <div className="meeting-minutes-section-editor__mobile-head">
              <button className="btn-action btn-action--icon" type="button" onClick={cancelSectionEdit} aria-label="Cancel">
                <X size={14} />
              </button>
              <div>
                <h2>Edit agenda item</h2>
                <span>{agendaEntryLabel(sections.map((section: any) => ({ title: section.title ?? "", depth: section.depth === 1 ? 1 : 0 })), index, agendaNumberingMode)}</span>
              </div>
              <button
                className="btn-action btn-action--danger"
                type="button"
                onClick={() => void confirmAndRemoveSection(index)}
                aria-label="Remove section"
              >
                <Trash2 size={12} /> Remove
              </button>
              <button className="btn-action btn-action--primary" type="button" onClick={saveSectionEdit}>
                <Save size={12} /> Save
              </button>
            </div>
            <div className="meeting-minutes-section-editor__top">
              <Field label="Title">
                <input
                  ref={sectionMobileTitleRef}
                  className="input"
                  value={sectionDraft.title}
                  onChange={(event) => setSectionDraft({ ...sectionDraft, title: event.target.value })}
                  placeholder="Section title"
                />
              </Field>
              <Field label="Kind">
                <div className="meeting-minutes-section-item__title-pills">
                  {SECTION_TYPE_PILLS.map((pill) => {
                    const active = sectionDraft.type === pill.value;
                    return (
                      <button
                        key={pill.value}
                        type="button"
                        className={`meeting-minutes-section-item__title-pill${active ? " is-active" : ""}`}
                        aria-pressed={active}
                        onClick={() => setSectionDraft({ ...sectionDraft, type: active ? "discussion" : pill.value })}
                      >
                        {active ? <X size={11} /> : <Plus size={11} />}
                        <span>{pill.label}</span>
                      </button>
                    );
                  })}
                </div>
              </Field>
              <Field label="Presenter">
                <NameAutocomplete
                  value={sectionDraft.presenter}
                  onChange={(next) => setSectionDraft({ ...sectionDraft, presenter: next })}
                  options={assigneeOptions}
                  placeholder="Presenter..."
                />
              </Field>
            </div>
          </>
        )}

        <div className="meeting-minutes-section-editor__tabs" role="group" aria-label="Section editor areas">
          <button type="button" className={`meeting-minutes-section-editor-tab${sectionEditorTab === "notes" ? " is-active" : ""}`} onClick={() => setSectionEditorTab("notes")}>
            Notes
          </button>
          <button type="button" className={`meeting-minutes-section-editor-tab${sectionEditorTab === "motions" ? " is-active" : ""}`} onClick={() => setSectionEditorTab("motions")}>
            Motions{assignedMotionRows.length ? ` (${assignedMotionRows.length})` : ""}
          </button>
          <button type="button" className={`meeting-minutes-section-editor-tab${sectionEditorTab === "tasks" ? " is-active" : ""}`} onClick={() => setSectionEditorTab("tasks")}>
            Actions{linkedTaskRecords.length ? ` (${linkedTaskRecords.length})` : ""}
          </button>
        </div>

        {sectionEditorTab === "notes" && (
          <div className="meeting-minutes-section-editor__panel">
            <button
              type="button"
              role="switch"
              aria-checked={sectionDraft.publicVisible}
              className={`meeting-minutes-section-editor__public-toggle${sectionDraft.publicVisible ? " is-public" : " is-private"}`}
              onClick={() => setSectionDraft({ ...sectionDraft, publicVisible: !sectionDraft.publicVisible })}
              title={sectionDraft.publicVisible
                ? "This item appears in the Public copy export. Click to hide it."
                : "This item is hidden from the Public copy export. Click to include it."}
            >
              <span className="meeting-minutes-section-editor__public-toggle-icon" aria-hidden>
                <Eye size={14} className="meeting-minutes-section-editor__public-toggle-eye is-on" />
                <EyeOff size={14} className="meeting-minutes-section-editor__public-toggle-eye is-off" />
              </span>
              <span className="meeting-minutes-section-editor__public-toggle-text">
                {sectionDraft.publicVisible ? "Visible in Public copy" : "Hidden from Public copy"}
              </span>
            </button>
            <Field label="Discussion notes" hint="Discussion/report points only. Use the toolbar for headings, lists, and more.">
              {/* Exactly one editor instance is mounted at a time (inline on
                  desktop, portal on mobile), so the flush ref always attaches
                  to the visible editor. */}
              <MarkdownEditor
                ref={sectionDiscussionRef}
                rows={8}
                value={sectionDraft.discussion}
                onChange={(markdown) => setSectionDraft({ ...sectionDraft, discussion: markdown })}
                placeholder="Expenses incurred by Ahmad: $80.00 for notary signing, $33.01 for posters. Receipts are recorded on Teams under Expenses."
              />
            </Field>
            <Field label="Decisions">
              <LineListEditor
                items={sectionDraft.decisions}
                onChange={(next) => setSectionDraft({ ...sectionDraft, decisions: next })}
                placeholder="Add a decision…"
                addLabel="Add decision"
                aria-label="Decisions"
              />
            </Field>
          </div>
        )}

        {sectionEditorTab === "motions" && (
          <div className="meeting-minutes-section-editor__panel">
            {/* Embedded motion editor scoped to this agenda item — adds, edits,
              * and votes happen inline so the user doesn't have to bounce to the
              * top-level Motions tab. The "Assign existing motion" picklist
              * below is still here for pulling unrelated motions into this
              * section. */}
            <MotionEditor
              ref={sectionMotionEditorRef}
              motions={motions}
              onChange={(next) => { void saveMinuteMotions(next); }}
              directorNames={assigneeOptions}
              people={motionPeople}
              agendaSections={sections.map((section: any) => ({
                title: section.title || "Untitled section",
                discussion: section.discussion ?? "",
                decisions: section.decisions ?? [],
              }))}
              sectionScope={index}
              onPendingDraftChange={setHasPendingSectionMotion}
            />
            {availableMotionRows.length > 0 && (
              <details className="meeting-minutes-motion-picklist">
                <summary>Assign existing motion to this item</summary>
                <div className="meeting-minutes-motion-assignment__list">
                  {availableMotionRows.map(({ motion, motionIndex }) => (
                    <div
                      className="meeting-minutes-motion-assignment__row"
                      key={`${motion.text}-${motionIndex}`}
                    >
                      <div className="meeting-minutes-motion-assignment__text">
                        <strong>{motion.text}</strong>
                        <span>
                          {motion.outcome || "Pending"}
                          {motion.movedBy ? ` · Moved by ${motionPersonDisplayName(motion.movedBy, motionPeople, { memberId: motion.movedByMemberId, directorId: motion.movedByDirectorId })}` : ""}
                          {motion.secondedBy ? ` · Seconded by ${motionPersonDisplayName(motion.secondedBy, motionPeople, { memberId: motion.secondedByMemberId, directorId: motion.secondedByDirectorId })}` : ""}
                        </span>
                      </div>
                      <button
                        className="btn-action"
                        type="button"
                        onClick={() => assignMotionToSection(motionIndex, String(index))}
                      >
                        <Plus size={12} /> Assign
                      </button>
                    </div>
                  ))}
                </div>
              </details>
            )}
          </div>
        )}

        {sectionEditorTab === "tasks" && (
          <div className="meeting-minutes-section-editor__panel">
            <div className="meeting-minutes-section-tasks">
              {linkedTaskRecords.length === 0 ? (
                <div className="muted">
                  Link a task to update its status here.
                </div>
              ) : (
                linkedTaskRecords.map((task) => {
                  const draft = sectionDraft.taskUpdates[task._id] ?? {};
                  const currentStatus = draft.status ?? task.status ?? "Todo";
                  const noteValue = draft.completionNote ?? task.completionNote ?? "";
                  // Default the note open when there's already content — users
                  // shouldn't have to hunt for an existing note. Empty notes
                  // stay collapsed so the row condenses to one line.
                  const hasNote = !!noteValue.trim();
                  return (
                    <div className="meeting-minutes-section-task" key={task._id}>
                      <div className="meeting-minutes-section-task__head">
                        <strong className="meeting-minutes-section-task__title">{task.title}</strong>
                        <Segmented
                          value={currentStatus}
                          onChange={(next) => updateTaskDraft(task._id, { status: next })}
                          items={SECTION_TASK_STATUS_ITEMS}
                        />
                        {task.priority && (
                          <Badge tone={task.priority === "High" ? "danger" : task.priority === "Medium" ? "warn" : "neutral"}>
                            {task.priority}
                          </Badge>
                        )}
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
                      <details className="meeting-minutes-section-task__note" open={hasNote}>
                        <summary className="meeting-minutes-section-task__note-toggle">
                          {hasNote ? "Completion note" : "Add completion note"}
                        </summary>
                        <MarkdownEditor
                          rows={2}
                          value={noteValue}
                          onChange={(markdown) => updateTaskDraft(task._id, { completionNote: markdown })}
                          placeholder="Outcome, blockers, or notes for the kanban card."
                        />
                      </details>
                    </div>
                  );
                })
              )}

              {createTaskForMeeting && (
                <QuickAddTaskForm
                  onSubmit={createTaskForMeeting}
                  onCreated={(taskId) => attachLinkedTask(taskId)}
                />
              )}
            </div>
          </div>
        )}

        {!isMobile && (
          <div className="row" style={{ gap: 6, justifyContent: "space-between", alignItems: "center" }}>
            <button
              className="btn-action btn-action--danger"
              type="button"
              onClick={() => void confirmAndRemoveSection(index)}
            >
              <Trash2 size={12} /> Remove section
            </button>
            <div className="row" style={{ gap: 6 }}>
              <button className="btn-action" onClick={cancelSectionEdit}>Cancel</button>
              <button className="btn-action btn-action--primary" onClick={saveSectionEdit}>
                <Save size={12} /> {hasPendingSectionMotion ? "Save section + add motion" : "Save section"}
              </button>
            </div>
          </div>
        )}
      </div>
    );

    if (!isMobile) return editor;

    return createPortal(
      <div className="meeting-minutes-section-editor-screen" role="dialog" aria-modal="true" aria-label="Edit agenda item">
        {editor}
      </div>,
      document.body,
    );
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
  return {
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
  };
}
