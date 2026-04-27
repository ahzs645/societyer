/**
 * Small localStorage-backed store for named table views. A "view" captures the
 * filter chips, sort, hidden columns, and density so users can return to a
 * curated slice of a list (e.g., "Open tasks — this quarter") with one click.
 */

import type { AppliedFilter } from "../components/FilterBar";
import type { SortState } from "../components/DataTable";

export type SavedView = {
  id: string;
  name: string;
  filters: AppliedFilter[];
  sort: SortState;
  searchTerm?: string;
  hiddenColumns: string[];
  /** Optional per-column widths in pixels, keyed by column id. */
  columnWidths?: Record<string, number>;
  /** Optional column id ordering. Missing ids render in their original order. */
  columnOrder?: string[];
  density: "compact" | "comfortable";
  isShared?: boolean;
  isSystem?: boolean;
  createdAtISO: string;
};

export type SharedSavedViewsContext = {
  societyId: string;
  objectMetadataId?: string;
  nameSingular?: string;
  createdByUserId?: string;
};

const NAMESPACE = "societyer.views";

function storageKey(viewsKey: string) {
  return `${NAMESPACE}.${viewsKey}`;
}

export function readSavedViews(viewsKey: string): SavedView[] {
  try {
    const raw = localStorage.getItem(storageKey(viewsKey));
    const parsed = raw ? JSON.parse(raw) : null;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is SavedView => typeof v?.id === "string" && typeof v?.name === "string");
  } catch {
    return [];
  }
}

export function writeSavedViews(viewsKey: string, views: SavedView[]): void {
  try {
    localStorage.setItem(storageKey(viewsKey), JSON.stringify(views));
  } catch {
    /* ignore quota */
  }
}

export function makeViewId() {
  return `v_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`;
}

function parseJsonObject(raw: unknown): Record<string, unknown> {
  if (typeof raw !== "string" || !raw.trim()) return {};
  try {
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function parseJsonArray<T>(raw: unknown): T[] {
  if (typeof raw !== "string" || !raw.trim()) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed as T[] : [];
  } catch {
    return [];
  }
}

export function savedViewFromWorkspaceView(row: any): SavedView {
  const columnState = parseJsonObject(row?.columnStateJson);
  return {
    id: String(row._id),
    name: String(row.name ?? "Untitled view"),
    filters: parseJsonArray<AppliedFilter>(row.filtersJson),
    sort: parseJsonArray<NonNullable<SortState>>(row.sortsJson)[0] ?? null,
    searchTerm: row.searchTerm,
    hiddenColumns: Array.isArray(columnState.hiddenColumns)
      ? columnState.hiddenColumns.filter((id): id is string => typeof id === "string")
      : [],
    columnWidths:
      columnState.columnWidths && typeof columnState.columnWidths === "object" && !Array.isArray(columnState.columnWidths)
        ? Object.fromEntries(
            Object.entries(columnState.columnWidths).filter((entry): entry is [string, number] =>
              typeof entry[0] === "string" && typeof entry[1] === "number",
            ),
          )
        : undefined,
    columnOrder: Array.isArray(columnState.columnOrder)
      ? columnState.columnOrder.filter((id): id is string => typeof id === "string")
      : undefined,
    density: row.density === "comfortable" ? "comfortable" : "compact",
    isShared: row.isShared !== false,
    isSystem: row.isSystem === true,
    createdAtISO: String(row.createdAtISO ?? new Date().toISOString()),
  };
}

export function savedViewToWorkspacePayload(view: SavedView) {
  const payload: {
    name: string;
    filtersJson: string;
    sortsJson: string;
    searchTerm?: string;
    density: SavedView["density"];
    columnStateJson: string;
  } = {
    name: view.name,
    filtersJson: JSON.stringify(view.filters ?? []),
    sortsJson: JSON.stringify(view.sort ? [view.sort] : []),
    density: view.density,
    columnStateJson: JSON.stringify({
      hiddenColumns: view.hiddenColumns ?? [],
      columnWidths: view.columnWidths ?? {},
      columnOrder: view.columnOrder ?? [],
    }),
  };
  if (view.searchTerm) payload.searchTerm = view.searchTerm;
  return payload;
}
