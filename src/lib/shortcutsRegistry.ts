export type Shortcut = {
  /** Each entry renders as its own <kbd> chip. */
  keys: string[];
  label: string;
};

export type ShortcutSection = {
  id: string;
  label: string;
  items: Shortcut[];
};

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    id: "navigation",
    label: "Navigation",
    items: [
      { keys: ["⌘", "K"], label: "Open the command palette" },
      { keys: ["/"], label: "Open the command palette (no modifier)" },
      { keys: ["?"], label: "Show this keyboard help" },
      { keys: ["⌘", "\\"], label: "Toggle the sidebar" },
      { keys: ["Alt", "O"], label: "Toggle the inspector panel" },
    ],
  },
  {
    id: "commandPalette",
    label: "Command palette",
    items: [
      { keys: ["↑", "↓"], label: "Move between commands" },
      { keys: ["Enter"], label: "Run the highlighted command" },
      { keys: ["Esc"], label: "Close the palette" },
    ],
  },
  {
    id: "sidebar",
    label: "Sidebar & favorites",
    items: [
      { keys: ["Enter"], label: "Activate the focused sidebar item" },
      { keys: ["Space"], label: "Activate the focused sidebar item" },
      { keys: ["Menu"], label: "Open the right-click menu on the focused item" },
      { keys: ["Shift", "F10"], label: "Open the right-click menu on the focused item" },
      { keys: ["Esc"], label: "Dismiss an open sidebar menu" },
    ],
  },
  {
    id: "drawersDialogs",
    label: "Drawers & dialogs",
    items: [
      { keys: ["Esc"], label: "Close the drawer or modal" },
      { keys: ["Tab"], label: "Move focus forward inside the dialog" },
      { keys: ["Shift", "Tab"], label: "Move focus backward inside the dialog" },
      { keys: ["Enter"], label: "Submit a prompt dialog" },
    ],
  },
  {
    id: "tables",
    label: "Tables",
    items: [
      { keys: ["↑", "↓"], label: "Move between rows" },
      { keys: ["←", "→"], label: "Move between columns" },
      { keys: ["Enter"], label: "Open the focused row or edit the cell" },
      { keys: ["Esc"], label: "Cancel cell editing / clear focus" },
      { keys: ["⌘", "C"], label: "Copy the selected cells" },
    ],
  },
  {
    id: "menus",
    label: "Dropdowns & menus",
    items: [
      { keys: ["↑", "↓"], label: "Move the highlight" },
      { keys: ["Home"], label: "Jump to the first option" },
      { keys: ["End"], label: "Jump to the last option" },
      { keys: ["Enter"], label: "Select the highlighted option" },
      { keys: ["Esc"], label: "Close the menu" },
    ],
  },
  {
    id: "aiAssistant",
    label: "AI assistant",
    items: [
      { keys: ["⌘", "Enter"], label: "Send the current message" },
      { keys: ["Esc"], label: "Close the assistant drawer" },
    ],
  },
];
