import { ViewportPopover } from "@/components/ViewportPopover";
import { lowerLabel } from "../utils/lowerLabel";
import { createElement, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { useLocation } from "react-router-dom";
import {
  ArrowDownUp,
  CalendarDays,
  ChevronDown,
  Columns,
  Download,
  Filter,
  Kanban,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Table2,
  X,
  ListChecks,
  List,
  Rows3,
} from "lucide-react";
import {
  useRecordTableIsDirty,
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { resolveRouteIdentity } from "../../../../lib/routeIdentity";
import { useToast } from "../../../../components/Toast";
import { usePrompt } from "../../../../components/Modal";
import { useTranslation } from "react-i18next";
import { RecordTableSortPopover } from "./RecordTableSortPopover";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { usePermissions } from "../../../../hooks/usePermissions";
import { isOutsidePointerEvent } from "../../../../lib/floatingLayer";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { useRegisterCommand } from "../../../../lib/commands";
import { RecordTableGroupByPopover } from "./RecordTableGroupByPopover";
import { RecordTableExportDialog } from "./RecordTableExportDialog";
import { getViewGroupBy } from "../utils/groupRecords";
import { RecordTableAskFilterButton } from "./RecordTableAskFilterButton";

/**
 * Compact search bar + column toggle + view switcher. Sits above the table
 * and writes directly into the same zustand store.
 *
 * The view-switcher is driven by the `views` prop so the hook / parent
 * owns the fetch — this component stays stateless about which views
 * exist in the society.
 */
/**
 * Switching view type (table/kanban/calendar) swaps in a differently-sized
 * DOM subtree without changing the page's scroll offset, so a user scrolled
 * partway down one view lands mid-page in the next one - e.g. the tail of a
 * kanban board rendered above the new table's header. Reset to the top so
 * each view always opens from a known position.
 */
function resetScrollForViewSwitch() {
  window.scrollTo({ top: 0, behavior: "auto" });
}

export type TableListViewOption = { active: boolean; onSelect: () => void; onLeave: () => void };

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
  listView,
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
  // Also gated on the view being dirty — on a pristine view there is nothing
  // new to fork off, so "Save as" stays hidden until the user changes
  // something (filters, sort, columns, density).
  onSaveAsView?: (name: string) => void | Promise<unknown>;
  actions?: ReactNode;
  /**
   * Adds a "List view" button ahead of the table/kanban/calendar switch for
   * pages that render their own grouped list. While it is active the page
   * owns the body; choosing any other type calls `onLeave`.
   */
  listView?: TableListViewOption;
}) {
  const searchTerm = useRecordTableState((s) => s.searchTerm);
  const columns = useRecordTableState((s) => s.columns);
  const density = useRecordTableState((s) => s.density);
  const filters = useRecordTableState((s) => s.filters);
  const sorts = useRecordTableState((s) => s.sorts);
  const viewType = useRecordTableState((s) => s.type);
  const kanbanFieldMetadataId = useRecordTableState((s) => s.kanbanFieldMetadataId);
  const calendarFieldMetadataId = useRecordTableState((s) => s.calendarFieldMetadataId);
  const handle = useRecordTableStoreHandle();
  const filteredRecords = useFilteredRecords();
  const isDirty = useRecordTableIsDirty();
  const { objectMetadata } = useRecordTableContextOrThrow();
  const toast = useToast();
  const prompt = usePrompt();
  const { t } = useTranslation();
  const canPersistView = usePermissions().can("settings:write");
  // Phones: search is an icon until tapped, and the "Select records" toggle
  // sits in this row instead of taking a row of its own above the table.
  const isMobile = useIsMobile();
  const [searchOpen, setSearchOpen] = useState(false);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const mobileSelectable = useRecordTableState((s) => s.mobileSelectable);
  const mobileSelectionMode = useRecordTableState((s) => s.mobileSelectionMode);
  useEffect(() => {
    handle.get().setToolbarMounted(true);
    return () => handle.get().setToolbarMounted(false);
  }, [handle]);
  // The page-mounted filter editor portals into this row and floats under it.
  const toolbarRef = useCallback((element: HTMLDivElement | null) => handle.get().setToolbarElement(element), [handle]);
  const showSearch = !isMobile || searchOpen || Boolean(searchTerm);

  // The section icon comes from the route registry so a table's icon always
  // matches its page header and sidebar nav (single source of truth, same as
  // PageHeader). The `icon` prop is only a fallback for unregistered routes.
  const location = useLocation();
  const routeIdentity = resolveRouteIdentity(location.pathname);
  const resolvedIcon: ReactNode = routeIdentity
    ? createElement(routeIdentity.icon, { size: 14 })
    : icon;

  const [columnMenuOpen, setColumnMenuOpen] = useState(false);
  const [viewMenuOpen, setViewMenuOpen] = useState(false);
  const [sortMenuOpen, setSortMenuOpen] = useState(false);
  const [groupMenuOpen, setGroupMenuOpen] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const groupButtonRef = useRef<HTMLButtonElement>(null);
  const groupByFieldId = useRecordTableState((s) => getViewGroupBy(s.viewGroups)?.fieldMetadataId ?? null);
  const groupByLabel = groupByFieldId
    ? columns.find((column) => column.fieldMetadataId === groupByFieldId)?.field.label ?? null
    : null;
  const tableId = useRecordTableState((s) => s.tableId);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const viewMenuRef = useRef<HTMLDivElement>(null);
  const sortButtonRef = useRef<HTMLButtonElement>(null);

  // Click-outside for dropdowns.
  useEffect(() => {
    if (!columnMenuOpen && !viewMenuOpen) return;
    const onDown = (e: MouseEvent) => {
      // Portaled Select menus inside these dropdowns count as inside.
      if (columnMenuOpen && columnMenuRef.current && isOutsidePointerEvent(e, columnMenuRef)) {
        setColumnMenuOpen(false);
      }
      if (viewMenuOpen && viewMenuRef.current && isOutsidePointerEvent(e, viewMenuRef)) {
        setViewMenuOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [columnMenuOpen, viewMenuOpen]);

  const activeViewName =
    (views ?? []).find((v) => v._id === currentViewId)?.name ?? t("recordTable.allRecords", "All records");
  // One "Export …" command per mounted table, alongside page-specific exports.
  useRegisterCommand({
    id: `record-table-export:${tableId}`,
    label: `Export ${lowerLabel(objectMetadata.labelPlural)} table…`,
    icon: Download,
    category: "Actions",
    run: () => setExportOpen(true),
  });
  const selectableKanbanFields = columns.filter((column) => {
    const type = column.field.fieldType;
    return type === "SELECT" || type === "MULTI_SELECT" || type === "BOOLEAN" || type === "RELATION";
  });
  const selectableCalendarFields = columns.filter((column) => {
    const type = column.field.fieldType;
    return type === "DATE" || type === "DATE_TIME";
  });

  return (
    <div className="record-table__toolbar" ref={toolbarRef}>
      <div className="record-table__toolbar-left">
        {views && views.length > 0 ? (
          <div className="record-table__view-switcher" ref={viewMenuRef}>
            <button
              type="button"
              className="record-table__view-button"
              onClick={() => setViewMenuOpen((x) => !x)}
            >
              {resolvedIcon}
              <span>{activeViewName}</span>
              <span className="record-table__view-count">{filteredRecords.length}</span>
              <ChevronDown size={12} />
            </button>
            {viewMenuOpen && (
              <ViewportPopover open onClose={() => setViewMenuOpen(false)} anchorRef={viewMenuRef} label="Saved views" className="record-table__menu">
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
              </ViewportPopover>
            )}
          </div>
        ) : (
          <div className="record-table__title">
            {resolvedIcon}
            <span>{label}</span>
            <span className="record-table__view-count">{filteredRecords.length}</span>
          </div>
        )}
        {isMobile && (
          <div className="record-table__mobile-tools">
            {!showSearch && (
              <button
                type="button"
                className="record-table__icon-button"
                aria-label={`Search ${lowerLabel(objectMetadata.labelPlural)}`}
                onClick={() => {
                  setSearchOpen(true);
                  window.setTimeout(() => searchInputRef.current?.focus(), 0);
                }}
              >
                <Search size={16} />
              </button>
            )}
            {mobileSelectable && (
              <button
                type="button"
                className={`record-table__icon-button${mobileSelectionMode ? " is-active" : ""}`}
                aria-pressed={mobileSelectionMode}
                aria-label={mobileSelectionMode ? "Exit selection" : "Select records"}
                title={mobileSelectionMode ? "Exit selection" : "Select records"}
                onKeyDown={(event) => {
                  if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
                }}
                onClick={() => {
                  if (mobileSelectionMode) handle.get().clearSelection();
                  handle.get().setMobileSelectionMode(!mobileSelectionMode);
                }}
              >
                <ListChecks size={16} />
              </button>
            )}
          </div>
        )}
      </div>

      {showSearch && (
      <div className="record-table__toolbar-center">
        <div className="record-table__search">
          <Search size={12} />
          <input
            ref={searchInputRef}
            className="record-table__search-input"
            placeholder={`Search ${lowerLabel(objectMetadata.labelPlural)}…`}
            value={searchTerm}
            onChange={(e) => handle.get().setSearchTerm(e.target.value)}
            onBlur={() => { if (!searchTerm) setSearchOpen(false); }}
          />
          {(searchTerm || (isMobile && searchOpen)) && (
            <button
              type="button"
              className="record-table__search-clear"
              aria-label={searchTerm ? "Clear search" : "Close search"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { handle.get().setSearchTerm(""); setSearchOpen(false); }}
            >
              <X size={isMobile ? 14 : 11} />
            </button>
          )}
        </div>
      </div>
      )}

      <div className="record-table__toolbar-right">
        {onSaveView && isDirty && (
          <>
            <button
              type="button"
              className="record-table__toolbar-button record-table__toolbar-button--dirty"
              disabled={isSaving || !canPersistView}
              onClick={async () => {
                try {
                  setIsSaving(true);
                  await onSaveView();
                } catch (error) {
                  toast.error(
                    "Couldn't save view",
                    error instanceof Error ? error.message : undefined,
                  );
                } finally {
                  setIsSaving(false);
                }
              }}
              title="Save the current column layout, filters and sort into this view"
            >
              <Save size={12} />
              <span>{isSaving ? t("common.saving", "Saving…") : t("common.saveChanges", "Save changes")}</span>
            </button>
            <button
              type="button"
              className="record-table__toolbar-button"
              disabled={isSaving}
              onClick={() => handle.get().discardDraftChanges()}
              title="Revert to the last saved view"
            >
              <RotateCcw size={12} />
              <span>{t("common.discard", "Discard")}</span>
            </button>
          </>
        )}

        {onSaveAsView && isDirty && (
          <button
            type="button"
            className="record-table__toolbar-button"
            disabled={isSaving || !canPersistView}
            onClick={async () => {
              const name = await prompt({
                title: t("recordTable.saveViewTitle", "Save as a new view"),
                message: t("recordTable.saveViewMessage", "Saves the current columns, filters and sort as a personal view."),
                placeholder: t("recordTable.viewName", "View name"),
                confirmLabel: t("recordTable.saveView", "Save view"),
                required: true,
              });
              if (!name?.trim()) return;
              try {
                setIsSaving(true);
                await onSaveAsView(name.trim());
              } catch (error) {
                toast.error(
                  "Couldn't save new view",
                  error instanceof Error ? error.message : undefined,
                );
              } finally {
                setIsSaving(false);
              }
            }}
            title="Save the current table setup as a new personal view"
          >
            <Save size={12} />
            <span>{t("common.saveAs", "Save as")}</span>
          </button>
        )}

        <div className="record-table__segmented" aria-label="View type">
          {listView && (
            <button
              type="button"
              className={listView.active ? "is-active" : ""}
              aria-pressed={listView.active}
              onClick={() => {
                listView.onSelect();
                resetScrollForViewSwitch();
              }}
              title={t("recordTable.listView", "List view")}
            >
              <List size={12} />
            </button>
          )}
          <button
            type="button"
            className={!listView?.active && viewType === "table" ? "is-active" : ""}
            onClick={() => {
              listView?.onLeave();
              handle.get().setType("table");
              resetScrollForViewSwitch();
            }}
            title={t("recordTable.tableView", "Table view")}
          >
            <Table2 size={12} />
          </button>
          <button
            type="button"
            className={!listView?.active && (viewType === "kanban" || viewType === "board") ? "is-active" : ""}
            onClick={() => {
              listView?.onLeave();
              const firstField = kanbanFieldMetadataId ?? selectableKanbanFields[0]?.fieldMetadataId;
              handle.get().setType("kanban");
              if (firstField) handle.get().setKanbanFieldMetadataId(firstField);
              resetScrollForViewSwitch();
            }}
            title={t("recordTable.kanbanView", "Kanban view")}
          >
            <Kanban size={12} />
          </button>
          <button
            type="button"
            className={!listView?.active && viewType === "calendar" ? "is-active" : ""}
            onClick={() => {
              listView?.onLeave();
              const firstField = calendarFieldMetadataId ?? selectableCalendarFields[0]?.fieldMetadataId;
              handle.get().setType("calendar");
              if (firstField) handle.get().setCalendarFieldMetadataId(firstField);
              resetScrollForViewSwitch();
            }}
            title={t("recordTable.calendarView", "Calendar view")}
          >
            <CalendarDays size={12} />
          </button>
        </div>

        {onOpenFilter && <RecordTableAskFilterButton />}
        {onOpenFilter && (
          <button
            type="button"
            className={
              "record-table__toolbar-button record-table__toolbar-button--collapsible" +
              (filters.length > 0 ? " record-table__toolbar-button--active" : "")
            }
            data-record-table-filter-trigger=""
            aria-label={`${t("common.filter", "Filter")}${filters.length > 0 ? ` · ${filters.length}` : ""}`}
            aria-haspopup="dialog"
            onClick={onOpenFilter}
          >
            <Filter size={12} />
            <span>{t("common.filter", "Filter")}{filters.length > 0 ? ` · ${filters.length}` : ""}</span>
          </button>
        )}

        <button
          type="button"
          className={
            "record-table__toolbar-button record-table__toolbar-button--collapsible" +
            (sorts.length > 0 ? " record-table__toolbar-button--active" : "")
          }
          ref={sortButtonRef}
          aria-label={`${t("common.sort", "Sort")}${sorts.length > 0 ? ` · ${sorts.length}` : ""}`}
          aria-haspopup="dialog"
          aria-expanded={sortMenuOpen}
          onClick={() => setSortMenuOpen((x) => !x)}
        >
          <ArrowDownUp size={12} />
          <span>{t("common.sort", "Sort")}{sorts.length > 0 ? ` · ${sorts.length}` : ""}</span>
        </button>
        <RecordTableSortPopover open={sortMenuOpen} onClose={() => setSortMenuOpen(false)} anchorRef={sortButtonRef} />

        {!listView?.active && viewType === "table" && (
          <>
            <button
              type="button"
              className={
                "record-table__toolbar-button record-table__toolbar-button--group" +
                (groupByLabel ? " record-table__toolbar-button--active" : "")
              }
              ref={groupButtonRef}
              data-record-table-action="group"
              aria-label={groupByLabel ? `Group · ${groupByLabel}` : "Group"}
              aria-haspopup="dialog"
              aria-expanded={groupMenuOpen}
              title={groupByLabel ? `Grouped by ${groupByLabel}` : "Group records"}
              onClick={() => setGroupMenuOpen((x) => !x)}
            >
              <Rows3 size={12} />
              <span>{groupByLabel ? `Group · ${groupByLabel}` : "Group"}</span>
            </button>
            <RecordTableGroupByPopover open={groupMenuOpen} onClose={() => setGroupMenuOpen(false)} anchorRef={groupButtonRef} />
          </>
        )}

        <div className="record-table__view-switcher" ref={columnMenuRef}>
          <button
            type="button"
            className="record-table__toolbar-button record-table__toolbar-button--options"
            aria-label={t("common.options", "Options")}
            aria-haspopup="dialog"
            aria-expanded={columnMenuOpen}
            onClick={() => setColumnMenuOpen((x) => !x)}
          >
            <SlidersHorizontal size={12} />
            <span>{t("common.options", "Options")}</span>
          </button>
          {columnMenuOpen && (
            <ViewportPopover open onClose={() => setColumnMenuOpen(false)} anchorRef={columnMenuRef} label="Table options" className="record-table__menu record-table__menu--right record-table__menu--wide">
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
              <div className="record-table__menu-section">
                <span className="record-table__menu-label">Density</span>
                <div className="record-table__density-options" role="radiogroup" aria-label="Row density">
                  <button
                    type="button"
                    role="radio"
                    aria-checked={density === "compact"}
                    className={density === "compact" ? "is-active" : ""}
                    onClick={() => handle.get().setDensity("compact")}
                  >
                    Compact
                  </button>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={density === "comfortable"}
                    className={density === "comfortable" ? "is-active" : ""}
                    onClick={() => handle.get().setDensity("comfortable")}
                  >
                    Comfortable
                  </button>
                </div>
              </div>
              <div className="record-table__menu-section">
                <button
                  type="button"
                  className="record-table__menu-action"
                  onClick={() => {
                    setColumnMenuOpen(false);
                    setExportOpen(true);
                  }}
                >
                  <Download size={13} aria-hidden="true" /> Export…
                </button>
              </div>
              <div className="record-table__menu-section">
                <span className="record-table__menu-label record-table__menu-label--icon">
                  <Columns size={12} /> Columns
                </span>
              {columns.map((col) => (
                <label key={col.viewFieldId} className="record-table__menu-checkbox">
                  <input
                    type="checkbox"
                    checked={col.isVisible}
                    disabled={col.field.name === objectMetadata.labelIdentifierFieldName}
                    onChange={() => handle.get().toggleColumnVisibility(col.viewFieldId)}
                  />
                  {col.field.label}
                </label>
              ))}
              </div>
            </ViewportPopover>
          )}
        </div>

        {actions}
      </div>
      <RecordTableExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        viewName={views && views.length > 0 ? activeViewName : label}
      />
    </div>
  );
}
