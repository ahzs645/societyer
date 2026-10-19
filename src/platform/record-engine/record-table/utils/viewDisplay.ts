import type { ViewDisplay, ViewDisplayMode, ViewGroup } from "../../types/View";

const DISPLAY_ENTRY_ID = "display";

/** Page sizes offered in the view options. */
export const RECORD_TABLE_PAGE_SIZES = [25, 50, 100] as const;
export const DEFAULT_RECORD_TABLE_PAGE_SIZE = 50;

/** How a table shows its rows once the view's choice and the table's default are combined. */
export type RecordTableDisplay = { mode: ViewDisplayMode; pageSize: number };

export const DEFAULT_RECORD_TABLE_DISPLAY: RecordTableDisplay = {
  mode: "continuous",
  pageSize: DEFAULT_RECORD_TABLE_PAGE_SIZE,
};

/** The view's own display choice, if it made one. */
export function getViewDisplay(viewGroups: ViewGroup[] | undefined): ViewDisplay | null {
  const entry = viewGroups?.find((group) => group.display?.mode);
  return entry?.display ?? null;
}

/** Replace (or clear, with null) the display entry while keeping the group-by and per-value entries. */
export function withViewDisplay(viewGroups: ViewGroup[] | undefined, display: ViewDisplay | null): ViewGroup[] {
  const rest = (viewGroups ?? []).filter((group) => !group.display);
  if (!display) return rest;
  return [...rest, { id: DISPLAY_ENTRY_ID, fieldValue: "", position: -2, isVisible: true, display }];
}

export function normalizePageSize(size: unknown, fallback = DEFAULT_RECORD_TABLE_PAGE_SIZE): number {
  const number = Math.round(Number(size));
  return Number.isFinite(number) && number >= 5 && number <= 1000 ? number : fallback;
}

export function resolveRecordTableDisplay(
  viewGroups: ViewGroup[] | undefined,
  defaults: RecordTableDisplay = DEFAULT_RECORD_TABLE_DISPLAY,
): RecordTableDisplay {
  const own = getViewDisplay(viewGroups);
  const mode = own?.mode === "pages" || own?.mode === "continuous" ? own.mode : defaults.mode;
  return { mode, pageSize: normalizePageSize(own?.pageSize, defaults.pageSize) };
}

/**
 * The view groups after choosing a display. A choice that matches the
 * table's default leaves no entry, so switching back is not an unsaved change.
 */
export function chooseRecordTableDisplay(
  viewGroups: ViewGroup[] | undefined,
  next: RecordTableDisplay,
  defaults: RecordTableDisplay = DEFAULT_RECORD_TABLE_DISPLAY,
): ViewGroup[] {
  const sameAsDefault = next.mode === defaults.mode && (next.mode === "continuous" || next.pageSize === defaults.pageSize);
  if (sameAsDefault) return withViewDisplay(viewGroups, null);
  return withViewDisplay(viewGroups, next.mode === "pages" ? { mode: "pages", pageSize: next.pageSize } : { mode: "continuous" });
}

/** Where one page sits in the whole list. `start`/`end` index the reachable rows (end exclusive). */
export type RecordTablePage = {
  /** 0-based. */
  index: number;
  count: number;
  size: number;
  start: number;
  end: number;
  total: number;
};

export function pageCount(total: number, pageSize: number) {
  return Math.max(1, Math.ceil(total / Math.max(1, pageSize)));
}

/** A page index kept inside the list (a filter that shrinks the list lands on its last page). */
export function clampPageIndex(index: number, total: number, pageSize: number) {
  return Math.min(Math.max(0, Math.floor(index)), pageCount(total, pageSize) - 1);
}

export function describePage(index: number, total: number, pageSize: number): RecordTablePage {
  const clamped = clampPageIndex(index, total, pageSize);
  const start = clamped * pageSize;
  return {
    index: clamped,
    count: pageCount(total, pageSize),
    size: pageSize,
    start: Math.min(start, total),
    end: Math.min(start + pageSize, total),
    total,
  };
}

type PageableItem =
  | { kind: "group"; collapsed: boolean }
  | { kind: "record"; rowIndex: number };

/**
 * The body items for one page. Records are paged by their row index (folded
 * groups hold none). A group's header comes along with its first record on
 * the page (again on each page the group continues onto), and a folded
 * group's header shows on the page whose rows surround it.
 */
export function pageItems<Item extends PageableItem>(items: Item[], page: RecordTablePage): Item[] {
  const out: Item[] = [];
  // Headers since the last record ahead of the page, and the open group's header.
  let leading: Item[] = [];
  let openHeader: Item | null = null;
  // Headers after a row of the page, kept until a later row of the page shows they belong.
  let trailing: Item[] = [];
  let started = false;
  for (const item of items) {
    if (item.kind === "group") {
      if (!item.collapsed) openHeader = item;
      if (started) trailing.push(item);
      else leading.push(item);
      continue;
    }
    if (item.rowIndex < page.start) {
      leading = [];
      continue;
    }
    if (item.rowIndex >= page.end) return out;
    if (!started) {
      started = true;
      if (openHeader && !leading.includes(openHeader)) out.push(openHeader);
      out.push(...leading);
    }
    out.push(...trailing, item);
    trailing = [];
  }
  // Folded groups after the last row belong to the last page.
  if (page.end >= page.total) out.push(...(started ? trailing : leading));
  return out;
}
