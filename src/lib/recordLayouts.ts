export type RecordLayoutSection = "summary" | "tabs" | "inspector";

export type RecordLayoutWidget = {
  id: string;
  label: string;
  section: RecordLayoutSection;
};

export type RecordLayoutSectionState = {
  order: string[];
  hidden: string[];
};

export type RecordLayoutState = {
  version: 1;
  sections: Partial<Record<RecordLayoutSection, RecordLayoutSectionState>>;
};

export type RecordLayoutScope = {
  storageKey?: string;
  pageId?: string;
  objectId?: string;
};

const STORAGE_PREFIX = "societyer.record-layout.v1";

export function makeRecordLayoutStorageKey(scope: RecordLayoutScope) {
  if (scope.storageKey) return `${STORAGE_PREFIX}.${cleanKeyPart(scope.storageKey)}`;
  const page = scope.pageId ? cleanKeyPart(scope.pageId) : "page";
  const object = scope.objectId ? cleanKeyPart(scope.objectId) : "object";
  return `${STORAGE_PREFIX}.${page}.${object}`;
}

export function loadRecordLayout(storageKey: string): RecordLayoutState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(storageKey);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || typeof parsed.sections !== "object") return null;
    return parsed as RecordLayoutState;
  } catch {
    return null;
  }
}

export function saveRecordLayout(storageKey: string, layout: RecordLayoutState) {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(storageKey, JSON.stringify(layout));
}

export function clearRecordLayout(storageKey: string) {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(storageKey);
}

export function sectionState(layout: RecordLayoutState | null, section: RecordLayoutSection): RecordLayoutSectionState {
  return layout?.sections[section] ?? { order: [], hidden: [] };
}

export function orderWidgets<T extends { id: string }>(
  widgets: T[],
  layout: RecordLayoutState | null,
  section: RecordLayoutSection,
) {
  const state = sectionState(layout, section);
  const byId = new Map(widgets.map((widget) => [widget.id, widget]));
  const ordered = state.order
    .map((id) => byId.get(id))
    .filter((widget): widget is T => Boolean(widget));
  const orderedIds = new Set(ordered.map((widget) => widget.id));
  const newWidgets = widgets.filter((widget) => !orderedIds.has(widget.id));
  return [...ordered, ...newWidgets];
}

export function visibleWidgets<T extends { id: string }>(
  widgets: T[],
  layout: RecordLayoutState | null,
  section: RecordLayoutSection,
) {
  const hidden = new Set(sectionState(layout, section).hidden);
  return orderWidgets(widgets, layout, section).filter((widget) => !hidden.has(widget.id));
}

export function updateSection(
  layout: RecordLayoutState | null,
  section: RecordLayoutSection,
  updater: (state: RecordLayoutSectionState) => RecordLayoutSectionState,
): RecordLayoutState {
  const current = sectionState(layout, section);
  return {
    version: 1,
    sections: {
      ...(layout?.sections ?? {}),
      [section]: normalizeSectionState(updater(current)),
    },
  };
}

function normalizeSectionState(state: RecordLayoutSectionState): RecordLayoutSectionState {
  return {
    order: Array.from(new Set(state.order)),
    hidden: Array.from(new Set(state.hidden)),
  };
}

function cleanKeyPart(value: string) {
  return value.trim().replace(/[^a-zA-Z0-9:_/-]+/g, "-").slice(0, 160) || "default";
}
