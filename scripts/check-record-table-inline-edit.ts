// RecordTable grid mode (`inlineEdit`) gate: the pure logic behind it.
//
// Covers selection maths (arrows, ⌘/Ctrl+arrows, Shift extension, Page
// Up/Down, Home/End, Tab wrapping, folded columns), TSV parse/serialise,
// value coercion through the EditableGrid parsers (currency in cents or
// dollars, dates, options by label/keyword, required/validate), paste
// planning (fill, blocks, read-only/invalid/outside skips), the undo/redo
// stack and the batch changeset.
//
// Run: npm run test:record-table-inline-edit

import assert from "node:assert/strict";
import type { FieldMetadata } from "../src/platform/record-engine/types/FieldMetadata";
import type { RecordTableEditableColumn } from "../src/platform/record-engine/record-table/contexts/RecordTableInlineEditContext";
import { cellsInRect, navigateGrid, selectAllCells, selectionRect, type GridSelection } from "../src/platform/record-engine/record-table/utils/gridNavigation";
import { parseTsv, planPaste, pasteSummary, toTsv, type PasteTarget } from "../src/platform/record-engine/record-table/utils/gridClipboard";
import {
  checkInlineValue,
  emptyInlineValue,
  formatInlineText,
  inlineEditOptions,
  parseInlineText,
  sameInlineValue,
} from "../src/platform/record-engine/record-table/utils/inlineEditValues";
import {
  EMPTY_EDIT_HISTORY,
  createEditEntry,
  dropEdit,
  entryWrites,
  narrowEdit,
  recordEdit,
  redoEdit,
  undoEdit,
} from "../src/platform/record-engine/record-table/utils/editHistory";
import { applyStagedEdits, stageWrites, stagedCount, stagedList, unstageWrites, type StagedEdits } from "../src/platform/record-engine/record-table/utils/stagedEdits";
import { RECORD_TABLE_GRID_SHORTCUTS } from "../src/platform/record-engine/record-table/utils/gridShortcuts";

let checks = 0;
function check(name: string, run: () => void) {
  try {
    run();
    checks += 1;
  } catch (error) {
    console.error(`✗ ${name}`);
    throw error;
  }
}

// ------------------------------------------------------------ selection --

const bounds = { rowCount: 20, navigable: [0, 1, 2, 3], pageSize: 5 };
const at = (rowIndex: number, columnIndex: number) => ({ rowIndex, columnIndex });
const sel = (focus: { rowIndex: number; columnIndex: number }, anchor: { rowIndex: number; columnIndex: number } | null = null): GridSelection => ({ focus, anchor });

check("arrows move one cell and clamp at the edges", () => {
  assert.deepEqual(navigateGrid(sel(at(3, 1)), { key: "ArrowDown" }, bounds), sel(at(4, 1)));
  assert.deepEqual(navigateGrid(sel(at(3, 1)), { key: "ArrowRight" }, bounds), sel(at(3, 2)));
  assert.deepEqual(navigateGrid(sel(at(0, 0)), { key: "ArrowUp" }, bounds), sel(at(0, 0)));
  assert.deepEqual(navigateGrid(sel(at(19, 3)), { key: "ArrowRight" }, bounds), sel(at(19, 3)));
});

check("a plain move drops the range", () => {
  assert.deepEqual(navigateGrid(sel(at(3, 1), at(1, 0)), { key: "ArrowLeft" }, bounds), sel(at(3, 0)));
});

check("Shift+arrow extends from the anchor (or the focus when there is none)", () => {
  assert.deepEqual(navigateGrid(sel(at(3, 1)), { key: "ArrowDown", shiftKey: true }, bounds), sel(at(4, 1), at(3, 1)));
  assert.deepEqual(navigateGrid(sel(at(4, 1), at(3, 1)), { key: "ArrowRight", shiftKey: true }, bounds), sel(at(4, 2), at(3, 1)));
});

check("⌘/Ctrl+arrow jumps to the edge; with Shift it extends there", () => {
  assert.deepEqual(navigateGrid(sel(at(3, 1)), { key: "ArrowDown", mod: true }, bounds), sel(at(19, 1)));
  assert.deepEqual(navigateGrid(sel(at(3, 1)), { key: "ArrowLeft", mod: true }, bounds), sel(at(3, 0)));
  assert.deepEqual(navigateGrid(sel(at(3, 1)), { key: "ArrowUp", mod: true, shiftKey: true }, bounds), sel(at(0, 1), at(3, 1)));
  assert.deepEqual(navigateGrid(sel(at(3, 1)), { key: "ArrowRight", mod: true, shiftKey: true }, bounds), sel(at(3, 3), at(3, 1)));
});

check("Page Up/Down move a page and clamp", () => {
  assert.deepEqual(navigateGrid(sel(at(3, 2)), { key: "PageDown" }, bounds), sel(at(8, 2)));
  assert.deepEqual(navigateGrid(sel(at(3, 2)), { key: "PageUp" }, bounds), sel(at(0, 2)));
  assert.deepEqual(navigateGrid(sel(at(18, 2)), { key: "PageDown", shiftKey: true }, bounds), sel(at(19, 2), at(18, 2)));
});

check("Home/End go to the first/last column; with ⌘ also the first/last row", () => {
  assert.deepEqual(navigateGrid(sel(at(5, 2)), { key: "Home" }, bounds), sel(at(5, 0)));
  assert.deepEqual(navigateGrid(sel(at(5, 2)), { key: "End" }, bounds), sel(at(5, 3)));
  assert.deepEqual(navigateGrid(sel(at(5, 2)), { key: "End", mod: true }, bounds), sel(at(19, 3)));
  assert.deepEqual(navigateGrid(sel(at(5, 2)), { key: "Home", mod: true }, bounds), sel(at(0, 0)));
});

check("Tab wraps across rows and lets focus leave at either end", () => {
  assert.deepEqual(navigateGrid(sel(at(2, 3)), { key: "Tab" }, bounds), sel(at(3, 0)));
  assert.deepEqual(navigateGrid(sel(at(3, 0)), { key: "Tab", shiftKey: true }, bounds), sel(at(2, 3)));
  assert.deepEqual(navigateGrid(sel(at(2, 1), at(0, 0)), { key: "Tab" }, bounds), sel(at(2, 2)), "Tab never extends");
  assert.equal(navigateGrid(sel(at(19, 3)), { key: "Tab" }, bounds), null);
  assert.equal(navigateGrid(sel(at(0, 0)), { key: "Tab", shiftKey: true }, bounds), null);
});

check("folded columns are skipped", () => {
  const folded = { rowCount: 3, navigable: [0, 2, 5], pageSize: 1 };
  assert.deepEqual(navigateGrid(sel(at(0, 0)), { key: "ArrowRight" }, folded), sel(at(0, 2)));
  assert.deepEqual(navigateGrid(sel(at(0, 2)), { key: "ArrowRight" }, folded), sel(at(0, 5)));
  assert.deepEqual(navigateGrid(sel(at(0, 5)), { key: "Tab" }, folded), sel(at(1, 0)));
  assert.deepEqual(cellsInRect({ top: 0, bottom: 1, left: 0, right: 2 }, folded.navigable), [at(0, 0), at(0, 2), at(1, 0), at(1, 2)]);
});

check("non-grid keys and empty grids are left alone", () => {
  assert.equal(navigateGrid(sel(at(0, 0)), { key: "a" }, bounds), null);
  assert.equal(navigateGrid(sel(at(0, 0)), { key: "ArrowDown" }, { ...bounds, rowCount: 0 }), null);
});

check("selection rectangles and select-all", () => {
  assert.deepEqual(selectionRect(sel(at(1, 3), at(4, 0))), { top: 1, bottom: 4, left: 0, right: 3 });
  assert.deepEqual(selectionRect(sel(at(2, 2))), { top: 2, bottom: 2, left: 2, right: 2 });
  assert.deepEqual(selectAllCells(bounds), sel(at(0, 0), at(19, 3)));
  assert.equal(selectAllCells({ ...bounds, rowCount: 0 }), null);
});

// ------------------------------------------------------------------ TSV --

check("TSV parses spreadsheet clipboards", () => {
  assert.deepEqual(parseTsv("a\tb\nc\td\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseTsv("a\tb\r\nc\td\r\n"), [["a", "b"], ["c", "d"]]);
  assert.deepEqual(parseTsv('"line 1\nline 2"\t"say ""hi"""'), [["line 1\nline 2", 'say "hi"']]);
  assert.deepEqual(parseTsv("solo"), [["solo"]]);
});

check("TSV serialises with quoting and round-trips", () => {
  const matrix = [["Firm", "Notes"], ["North Shore CPA", 'Tab\there, "quoted"\nand a newline']];
  const text = toTsv(matrix);
  assert.equal(text.split("\n")[0], "Firm\tNotes");
  assert.deepEqual(parseTsv(text), matrix);
});

// --------------------------------------------------------------- values --

function field(name: string, label: string, fieldType: FieldMetadata["fieldType"], config: Record<string, unknown> = {}): FieldMetadata {
  return {
    _id: name,
    objectMetadataId: "object",
    name,
    label,
    fieldType,
    config,
    defaultValue: undefined,
    isSystem: false,
    isHidden: false,
    isNullable: true,
    isReadOnly: false,
    position: 0,
  };
}

const amountDollars = field("amount", "Amount", "CURRENCY");
const amountCents = field("amountCents", "Amount", "CURRENCY", { isCents: true });
const dateField = field("date", "Date", "DATE");
const statusField = field("status", "Status", "SELECT", { options: [{ value: "open", label: "Open" }, { value: "closed", label: "Closed" }] });
const accountField = field("accountId", "Category", "RELATION");
const yearField = field("fiscalYear", "Fiscal year", "TEXT");
const countField = field("count", "Count", "NUMBER");
const record = { _id: "r1", amount: 12.5, amountCents: 1250, date: "2026-03-04", status: "open", accountId: "acc-1", fiscalYear: "2026" };

const currency: RecordTableEditableColumn = { editor: "currency" };
const accountOptions = [
  { value: "acc-1", label: "5100 · Office supplies", keywords: ["5100"] },
  { value: "acc-2", label: "5200 · Rent", keywords: ["5200"] },
];

check("currency parses to dollars or cents per the field's metadata", () => {
  assert.deepEqual(parseInlineText("$1,200.50", amountDollars, currency, record), { ok: true, value: 1200.5 });
  assert.deepEqual(parseInlineText("$1,200.50", amountCents, currency, record), { ok: true, value: 120050 });
  assert.equal(formatInlineText(12.5, amountDollars, currency, record), "12.50");
  assert.equal(formatInlineText(1250, amountCents, currency, record), "12.50");
  assert.equal(parseInlineText("lots", amountDollars, currency, record).ok, false);
});

check("numbers and dates coerce like the budget grid", () => {
  assert.deepEqual(parseInlineText("1,234", countField, { editor: "number" }, record), { ok: true, value: 1234 });
  assert.deepEqual(parseInlineText("4 Mar 2026", dateField, { editor: "date" }, record), { ok: true, value: "2026-03-04" });
  assert.deepEqual(parseInlineText("2026/3/5", dateField, { editor: "date" }, record), { ok: true, value: "2026-03-05" });
  assert.equal(parseInlineText("03/04/2026", dateField, { editor: "date" }, record).ok, false, "ambiguous dates are rejected");
});

check("select options default to the field metadata and match labels", () => {
  const select: RecordTableEditableColumn = { editor: "select" };
  assert.deepEqual(inlineEditOptions(statusField, select, record).map((option) => option.value), ["open", "closed"]);
  assert.deepEqual(parseInlineText("Closed", statusField, select, record), { ok: true, value: "closed" });
  assert.equal(formatInlineText("closed", statusField, select, record), "Closed");
  const rejected = parseInlineText("Pending", statusField, select, record);
  assert.equal(rejected.ok, false);
});

check("relation pickers use the page's options, by label, code or id", () => {
  const relation: RecordTableEditableColumn = { editor: "relation", options: () => accountOptions };
  assert.deepEqual(parseInlineText("Rent", accountField, relation, record), { ok: true, value: "acc-2" });
  assert.deepEqual(parseInlineText("5100", accountField, relation, record), { ok: true, value: "acc-1" });
  assert.deepEqual(parseInlineText("acc-2", accountField, relation, record), { ok: true, value: "acc-2" });
  assert.equal(formatInlineText("acc-1", accountField, relation, record), "5100 · Office supplies");
});

check("required and validate reject values; blanks become the column's empty value", () => {
  const year: RecordTableEditableColumn = {
    editor: "text",
    required: true,
    validate: (value) => (/^\d{4}$/.test(String(value)) ? null : "Use a year such as 2026."),
  };
  assert.deepEqual(parseInlineText("", yearField, year, record), { ok: false, error: "Fiscal year is required." });
  assert.deepEqual(parseInlineText("twenty", yearField, year, record), { ok: false, error: "Use a year such as 2026." });
  assert.deepEqual(parseInlineText(" 2027 ", yearField, year, record), { ok: true, value: "2027" });
  assert.deepEqual(parseInlineText("", amountDollars, currency, record), { ok: true, value: null });
  assert.equal(emptyInlineValue({ editor: "text" }), "");
  assert.equal(emptyInlineValue({ editor: "text", emptyValue: null }), null);
  assert.deepEqual(checkInlineValue("", yearField, year, record), { ok: false, error: "Fiscal year is required." });
  assert.deepEqual(checkInlineValue("2026-04-01", dateField, { editor: "date" }, record), { ok: true, value: "2026-04-01" });
});

check("values compare the way saving does", () => {
  assert.equal(sameInlineValue("", null), true);
  assert.equal(sameInlineValue(12, 12), true);
  assert.equal(sameInlineValue(["a"], ["a"]), true);
  assert.equal(sameInlineValue("a", "b"), false);
});

// ---------------------------------------------------------------- paste --

const pasteNavigable = [0, 1, 2, 3];
const editableAt = (readOnlyColumns: number[] = []) => (cell: { rowIndex: number; columnIndex: number }): PasteTarget =>
  readOnlyColumns.includes(cell.columnIndex)
    ? { editable: false }
    : {
        editable: true,
        label: `Col ${cell.columnIndex}`,
        parse: (text) => (text === "bad" ? { ok: false, error: "Not valid." } : { ok: true, value: text.trim() }),
      };

check("one copied value fills the whole selection", () => {
  const plan = planPaste({ text: "x\n", selection: { top: 1, bottom: 3, left: 1, right: 2 }, rowCount: 10, navigable: pasteNavigable, targetAt: editableAt() });
  assert.equal(plan.writes.length, 6);
  assert.ok(plan.writes.every((write) => write.value === "x"));
  assert.deepEqual(plan.covered, { focus: at(1, 1), anchor: at(3, 2) });
});

check("a block keeps its shape from the selection's top-left", () => {
  const plan = planPaste({ text: "a\tb\nc\td", selection: { top: 2, bottom: 2, left: 1, right: 1 }, rowCount: 10, navigable: pasteNavigable, targetAt: editableAt() });
  assert.deepEqual(plan.writes, [
    { rowIndex: 2, columnIndex: 1, value: "a" },
    { rowIndex: 2, columnIndex: 2, value: "b" },
    { rowIndex: 3, columnIndex: 1, value: "c" },
    { rowIndex: 3, columnIndex: 2, value: "d" },
  ]);
});

check("read-only, invalid and outside cells are skipped and counted", () => {
  const plan = planPaste({
    text: "a\tb\tbad\te\tf\ng\th\ti\tj\tk",
    selection: { top: 8, bottom: 8, left: 0, right: 0 },
    rowCount: 9,
    navigable: pasteNavigable,
    targetAt: editableAt([1]),
  });
  assert.deepEqual(plan.writes.map((write) => write.value), ["a", "e"]);
  assert.equal(plan.readOnly, 1);
  assert.equal(plan.invalid, 1);
  assert.equal(plan.outside, 6, "the fifth column and the whole second row fall outside");
  assert.deepEqual(plan.errors, ["Row 9 · Col 2: Not valid."]);
  const summary = pasteSummary(plan);
  assert.equal(summary.warn, true);
  assert.equal(summary.message, "Pasted 2 cells, 1 invalid skipped, 1 read-only skipped, 6 outside the table ignored");
});

check("paste steps over folded columns", () => {
  const plan = planPaste({ text: "a\tb", selection: { top: 0, bottom: 0, left: 0, right: 0 }, rowCount: 1, navigable: [0, 2], targetAt: editableAt() });
  assert.deepEqual(plan.writes.map((write) => write.columnIndex), [0, 2]);
  assert.equal(pasteSummary(plan).warn, false);
});

// -------------------------------------------------------------- history --

check("undo/redo replay before and after values", () => {
  const first = createEditEntry("Edit amount", [{ recordId: "r1", fieldName: "amount", before: 1, after: 2 }]);
  const second = createEditEntry("Paste", [
    { recordId: "r1", fieldName: "status", before: "open", after: "closed" },
    { recordId: "r2", fieldName: "status", before: "open", after: "closed" },
  ]);
  let history = recordEdit(recordEdit(EMPTY_EDIT_HISTORY, first), second);
  const undone = undoEdit(history);
  assert.ok(undone);
  assert.equal(undone.entry.id, second.id);
  assert.deepEqual(entryWrites(undone.entry, "before"), [
    { recordId: "r1", fieldName: "status", value: "open" },
    { recordId: "r2", fieldName: "status", value: "open" },
  ]);
  history = undone.history;
  const redone = redoEdit(history);
  assert.ok(redone);
  assert.deepEqual(entryWrites(redone.entry, "after")[0], { recordId: "r1", fieldName: "status", value: "closed" });
  history = undoEdit(redone.history)!.history;
  history = recordEdit(history, createEditEntry("Edit date", [{ recordId: "r1", fieldName: "date", before: "a", after: "b" }]));
  assert.equal(history.future.length, 0, "a new edit drops the redo branch");
  assert.equal(redoEdit(history), null);
  assert.equal(undoEdit(EMPTY_EDIT_HISTORY), null);
});

check("failed saves leave the stack; empty edits never enter it; the stack is bounded", () => {
  const entry = createEditEntry("Edit", [{ recordId: "r1", fieldName: "a", before: 1, after: 2 }]);
  const history = recordEdit(EMPTY_EDIT_HISTORY, entry);
  assert.deepEqual(dropEdit(history, entry.id), EMPTY_EDIT_HISTORY);
  assert.equal(recordEdit(history, createEditEntry("Nothing", [])), history);
  let bounded = EMPTY_EDIT_HISTORY;
  for (let index = 0; index < 5; index += 1) {
    bounded = recordEdit(bounded, createEditEntry(`Edit ${index}`, [{ recordId: "r", fieldName: "f", before: index, after: index + 1 }]), 3);
  }
  assert.deepEqual(bounded.past.map((item) => item.label), ["Edit 2", "Edit 3", "Edit 4"]);
});

check("a partly failed paste keeps undo for the cells that saved", () => {
  const entry = createEditEntry("Paste", [
    { recordId: "r1", fieldName: "a", before: 1, after: 2 },
    { recordId: "r2", fieldName: "a", before: 3, after: 4 },
    { recordId: "r3", fieldName: "a", before: 5, after: 6 },
  ]);
  const older = createEditEntry("Edit", [{ recordId: "r9", fieldName: "b", before: "x", after: "y" }]);
  const history = recordEdit(recordEdit(EMPTY_EDIT_HISTORY, older), entry);
  const narrowed = narrowEdit(history, entry.id, [true, false, true]);
  assert.equal(narrowed.past.length, 2);
  assert.equal(narrowed.past[0], older, "other entries are untouched");
  assert.equal(narrowed.past[1].id, entry.id, "the entry keeps its id, so its Undo toast still matches");
  assert.deepEqual(narrowed.past[1].changes.map((change) => change.recordId), ["r1", "r3"]);
  assert.deepEqual(narrowEdit(history, entry.id, [false, false, false]).past, [older], "nothing saved drops the entry");
});

// ---------------------------------------------------------------- batch --

check("the batch changeset stages, reverts and overlays edits", () => {
  const saved: Record<string, Record<string, unknown>> = { r1: { _id: "r1", amount: 10, status: "open" }, r2: { _id: "r2", amount: 5, status: "open" } };
  const savedValue = (recordId: string, fieldName: string) => saved[recordId]?.[fieldName];
  let staged: StagedEdits = new Map();
  staged = stageWrites(staged, [
    { recordId: "r1", fieldName: "amount", value: 12 },
    { recordId: "r2", fieldName: "status", value: "closed" },
  ], savedValue);
  assert.equal(stagedCount(staged), 2);
  assert.deepEqual(applyStagedEdits(Object.values(saved), staged), [
    { _id: "r1", amount: 12, status: "open" },
    { _id: "r2", amount: 5, status: "closed" },
  ]);
  staged = stageWrites(staged, [{ recordId: "r1", fieldName: "amount", value: 10 }], savedValue);
  assert.equal(stagedCount(staged), 1, "typing the saved value again un-stages the cell");
  assert.deepEqual(stagedList(staged), [{ recordId: "r2", fieldName: "status", value: "closed" }]);
  assert.equal(stageWrites(staged, [], savedValue), staged);
});

check("saving a batch un-stages only what it saved", () => {
  const savedValue = () => undefined;
  const sent = [
    { recordId: "r1", fieldName: "amount", value: 12 },
    { recordId: "r2", fieldName: "status", value: "closed" },
  ];
  let staged: StagedEdits = stageWrites(new Map(), sent, savedValue);
  // Edits made while the save was in flight: a new cell, and r2 again.
  staged = stageWrites(staged, [
    { recordId: "r1", fieldName: "date", value: "2026-10-01" },
    { recordId: "r2", fieldName: "status", value: "void" },
  ], savedValue);
  const after = unstageWrites(staged, sent);
  assert.deepEqual(stagedList(after), [
    { recordId: "r1", fieldName: "date", value: "2026-10-01" },
    { recordId: "r2", fieldName: "status", value: "void" },
  ]);
  assert.equal(stagedCount(unstageWrites(stageWrites(new Map(), sent, savedValue), sent)), 0, "with nothing new, the changeset empties");
  assert.equal(unstageWrites(after, []), after);
});

// ------------------------------------------------------------ shortcuts --

check("the grid shortcuts are exposed as data", () => {
  const labels = RECORD_TABLE_GRID_SHORTCUTS.items.map((item) => item.keys.join("+"));
  for (const keys of ["Mod+E", "Mod+Z", "Mod+Shift+Z", "Mod+V", "Mod+C", "Mod+X", "Mod+A", "Tab", "Enter", "Space", "Delete", "Esc", "Page Up+Page Down", "Home+End"]) {
    assert.ok(labels.includes(keys), `${keys} is listed`);
  }
});

console.log(`record table inline edit checks passed: ${checks} groups`);
