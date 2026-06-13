// Private sub-components/helpers/consts for MeetingMinutesColumn.tsx (AttendanceRoster, section drafts, etc.).

import { type DragEvent as ReactDragEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ArrowDown, ArrowUp, Check, ChevronDown, ClipboardList, FileText, GripVertical, IndentDecrease, IndentIncrease, ListChecks, Mic, MoreHorizontal, Pencil, Plus, Save, Trash2, Unlink, X } from "lucide-react";
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


type SectionDraft = {
  title: string;
  type: string;
  presenter: string;
  discussion: string;
  decisions: string[];
  actionItems: SectionActionDraft[];
  linkedTaskIds: string[];
  taskUpdates: Record<string, { status?: string; completionNote?: string }>;
  publicVisible: boolean;
};


type SectionEditorTab = "notes" | "motions" | "tasks";


type SectionActionDraft = {
  text: string;
  assignee: string;
  dueDate: string;
  done: boolean;
};


type AttendancePerson = { name: string; status: "present" | "absent" };


function AttendanceRosterRow({
  person,
  onSetStatus,
}: {
  person: AttendancePerson;
  onSetStatus: (status: AttendancePerson["status"]) => void;
}) {
  return (
    <>
      <span className="attendance-roster__name">{person.name}</span>
      <div className="attendance-roster__status segmented">
        <button
          type="button"
          className={`segmented__btn${person.status === "present" ? " is-active" : ""}`}
          onClick={() => onSetStatus("present")}
          aria-label="Present"
          title="Present"
        >
          <Check size={14} aria-hidden />
        </button>
        <button
          type="button"
          className={`segmented__btn${person.status === "absent" ? " is-active" : ""}`}
          onClick={() => onSetStatus("absent")}
          aria-label="Absent / regrets"
          title="Absent / regrets"
        >
          <X size={14} aria-hidden />
        </button>
      </div>
    </>
  );
}


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

  return (
    <ListEditor
      items={people}
      divided
      onRemove={remove}
      getRemoveLabel={(person) => `Remove ${person.name}`}
      renderItem={(person, index) => (
        <AttendanceRosterRow
          person={person}
          onSetStatus={(status) => setStatus(index, status)}
        />
      )}
      footer={
        <>
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
        </>
      }
    />
  );
}


function cleanOptional(value: string | undefined | null) {
  const text = String(value ?? "").trim();
  return text || undefined;
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
    if (isAdjournmentMotion(motion)) return isAdjournmentSection(section);
    // When the motion has been bound to a specific section index, that index
    // alone determines its home — don't also match every same-titled sibling
    // (sections frequently share a title like "New section" before they're
    // renamed).
    if (motion.sectionIndex != null) return motion.sectionIndex === sectionIndex;
    if (motion.sectionTitle && normalize(motion.sectionTitle) === normalize(section?.title ?? "")) return true;
    if (motion.sectionTitle) return false;
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


function isAdjournmentSection(section: any) {
  return /\badjourn(?:ment|ed|s)?\b/i.test(String(section?.title ?? ""));
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


function sectionSummaryMeta(section: any, _motionCount: number) {
  const parts = [
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


export {
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
};

export type {
  SectionTypeId,
  AgendaNumberingMode,
  SectionDraft,
  SectionEditorTab,
  SectionActionDraft,
  AttendancePerson,
};
