/**
 * Keyboard shortcuts shown in the `?` help dialog, grouped by where they
 * apply. Keys are written as platform-neutral tokens — "Mod" is ⌘ on Apple
 * platforms and Ctrl elsewhere, "Alt" is ⌥ / Alt, "Shift" is ⇧ / Shift — and
 * rendered per platform by `formatShortcutKey` / `<ShortcutHint>`.
 *
 * A sequence such as "G then D" is written `keys: ["G", "D"], sequence: true`.
 */
export type Shortcut = {
  /** Each entry renders as its own <kbd> chip. */
  keys: string[];
  label: string;
  /** Keys are pressed one after another, not together. */
  sequence?: boolean;
  /** Extra search terms for the help dialog's filter. */
  keywords?: string[];
};

export type ShortcutSection = {
  id: string;
  label: string;
  items: Shortcut[];
};

/** Named shortcuts other components can show as hints (tooltips, palette rows). */
export const SHORTCUTS = {
  commandPalette: { keys: ["Mod", "K"], label: "Open the command palette" },
  commandPaletteSlash: { keys: ["/"], label: "Open the command palette (no modifier)" },
  help: { keys: ["?"], label: "Show keyboard shortcuts" },
  toggleSidebar: { keys: ["Mod", "\\"], label: "Collapse the sidebar to icons / expand it" },
  hideSidebar: { keys: ["Mod", "Shift", "\\"], label: "Hide or show the sidebar (focus mode)" },
  inspector: { keys: ["Alt", "O"], label: "Toggle the inspector panel" },
  goDashboard: { keys: ["G", "D"], label: "Go to the dashboard", sequence: true },
  goTasks: { keys: ["G", "T"], label: "Go to tasks", sequence: true },
  goMeetings: { keys: ["G", "M"], label: "Go to meetings", sequence: true },
  goFinancials: { keys: ["G", "F"], label: "Go to financials", sequence: true },
} satisfies Record<string, Shortcut>;

export type ShortcutId = keyof typeof SHORTCUTS;

/** "g then …" navigation targets, keyed by the second key (lower case). */
export const GO_TO_SHORTCUTS: Record<string, { to: string; id: ShortcutId }> = {
  d: { to: "/app", id: "goDashboard" },
  t: { to: "/app/tasks", id: "goTasks" },
  m: { to: "/app/meetings", id: "goMeetings" },
  f: { to: "/app/financials", id: "goFinancials" },
};

/** Route → its "g then …" shortcut, for hints in the palette and sidebar. */
export const ROUTE_SHORTCUTS: Record<string, Shortcut> = Object.fromEntries(
  Object.values(GO_TO_SHORTCUTS).map(({ to, id }) => [to, SHORTCUTS[id]]),
);

export const SHORTCUT_SECTIONS: ShortcutSection[] = [
  {
    id: "general",
    label: "General",
    items: [
      SHORTCUTS.commandPalette,
      SHORTCUTS.commandPaletteSlash,
      SHORTCUTS.help,
      SHORTCUTS.toggleSidebar,
      SHORTCUTS.hideSidebar,
      SHORTCUTS.inspector,
    ],
  },
  {
    id: "navigation",
    label: "Navigation",
    items: [
      SHORTCUTS.goDashboard,
      SHORTCUTS.goTasks,
      SHORTCUTS.goMeetings,
      SHORTCUTS.goFinancials,
    ],
  },
  {
    id: "sidebar",
    label: "Sidebar & favorites",
    items: [
      { keys: ["↑", "↓"], label: "Move between sidebar items" },
      { keys: ["→"], label: "Expand a section, or step into it" },
      { keys: ["←"], label: "Collapse a section, or step back to it" },
      { keys: ["Home", "End"], label: "Jump to the first or last sidebar item" },
      { keys: ["Enter"], label: "Open the focused page" },
      { keys: ["Menu"], label: "Open the right-click menu on the focused item", keywords: ["pin", "favorite"] },
      { keys: ["Shift", "F10"], label: "Open the right-click menu on the focused item", keywords: ["pin", "favorite"] },
      { keys: ["Esc"], label: "Dismiss an open sidebar menu or flyout" },
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
    id: "tables",
    label: "Tables",
    items: [
      { keys: ["J", "K"], label: "Move to the next or previous row", keywords: ["down", "up"] },
      { keys: ["↑", "↓"], label: "Move between rows" },
      { keys: ["←", "→"], label: "Move between columns" },
      { keys: ["Enter"], label: "Open the focused row or edit the cell" },
      { keys: ["X"], label: "Select or deselect the focused row", keywords: ["check"] },
      { keys: ["Space"], label: "Select or deselect the focused row", keywords: ["check"] },
      { keys: ["Esc"], label: "Cancel editing, clear the selection or focus" },
      { keys: ["Mod", "C"], label: "Copy the selected cells", keywords: ["clipboard"] },
    ],
  },
  {
    id: "sidePanel",
    label: "Side panel",
    items: [
      { keys: ["↑", "↓"], label: "Show the previous or next record" },
      { keys: ["Mod", "Enter"], label: "Open the record as a full page" },
      { keys: ["Esc"], label: "Close the side panel" },
    ],
  },
  {
    id: "editor",
    label: "Editor & forms",
    items: [
      { keys: ["Mod", "Enter"], label: "Send the current message (AI assistant)" },
      { keys: ["Enter"], label: "Submit a prompt dialog" },
      { keys: ["Enter"], label: "Add the typed task and start the next one" },
      { keys: ["Tab"], label: "Move focus forward inside a dialog" },
      { keys: ["Shift", "Tab"], label: "Move focus backward inside a dialog" },
      { keys: ["Esc"], label: "Close the drawer, modal or assistant" },
    ],
  },
  {
    id: "tasks",
    label: "Tasks list",
    items: [
      { keys: ["N"], label: "New task" },
      { keys: ["↑", "↓"], label: "Move between tasks" },
      { keys: ["Enter"], label: "Open the focused task" },
      { keys: ["Space"], label: "Select the focused task" },
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
];

/** True on macOS / iOS / iPadOS, where the command key is the modifier. */
export function isApplePlatform(): boolean {
  if (typeof navigator === "undefined") return false;
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } };
  const platform = nav.userAgentData?.platform || nav.platform || nav.userAgent || "";
  return /mac|iphone|ipad|ipod/i.test(platform);
}

const APPLE_KEYS: Record<string, string> = { Mod: "⌘", Alt: "⌥", Shift: "⇧", Ctrl: "⌃", Enter: "↵" };
const OTHER_KEYS: Record<string, string> = { Mod: "Ctrl", Alt: "Alt", Shift: "Shift", Ctrl: "Ctrl", Enter: "Enter" };

/** Display text for one key token on the current platform. */
export function formatShortcutKey(key: string, apple = isApplePlatform()): string {
  return (apple ? APPLE_KEYS : OTHER_KEYS)[key] ?? key;
}

/** One-line text form, e.g. "⌘K" / "Ctrl+K" / "G then D" — for title attributes. */
export function formatShortcut(shortcut: Pick<Shortcut, "keys" | "sequence">, apple = isApplePlatform()): string {
  const keys = shortcut.keys.map((key) => formatShortcutKey(key, apple));
  if (shortcut.sequence) return keys.join(" then ");
  return apple ? keys.join("") : keys.join("+");
}

/** True when keyboard focus is in a text-entry surface (shortcuts stay out of the way). */
export function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag !== "INPUT") return false;
  const type = (el as HTMLInputElement).type;
  return !["checkbox", "radio", "button", "submit", "reset", "range", "color", "file"].includes(type);
}
