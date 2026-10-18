import { useEffect, useRef, type ReactNode } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { usePersistView } from "../hooks/usePersistView";
import { RecordTableToolbar, type TableListViewOption } from "./RecordTableToolbar";

/**
 * Toolbar wrapper that wires up `usePersistView` so Save / Discard
 * buttons appear automatically once the view is dirty. Must live inside
 * a `<RecordTableScope>`.
 *
 * Use this variant for objects that own server-backed views (members,
 * directors, filings). For log-ish pages with no per-user view config,
 * render the plain `<RecordTableToolbar>` directly and skip this.
 */
export function RecordTableViewToolbar({
  societyId,
  objectMetadataId,
  icon,
  label,
  views,
  currentViewId,
  onChangeView,
  onOpenFilter,
  actions,
  listView,
  onViewPicked,
  hideViewPickerOnPhone,
}: {
  societyId: Id<"societies">;
  objectMetadataId: Id<"objectMetadata">;
  icon?: ReactNode;
  label: string;
  views?: { _id: string; name: string; isSystem: boolean }[];
  currentViewId?: string | null;
  onChangeView?: (viewId: string) => void;
  onOpenFilter?: () => void;
  actions?: ReactNode;
  /** See RecordTableToolbar: a page-owned grouped list ahead of the view types. */
  listView?: TableListViewOption;
  /** Called when the user picks or saves a view (not when one is restored on load). */
  onViewPicked?: (viewId: string) => void;
  /** See RecordTableToolbar: the page offers the saved views itself on phones. */
  hideViewPickerOnPhone?: boolean;
}) {
  const { saveCurrentView, saveAsNewView } = usePersistView({ societyId, objectMetadataId });
  const storageKey = `societyer:record-view:${societyId}:${objectMetadataId}`;
  // Pages keep the selected view in component state; remember it per browser
  // so a reload (or coming back later) reopens the view the user picked or saved.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !views?.length || !onChangeView) return;
    restoredRef.current = true;
    const remembered = readRememberedView(storageKey);
    if (remembered && remembered !== currentViewId && views.some((view) => String(view._id) === remembered)) {
      onChangeView(remembered);
    }
  }, [currentViewId, onChangeView, storageKey, views]);
  const changeView = onChangeView
    ? (viewId: string) => {
        rememberView(storageKey, viewId);
        onChangeView(viewId);
        onViewPicked?.(viewId);
      }
    : undefined;

  return (
    <RecordTableToolbar
      icon={icon}
      label={label}
      views={views}
      currentViewId={currentViewId}
      onChangeView={changeView}
      onOpenFilter={onOpenFilter}
      onSaveView={saveCurrentView}
      onSaveAsView={async (name) => {
        const viewId = await saveAsNewView(name);
        changeView?.(String(viewId));
        return viewId;
      }}
      actions={actions}
      listView={listView}
      hideViewPickerOnPhone={hideViewPickerOnPhone}
    />
  );
}

function readRememberedView(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

function rememberView(key: string, viewId: string) {
  try {
    window.localStorage.setItem(key, viewId);
  } catch {
    // Private mode or blocked storage: the choice simply is not remembered.
  }
}
