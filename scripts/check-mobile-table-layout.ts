import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FREEZE_FIRST_COLUMN_ABOVE,
  MOBILE_MAX_VISIBLE_COLUMNS,
  getMobileTableLayout,
  limitColumnsForPhone,
} from "../src/lib/mobileTableLayout";

// --- Phone: selection + drag handle are dropped, first column is frozen -----
const phone = getMobileTableLayout({
  isMobile: true,
  selectable: true,
  hasDragHandle: true,
  visibleColumnCount: 3,
});
assert.equal(phone.showSelectionColumn, false, "phone drops the selection column");
assert.equal(phone.showDragHandle, false, "phone drops the drag handle");
assert.equal(phone.freezeFirstColumn, true, "phone always freezes the first column");

// A phone with only a couple of columns still freezes the first one — the
// threshold is a desktop-only heuristic.
const phoneNarrow = getMobileTableLayout({
  isMobile: true,
  selectable: false,
  visibleColumnCount: 1,
});
assert.equal(phoneNarrow.freezeFirstColumn, true, "phone freezes even below the column threshold");

// --- Desktop: selection + drag handle honor their opt-ins --------------------
const desktopSelectable = getMobileTableLayout({
  isMobile: false,
  selectable: true,
  hasDragHandle: true,
  visibleColumnCount: 4,
});
assert.equal(desktopSelectable.showSelectionColumn, true, "desktop keeps the selection column when selectable");
assert.equal(desktopSelectable.showDragHandle, true, "desktop keeps the drag handle when supported");

const desktopNonSelectable = getMobileTableLayout({
  isMobile: false,
  selectable: false,
  hasDragHandle: false,
  visibleColumnCount: 4,
});
assert.equal(desktopNonSelectable.showSelectionColumn, false, "desktop hides selection when not selectable");
assert.equal(desktopNonSelectable.showDragHandle, false, "desktop hides drag handle when unsupported");

// --- Desktop freeze heuristic: freeze only once the table is wide -----------
const desktopNarrow = getMobileTableLayout({
  isMobile: false,
  selectable: false,
  visibleColumnCount: DEFAULT_FREEZE_FIRST_COLUMN_ABOVE - 1,
});
assert.equal(desktopNarrow.freezeFirstColumn, false, "narrow desktop table does not freeze the first column");

const desktopWide = getMobileTableLayout({
  isMobile: false,
  selectable: false,
  visibleColumnCount: DEFAULT_FREEZE_FIRST_COLUMN_ABOVE,
});
assert.equal(desktopWide.freezeFirstColumn, true, "wide desktop table freezes the first column at the threshold");

// A caller can override the desktop threshold.
const customThreshold = getMobileTableLayout({
  isMobile: false,
  selectable: false,
  visibleColumnCount: 3,
  freezeFirstColumnAbove: 3,
});
assert.equal(customThreshold.freezeFirstColumn, true, "custom freeze threshold is respected");

// --- Defaults: drag handle is off unless a table opts in ---------------------
const defaultDragHandle = getMobileTableLayout({ isMobile: false, selectable: true });
assert.equal(defaultDragHandle.showDragHandle, false, "drag handle defaults to off when unspecified");

// --- Phone column cap: name + a couple, never a sideways pan through all ---
const manyColumns = ["name", "status", "date", "email", "phone", "notes"];
assert.deepEqual(
  limitColumnsForPhone(manyColumns, true),
  manyColumns.slice(0, MOBILE_MAX_VISIBLE_COLUMNS),
  "phone renders only the first few visible columns",
);
assert.equal(
  limitColumnsForPhone(manyColumns, false),
  manyColumns,
  "desktop renders the full set (same reference, no copy)",
);
assert.deepEqual(
  limitColumnsForPhone(["status", "date", "name", "email"], true, (column) => column === "name"),
  ["name", "status", "date"],
  "phone keeps the identifier column first plus the leading others",
);
const fewColumns = ["name", "status"];
assert.equal(
  limitColumnsForPhone(fewColumns, true),
  fewColumns,
  "a table already within the cap is untouched on phones",
);

// --- Shared RecordTable CSS keeps the Twenty mobile interaction contract ---
const recordTableStyles = readFileSync(
  new URL("../src/styles/_record-table.scss", import.meta.url),
  "utf8",
);
const recordTableCellSource = readFileSync(
  new URL(
    "../src/platform/record-engine/record-table/components/RecordTableCell.tsx",
    import.meta.url,
  ),
  "utf8",
);

assert.match(
  recordTableStyles,
  /@media \(max-width: 760px\)/,
  "record table has an explicit phone breakpoint",
);
assert.match(
  recordTableStyles,
  /position: sticky;[\s\S]*width: 46vw !important;/,
  "phone identifier column remains sticky and viewport-capped",
);
assert.doesNotMatch(
  recordTableStyles,
  /\.record-table__scroll-frame\.is-scrolled-right::after|linear-gradient\(to left, rgba\(0, 0, 0, 0\.14\)/,
  "record table keeps Researcher-style clean clipping without an edge gradient",
);
assert.match(
  recordTableStyles,
  /@media \(hover: none\), \(pointer: coarse\)[\s\S]*\.record-table__row-actions[\s\S]*opacity: 1;/,
  "touch devices do not hide row actions behind hover",
);
assert.match(
  recordTableStyles,
  /\.record-table__identifier-button[\s\S]*max-width: 100%;/,
  "identifier control cannot widen the frozen phone column",
);
assert.match(
  recordTableCellSource,
  /const tapOpensRecord = isMobile && !!tableCtx\.onRecordClick;[\s\S]*const canInlineEdit = canEdit && !tapOpensRecord;/,
  "phone taps open the record (no inline editor) whenever the table can open one",
);
assert.match(
  recordTableCellSource,
  /isMobile && canInlineEdit && !isLabelIdentifier[\s\S]*startEdit\(\)/,
  "phone tables without a record to open still edit a field from one tap",
);
assert.match(
  recordTableCellSource,
  /target\.closest\("\.record-table__cell-editor-popover, \.menu, \.calendar"\)/,
  "phone editor portal interactions cannot bubble back into a cell and reopen it",
);

// --- Phones: long lists, pages, batch loading and the value picker ---------
const cardListSource = readFileSync(
  new URL("../src/platform/record-engine/record-table/components/RecordTableCardList.tsx", import.meta.url),
  "utf8",
);
const recordTableSource = readFileSync(
  new URL("../src/platform/record-engine/record-table/components/RecordTable.tsx", import.meta.url),
  "utf8",
);
const toolbarSource = readFileSync(
  new URL("../src/platform/record-engine/record-table/components/RecordTableToolbar.tsx", import.meta.url),
  "utf8",
);
assert.match(
  cardListSource,
  /customScrollParent: scrollParent[\s\S]*useWindowScroll/,
  "phone cards window against the page's own scroller (.page), so 25,000 cards mount a screenful",
);
assert.match(
  recordTableSource,
  /<RecordTableCardList[\s\S]*?\/>\s*\{pager\}/,
  "phone cards shown in pages get the pager under them",
);
assert.match(
  recordTableStyles,
  /@media \(max-width: 560px\) \{\s*\/\/ Phones: the range on its own line[\s\S]*min-height: 40px;/,
  "the phone pager puts the range on its own line with touch-sized buttons",
);
assert.match(
  toolbarSource,
  /\{isPhone && loadingStatusElement\}/,
  "phones show batch loading progress on its own line under the toolbar row",
);
assert.match(
  recordTableStyles,
  /\.record-table__value-option \{[\s\S]*@media \(pointer: coarse\) \{ min-height: 40px; \}/,
  "filter values are touch-sized on phones",
);

// --- Phones: a collapsible search is an icon in the toolbar row ---------------
assert.match(
  toolbarSource,
  /\{collapsibleSearch && \(isPhone \|\| !showSearch\) && \([\s\S]*?record-table__toolbar-button--search/,
  "a collapsible search keeps its button in the phone row (beside the open field) and swaps it for the field on wider screens",
);
assert.match(
  toolbarSource,
  /flushSync\(\(\) => setSearchOpen\(true\)\);\s*searchInputRef\.current\?\.focus\(\);/,
  "the field opens and takes focus in the same tap, so a phone raises its keyboard",
);
assert.match(
  toolbarSource,
  /const showSearch = \(!isMobile && !collapsibleSearch\) \|\| searchOpen \|\| searching;/,
  "an active search keeps the field open, so a searched list always shows its search",
);
assert.match(
  toolbarSource,
  /autoCapitalize="none"[\s\S]*autoCorrect="off"[\s\S]*spellCheck=\{false\}[\s\S]*enterKeyHint="search"/,
  "phone keyboards don't capitalise or autocorrect names and reference numbers",
);
assert.match(
  recordTableStyles,
  /@media \(max-width: 560px\) \{\s*\.record-table__toolbar \.record-table__view-button > \.record-table__view-edited \{/,
  "an edited view shows as a dot in the phone's view pill",
);
const procurementStyles = readFileSync(new URL("../src/styles/_procurement-review.scss", import.meta.url), "utf8");
assert.match(
  procurementStyles,
  /@media \(max-width: 560px\) \{\s*\.procurement-reader__layer > \.tabs \.tab \{[\s\S]*?> \.tab__count \{ display: none; \}/,
  "the procurement reader's tabs fit a phone without their counts",
);

console.log("mobile table layout checks passed");
