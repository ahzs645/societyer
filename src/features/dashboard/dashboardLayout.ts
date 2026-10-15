import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Which dashboard modules a user shows, where, and in what order —
 * remembered per user and per workspace in localStorage (guarded: blocked
 * storage just means the default layout every visit). There is no
 * server-side preferences store for UI layout yet.
 *
 * Layout model: full-width modules sit at the top; the rest live in a main
 * (wide) or side (narrow) column. Each column is an independent stack, so
 * hiding a module never reshuffles the other column.
 */

export type DashboardModuleId =
  | "setup"
  | "stats"
  | "compliance"
  | "continuity"
  | "agreements"
  | "filings"
  | "goals"
  | "meetings"
  | "organization"
  | "board"
  | "activity"
  | "finance"
  | "tasks";

export type DashboardColumn = "main" | "side";
export type DashboardPlacement = "full" | DashboardColumn;

export type DashboardModuleDefinition = {
  id: DashboardModuleId;
  label: string;
  description: string;
  placement: DashboardPlacement;
};

/** Default order and placement: the classic dashboard. */
export const DASHBOARD_MODULES: DashboardModuleDefinition[] = [
  { id: "setup", label: "Setup guide", description: "How far setup has come and the next step.", placement: "full" },
  { id: "stats", label: "Key numbers", description: "People, meetings and overdue filings at a glance.", placement: "full" },
  { id: "compliance", label: "Compliance posture", description: "Automated checks and what resolves them.", placement: "main" },
  { id: "continuity", label: "Record continuity", description: "Gaps in the meeting and filing record.", placement: "main" },
  { id: "agreements", label: "Agreements expiring", description: "Agreements nearing their end or renewal.", placement: "main" },
  { id: "filings", label: "Filings and deadlines", description: "Overdue and upcoming filings.", placement: "main" },
  { id: "goals", label: "Goals", description: "Progress on current goals.", placement: "main" },
  { id: "meetings", label: "Upcoming meetings", description: "The next scheduled meetings.", placement: "side" },
  { id: "finance", label: "Finance snapshot", description: "Cash and budget at a glance.", placement: "side" },
  { id: "organization", label: "Organization profile", description: "Legal name, number and fiscal year.", placement: "side" },
  { id: "board", label: "Board of directors", description: "Current directors.", placement: "side" },
  { id: "activity", label: "Activity", description: "Recent changes in the workspace.", placement: "side" },
  { id: "tasks", label: "Open tasks", description: "Work items still open.", placement: "side" },
];

export const DEFAULT_MODULE_ORDER = DASHBOARD_MODULES.map((module) => module.id);
const DEFINITIONS = new Map(DASHBOARD_MODULES.map((module) => [module.id, module]));
const KNOWN = new Set<string>(DEFAULT_MODULE_ORDER);

export type DashboardLayout = {
  order: DashboardModuleId[];
  hidden: DashboardModuleId[];
  /** Column overrides for half-width modules the user moved. */
  columns: Partial<Record<DashboardModuleId, DashboardColumn>>;
};

export function modulePlacement(layout: DashboardLayout, id: DashboardModuleId): DashboardPlacement {
  const placement = DEFINITIONS.get(id)?.placement ?? "main";
  if (placement === "full") return "full";
  return layout.columns[id] ?? placement;
}

const STORAGE_PREFIX = "societyer.dashboard.layout";

function storageKey(userId: string | null | undefined, societyId: string | null | undefined) {
  return `${STORAGE_PREFIX}:${userId ?? "anonymous"}:${societyId ?? "none"}`;
}

const isModuleId = (id: unknown): id is DashboardModuleId => typeof id === "string" && KNOWN.has(id);

/** Keeps only known modules and slots any new module in at its default position. */
export function normalizeLayout(value: unknown): DashboardLayout {
  const raw = (value && typeof value === "object" ? value : {}) as { order?: unknown; hidden?: unknown; columns?: unknown };
  const order = Array.from(new Set(Array.isArray(raw.order) ? raw.order.filter(isModuleId) : []));
  DEFAULT_MODULE_ORDER.forEach((id, defaultIndex) => {
    if (order.includes(id)) return;
    // Insert after the nearest earlier default neighbour that is present.
    const before = DEFAULT_MODULE_ORDER.slice(0, defaultIndex).reverse().find((candidate) => order.includes(candidate));
    order.splice(before ? order.indexOf(before) + 1 : 0, 0, id);
  });
  const hidden = Array.from(new Set(Array.isArray(raw.hidden) ? raw.hidden.filter(isModuleId) : []));
  const columns: DashboardLayout["columns"] = {};
  if (raw.columns && typeof raw.columns === "object") {
    for (const [id, column] of Object.entries(raw.columns as Record<string, unknown>)) {
      if (!isModuleId(id) || DEFINITIONS.get(id)?.placement === "full") continue;
      if (column === "main" || column === "side") columns[id] = column;
    }
  }
  return { order, hidden, columns };
}

function readLayout(key: string): DashboardLayout {
  try {
    const raw = window.localStorage.getItem(key);
    return normalizeLayout(raw ? JSON.parse(raw) : null);
  } catch {
    return normalizeLayout(null);
  }
}

function writeLayout(key: string, layout: DashboardLayout | null) {
  try {
    if (layout) window.localStorage.setItem(key, JSON.stringify(layout));
    else window.localStorage.removeItem(key);
  } catch {
    // Storage unavailable: the change still applies for this visit.
  }
}

export function useDashboardLayout(userId: string | null | undefined, societyId: string | null | undefined) {
  const key = storageKey(userId, societyId);
  const [layout, setLayoutState] = useState<DashboardLayout>(() => readLayout(key));

  // Switching user or workspace loads that pair's layout.
  useEffect(() => {
    setLayoutState(readLayout(key));
  }, [key]);

  const setLayout = useCallback(
    (update: (current: DashboardLayout) => DashboardLayout) => {
      setLayoutState((current) => {
        const next = normalizeLayout(update(current));
        writeLayout(key, next);
        return next;
      });
    },
    [key],
  );

  const setHidden = useCallback(
    (id: DashboardModuleId, hidden: boolean) =>
      setLayout((current) => ({
        ...current,
        hidden: hidden ? [...current.hidden.filter((entry) => entry !== id), id] : current.hidden.filter((entry) => entry !== id),
      })),
    [setLayout],
  );

  const reset = useCallback(() => {
    writeLayout(key, null);
    setLayoutState(normalizeLayout(null));
  }, [key]);

  const replace = useCallback((next: DashboardLayout) => setLayout(() => next), [setLayout]);

  const hiddenSet = useMemo(() => new Set(layout.hidden), [layout.hidden]);
  const isDefault =
    layout.hidden.length === 0 &&
    Object.keys(layout.columns).every((id) => layout.columns[id as DashboardModuleId] === DEFINITIONS.get(id as DashboardModuleId)?.placement) &&
    layout.order.every((id, index) => id === DEFAULT_MODULE_ORDER[index]);

  return { layout, hiddenSet, isDefault, setHidden, reset, replace };
}
