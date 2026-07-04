import assert from "node:assert/strict";
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

console.log("mobile table layout checks passed");
