// Single source of truth for how a data table restructures itself on a phone.
// Both DataTable (src/components) and RecordTable (src/modules) render the
// same Twenty-style narrow-screen treatment: drop the leading structural
// columns (selection checkbox, drag handle) so the primary/name column sits
// flush left, then freeze that first column while the rest scroll sideways.
// Keeping the decision here — instead of inline booleans duplicated across the
// two components — means the behavior can drift only in one place, and can be
// unit-tested without a browser.

export type MobileTableLayoutInput = {
  // True when the viewport is narrow enough for the phone treatment. Callers
  // pass the value from `useIsMobile()`.
  isMobile: boolean;
  // Whether the table would show a selection column at all on a wide screen.
  selectable: boolean;
  // Whether the table supports a leading drag handle at all. DataTable has
  // none; RecordTable does. Ignored on phones (the handle is always dropped).
  hasDragHandle?: boolean;
  // Visible data-column count, used only for the wide-desktop freeze heuristic.
  visibleColumnCount?: number;
  // On a wide screen, freeze the first column once the table has at least this
  // many columns (so a wide table stays readable while scrolling). On a phone
  // the first column is always frozen regardless of this threshold.
  freezeFirstColumnAbove?: number;
};

export type MobileTableLayout = {
  // Render the leading selection checkbox column.
  showSelectionColumn: boolean;
  // Render the leading drag-handle column.
  showDragHandle: boolean;
  // Pin the first column and let the remaining columns scroll horizontally.
  freezeFirstColumn: boolean;
};

export const DEFAULT_FREEZE_FIRST_COLUMN_ABOVE = 6;

export function getMobileTableLayout({
  isMobile,
  selectable,
  hasDragHandle = false,
  visibleColumnCount = 0,
  freezeFirstColumnAbove = DEFAULT_FREEZE_FIRST_COLUMN_ABOVE,
}: MobileTableLayoutInput): MobileTableLayout {
  return {
    // Leading structural columns are dropped on phones so the name column is
    // flush left and can be the frozen one.
    showSelectionColumn: selectable && !isMobile,
    showDragHandle: hasDragHandle && !isMobile,
    // Always freeze on a phone; on desktop only once the table is wide.
    freezeFirstColumn: isMobile || visibleColumnCount >= freezeFirstColumnAbove,
  };
}
