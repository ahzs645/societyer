import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Link } from "react-router-dom";
import { ArrowDown, ArrowUp, ChevronDown, ClipboardList, ExternalLink, FileText, GripVertical, IndentDecrease, IndentIncrease, ListChecks, Mic, MinusCircle, Pencil, Plus, Save, Trash2, Unlink, X } from "lucide-react";
import { Badge, Field, MenuRow } from "../../../components/ui";
import { useConfirm } from "../../../components/Modal";
import { Checkbox } from "../../../components/Controls";
import { LegalGuideInline } from "../../../components/LegalGuide";
import { Segmented } from "../../../components/primitives";
import { isAdjournmentMotion, motionPersonDisplayName, type Motion, type MotionPerson } from "../../../components/MotionEditor";
import { NameAutocomplete } from "../../../components/NameAutocomplete";
import { Select } from "../../../components/Select";
import { SignaturePanel } from "../../../components/SignaturePanel";
import { Tooltip } from "../../../components/Tooltip";
import {
  AttendanceDetails,
  formatSourceReferences,
  personLinkCandidates,
  type AgendaItemEntry,
} from "./MeetingDetailSupport";

const SECTION_TASK_STATUS_ITEMS: { id: string; label: string }[] = [
  { id: "Todo", label: "To do" },
  { id: "InProgress", label: "In progress" },
  { id: "Blocked", label: "Blocked" },
  { id: "Done", label: "Done" },
];

type SectionTypeId = "discussion" | "motion" | "report" | "decision" | "other";
type AgendaNumberingMode = "letters" | "decimal";

const AGENDA_NUMBERING_PREF_KEY = "societyer.meetingAgendaNumberingMode";

const SECTION_TYPE_OPTIONS: { value: SectionTypeId; label: string }[] = [
  { value: "discussion", label: "Discussion" },
  { value: "motion", label: "Motion" },
  { value: "report", label: "Report" },
  { value: "decision", label: "Decision" },
  { value: "other", label: "Other" },
];

const AGENDA_NUMBERING_ITEMS: { id: AgendaNumberingMode; label: string }[] = [
  { id: "letters", label: "1.a" },
  { id: "decimal", label: "1.1" },
];

function readStoredAgendaNumberingMode(): AgendaNumberingMode {
  if (typeof window === "undefined") return "letters";
  return window.localStorage.getItem(AGENDA_NUMBERING_PREF_KEY) === "decimal" ? "decimal" : "letters";
}

function agendaAlphaLabel(index: number) {
  let n = index + 1;
  let label = "";
  while (n > 0) {
    n -= 1;
    label = String.fromCharCode(65 + (n % 26)) + label;
    n = Math.floor(n / 26);
  }
  return label;
}

function agendaNumberingLabel(rootIndex: number, childIndex: number, mode: AgendaNumberingMode) {
  const root = `${rootIndex + 1}`;
  if (mode === "decimal") {
    return childIndex > 0 ? `${root}.${childIndex}` : root;
  }
  return childIndex > 0 ? `${root}.${agendaAlphaLabel(childIndex - 1).toLowerCase()}` : root;
}

function agendaEntryLabel(items: AgendaItemEntry[], targetIndex: number, mode: AgendaNumberingMode) {
  let rootIndex = -1;
  let childIndex = 0;
  for (let i = 0; i <= targetIndex; i += 1) {
    const isChild = items[i]?.depth === 1 && rootIndex >= 0;
    if (isChild) {
      childIndex += 1;
    } else {
      rootIndex += 1;
      childIndex = 0;
    }
  }
  return agendaNumberingLabel(Math.max(rootIndex, 0), childIndex, mode);
}

export function MeetingMinutesColumn({
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
  transcriptOnFile,
  transcriptEdit,
  setTranscriptEdit,
  saveTranscriptEditText,
  savingTranscript,
}: {
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
  const sectionDiscussionRef = useRef<HTMLTextAreaElement | null>(null);
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
      decisions: "",
      actionItems: [],
      linkedTaskIds: [],
      taskUpdates: {},
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
      childCount === 0 ? `${rootCount}.` : `${rootCount}${String.fromCharCode(96 + childCount)}.`;

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
  }, [agendaEdit, sections]);
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
    const isEmpty =
      !section?.discussion &&
      !section?.presenter &&
      !(section?.decisions ?? []).length &&
      !(section?.actionItems ?? []).length &&
      !(motionMatchesBySection[index]?.length);
    if (isEmpty) {
      void removeSection(index);
      return;
    }
    const ok = await confirm({
      title: `Delete "${section.title || "Untitled section"}"?`,
      message: "Notes, decisions, and action items in this section will be removed.",
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

  const cancelSectionEdit = () => {
    setSectionEditIndex(null);
    setSectionDraft(null);
  };

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

  const renderSectionEditor = (mode: "inline" | "mobile" = "inline") => {
    if (sectionEditIndex == null || !sectionDraft) return null;
    const index = sectionEditIndex;
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
              <Field label="Type">
                <Select
                  value={sectionDraft.type as SectionTypeId}
                  onChange={(next) => setSectionDraft({ ...sectionDraft, type: next })}
                  options={SECTION_TYPE_OPTIONS}
                />
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
                ref={isMobile ? undefined : sectionDiscussionRef}
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
                  {assignedMotionRows.map(({ motion, motionIndex }) => (
                    <MotionAssignmentRow
                      key={`${motion.text}-${motionIndex}`}
                      motion={motion}
                      motionIndex={motionIndex}
                      people={motionPeople}
                      onRemove={() => assignMotionToSection(motionIndex, "")}
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
                  <option value="">Link a meeting task...</option>
                  {availableMeetingTasks.map((task: any) => (
                    <option key={task._id} value={task._id}>
                      {task.title}{task.status ? ` · ${task.status}` : ""}
                    </option>
                  ))}
                </select>
              ) : (meetingTasks?.length ?? 0) === 0 ? (
                <div className="muted" style={{ fontSize: "var(--fs-sm)", display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 6 }}>
                  <span>No tasks linked to this meeting yet. Add tasks on the Package tab to make them available here.</span>
                  <Link to="/app/tasks" className="btn-action">
                    <ExternalLink size={12} /> Open Tasks page
                  </Link>
                </div>
              ) : (
                <div className="muted" style={{ fontSize: "var(--fs-sm)" }}>
                  All meeting tasks are linked to this section.
                </div>
              )}
            </div>
          </div>
        )}

        {!isMobile && (
          <div className="row" style={{ gap: 6, justifyContent: "flex-end" }}>
            <button className="btn-action" onClick={cancelSectionEdit}>Cancel</button>
            <button className="btn-action btn-action--primary" onClick={saveSectionEdit}>
              <Save size={12} /> Save section
            </button>
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
                  const canIndent = item.depth === 0 && agendaItems.slice(0, index).some((entry) => entry.depth === 0);
                  const canOutdent = item.depth === 1;
                  return (
                    <div
                      className={`meeting-minutes-agenda-editor__row${canRemove ? "" : " is-locked"}${item.depth === 1 ? " meeting-minutes-agenda-editor__row--child" : ""}`}
                      key={index}
                    >
                      <span className="meeting-minutes-agenda-editor__index" aria-hidden="true">
                        {itemLabel}
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
                      <div className="meeting-minutes-agenda-editor__hierarchy-actions" aria-label="Agenda item hierarchy">
                        <button
                          className="btn-action btn-action--icon"
                          type="button"
                          tabIndex={-1}
                          title="Outdent item"
                          aria-label="Outdent item"
                          disabled={!canOutdent}
                          onClick={() => outdentAgendaItem(index)}
                        >
                          <IndentDecrease size={12} />
                        </button>
                        <button
                          className="btn-action btn-action--icon"
                          type="button"
                          tabIndex={-1}
                          title="Indent item"
                          aria-label="Indent item"
                          disabled={!canIndent}
                          onClick={() => indentAgendaItem(index)}
                        >
                          <IndentIncrease size={12} />
                        </button>
                      </div>
                      <button
                        className="btn-action btn-action--icon meeting-minutes-agenda-editor__remove"
                        type="button"
                        tabIndex={-1}
                        title={canRemove ? "Remove item" : "This item has notes, decisions, or actions. Clear those before removing it from the agenda."}
                        aria-label={canRemove ? "Remove item" : "Cannot remove item with recorded section details"}
                        disabled={!canRemove}
                        onClick={() => removeAgendaItem(index)}
                      >
                        <MinusCircle size={12} />
                      </button>
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
                          return (
                          <details
                            key={`${section.title ?? "section"}-${index}`}
                            id={`meeting-minutes-section-${index}`}
                            className={`meeting-minutes-section-item${agendaPreviewRemovals.has(index) ? " meeting-minutes-section-item--pending-remove" : ""}${isChild ? " meeting-minutes-section-item--child" : ""}${isDragging ? " is-dragging" : ""}${showDropAbove ? " is-drop-above" : ""}${showDropBelow ? " is-drop-below" : ""}`}
                            open={openSectionIndexes.has(index)}
                            onToggle={(event) => toggleSection(index, event.currentTarget.open)}
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
                                <ChevronDown size={13} aria-hidden="true" />
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
                                ) : (
                                  <strong>{label} {section.title || "Untitled section"}</strong>
                                )}
                              </span>
                              <span className="meeting-minutes-section-item__meta">
                                {sectionSummaryMeta(section, motionMatchesBySection[index]?.length ?? 0)}
                              </span>
                              <span className="meeting-minutes-section-item__actions">
                                <Tooltip content={agendaEdit !== null ? "Finish editing the agenda first" : "Edit agenda item"} placement="top">
                                  <span className="meeting-minutes-section-item__action-tooltip">
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
                                  </span>
                                </Tooltip>
                                <Tooltip content={agendaEdit !== null ? "Finish editing the agenda first" : "Remove section"} placement="top">
                                  <span className="meeting-minutes-section-item__action-tooltip">
                                    <button
                                      className="btn-action btn-action--icon"
                                      type="button"
                                      // Locked while the agenda is mid-edit — saving
                                      // the agenda would re-sync sections anyway, so
                                      // any concurrent removal would race.
                                      disabled={agendaEdit !== null}
                                      aria-label="Remove section"
                                      onClick={(event) => {
                                        event.preventDefault();
                                        event.stopPropagation();
                                        void confirmAndRemoveSection(index);
                                      }}
                                    >
                                      <MinusCircle size={12} />
                                    </button>
                                  </span>
                                </Tooltip>
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
  people,
  onRemove,
}: {
  motion: Motion;
  motionIndex: number;
  people: MotionPerson[];
  onRemove: () => void | Promise<void>;
}) {
  return (
    <div className="meeting-minutes-motion-assignment__row is-current">
      <div className="meeting-minutes-motion-assignment__text">
        <strong>{motion.text}</strong>
        <span>
          {motion.outcome || "Pending"}
          {motion.movedBy ? ` · Moved by ${motionPersonDisplayName(motion.movedBy, people, { memberId: motion.movedByMemberId, directorId: motion.movedByDirectorId })}` : ""}
          {motion.secondedBy ? ` · Seconded by ${motionPersonDisplayName(motion.secondedBy, people, { memberId: motion.secondedByMemberId, directorId: motion.secondedByDirectorId })}` : ""}
        </span>
      </div>
      <button
        className="btn-action"
        type="button"
        aria-label={`Remove motion ${motionIndex + 1} from this agenda item`}
        onClick={() => onRemove()}
      >
        <MinusCircle size={12} /> Remove
      </button>
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
          placeholder="Type a name"
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

// Shared motion remap for any section reorder that produces a permutation of
// the existing section indices. `oldIndexOrder[newIdx] === oldIdx`. Each
// motion's sectionIndex is rewritten to its post-reorder slot.
function remapMotionsByIndexOrder(
  motions: Motion[],
  oldIndexOrder: number[],
): { motions: Motion[]; changed: boolean } {
  const newIndexOf = new Map<number, number>();
  oldIndexOrder.forEach((oldIdx, newIdx) => newIndexOf.set(oldIdx, newIdx));
  let changed = false;
  const remapped = motions.map((motion) => {
    if (motion.sectionIndex == null) return motion;
    const newIdx = newIndexOf.get(motion.sectionIndex);
    if (newIdx == null || newIdx === motion.sectionIndex) return motion;
    changed = true;
    return { ...motion, sectionIndex: newIdx };
  });
  return { motions: remapped, changed };
}

function normalize(value: string) {
  return String(value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9$]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}
