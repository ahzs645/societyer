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
  hiddenColumns: string[];
  density: "compact" | "comfortable";
  createdAtISO: string;
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

