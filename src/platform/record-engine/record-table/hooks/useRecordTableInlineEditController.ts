import { useMemo, useRef, type ClipboardEvent as ReactClipboardEvent, type RefObject } from "react";
import { useToast } from "../../../../components/Toast";
import type { FieldMetadata, RecordField } from "../../types";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import type {
  InlineCellWrite,
  InlineEditRecord,
  RecordTableInlineEdit,
  RecordTableInlineEditController,
} from "../contexts/RecordTableInlineEditContext";
import { useRecordTableStoreHandle, type CellPosition } from "../state/recordTableStore";
import { createEditEntry, dropEdit, EMPTY_EDIT_HISTORY, entryWrites, recordEdit, redoEdit, undoEdit, type EditHistoryEntry } from "../utils/editHistory";
import { planPaste, pasteSummary, toTsv } from "../utils/gridClipboard";
import { cellsInRect, navigateGrid, selectAllCells, selectionRect } from "../utils/gridNavigation";
import { checkInlineValue, emptyInlineValue, formatInlineText, parseInlineText, sameInlineValue } from "../utils/inlineEditValues";
import { recordCellText } from "../utils/recordCellText";
import { stagedCount, stagedList } from "../utils/stagedEdits";
import { useRecordTableColumns } from "./useRecordTableColumns";
import { useRecordTableRowModel } from "./useRecordTableRowModel";
import { SETTLED_EDIT_TTL_MS, useRecordTableUpdate } from "./useRecordTableUpdate";

/** Rows a Page Up/Down moves when nothing has been measured yet. */
const DEFAULT_PAGE_SIZE = 10;

type Write = { recordId: string; fieldName: string; value: unknown; previousValue: unknown; fieldLabel: string };

type Latest = {
  rows: InlineEditRecord[];
  ordered: InlineEditRecord[];
  columns: RecordField[];
  navigable: number[];
  onUpdate: unknown;
};

/** What the grid's pieces share: the opt-in config and the table they act on. */
type GridDeps = {
  config: RecordTableInlineEdit;
  handle: ReturnType<typeof useRecordTableStoreHandle>;
  toast: ReturnType<typeof useToast>;
  saveCell: ReturnType<typeof useRecordTableUpdate>;
  latest: { readonly current: Latest };
  rootRef: RefObject<HTMLElement | null>;
};

function isTypingTarget(target: EventTarget | null) {
  if (!(target instanceof HTMLElement)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

function plural(count: number, noun: string) {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}

/** Saving, undo/redo and focus: the path every grid edit takes. */
function createCommitPath({ config, handle, toast, saveCell, latest, rootRef }: GridDeps) {
  const announce = (message: string) => handle.get().announce(message);
  const canEditCell = (record: InlineEditRecord, field: FieldMetadata) => {
    const column = config.columns[field.name];
    if (!column) return false;
    if (!config.batch && !config.onCommit && !latest.current.onUpdate) return false;
    return !column.readOnly?.(record);
  };
  const fieldLabel = (fieldName: string) =>
    latest.current.columns.find((column) => column.field.name === fieldName)?.field.label ?? fieldName;

  const focusCell = (position: CellPosition) => {
    handle.get().setFocusedCell(position);
    window.requestAnimationFrame(() => {
      if (handle.get().editingCell) return;
      rootRef.current
        ?.querySelector<HTMLElement>(`[data-row-index="${position.rowIndex}"][data-column-index="${position.columnIndex}"]`)
        ?.focus({ preventScroll: true });
    });
  };

  /** Saves (or stages) cell values. Resolves to whether every one was accepted. */
  const applyWrites = async (writes: Write[]): Promise<boolean> => {
    if (writes.length === 0) return true;
    if (config.batch) {
      handle.get().stageEdits(writes);
      return true;
    }
    const onCommit = config.onCommit;
    const results = await Promise.all(
      writes.map((write) =>
        saveCell(
          { recordId: write.recordId, fieldName: write.fieldName, value: write.value },
          {
            fieldLabel: write.fieldLabel,
            // A failing paste reports once, not once per cell.
            dedupeKey: writes.length > 1 ? "record-table-grid-save" : undefined,
            commit: onCommit ? (args) => onCommit({ ...args, previousValue: write.previousValue }) : undefined,
          },
        ),
      ),
    );
    return results.every(Boolean);
  };

  const commit = async (writes: InlineCellWrite[], label: string) => {
    const changes = writes
      .map((write) => ({
        recordId: String(write.record._id),
        fieldName: write.field.name,
        before: write.record[write.field.name],
        after: write.value,
        field: write.field,
        record: write.record,
      }))
      .filter((change) => !sameInlineValue(change.before, change.after));
    if (changes.length === 0) return true;
    const entry = createEditEntry(
      label,
      changes.map(({ recordId, fieldName, before, after }) => ({ recordId, fieldName, before, after })),
    );
    handle.get().setEditHistory(recordEdit(handle.get().editHistory, entry));
    const pending = config.batch ? ", not saved yet" : "";
    if (changes.length === 1) {
      const [change] = changes;
      const column = config.columns[change.fieldName];
      const text = column ? formatInlineText(change.after, change.field, column, change.record) : String(change.after ?? "");
      announce(`${change.field.label} set to ${text || "blank"}${pending}`);
    } else {
      announce(`${label}: ${plural(changes.length, "cell")} changed${pending}`);
    }
    const ok = await applyWrites(
      changes.map((change) => ({
        recordId: change.recordId,
        fieldName: change.fieldName,
        value: change.after,
        previousValue: change.before,
        fieldLabel: change.field.label,
      })),
    );
    if (!ok) handle.get().setEditHistory(dropEdit(handle.get().editHistory, entry.id));
    return ok;
  };

  /** Shows the first cell an undo/redo touched, when it is on screen. */
  const revealEntry = (entry: EditHistoryEntry) => {
    const [first] = entry.changes;
    if (!first) return;
    const rowIndex = latest.current.rows.findIndex((record) => String(record?._id) === first.recordId);
    const columnIndex = latest.current.columns.findIndex((column) => column.field.name === first.fieldName);
    if (rowIndex < 0 || columnIndex < 0) return;
    handle.get().setRangeAnchor(null);
    focusCell({ rowIndex, columnIndex });
  };

  /** Undo puts each cell's `before` back through the same commit path; redo its `after`. */
  const replay = (direction: "undo" | "redo") => {
    const step = direction === "undo" ? undoEdit(handle.get().editHistory) : redoEdit(handle.get().editHistory);
    if (!step) {
      announce(`Nothing to ${direction}`);
      return;
    }
    handle.get().setEditHistory(step.history);
    const side = direction === "undo" ? "before" : "after";
    const other = direction === "undo" ? "after" : "before";
    const writes = entryWrites(step.entry, side).map((write, index) => ({
      ...write,
      previousValue: step.entry.changes[index][other],
      fieldLabel: fieldLabel(write.fieldName),
    }));
    const message = `${direction === "undo" ? "Undid" : "Redid"} ${step.entry.label.toLowerCase()}`;
    announce(message);
    toast.info(message, { dedupeKey: "record-table-grid-history" });
    revealEntry(step.entry);
    void applyWrites(writes).then((ok) => {
      if (!ok) handle.get().setEditHistory(dropEdit(handle.get().editHistory, step.entry.id));
    });
  };

  /**
   * An "Undo" toast action for the edit just recorded. It only steps back
   * while that edit is still the latest; otherwise ⌘Z walks back in order.
   */
  const undoAction = () => {
    const id = handle.get().editHistory.past.at(-1)?.id;
    return {
      label: "Undo",
      onClick: () => {
        if (id !== undefined && handle.get().editHistory.past.at(-1)?.id === id) replay("undo");
        else toast.info("Newer edits since then", { description: "Use ⌘Z / Ctrl+Z to step back through them." });
      },
    };
  };

  return { announce, canEditCell, focusCell, commit, replay, undoAction };
}

type CommitPath = ReturnType<typeof createCommitPath>;

/** Range clear, copy, cut and paste over the current selection. */
function createClipboard({ config, handle, toast, latest }: GridDeps, { announce, canEditCell, commit, undoAction }: CommitPath) {
  const textAt = (record: InlineEditRecord, columnIndex: number) => {
    const field = latest.current.columns[columnIndex]?.field;
    if (!field) return "";
    const column = config.columns[field.name];
    return column ? formatInlineText(record[field.name], field, column, record) : recordCellText(field, record[field.name], record);
  };

  /** The selection as a text matrix: a cell range, else checked rows (with a header), else the focused cell. */
  const selectionMatrix = (allowRows: boolean): { matrix: string[][]; summary: string } | null => {
    const state = handle.get();
    const { rows, ordered, columns, navigable } = latest.current;
    const focus = state.focusedCell;
    const anchor = state.rangeAnchor;
    if (focus && anchor && (anchor.rowIndex !== focus.rowIndex || anchor.columnIndex !== focus.columnIndex)) {
      const rect = selectionRect({ focus, anchor });
      const columnIndexes = navigable.filter((index) => index >= rect.left && index <= rect.right);
      const matrix = rows.slice(rect.top, rect.bottom + 1).map((record) => columnIndexes.map((index) => textAt(record, index)));
      return { matrix, summary: `Copied ${plural(matrix.length * columnIndexes.length, "cell")}` };
    }
    if (allowRows && state.selectedRecordIds.size > 0) {
      const selected = ordered.filter((record) => state.selectedRecordIds.has(String(record?._id)));
      const header = navigable.map((index) => columns[index].field.label);
      return {
        matrix: [header, ...selected.map((record) => navigable.map((index) => textAt(record, index)))],
        summary: `Copied ${plural(selected.length, "row")}`,
      };
    }
    const record = focus ? rows[focus.rowIndex] : undefined;
    return focus && record ? { matrix: [[textAt(record, focus.columnIndex)]], summary: "Copied cell" } : null;
  };

  /** Clears the declared cells of the selection. False when it holds none, so the table's own clear runs. */
  const clearSelection = (label = "Clear cells") => {
    const state = handle.get();
    const focus = state.focusedCell;
    if (!focus) return false;
    const { rows, columns, navigable } = latest.current;
    const writes: InlineCellWrite[] = [];
    let declared = 0;
    let locked = 0;
    let required = 0;
    for (const cell of cellsInRect(selectionRect({ focus, anchor: state.rangeAnchor }), navigable)) {
      const record = rows[cell.rowIndex];
      const field = columns[cell.columnIndex]?.field;
      const column = field ? config.columns[field.name] : undefined;
      if (!record || !field || !column) continue;
      declared += 1;
      if (!canEditCell(record, field)) {
        locked += 1;
        continue;
      }
      const checked = checkInlineValue(emptyInlineValue(column), field, column, record);
      if (checked.ok) writes.push({ record, field, value: checked.value });
      else required += 1;
    }
    if (declared === 0) return false;
    const changed = writes.filter((write) => !sameInlineValue(write.record[write.field.name], write.value)).length;
    void commit(writes, label);
    // A stray Delete never loses data silently: say what went, with Undo.
    const skipped = [required ? `${required} required left as is` : "", locked ? `${locked} read-only skipped` : ""].filter(Boolean);
    const message = [`${label === "Cut" ? "Cut" : "Cleared"} ${plural(changed, "cell")}`, ...skipped].join(", ");
    if (skipped.length) announce(message);
    const action = changed > 0 ? undoAction() : undefined;
    if (skipped.length) toast.warn(message, { dedupeKey: "record-table-grid-clear", action });
    else if (changed > 0) toast.success(message, { dedupeKey: "record-table-grid-clear", action });
    return true;
  };

  const ignoreClipboard = (event: ReactClipboardEvent<HTMLElement>) => isTypingTarget(event.target) || !!handle.get().editingCell;

  const onPaste = (event: ReactClipboardEvent<HTMLElement>) => {
    if (ignoreClipboard(event)) return;
    const text = event.clipboardData.getData("text/plain");
    const { rows, columns, navigable } = latest.current;
    const state = handle.get();
    const focus = state.focusedCell ?? (rows.length && navigable.length ? { rowIndex: 0, columnIndex: navigable[0] } : null);
    if (!text || !focus) return;
    event.preventDefault();
    const plan = planPaste({
      text,
      selection: selectionRect({ focus, anchor: state.rangeAnchor }),
      rowCount: rows.length,
      navigable,
      targetAt: (cell) => {
        const record = rows[cell.rowIndex];
        const field = columns[cell.columnIndex]?.field;
        const column = field ? config.columns[field.name] : undefined;
        if (!record || !field || !column || !canEditCell(record, field)) return { editable: false };
        return { editable: true, label: field.label, parse: (raw) => parseInlineText(raw, field, column, record) };
      },
    });
    if (plan.covered) {
      const { focus: first, anchor: last } = plan.covered;
      const single = first.rowIndex === last.rowIndex && first.columnIndex === last.columnIndex;
      handle.set({ focusedCell: first, rangeAnchor: single ? null : last });
    }
    const before = handle.get().editHistory.past.at(-1)?.id;
    void commit(
      plan.writes.map((write) => ({ record: rows[write.rowIndex], field: columns[write.columnIndex].field, value: write.value })),
      "Paste",
    );
    const action = handle.get().editHistory.past.at(-1)?.id !== before ? undoAction() : undefined;
    const summary = pasteSummary(plan);
    announce(summary.message);
    if (summary.warn) {
      toast.warn(summary.message, { description: plan.errors.join(" · ") || undefined, duration: 9000, dedupeKey: "record-table-grid-clipboard", action });
    } else {
      toast.success(summary.message, { dedupeKey: "record-table-grid-clipboard", action });
    }
  };

  return {
    clearSelection,
    onPaste,
    onCopy: (event: ReactClipboardEvent<HTMLElement>) => {
      if (ignoreClipboard(event) || (window.getSelection?.()?.toString() ?? "").length > 0) return;
      const copied = selectionMatrix(true);
      if (!copied) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", toTsv(copied.matrix));
      announce(copied.summary);
      toast.success(copied.summary, { dedupeKey: "record-table-grid-clipboard" });
    },
    onCut: (event: ReactClipboardEvent<HTMLElement>) => {
      if (ignoreClipboard(event)) return;
      const copied = selectionMatrix(false);
      if (!copied) return;
      event.preventDefault();
      event.clipboardData.setData("text/plain", toTsv(copied.matrix));
      if (!clearSelection("Cut")) announce(copied.summary);
    },
  };
}

/** Batch mode: save or throw away the pending changeset. */
function createBatch({ config, handle, toast }: GridDeps, { announce }: CommitPath) {
  const saveBatch = async () => {
    const batch = config.batch;
    if (!batch) return false;
    const state = handle.get();
    const list = stagedList(state.stagedEdits);
    if (list.length === 0) return true;
    const byId = new Map(state.records.map((record) => [String(record?._id), record]));
    const edits = list.map((write) => ({ ...write, previousValue: byId.get(write.recordId)?.[write.fieldName] }));
    try {
      await batch.onSave(edits);
    } catch (error) {
      toast.error(`Couldn't save ${plural(edits.length, "change")}`, {
        description: error instanceof Error && error.message ? error.message : "Your edits are still here; try again in a moment.",
      });
      return false;
    }
    // Saved values keep showing until the records catch up (as a saved
    // single edit does), so nothing flashes back to the old value.
    for (const edit of edits) {
      const token = handle.get().beginPendingEdit(edit.recordId, edit.fieldName, edit.value);
      handle.get().settlePendingEdit(token, true);
      window.setTimeout(() => handle.get().settlePendingEdit(token, false), SETTLED_EDIT_TTL_MS);
    }
    handle.get().clearStagedEdits();
    const message = `Saved ${plural(edits.length, "change")}`;
    announce(message);
    toast.success(message);
    return true;
  };
  const discardBatch = () => {
    const count = stagedCount(handle.get().stagedEdits);
    handle.get().clearStagedEdits();
    // The stack described the discarded changeset.
    handle.get().setEditHistory(EMPTY_EDIT_HISTORY);
    if (count) announce(`Discarded ${plural(count, "change")}`);
  };
  return { saveBatch, discardBatch };
}

/**
 * Grid mode for one RecordTable (see RecordTableInlineEdit): the commit path
 * (immediate with optimistic rollback, or a batch changeset), the undo/redo
 * stack, range clear, clipboard and the moves after an edit. Returns null
 * when the table did not opt in, so callers keep today's behaviour.
 */
export function useRecordTableInlineEditController(
  config: RecordTableInlineEdit | undefined,
  rootRef: RefObject<HTMLElement | null>,
): RecordTableInlineEditController | null {
  const { objectMetadata, onUpdate } = useRecordTableContextOrThrow();
  const { records: rows, ordered } = useRecordTableRowModel();
  const { columns, navigable } = useRecordTableColumns(objectMetadata.labelIdentifierFieldName);
  const handle = useRecordTableStoreHandle();
  const toast = useToast();
  const saveCell = useRecordTableUpdate();
  // Handlers read the rows and columns at the moment they run, so the
  // controller (and every cell reading it) stays stable between renders.
  const latest = useRef<Latest>({ rows, ordered, columns, navigable, onUpdate });
  latest.current = { rows, ordered, columns, navigable, onUpdate };

  return useMemo(() => {
    if (!config) return null;
    const deps: GridDeps = { config, handle, toast, saveCell, latest, rootRef };
    const core = createCommitPath(deps);
    const clipboard = createClipboard(deps, core);
    const batch = createBatch(deps, core);
    const bounds = (pageSize: number) => ({ rowCount: latest.current.rows.length, navigable: latest.current.navigable, pageSize });
    return {
      config,
      columnFor: (fieldName) => config.columns[fieldName],
      canEditCell: core.canEditCell,
      commit: core.commit,
      clearSelection: clipboard.clearSelection,
      undo: () => core.replay("undo"),
      redo: () => core.replay("redo"),
      selectAll: (selectable) => {
        const count = latest.current.rows.length;
        if (selectable) {
          handle.get().setSelectedRecordIds(new Set(latest.current.rows.map((record) => String(record?._id))));
          handle.get().setRangeAnchor(null);
          core.announce(`Selected all ${plural(count, "row")}`);
          return;
        }
        const all = selectAllCells(bounds(1));
        if (!all) return;
        handle.set({ focusedCell: all.focus, rangeAnchor: all.anchor });
        core.announce(`Selected all ${plural(count * latest.current.navigable.length, "cell")}`);
      },
      finishEdit: (from, move) => {
        handle.get().setEditingInitialValue(undefined);
        handle.get().setEditingCell(null);
        if (move === "blur") return;
        if (move === "none") {
          core.focusCell(from);
          return;
        }
        // Enter moves down (Shift+Enter up); Tab moves on, wrapping rows.
        const key = move === "down" ? "ArrowDown" : move === "up" ? "ArrowUp" : "Tab";
        const next = navigateGrid({ focus: from, anchor: null }, { key, shiftKey: move === "left" }, bounds(1));
        handle.get().setRangeAnchor(null);
        core.focusCell(next?.focus ?? from);
      },
      focusCell: core.focusCell,
      pageSize: () => {
        const root = rootRef.current;
        const row = root?.querySelector<HTMLElement>(".record-table__row");
        if (!root || !row || row.offsetHeight === 0) return DEFAULT_PAGE_SIZE;
        const scroller = root.querySelector<HTMLElement>(".record-table__virtuoso") ?? root;
        const visible = Math.min(scroller.clientHeight || window.innerHeight, window.innerHeight);
        return Math.max(1, Math.floor(visible / row.offsetHeight) - 1);
      },
      announce: core.announce,
      onCopy: clipboard.onCopy,
      onCut: clipboard.onCut,
      onPaste: clipboard.onPaste,
      saveBatch: batch.saveBatch,
      discardBatch: batch.discardBatch,
    } satisfies RecordTableInlineEditController;
  }, [config, handle, rootRef, saveCell, toast]);
}
