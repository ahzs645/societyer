import {
  forwardRef,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ClipboardEvent,
  type KeyboardEvent,
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
} from "react";
import { TableVirtuoso, type TableVirtuosoHandle } from "react-virtuoso";
import { AlertCircle, Plus, Redo2, Trash2, Undo2 } from "lucide-react";
import { useToast } from "../Toast";
import { InfoPopover } from "../InfoPopover";
import { ShortcutHint } from "../ShortcutHint";
import { SHORTCUT_SECTIONS } from "../../lib/shortcutsRegistry";
import { useIsMobile } from "../../lib/useIsMobile";
import { formatMoney } from "../../lib/money";
import { GridCellEditor, type GridMove } from "./GridCellEditor";
import { GridRowListEditor } from "./GridRowListEditor";
import type { CellRange, CellRef, EditableGridProps, GridColumn, GridRow } from "./types";
import {
  cellDisplay,
  cellError,
  cellText,
  cellValue,
  columnLetter,
  columnTotal,
  continueSeries,
  emptyValue,
  inRange,
  invalidCell,
  isBlankRow,
  isEmptyValue,
  isInvalidCell,
  isMoneyColumn,
  isNumericColumn,
  isReadOnlyColumn,
  normaliseRange,
  parseCellText,
  parseTsv,
  toTsv,
  valuesEqual,
} from "./values";

type Editing = { r: number; c: number; mode: "replace" | "edit"; text: string };
type CellWrite = { r: number; c: number; value: unknown };

const cx = (...parts: Array<string | false | null | undefined>) => parts.filter(Boolean).join(" ");

/**
 * Spreadsheet-style grid for bulk entry: typed columns, range selection,
 * clipboard (TSV) copy/cut/paste, fill handle, undo/redo and per-cell
 * validation. Below the phone breakpoint it becomes a row list with a form
 * sheet per row. Edits are reported through `onRowsChange`; pair it with
 * `useGridChangeset` to keep them pending until the host saves.
 */
export function EditableGrid<R extends GridRow>(props: EditableGridProps<R>) {
  const isPhone = useIsMobile();
  return isPhone ? <GridRowListEditor {...props} /> : <GridDesktop {...props} />;
}

function GridDesktop<R extends GridRow>({
  label,
  columns,
  rows,
  onRowsChange,
  createRow,
  history,
  frozenFirstColumn,
  allowAddRows = true,
  allowDeleteRows = true,
  minRows = 0,
  rowErrors,
  toolbar,
  summary,
  virtualizeAbove = 200,
  onSelectionChange,
  onSaveShortcut,
  readOnly,
  rowNoun = "row",
  className,
}: EditableGridProps<R>) {
  const toast = useToast();
  const gridId = `egrid-${useId().replace(/[^a-zA-Z0-9]/g, "")}`;
  const tableRef = useRef<HTMLTableElement | null>(null);
  const virtuosoRef = useRef<TableVirtuosoHandle>(null);
  const rowsRef = useRef(rows);
  rowsRef.current = rows;
  const [active, setActive] = useState<CellRef>({ r: 0, c: 0 });
  const [extent, setExtent] = useState<CellRef>({ r: 0, c: 0 });
  const [editing, setEditing] = useState<Editing | null>(null);
  const [fill, setFill] = useState<CellRange | null>(null);
  const [focused, setFocused] = useState(false);
  const [announcement, setAnnouncement] = useState("");
  const selectingRef = useRef(false);

  const rowCount = rows.length;
  const colCount = columns.length;
  const virtual = rowCount > virtualizeAbove;
  const hasTotals = columns.some((col) => col.total);
  const canEdit = !readOnly;
  const canAdd = canEdit && allowAddRows;
  const canDelete = canEdit && allowDeleteRows;

  const clampCell = useCallback(
    (cell: CellRef): CellRef => ({
      r: Math.max(0, Math.min(Math.max(rowCount - 1, 0), cell.r)),
      c: Math.max(0, Math.min(colCount - 1, cell.c)),
    }),
    [rowCount, colCount],
  );
  const a = clampCell(active);
  const e = clampCell(extent);
  const range: CellRange | null = rowCount > 0 ? normaliseRange(a, e) : null;
  const cellId = (r: number, c: number) => `${gridId}-r${r}-c${c}`;

  const announce = useCallback((message: string) => {
    // A trailing zero-width space makes repeated messages re-announce.
    setAnnouncement((current) => (current === message ? `${message}​` : message));
  }, []);

  const focusGrid = useCallback(() => {
    tableRef.current?.focus({ preventScroll: true });
  }, []);

  // Focus moves back to the grid synchronously (so keys typed right after
  // Enter/Tab land in the next cell), and once more after popovers such as
  // the date picker restore focus to their own (now unmounted) trigger.
  const refocusAfterEdit = () => {
    focusGrid();
    requestAnimationFrame(() => {
      const activeEl = document.activeElement;
      if (!activeEl || activeEl === document.body) focusGrid();
    });
  };

  const select = (cell: CellRef, extend = false) => {
    const next = clampCell(cell);
    if (extend) setExtent(next);
    else {
      setActive(next);
      setExtent(next);
    }
  };

  // Keep the moving end of the selection in view.
  useEffect(() => {
    if (!tableRef.current || !tableRef.current.contains(document.activeElement)) return;
    if (virtual) virtuosoRef.current?.scrollIntoView({ index: e.r });
    const frame = requestAnimationFrame(() => {
      document.getElementById(cellId(e.r, e.c))?.scrollIntoView({ block: "nearest", inline: "nearest" });
    });
    return () => cancelAnimationFrame(frame);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [e.r, e.c, virtual]);

  // Crossing the virtualization threshold swaps the table element; keep focus.
  const virtualRef = useRef(virtual);
  useEffect(() => {
    if (virtualRef.current === virtual) return;
    virtualRef.current = virtual;
    if (focused && !editing) {
      const frame = requestAnimationFrame(focusGrid);
      return () => cancelAnimationFrame(frame);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [virtual]);

  const rangeKey = range ?`${range.r0}:${range.r1}:${range.c0}:${range.c1}` : "";
  useEffect(() => {
    if (!onSelectionChange) return;
    if (!range) {
      onSelectionChange({ range: null, columnKeys: [], rowKeys: [] });
      return;
    }
    onSelectionChange({
      range,
      columnKeys: columns.slice(range.c0, range.c1 + 1).map((col) => col.key),
      rowKeys: rows.slice(range.r0, range.r1 + 1).map((row) => row.key),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rangeKey, rows, columns]);

  // ----------------------------------------------------------- writes --

  const writeCells = (writes: CellWrite[], label: string, appended: R[] = []) => {
    const base = rowsRef.current;
    const next = appended.length ? [...base, ...appended] : base.slice();
    let changed = appended.length > 0;
    for (const write of writes) {
      const col = columns[write.c];
      const row = next[write.r];
      if (!row || !col || isReadOnlyColumn(col, row)) continue;
      const current = row[col.key];
      if (valuesEqual(current, write.value) && isInvalidCell(current) === isInvalidCell(write.value)) continue;
      next[write.r] = { ...row, [col.key]: write.value };
      changed = true;
    }
    if (!changed) return false;
    rowsRef.current = next;
    onRowsChange(next, label);
    return true;
  };

  const describeCell = (r: number, c: number) => `Row ${r + 1}, ${columns[c]?.header ?? ""}`;

  const moveFrom = (r: number, c: number, move: GridMove, maxRows: number) => {
    if (move === "none" || move === "blur") return;
    let nr = r;
    let nc = c;
    const editable = (ci: number) => columns[ci] && columns[ci].type !== "computed";
    if (move === "down") nr = Math.min(maxRows - 1, r + 1);
    if (move === "up") nr = Math.max(0, r - 1);
    if (move === "right" || move === "left") {
      const step = move === "right" ? 1 : -1;
      let ci = c + step;
      let ri = r;
      // Tab skips computed columns and wraps to the next/previous row.
      for (let guard = 0; guard < colCount * 2; guard += 1) {
        if (ci >= colCount) { if (ri + 1 >= maxRows) { ci = c; break; } ri += 1; ci = 0; }
        if (ci < 0) { if (ri - 1 < 0) { ci = c; break; } ri -= 1; ci = colCount - 1; }
        if (editable(ci)) break;
        ci += step;
      }
      nr = ri;
      nc = ci;
    }
    setActive({ r: nr, c: nc });
    setExtent({ r: nr, c: nc });
  };

  const startEdit = (cell: CellRef, mode: "replace" | "edit", initial?: string) => {
    if (!canEdit || rowCount === 0) return;
    const row = rows[cell.r];
    const col = columns[cell.c];
    if (!row || !col) return;
    if (isReadOnlyColumn(col, row)) {
      announce(`${col.header} is read-only.`);
      return;
    }
    setActive(cell);
    setExtent(cell);
    setEditing({ r: cell.r, c: cell.c, mode, text: initial ?? cellText(row[col.key], col, row) });
  };

  const finishEdit = (value: unknown, move: GridMove, error?: string) => {
    if (!editing) return;
    const { r, c } = editing;
    const col = columns[c];
    const row = rowsRef.current[r];
    if (!row || !col) { setEditing(null); return; }
    const rowAfter = { ...row, [col.key]: value } as R;
    const appendRow = move === "down" && r === rowsRef.current.length - 1 && canAdd && !isBlankRow(rowAfter, columns);
    const appended = appendRow ? [createRow()] : [];
    const changed = writeCells([{ r, c, value }], `Edit ${col.header.toLowerCase()}`, appended);
    setEditing(null);
    moveFrom(r, c, move, rowsRef.current.length);
    if (error) announce(`${describeCell(r, c)}: ${error}`);
    else if (changed) announce(`${describeCell(r, c)} set to ${cellDisplay(value, col, rowAfter) || "blank"}${appendRow ? `. Added ${rowNoun} ${r + 2}.` : ""}`);
    if (move !== "blur") refocusAfterEdit();
  };

  const commitText = (text: string, move: GridMove) => {
    if (!editing) return;
    const col = columns[editing.c];
    const row = rowsRef.current[editing.r];
    if (!col || !row) { setEditing(null); return; }
    const parsed = parseCellText(text, col, row);
    if (parsed.ok) finishEdit(parsed.value, move);
    else finishEdit(invalidCell(text.trim(), parsed.error), move, parsed.error);
  };

  const cancelEdit = (fromBlur?: boolean) => {
    setEditing(null);
    if (!fromBlur) refocusAfterEdit();
  };

  const clearRange = (label = "Clear cells") => {
    if (!range || !canEdit) return;
    const writes: CellWrite[] = [];
    for (let r = range.r0; r <= range.r1; r += 1) {
      for (let c = range.c0; c <= range.c1; c += 1) writes.push({ r, c, value: emptyValue(columns[c]) });
    }
    if (writeCells(writes, label)) announce(`Cleared ${writes.length} cell${writes.length === 1 ? "" : "s"}`);
  };

  const addRow = () => {
    if (!canAdd) return;
    const next = [...rowsRef.current, createRow()];
    rowsRef.current = next;
    onRowsChange(next, `Add ${rowNoun}`);
    const r = next.length - 1;
    setActive({ r, c: 0 });
    setExtent({ r, c: 0 });
    announce(`Added ${rowNoun} ${r + 1}`);
    requestAnimationFrame(focusGrid);
  };

  const deleteRows = (r0: number, r1: number) => {
    if (!canDelete) return;
    const current = rowsRef.current;
    const removed = current.slice(r0, r1 + 1).map((row, offset) => ({ row, index: r0 + offset }));
    if (removed.length === 0) return;
    let next = current.filter((_, index) => index < r0 || index > r1);
    const placeholders = new Set<string>();
    while (next.length < minRows) {
      const blank = createRow();
      placeholders.add(blank.key);
      next = [...next, blank];
    }
    rowsRef.current = next;
    const noun = removed.length === 1 ? `${rowNoun} ${r0 + 1}` : `${removed.length} ${rowNoun}s`;
    onRowsChange(next, removed.length === 1 ? `Delete ${rowNoun}` : `Delete ${rowNoun}s`);
    select({ r: Math.min(r0, next.length - 1), c: a.c });
    announce(`Deleted ${noun}`);
    toast.info(`Deleted ${noun}`, {
      action: {
        label: "Undo",
        onClick: () => {
          const latest = rowsRef.current;
          const keys = new Set(latest.map((row) => row.key));
          // Drop the blank rows that only stood in for the deleted ones.
          const restored = latest.filter((row) => !(placeholders.has(row.key) && isBlankRow(row, columns)));
          for (const item of removed) {
            if (keys.has(item.row.key)) continue;
            restored.splice(Math.min(item.index, restored.length), 0, item.row);
          }
          rowsRef.current = restored;
          onRowsChange(restored, `Restore ${rowNoun}s`);
          announce(`Restored ${noun}`);
        },
      },
    });
    requestAnimationFrame(focusGrid);
  };

  // ------------------------------------------------------------ fill --

  const applyFill = (source: CellRange, target: CellRange) => {
    const current = rowsRef.current;
    const writes: CellWrite[] = [];
    let skipped = 0;
    if (target.r1 > source.r1) {
      const count = target.r1 - source.r1;
      for (let c = source.c0; c <= source.c1; c += 1) {
        const col = columns[c];
        const sourceValues = current.slice(source.r0, source.r1 + 1).map((row) => row[col.key]);
        const values = continueSeries(sourceValues, col, count);
        values.forEach((value, k) => writes.push({ r: source.r1 + 1 + k, c, value }));
      }
    } else if (target.c1 > source.c1) {
      const width = source.c1 - source.c0 + 1;
      for (let r = source.r0; r <= source.r1; r += 1) {
        const row = current[r];
        for (let k = 0; k < target.c1 - source.c1; k += 1) {
          const from = columns[source.c0 + (k % width)];
          const to = columns[source.c1 + 1 + k];
          if (!to || isReadOnlyColumn(to, row)) continue;
          const value = cellValue(row, from);
          if (from.type === to.type) {
            writes.push({ r, c: source.c1 + 1 + k, value });
            continue;
          }
          const parsed = parseCellText(cellText(value, from, row), to, row);
          if (parsed.ok) writes.push({ r, c: source.c1 + 1 + k, value: parsed.value });
          else skipped += 1;
        }
      }
    } else return;
    writeCells(writes, "Fill");
    setActive({ r: target.r0, c: target.c0 });
    setExtent({ r: target.r1, c: target.c1 });
    announce(`Filled ${writes.length} cell${writes.length === 1 ? "" : "s"}${skipped ? `, ${skipped} skipped` : ""}`);
  };

  const fillDown = () => {
    if (!range || !canEdit) return;
    const { r0, r1, c0, c1 } = range;
    const sourceRow = r1 > r0 ? r0 : r0 - 1;
    if (sourceRow < 0) return;
    const current = rowsRef.current;
    const writes: CellWrite[] = [];
    for (let r = sourceRow + 1; r <= r1; r += 1) {
      for (let c = c0; c <= c1; c += 1) writes.push({ r, c, value: current[sourceRow][columns[c].key] });
    }
    if (writeCells(writes, "Fill down")) announce(`Filled down ${writes.length} cell${writes.length === 1 ? "" : "s"}`);
  };

  const startFillDrag = (event: ReactPointerEvent) => {
    if (!range) return;
    event.preventDefault();
    event.stopPropagation();
    const source = range;
    let preview: CellRange | null = null;
    const onMove = (move: PointerEvent) => {
      const target = document.elementFromPoint(move.clientX, move.clientY)?.closest<HTMLElement>(`[data-egrid="${gridId}"]`);
      if (!target) return;
      const r = Number(target.dataset.r);
      const c = Number(target.dataset.c);
      const next = r > source.r1 ? { ...source, r1: r } : c > source.c1 ? { ...source, c1: c } : null;
      const same = next && preview && next.r1 === preview.r1 && next.c1 === preview.c1;
      if (!same) {
        preview = next;
        setFill(next);
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      setFill(null);
      if (preview) applyFill(source, preview);
      focusGrid();
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  };

  // ------------------------------------------------------- clipboard --

  const rangeMatrix = (target: CellRange) =>
    rowsRef.current.slice(target.r0, target.r1 + 1).map((row) =>
      columns.slice(target.c0, target.c1 + 1).map((col) => cellText(cellValue(row, col), col, row)),
    );

  const onCopy = (event: ClipboardEvent) => {
    if (editing || !range) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", toTsv(rangeMatrix(range)));
    const cells = (range.r1 - range.r0 + 1) * (range.c1 - range.c0 + 1);
    announce(`Copied ${cells} cell${cells === 1 ? "" : "s"}`);
  };

  const onCut = (event: ClipboardEvent) => {
    if (editing || !range) return;
    event.preventDefault();
    event.clipboardData.setData("text/plain", toTsv(rangeMatrix(range)));
    if (canEdit) clearRange("Cut");
  };

  const onPaste = (event: ClipboardEvent) => {
    if (editing || !canEdit) return;
    const text = event.clipboardData.getData("text/plain");
    if (!text) return;
    event.preventDefault();
    pasteText(text);
  };

  const pasteText = (text: string) => {
    const matrix = parseTsv(text);
    const start = range ?? { r0: 0, r1: 0, c0: 0, c1: 0 };
    const current = rowsRef.current;
    const single = matrix.length === 1 && matrix[0].length === 1;
    // One copied value over a larger selection fills the whole selection.
    const height = single ? start.r1 - start.r0 + 1 : matrix.length;
    const width = single ? start.c1 - start.c0 + 1 : Math.max(...matrix.map((r) => r.length));
    const needed = start.r0 + height - current.length;
    const appended: R[] = canAdd && needed > 0 ? Array.from({ length: needed }, () => createRow()) : [];
    const working = [...current, ...appended];
    const writes: CellWrite[] = [];
    const rejected: string[] = [];
    let ignored = 0;
    let readOnlySkipped = 0;
    for (let i = 0; i < height; i += 1) {
      for (let j = 0; j < width; j += 1) {
        const raw = single ? matrix[0][0] : matrix[i]?.[j] ?? "";
        const r = start.r0 + i;
        const c = start.c0 + j;
        const col = columns[c];
        const row = working[r];
        if (!col || !row) { if (raw.trim()) ignored += 1; continue; }
        if (isReadOnlyColumn(col, row)) { if (raw.trim()) readOnlySkipped += 1; continue; }
        const parsed = parseCellText(raw, col, row);
        if (parsed.ok) {
          writes.push({ r, c, value: parsed.value });
          working[r] = { ...row, [col.key]: parsed.value };
        } else rejected.push(`${columnLetter(c)}${r + 1} ${col.header}: ${parsed.error}`);
      }
    }
    // Drop appended rows that ended up blank (e.g. every cell rejected).
    let trimmedAppend = appended;
    while (trimmedAppend.length && isBlankRow(working[current.length + trimmedAppend.length - 1], columns)) {
      trimmedAppend = trimmedAppend.slice(0, -1);
    }
    const kept = new Set(trimmedAppend.map((row) => row.key));
    const keptWrites = writes.filter((w) => w.r < current.length || kept.has(working[w.r].key));
    writeCells(keptWrites, "Paste", trimmedAppend);
    const lastRow = Math.min(start.r0 + height - 1, current.length + trimmedAppend.length - 1);
    const lastCol = Math.min(start.c0 + width - 1, colCount - 1);
    setActive({ r: start.r0, c: start.c0 });
    setExtent({ r: Math.max(start.r0, lastRow), c: lastCol });
    const filled = keptWrites.filter((w) => !isEmptyValue(w.value)).length;
    const parts = [`Pasted ${filled} cell${filled === 1 ? "" : "s"}`];
    if (trimmedAppend.length) parts.push(`added ${trimmedAppend.length} ${rowNoun}${trimmedAppend.length === 1 ? "" : "s"}`);
    if (rejected.length) parts.push(`${rejected.length} rejected`);
    if (readOnlySkipped) parts.push(`${readOnlySkipped} read-only skipped`);
    if (ignored) parts.push(`${ignored} outside the grid ignored`);
    const summaryText = parts.join(", ");
    announce(summaryText);
    if (rejected.length || ignored || readOnlySkipped) {
      const detail = rejected.slice(0, 3).join(" · ") + (rejected.length > 3 ? ` · and ${rejected.length - 3} more` : "");
      toast.warn(summaryText, { description: detail || undefined, duration: 9000 });
    }
  };

  // -------------------------------------------------------- keyboard --

  const onKeyDown = (event: KeyboardEvent<HTMLTableElement>) => {
    if (editing || event.target !== tableRef.current) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key;
    const lower = key.toLowerCase();
    const handled = () => {
      event.preventDefault();
      event.stopPropagation();
    };
    if (mod && lower === "z") {
      handled();
      const label = event.shiftKey ? history?.redo() : history?.undo();
      announce(label ? `${event.shiftKey ? "Redid" : "Undid"}: ${label}` : `Nothing to ${event.shiftKey ? "redo" : "undo"}`);
      return;
    }
    if (mod && lower === "y") {
      handled();
      const label = history?.redo();
      announce(label ? `Redid: ${label}` : "Nothing to redo");
      return;
    }
    if (mod && lower === "a") {
      handled();
      if (rowCount === 0) return;
      setActive({ r: 0, c: 0 });
      setExtent({ r: rowCount - 1, c: colCount - 1 });
      announce(`Selected all ${rowCount * colCount} cells`);
      return;
    }
    if (mod && lower === "d") { handled(); fillDown(); return; }
    if (mod && lower === "s") { if (onSaveShortcut) { handled(); onSaveShortcut(); } return; }
    if (mod && (lower === "c" || lower === "x" || lower === "v")) return; // clipboard events
    if (rowCount === 0) {
      if (key === "Enter" && canAdd) { handled(); addRow(); }
      return;
    }
    const arrows: Record<string, [number, number]> = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] };
    if (arrows[key]) {
      handled();
      const [dr, dc] = arrows[key];
      const from = event.shiftKey ? e : a;
      const target = mod
        ? { r: dr ? (dr > 0 ? rowCount - 1 : 0) : from.r, c: dc ? (dc > 0 ? colCount - 1 : 0) : from.c }
        : { r: from.r + dr, c: from.c + dc };
      select(target, event.shiftKey);
      return;
    }
    switch (key) {
      case "Home": handled(); select({ r: mod ? 0 : e.r, c: 0 }, event.shiftKey); return;
      case "End": handled(); select({ r: mod ? rowCount - 1 : e.r, c: colCount - 1 }, event.shiftKey); return;
      case "PageDown": handled(); select({ r: e.r + 10, c: e.c }, event.shiftKey); return;
      case "PageUp": handled(); select({ r: e.r - 10, c: e.c }, event.shiftKey); return;
      case "Tab": {
        const atEnd = event.shiftKey ? a.r === 0 && a.c === 0 : a.r === rowCount - 1 && a.c === colCount - 1;
        if (atEnd) return; // let focus leave the grid
        handled();
        moveFrom(a.r, a.c, event.shiftKey ? "left" : "right", rowCount);
        return;
      }
      case "Enter":
        handled();
        if (event.shiftKey) moveFrom(a.r, a.c, "up", rowCount);
        else startEdit(a, "edit");
        return;
      case "F2": handled(); startEdit(a, "edit"); return;
      case "Backspace":
      case "Delete": handled(); clearRange(); return;
      case "Escape":
        if (range && (range.r0 !== range.r1 || range.c0 !== range.c1)) {
          handled();
          setExtent(a);
          announce("Selection cleared");
        }
        return;
      default:
        if (key.length === 1 && !mod && !event.altKey && canEdit) {
          handled();
          const col = columns[a.c];
          if (col?.type === "select" && key === " ") startEdit(a, "edit");
          else startEdit(a, "replace", key === " " ? "" : key);
        }
    }
  };

  // ----------------------------------------------------------- mouse --

  const cellFromTarget = (target: EventTarget | null): CellRef | null => {
    const el = target instanceof Element ? target.closest<HTMLElement>(`[data-egrid="${gridId}"]`) : null;
    if (!el) return null;
    return { r: Number(el.dataset.r), c: Number(el.dataset.c) };
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLTableElement>) => {
    if (event.button !== 0) return;
    const cell = cellFromTarget(event.target);
    if (!cell) return;
    if (editing && editing.r === cell.r && editing.c === cell.c) return;
    select(cell, event.shiftKey);
    selectingRef.current = true;
    if (!editing) {
      // Keep focus on the grid (not the clicked cell's text).
      event.preventDefault();
      focusGrid();
    }
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLTableElement>) => {
    if (!selectingRef.current || !(event.buttons & 1) || fill) return;
    const cell = cellFromTarget(event.target);
    if (cell && (cell.r !== e.r || cell.c !== e.c)) setExtent(clampCell(cell));
  };

  useEffect(() => {
    const stop = () => { selectingRef.current = false; };
    window.addEventListener("pointerup", stop);
    return () => window.removeEventListener("pointerup", stop);
  }, []);

  const selectRow = (r: number, extend: boolean) => {
    if (extend) {
      setActive((current) => ({ r: clampCell(current).r, c: 0 }));
      setExtent({ r, c: colCount - 1 });
    } else {
      setActive({ r, c: 0 });
      setExtent({ r, c: colCount - 1 });
    }
    announce(`Selected ${rowNoun} ${r + 1}`);
    requestAnimationFrame(focusGrid);
  };

  const selectColumn = (c: number) => {
    if (rowCount === 0) return;
    setActive({ r: 0, c });
    setExtent({ r: rowCount - 1, c });
    announce(`Selected column ${columns[c].header}`);
    requestAnimationFrame(focusGrid);
  };

  // --------------------------------------------------------- render --

  const errorCount = useMemo(() => {
    let count = 0;
    for (const row of rows) for (const col of columns) if (cellError(row, col, rows, columns)) count += 1;
    return count;
  }, [rows, columns]);

  const activeError = rowCount > 0 && rows[a.r] && columns[a.c] ? cellError(rows[a.r], columns[a.c], rows, columns) : null;
  const selectedRows = range ? range.r1 - range.r0 + 1 : 0;
  const edgeRange = fill ?? range;

  const renderCell = (r: number, c: number) => {
    const row = rows[r];
    const col = columns[c];
    const value = cellValue(row, col);
    const error = cellError(row, col, rows, columns);
    const selected = inRange(range, r, c);
    const isActive = r === a.r && c === a.c;
    const onEdge = edgeRange && inRange(edgeRange, r, c);
    const isEditing = editing?.r === r && editing?.c === c;
    const readOnlyCell = isReadOnlyColumn(col, row);
    const showHandle = canEdit && !editing && !fill && range && r === range.r1 && c === range.c1;
    const display = cellDisplay(value, col, row);
    const errorId = `${cellId(r, c)}-error`;
    return (
      <td
        key={col.key}
        id={cellId(r, c)}
        role="gridcell"
        aria-colindex={c + 2}
        aria-selected={selected}
        aria-readonly={readOnlyCell || undefined}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
        data-egrid={gridId}
        data-r={r}
        data-c={c}
        title={error ?? undefined}
        className={cx(
          "egrid__cell",
          isNumericColumn(col) && "egrid__cell--num",
          readOnlyCell && "egrid__cell--readonly",
          frozenFirstColumn && c === 0 && "egrid__cell--frozen",
          selected && "is-selected",
          isActive && "is-active",
          isEditing && "is-editing",
          error && "is-invalid",
          fill && onEdge && "is-filling",
          onEdge && r === edgeRange!.r0 && "is-edge-top",
          onEdge && r === edgeRange!.r1 && "is-edge-bottom",
          onEdge && c === edgeRange!.c0 && "is-edge-left",
          onEdge && c === edgeRange!.c1 && "is-edge-right",
          showHandle && "has-fill-handle",
        )}
        onDoubleClick={() => startEdit({ r, c }, "edit")}
      >
        {isEditing && editing ? (
          <GridCellEditor
            col={col}
            row={row}
            value={row[col.key]}
            initialText={editing.text}
            mode={editing.mode}
            anchor={document.getElementById(cellId(r, c))}
            label={describeCell(r, c)}
            onCommitText={commitText}
            onCommitValue={(next, move) => finishEdit(next, move)}
            onCancel={cancelEdit}
          />
        ) : (
          <span className={cx("egrid__value", !display && "egrid__value--empty", isMoneyColumn(col) && "money")}>
            {display || (col.type !== "computed" && !readOnlyCell ? col.placeholder ?? "" : "")}
          </span>
        )}
        {error && <span id={errorId} className="sr-only">{error}</span>}
        {showHandle && (
          <span
            className="egrid__fill-handle"
            aria-hidden="true"
            title="Drag to fill"
            onPointerDown={startFillDrag}
          />
        )}
      </td>
    );
  };

  const renderRowCells = (r: number) => {
    const row = rows[r];
    const rowError = rowErrors?.[row.key];
    const rowSelected = Boolean(range && r >= range.r0 && r <= range.r1 && range.c0 === 0 && range.c1 === colCount - 1);
    return (
      <>
        <th
          scope="row"
          role="rowheader"
          aria-colindex={1}
          className={cx("egrid__rowhead", rowError && "is-invalid", rowSelected && "is-selected")}
          title={rowError ?? `Select ${rowNoun} ${r + 1}`}
          onPointerDown={(event) => { event.preventDefault(); selectRow(r, event.shiftKey); }}
        >
          <span className="egrid__rownum">{r + 1}</span>
          {rowError && <AlertCircle size={12} aria-label={rowError} />}
        </th>
        {columns.map((_, c) => renderCell(r, c))}
        {canDelete && (
          <td role="gridcell" aria-colindex={colCount + 2} className="egrid__rowactions">
            <button
              type="button"
              tabIndex={-1}
              className="egrid__row-delete"
              aria-label={`Delete ${rowNoun} ${r + 1}`}
              title={`Delete ${rowNoun} ${r + 1}`}
              onClick={() => deleteRows(r, r)}
            >
              <Trash2 size={13} />
            </button>
          </td>
        )}
      </>
    );
  };

  const headerRow = (
    <tr aria-rowindex={1} className="egrid__headrow">
      <th role="columnheader" aria-colindex={1} className="egrid__corner">
        <span className="sr-only">Row</span>
      </th>
      {columns.map((col, c) => (
        <th
          key={col.key}
          role="columnheader"
          aria-colindex={c + 2}
          scope="col"
          title={col.description ?? `Select the ${col.header} column`}
          className={cx("egrid__head", isNumericColumn(col) && "egrid__head--num", frozenFirstColumn && c === 0 && "egrid__head--frozen")}
          onPointerDown={(event) => { event.preventDefault(); selectColumn(c); }}
        >
          {col.header}
          {col.required && <span className="egrid__required" aria-hidden="true">*</span>}
        </th>
      ))}
      {canDelete && <th role="columnheader" aria-colindex={colCount + 2} className="egrid__head egrid__head--actions"><span className="sr-only">Delete</span></th>}
    </tr>
  );

  const totalsRow = hasTotals ? (
    <tr aria-rowindex={rowCount + 2} className="egrid__totals">
      <th scope="row" role="rowheader" aria-colindex={1} className="egrid__rowhead">Total</th>
      {columns.map((col, c) => (
        <td
          key={col.key}
          role="gridcell"
          aria-colindex={c + 2}
          className={cx("egrid__cell egrid__cell--total", isNumericColumn(col) && "egrid__cell--num", frozenFirstColumn && c === 0 && "egrid__cell--frozen")}
        >
          {col.total && <span className="egrid__value money">{isMoneyColumn(col) ? formatMoney(columnTotal(rows, col), { currency: col.currency }) : columnTotal(rows, col).toLocaleString()}</span>}
        </td>
      ))}
      {canDelete && <td role="gridcell" aria-colindex={colCount + 2} className="egrid__cell egrid__cell--total" />}
    </tr>
  ) : null;

  const colgroup = (
    <colgroup>
      <col className="egrid__col-rowhead" />
      {columns.map((col) => <col key={col.key} style={{ width: col.width ?? 140 }} />)}
      {canDelete && <col className="egrid__col-actions" />}
    </colgroup>
  );

  const tableProps = {
    role: "grid",
    tabIndex: 0,
    "aria-label": label,
    "aria-rowcount": rowCount + 1 + (hasTotals ? 1 : 0),
    "aria-colcount": colCount + 1 + (canDelete ? 1 : 0),
    "aria-multiselectable": true,
    "aria-readonly": readOnly || undefined,
    "aria-activedescendant": rowCount > 0 && !editing ? cellId(a.r, a.c) : undefined,
    className: cx("egrid__table", focused && "is-focused"),
    onKeyDown,
    onCopy,
    onCut,
    onPaste,
    onPointerDown,
    onPointerMove,
  } as const;

  const minWidth = 44 + columns.reduce((sum, col) => sum + (col.width ?? 140), 0) + (canDelete ? 36 : 0);

  return (
    <div
      className={cx("egrid", className)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocused(false);
      }}
    >
      <div className="egrid__toolbar" role="toolbar" aria-label={`${label} tools`}>
        {canAdd && (
          <button type="button" className="btn btn--sm" onClick={addRow}>
            <Plus size={14} /> Add {rowNoun}
          </button>
        )}
        {canDelete && (
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={!range || rowCount === 0}
            onClick={() => range && deleteRows(range.r0, range.r1)}
          >
            <Trash2 size={14} /> Delete {selectedRows > 1 ? `${selectedRows} ${rowNoun}s` : rowNoun}
          </button>
        )}
        {history && (
          <span className="egrid__toolbar-group">
            <button type="button" className="btn btn--sm btn--ghost btn--icon" aria-label="Undo" title="Undo" disabled={!history.canUndo}
              onClick={() => { const l = history.undo(); if (l) announce(`Undid: ${l}`); }}>
              <Undo2 size={14} />
            </button>
            <button type="button" className="btn btn--sm btn--ghost btn--icon" aria-label="Redo" title="Redo" disabled={!history.canRedo}
              onClick={() => { const l = history.redo(); if (l) announce(`Redid: ${l}`); }}>
              <Redo2 size={14} />
            </button>
          </span>
        )}
        {toolbar}
        <span className="egrid__toolbar-spacer" />
        <InfoPopover label="Grid keyboard shortcuts">
          <GridShortcutList />
        </InfoPopover>
      </div>

      <div className={cx("egrid__scroller", virtual && "egrid__scroller--virtual")}>
        {virtual ? (
          <TableVirtuoso
            ref={virtuosoRef}
            className="egrid__virtuoso"
            data={rows}
            context={{ tableProps, tableRef, colgroup, minWidth }}
            components={VIRTUOSO_COMPONENTS as any}
            computeItemKey={(_, row) => row.key}
            fixedHeaderContent={() => headerRow}
            fixedFooterContent={totalsRow ? () => totalsRow : undefined}
            itemContent={(index) => renderRowCells(index)}
            increaseViewportBy={240}
          />
        ) : (
          <table {...tableProps} ref={tableRef} style={{ minWidth }}>
            {colgroup}
            <thead>{headerRow}</thead>
            <tbody>
              {rows.map((row, r) => (
                <tr key={row.key} aria-rowindex={r + 2} className={cx("egrid__row", rowErrors?.[row.key] && "has-error")}>
                  {renderRowCells(r)}
                </tr>
              ))}
              {rowCount === 0 && (
                <tr className="egrid__empty-row">
                  <td colSpan={colCount + 1 + (canDelete ? 1 : 0)}>
                    No {rowNoun}s yet. {canAdd ? `Add a ${rowNoun} or paste rows from a spreadsheet.` : ""}
                  </td>
                </tr>
              )}
            </tbody>
            {totalsRow && <tfoot>{totalsRow}</tfoot>}
          </table>
        )}
      </div>

      <div className="egrid__status">
        {activeError && focused ? (
          <span className="egrid__status-error"><AlertCircle size={13} aria-hidden="true" /> {describeCell(a.r, a.c)}: {activeError}</span>
        ) : errorCount > 0 ? (
          <span className="egrid__status-error"><AlertCircle size={13} aria-hidden="true" /> {errorCount} cell{errorCount === 1 ? " needs" : "s need"} attention</span>
        ) : (
          <span className="egrid__status-hint">
            Paste rows from a spreadsheet with <ShortcutHint keys={["Mod", "V"]} />, drag the corner square to fill.
          </span>
        )}
        {summary}
      </div>
      <div className="sr-only" role="status" aria-live="polite" aria-atomic="true">{announcement}</div>
    </div>
  );
}

function GridShortcutList() {
  const section = SHORTCUT_SECTIONS.find((s) => s.id === "grid");
  if (!section) return null;
  return (
    <div className="egrid__shortcuts">
      <strong>Keyboard shortcuts</strong>
      <dl>
        {section.items.map((item) => (
          <div key={item.label} className="egrid__shortcut">
            <dt><ShortcutHint keys={item.keys} /></dt>
            <dd>{item.label}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

type VirtuosoContext = {
  tableProps: Record<string, unknown>;
  tableRef: { current: HTMLTableElement | null };
  colgroup: ReactNode;
  minWidth: number;
};

const VIRTUOSO_COMPONENTS = {
  Table: forwardRef<HTMLTableElement, { context: VirtuosoContext; style?: React.CSSProperties; children?: ReactNode }>(
    function EditableGridVirtualTable({ context, style, children, ...rest }, ref) {
      return (
        <table
          {...rest}
          {...context.tableProps}
          style={{ ...style, minWidth: context.minWidth }}
          ref={(el) => {
            context.tableRef.current = el;
            if (typeof ref === "function") ref(el);
            else if (ref) ref.current = el;
          }}
        >
          {context.colgroup}
          {children}
        </table>
      );
    },
  ),
  // Virtuoso's sticky header/footer default to z-index 1, under the sticky
  // row numbers and frozen column; lift them above the body.
  TableHead: forwardRef<HTMLTableSectionElement, { context?: VirtuosoContext; style?: React.CSSProperties; children?: ReactNode }>(
    function EditableGridVirtualHead({ context: _context, style, ...props }, ref) {
      return <thead {...props} ref={ref} style={{ ...style, zIndex: 6 }} />;
    },
  ),
  TableFoot: forwardRef<HTMLTableSectionElement, { context?: VirtuosoContext; style?: React.CSSProperties; children?: ReactNode }>(
    function EditableGridVirtualFoot({ context: _context, style, ...props }, ref) {
      return <tfoot {...props} ref={ref} style={{ ...style, zIndex: 6 }} />;
    },
  ),
  TableRow: forwardRef<HTMLTableRowElement, { context: VirtuosoContext; item: unknown; "data-index": number }>(
    function EditableGridVirtualRow({ context: _context, item: _item, ...props }, ref) {
      return <tr {...props} ref={ref} aria-rowindex={props["data-index"] + 2} className="egrid__row" />;
    },
  ),
};

export type { GridColumn };
