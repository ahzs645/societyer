import type { ShortcutSection } from "../../../../lib/shortcutsRegistry";

/**
 * Keys a RecordTable answers in grid mode (`inlineEdit`), as data for a page's
 * shortcuts sheet or the `?` help dialog: spread it into a section list, or
 * render `items` with <ShortcutHint>. Tokens follow shortcutsRegistry ("Mod"
 * is ⌘ on Apple platforms and Ctrl elsewhere).
 */
export const RECORD_TABLE_GRID_SHORTCUTS: ShortcutSection = {
  id: "recordTableGrid",
  label: "Editable tables",
  items: [
    { keys: ["↑", "↓", "←", "→"], label: "Move between cells" },
    { keys: ["Shift", "↑", "↓", "←", "→"], label: "Extend the selection", keywords: ["range"] },
    { keys: ["Mod", "↑", "↓", "←", "→"], label: "Jump to the edge of the table" },
    { keys: ["Mod", "Shift", "↑", "↓", "←", "→"], label: "Extend the selection to the edge", keywords: ["range"] },
    { keys: ["Page Up", "Page Down"], label: "Move up or down a page" },
    { keys: ["Home", "End"], label: "Go to the first or last column" },
    { keys: ["Tab"], label: "Move to the next cell (Shift+Tab moves back)" },
    { keys: ["Mod", "A"], label: "Select all rows" },
    { keys: ["Esc"], label: "Cancel the edit, or clear the selection" },
    { keys: ["Enter"], label: "Edit the selected cell; Enter again saves and moves down" },
    { keys: ["Space"], label: "Edit the selected cell" },
    { keys: ["Delete"], label: "Clear the selected cells", keywords: ["backspace"] },
    { keys: ["Mod", "C"], label: "Copy the selected cells", keywords: ["clipboard", "tsv"] },
    { keys: ["Mod", "X"], label: "Cut the selected cells", keywords: ["clipboard"] },
    { keys: ["Mod", "V"], label: "Paste, including a block from a spreadsheet or one value into every selected cell", keywords: ["clipboard", "tsv"] },
    { keys: ["Mod", "Z"], label: "Undo the last edit", keywords: ["history"] },
    { keys: ["Mod", "Shift", "Z"], label: "Redo", keywords: ["history"] },
    { keys: ["Mod", "E"], label: "Open the selected row in the side panel", keywords: ["preview", "drawer"] },
  ],
};
