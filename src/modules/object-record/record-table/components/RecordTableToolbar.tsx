import { useEffect, useRef, useState, type ReactNode } from "react";
import { ChevronDown, Columns, Filter, RotateCcw, Save, Search, X } from "lucide-react";
import {
  useRecordTableIsDirty,
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";

/**
 * Compact search bar + column toggle + view switcher. Sits above the table
 * and writes directly into the same zustand store.
 *
 * The view-switcher is driven by the `views` prop so the hook / parent
 * owns the fetch — this component stays stateless about which views
 * exist in the society.
 */
export function RecordTableToolbar({
  icon,
  label,
  views,
  currentViewId,
  onChangeView,
  onOpenFilter,
  onSaveView,
  actions,
}: {
  icon?: ReactNode;
  label: string;
  views?: { _id: string; name: string; isSystem: boolean }[];
  currentViewId?: string | null;
  onChangeView?: (viewId: string) => void;
  onOpenFilter?: () => void;
  /**
   * If provided, Save/Discard buttons appear whenever the table's live
   * state diverges from the last-loaded view. Typically wired to
   * `usePersistView().saveCurrentView`.
   */
  onSaveView?: () => void | Promise<void>;
  actions?: ReactNode;
}) {
  const searchTerm = useRecordTableState((s) => s.searchTerm);
  const columns = useRecordTableState((s) => s.columns);
  const density = useRecordTableState((s) => s.density);
  const filters = useRecordTableState((s) => s.filters);
  const handle = useRecordTableStoreHandle();
  const isDirty = useRecordTableIsDirty();
  const { objectMetadata } = useRecordTableContextOrThrow();

  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);

  // Click-outside for dropdowns.
  useEffect(() => {
    if (!columnMenuOpen && !viewMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      if (
        columnMenuOpen &&
        columnMenuRef.current &&
        !columnMenuRef.current.contains(e.target as Node)
      ) {
        setColumnMenuOpen(false);
      }
      if (
        viewMenuOpen &&
        viewMenuRef.current &&
        !viewMenuRef.current.contains(e.target as Node)
      ) {
        setViewMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [columnMenuOpen, viewMenuOpen]);

  const activeViewName =
    (views ?? []).find((v) => v._id === currentViewId)?.name ?? "All records";

  return (
    <div className="record-table__toolbar">
      <div className="record-table__toolbar-left">
        {views && views.length > 0 ? (
          <div className="record-table__view-switcher" ref={viewMenuRef}>
            <button
              type="button"
              className="record-table__view-button"
              onClick={() => setViewMenuOpen((x) => !x)}
            >
              {icon}
              <span>{activeViewName}</span>
              <ChevronDown size={12} />
            </button>
            {viewMenuOpen && (
              <div className="record-table__menu">
                {views.map((v) => (
                  <button
                    key={v._id}
                    type="button"
                    className={
                      "record-table__menu-item" +
                      (v._id === currentViewId ? " record-table__menu-item--active" : "")
                    }
                    onClick={() => {
                      onChangeView?.(v._id);
                      setViewMenuOpen(false);
                    }}
                  >
                    {v.name}
                    {v.isSystem && <span className="record-table__menu-badge">system</span>}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="record-table__title">
            {icon}
            <span>{label}</span>
          </div>
        )}
      </div>

      <div className="record-table__toolbar-center">
        <div className="record-table__search">
          <Search size={12} />
          <input
            className="record-table__search-input"
            placeholder={`Search ${objectMetadata.labelPlural.toLowerCase()}…`}
            value={searchTerm}
            onChange={(e) => handle.get().setSearchTerm(e.target.value)}
          />
          {searchTerm && (
            <button
              type="button"
              className="record-table__search-clear"
              aria-label="Clear search"
              onClick={() => handle.get().setSearchTerm("")}
            >
              <X size={11} />
            </button>
          )}
        </div>
      </div>

      <div className="record-table__toolbar-right">
        {onSaveView && isDirty && (
          <>
            <button
              type="button"
              className="record-table__toolbar-button record-table__toolbar-button--dirty"
              disabled={isSaving}
              onClick={async () => {
                try {
                  setIsSaving(true);
                  await onSaveView();
                } finally {
                  setIsSaving(false);
                }
              }}
              title="Save the current column layout, filters and sort into this view"
            >
              <Save size={12} />
              <span>{isSaving ? "Saving…" : "Save changes"}</span>
            </button>
            <button
              type="button"
              className="record-table__toolbar-button"
              disabled={isSaving}
              onClick={() => handle.get().discardDraftChanges()}
              title="Revert to the last saved view"
            >
              <RotateCcw size={12} />
              <span>Discard</span>
            </button>
          </>
        )}

        {onOpenFilter && (
          <button
            type="button"
            className={
              "record-table__toolbar-button" +
              (filters.length > 0 ? " record-table__toolbar-button--active" : "")
            }
            onClick={onOpenFilter}
          >
            <Filter size={12} />
            <span>Filter{filters.length > 0 ? ` · ${filters.length}` : ""}</span>
          </button>
        )}

        <button
          type="button"
          className="record-table__toolbar-button"
          onClick={() => handle.get().setDensity(density === "compact" ? "comfortable" : "compact")}
          title="Toggle row density"
        >
          <span>{density === "compact" ? "Compact" : "Comfort"}</span>
        </button>

        <div className="record-table__view-switcher" ref={columnMenuRef}>
          <button
            type="button"
            className="record-table__toolbar-button"
            onClick={() => setColumnMenuOpen((x) => !x)}
          >
            <Columns size={12} />
            <span>Columns</span>
          </button>
          {columnMenuOpen && (
            <div className="record-table__menu record-table__menu--right">
              {columns.map((col) => (
                <label key={col.viewFieldId} className="record-table__menu-checkbox">
                  <input
                    type="checkbox"
                    checked={col.isVisible}
                    onChange={() => handle.get().toggleColumnVisibility(col.viewFieldId)}
                  />
                  {col.field.label}
                </label>
              ))}
            </div>
          )}
        </div>

        {actions}
      </div>
    </div>
  );
}
