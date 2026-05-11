import { useEffect, useRef, useState, type ReactNode } from "react";
import {
  ArrowDownUp,
  CalendarDays,
  ChevronDown,
  Columns,
  Filter,
  Kanban,
  PanelRight,
  RotateCcw,
  Save,
  Search,
  Table2,
  X,
} from "lucide-react";
import {
  useRecordTableIsDirty,
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { RecordTableSortPopover } from "./RecordTableSortPopover";

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
  onSaveAsView,
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
  onSaveAsView?: (name: string) => void | Promise<unknown>;
  actions?: ReactNode;
}) {
  const searchTerm = useRecordTableState((s) => s.searchTerm);
  const columns = useRecordTableState((s) => s.columns);
  const density = useRecordTableState((s) => s.density);
  const filters = useRecordTableState((s) => s.filters);
  const sorts = useRecordTableState((s) => s.sorts);
  const viewType = useRecordTableState((s) => s.type);
  const kanbanFieldMetadataId = useRecordTableState((s) => s.kanbanFieldMetadataId);
  const calendarFieldMetadataId = useRecordTableState((s) => s.calendarFieldMetadataId);
  const openRecordIn = useRecordTableState((s) => s.openRecordIn);
  const handle = useRecordTableStoreHandle();
  const isDirty = useRecordTableIsDirty();
  const { objectMetadata } = useRecordTableContextOrThrow();

  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const viewOptionsRef = useRef<HTMLDivElement>(null);

  // Click-outside for dropdowns.
  useEffect(() => {
    if (!columnMenuOpen && !viewMenuOpen && !viewOptionsOpen) return;
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
      if (
        viewOptionsOpen &&
        viewOptionsRef.current &&
        !viewOptionsRef.current.contains(e.target as Node)
      ) {
        setViewOptionsOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [columnMenuOpen, viewMenuOpen, viewOptionsOpen]);

  const activeViewName =
    (views ?? []).find((v) => v._id === currentViewId)?.name ?? "All records";
  const selectableKanbanFields = columns.filter((column) => {
    const type = column.field.fieldType;
    return type === "SELECT" || type === "MULTI_SELECT" || type === "BOOLEAN" || type === "RELATION";
  });
  const selectableCalendarFields = columns.filter((column) => {
    const type = column.field.fieldType;
    return type === "DATE" || type === "DATE_TIME";
  });

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

        {onSaveAsView && (
          <button
            type="button"
            className="record-table__toolbar-button"
            onClick={async () => {
              const name = window.prompt("Name this view");
              if (!name?.trim()) return;
              await onSaveAsView(name.trim());
            }}
            title="Save the current table setup as a new personal view"
          >
            <Save size={12} />
            <span>Save as</span>
          </button>
        )}

        <div className="record-table__segmented" aria-label="View type">
          <button
            type="button"
            className={viewType === "table" ? "is-active" : ""}
            onClick={() => handle.get().setType("table")}
            title="Table view"
          >
            <Table2 size={12} />
          </button>
          <button
            type="button"
            className={viewType === "kanban" || viewType === "board" ? "is-active" : ""}
            onClick={() => {
              const firstField = kanbanFieldMetadataId ?? selectableKanbanFields[0]?.fieldMetadataId;
              handle.get().setType("kanban");
              if (firstField) handle.get().setKanbanFieldMetadataId(firstField);
            }}
            title="Kanban view"
          >
            <Kanban size={12} />
          </button>
          <button
            type="button"
            className={viewType === "calendar" ? "is-active" : ""}
            onClick={() => {
              const firstField = calendarFieldMetadataId ?? selectableCalendarFields[0]?.fieldMetadataId;
              handle.get().setType("calendar");
              if (firstField) handle.get().setCalendarFieldMetadataId(firstField);
            }}
            title="Calendar view"
          >
            <CalendarDays size={12} />
          </button>
        </div>

        <div className="record-table__view-switcher" ref={viewOptionsRef}>
          <button
            type="button"
            className="record-table__toolbar-button"
            onClick={() => setViewOptionsOpen((x) => !x)}
            title="View options"
          >
            <PanelRight size={12} />
            <span>{openRecordIn === "drawer" ? "Drawer" : "Page"}</span>
          </button>
          {viewOptionsOpen && (
            <div className="record-table__menu record-table__menu--right record-table__menu--wide">
              <div className="record-table__menu-section">
                <div className="record-table__menu-label">Open records in</div>
                <label className="record-table__menu-radio">
                  <input
                    type="radio"
                    checked={openRecordIn === "drawer"}
                    onChange={() => handle.get().setOpenRecordIn("drawer")}
                  />
                  Drawer
                </label>
                <label className="record-table__menu-radio">
                  <input
                    type="radio"
                    checked={openRecordIn === "page"}
                    onChange={() => handle.get().setOpenRecordIn("page")}
                  />
                  Page
                </label>
              </div>

              {(viewType === "kanban" || viewType === "board") && (
                <div className="record-table__menu-section">
                  <label className="record-table__menu-label" htmlFor="record-table-kanban-field">
                    Kanban field
                  </label>
                  <select
                    id="record-table-kanban-field"
                    className="record-table__menu-select"
                    value={kanbanFieldMetadataId ?? ""}
                    onChange={(event) =>
                      handle.get().setKanbanFieldMetadataId(event.target.value || undefined)
                    }
                  >
                    <option value="">Choose field...</option>
                    {selectableKanbanFields.map((column) => (
                      <option key={column.fieldMetadataId} value={column.fieldMetadataId}>
                        {column.field.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}

              {viewType === "calendar" && (
                <div className="record-table__menu-section">
                  <label className="record-table__menu-label" htmlFor="record-table-calendar-field">
                    Calendar field
                  </label>
                  <select
                    id="record-table-calendar-field"
                    className="record-table__menu-select"
                    value={calendarFieldMetadataId ?? ""}
                    onChange={(event) =>
                      handle.get().setCalendarFieldMetadataId(event.target.value || undefined)
                    }
                  >
                    <option value="">Choose date field...</option>
                    {selectableCalendarFields.map((column) => (
                      <option key={column.fieldMetadataId} value={column.fieldMetadataId}>
                        {column.field.label}
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>
          )}
        </div>

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
          className={
            "record-table__toolbar-button" +
            (sorts.length > 0 ? " record-table__toolbar-button--active" : "")
          }
          onClick={() => setSortMenuOpen((x) => !x)}
        >
          <ArrowDownUp size={12} />
          <span>Sort{sorts.length > 0 ? ` · ${sorts.length}` : ""}</span>
        </button>
        <RecordTableSortPopover open={sortMenuOpen} onClose={() => setSortMenuOpen(false)} />

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
