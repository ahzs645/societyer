import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  DEFAULT_FREEZE_FIRST_COLUMN_ABOVE,
  getMobileTableLayout,
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

// --- Shared RecordTable CSS keeps the Twenty mobile interaction contract ---
const recordTableStyles = readFileSync(
  new URL("../src/styles/_record-table.scss", import.meta.url),
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

console.log("mobile table layout checks passed");
