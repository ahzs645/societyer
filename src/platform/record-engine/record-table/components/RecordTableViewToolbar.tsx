import type { ReactNode } from "react";
import type { Id } from "../../../../../convex/_generated/dataModel";
import { usePersistView } from "../hooks/usePersistView";
import { RecordTableToolbar } from "./RecordTableToolbar";

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
}) {
  const { saveCurrentView, saveAsNewView } = usePersistView({ societyId, objectMetadataId });

  return (
    <RecordTableToolbar
      icon={icon}
      label={label}
      views={views}
      currentViewId={currentViewId}
      onChangeView={onChangeView}
      onOpenFilter={onOpenFilter}
      onSaveView={saveCurrentView}
      onSaveAsView={saveAsNewView}
      actions={actions}
    />
  );
}
