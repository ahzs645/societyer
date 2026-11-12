import { ViewportPopover } from "@/components/ViewportPopover";
import { lowerLabel } from "../utils/lowerLabel";
import { createElement, useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { useLocation } from "react-router-dom";
import {
  ArrowDownUp,
  CalendarDays,
  ChevronDown,
  Columns,
  Download,
  Filter,
  Kanban,
  Pencil,
  RotateCcw,
  Save,
  Search,
  SlidersHorizontal,
  Trash2,
  Table2,
  X,
  ListChecks,
  List,
  type LucideIcon,
} from "lucide-react";
import {
  useRecordTableIsDirty,
  useRecordTableIsViewEdited,
  useRecordTableState,
  useRecordTableStoreHandle,
} from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { resolveRouteIdentity } from "../../../../lib/routeIdentity";
import { useToast } from "../../../../components/Toast";
import { useConfirm, usePrompt } from "../../../../components/Modal";
import { useTranslation } from "react-i18next";
import { RecordTableSortPopover } from "./RecordTableSortPopover";
import { useFilteredRecords } from "../hooks/useFilteredRecords";
import { prepareRecordSearch } from "../utils/filterRecords";
import { usePermissions } from "../../../../hooks/usePermissions";
import { isOutsidePointerEvent } from "../../../../lib/floatingLayer";
import { useIsMobile } from "../../../../lib/useIsMobile";
import { useIsBottomSheet } from "../../../../lib/useSheetDrag";
import { useRegisterCommand } from "../../../../lib/commands";
import { RecordTableGroupByEditor } from "./RecordTableGroupByEditor";
import { Select } from "@/components/Select";
import { RecordTableExportDialog } from "./RecordTableExportDialog";
import { getViewGroupBy } from "../utils/groupRecords";
import { RecordTableAskFilterButton } from "./RecordTableAskFilterButton";
import { RecordTableViewOptionsSheet } from "./RecordTableViewOptionsSheet";
import { RecordTableDisplayOptions } from "./RecordTableDisplayOptions";

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
/**
 * A further page-owned view (the Tasks timeline) offered after the built-in
 * view types. While it is active the page owns the body; choosing any other
 * view calls `onLeave`.
 */
export type TablePageViewOption = {
  id: string;
  Icon: LucideIcon;
  label: string;
  short: string;
  active: boolean;
  onSelect: () => void;
  onLeave: () => void;
};

/**
 * Tables at least this long filter a pause after typing rather than on every
 * key: the field keeps up with the typing, and the list (and its count)
 * changes once per pause instead of jumping on each letter.
 */
const SEARCH_DEBOUNCE_ROWS = 1000;
const SEARCH_DEBOUNCE_MS = 150;

export function RecordTableToolbar({
  icon,
  label,
  views,
  currentViewId,
  onChangeView,
  onOpenFilter,
  onSaveView,
  onSaveAsView,
  saveAsViewMessage,
  onRenameView,
  onDeleteView,
  actions,
  listView,
  pageViews,
  hideViewPickerOnPhone = false,
  collapsibleSearch = false,
  extraFilterCount = 0,
  searchPlaceholder,
  hideTitle = false,
}: {
  icon?: ReactNode;
  label: string;
  /** No title and count: the table sits under a heading that already says
   *  what it lists (a card's title). `label` still names its search. */
  hideTitle?: boolean;
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
  /** What "Save as" says it saves (default: a personal view). */
  saveAsViewMessage?: string;
  /**
   * Rename / delete the view on show, offered at the foot of the views menu
   * for a view that isn't a system view, to people who may save views.
   */
  onRenameView?: (viewId: string, name: string) => void | Promise<void>;
  onDeleteView?: (viewId: string) => void | Promise<void>;
  actions?: ReactNode;
  /**
   * Adds a "List view" button ahead of the table/kanban/calendar switch for
   * pages that render their own grouped list. While it is active the page
   * owns the body; choosing any other type calls `onLeave`.
   */
  listView?: TableListViewOption;
  /** Page-owned views after the built-in ones (see TablePageViewOption). */
  pageViews?: TablePageViewOption[];
  /**
   * Phones: leave out the saved-view picker because the page offers the
   * views elsewhere (Tasks' view sheet), so there is one place to choose a
   * view. The row then just counts the records. Wider screens keep it.
   */
  hideViewPickerOnPhone?: boolean;
  /**
   * Search starts as a Search button in the toolbar row (on phones too, where
   * it is otherwise only in the "View options" sheet). It opens the field,
   * focused; the field folds back once it is empty and loses focus, or with
   * its ×. While a search applies the field stays open, so a searched list
   * always says so.
   */
  collapsibleSearch?: boolean;
  /** What the search box looks in, when it is more than the columns ("Search titles and notice text…"). */
  searchPlaceholder?: string;
  /**
   * Filters the page applies outside the table's own conditions (and offers
   * in the filter editor's `extra`), counted on the Filter button with them.
   */
  extraFilterCount?: number;
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
  const viewEdited = useRecordTableIsViewEdited();
  const { objectMetadata } = useRecordTableContextOrThrow();
  const toast = useToast();
  const prompt = usePrompt();
  const confirm = useConfirm();
  const { t } = useTranslation();
  const canPersistView = usePermissions().can("settings:write");
  // Phones: search is an icon until tapped, and the "Select records" toggle
  // sits in this row instead of taking a row of its own above the table.
  const isMobile = useIsMobile();
  // Phones (<= 560px) keep one row: the view picker, then just Filter and
  // "View options". The options sheet holds view type, sort, group, density,
  // fields, export, search and "Select records"; active filters and sorts
  // stay on show as chips under the toolbar (RecordTableFilterChips).
  const isPhone = useIsBottomSheet();
  const [searchOpen, setSearchOpen] = useState(false);
  const [viewOptionsOpen, setViewOptionsOpen] = useState(false);
  const viewOptionsRequest = useRecordTableState((s) => s.viewOptionsRequest);
  const handledViewOptionsRequest = useRef(viewOptionsRequest);
  useEffect(() => {
    if (handledViewOptionsRequest.current === viewOptionsRequest) return;
    handledViewOptionsRequest.current = viewOptionsRequest;
    if (isPhone) setViewOptionsOpen(true);
  }, [isPhone, viewOptionsRequest]);
  const searchInputRef = useRef<HTMLInputElement>(null);
  // The field shows what is typed straight away; long tables take it a pause
  // later (SEARCH_DEBOUNCE_MS). A search set from elsewhere (a view loading,
  // "Clear filters", a link) replaces what the field shows.
  const [searchDraft, setSearchDraft] = useState(searchTerm);
  const writtenSearch = useRef(searchTerm);
  const searchTimer = useRef<number | null>(null);
  const debounceSearch = useRecordTableState((s) => s.records.length >= SEARCH_DEBOUNCE_ROWS);
  useEffect(() => {
    if (searchTerm === writtenSearch.current) return;
    writtenSearch.current = searchTerm;
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = null;
    setSearchDraft(searchTerm);
  }, [searchTerm]);
  // A long table reads its records' search text while the field is first focused, before any letter is typed.
  const stopPreparing = useRef<(() => void) | null>(null);
  useEffect(() => () => {
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    stopPreparing.current?.();
  }, []);
  const prepareSearch = () => {
    if (!debounceSearch) return;
    stopPreparing.current?.();
    const state = handle.get();
    stopPreparing.current = prepareRecordSearch(state.records, state.columns.map((column) => column.field));
  };
  const writeSearch = (value: string, now = false) => {
    setSearchDraft(value);
    if (searchTimer.current !== null) window.clearTimeout(searchTimer.current);
    searchTimer.current = null;
    const commit = () => {
      searchTimer.current = null;
      writtenSearch.current = value;
      handle.get().setSearchTerm(value);
    };
    if (now || !debounceSearch) commit();
    else searchTimer.current = window.setTimeout(commit, SEARCH_DEBOUNCE_MS);
  };
  const mobileSelectable = useRecordTableState((s) => s.mobileSelectable);
  const mobileSelectionMode = useRecordTableState((s) => s.mobileSelectionMode);
  useEffect(() => {
    handle.get().setToolbarMounted(true);
    return () => handle.get().setToolbarMounted(false);
  }, [handle]);
  // The page-mounted filter editor portals into this row and floats under it.
  const toolbarRef = useCallback((element: HTMLDivElement | null) => handle.get().setToolbarElement(element), [handle]);
  const searching = Boolean(searchDraft || searchTerm);
  const showSearch = (!isMobile && !collapsibleSearch) || searchOpen || searching;
  // Rendered and focused in the same tap, so phones raise the keyboard.
  const openSearch = () => {
    flushSync(() => setSearchOpen(true));
    searchInputRef.current?.focus();
  };
  const closeSearch = () => {
    writeSearch("", true);
    setSearchOpen(false);
  };
  const onSearchKeyDown = (event: ReactKeyboardEvent<HTMLInputElement>) => {
    if (event.key === "Escape" && (searchDraft || searchOpen)) {
      // First Esc clears the search, the next folds the field away.
      event.preventDefault();
      event.stopPropagation();
      if (searchDraft) writeSearch("", true);
      else { setSearchOpen(false); event.currentTarget.blur(); }
    } else if (event.key === "Enter") {
      writeSearch(event.currentTarget.value, true);
      // Phones: the keyboard's Search key puts the keyboard away to show the results.
      if (isMobile) event.currentTarget.blur();
    }
  };

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
  const [exportOpen, setExportOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
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

  const currentView = (views ?? []).find((v) => v._id === currentViewId);
  const activeViewName = currentView?.name ?? t("recordTable.allRecords", "All records");
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

  // From the sheet: let it close (and hand focus back) before the field takes it.
  const openSearchFromSheet = () => {
    setViewOptionsOpen(false);
    setSearchOpen(true);
    window.setTimeout(() => searchInputRef.current?.focus(), 60);
  };
  const toggleSelectionMode = () => {
    if (mobileSelectionMode) handle.get().clearSelection();
    handle.get().setMobileSelectionMode(!mobileSelectionMode);
  };
  // A page-owned view (the list or a page view) owns the body; no built-in type shows as active.
  const listActive = Boolean(listView?.active) || Boolean(pageViews?.some((view) => view.active));
  const isKanban = viewType === "kanban" || viewType === "board";
  const leavePageViews = () => pageViews?.forEach((view) => view.onLeave());
  const chooseViewType = (next: string) => {
    const pageView = pageViews?.find((view) => view.id === next);
    if (pageView) {
      pageView.onSelect();
    } else if (next === "list") {
      listView?.onSelect();
    } else if (next === "table" || next === "kanban" || next === "calendar") {
      listView?.onLeave();
      leavePageViews();
      handle.get().setType(next);
      const firstField = next === "kanban"
        ? kanbanFieldMetadataId ?? selectableKanbanFields[0]?.fieldMetadataId
        : next === "calendar"
          ? calendarFieldMetadataId ?? selectableCalendarFields[0]?.fieldMetadataId
          : undefined;
      if (firstField && next === "kanban") handle.get().setKanbanFieldMetadataId(firstField);
      if (firstField && next === "calendar") handle.get().setCalendarFieldMetadataId(firstField);
    }
    resetScrollForViewSwitch();
  };
  const viewTypeOptions = [
    ...(listView ? [{ id: "list" as const, Icon: List, label: t("recordTable.listView", "List view"), short: t("recordTable.listShort", "List"), active: listView.active, page: true }] : []),
    { id: "table" as const, Icon: Table2, label: t("recordTable.tableView", "Table view"), short: t("recordTable.tableShort", "Table"), active: !listActive && viewType === "table" },
    { id: "kanban" as const, Icon: Kanban, label: t("recordTable.kanbanView", "Kanban view"), short: t("recordTable.kanbanShort", "Board"), active: !listActive && isKanban },
    { id: "calendar" as const, Icon: CalendarDays, label: t("recordTable.calendarView", "Calendar view"), short: t("recordTable.calendarShort", "Calendar"), active: !listActive && viewType === "calendar" },
    ...(pageViews ?? []).map(({ id, Icon, label, short, active }) => ({ id, Icon, label, short, active, page: true })),
  ];
  // Records still arriving in batches count toward the total straight away
  // (a search or filter counts the matches loaded so far).
  const loadingProgress = useRecordTableState((s) => s.loadingProgress);
  const searchingOrFiltered = filters.length > 0 || searchTerm.trim().length > 0;
  const viewCount = loadingProgress && !searchingOrFiltered
    ? Math.max(loadingProgress.total, filteredRecords.length)
    : filteredRecords.length;
  const loadingStatus = loadingProgress && loadingProgress.loaded < loadingProgress.total
    ? `Loading ${loadingProgress.loaded.toLocaleString("en-CA")} of ${loadingProgress.total.toLocaleString("en-CA")}…`
    : null;
  // Beside the view name; phones give it its own line under the toolbar row.
  const loadingStatusElement = loadingStatus && (
    <span className="record-table__loading-status" role="status" aria-live="polite">
      {loadingStatus}
    </span>
  );
  // Sorts and grouping live in the phone options sheet; its button counts them.
  const viewOptionsActive = sorts.length + (groupByLabel && !listActive && viewType === "table" ? 1 : 0);

  // Phones share one toolbar row between the view picker and two icon
  // buttons, so a long view name with a count chip could still be cut short.
  // When the name doesn't fit beside the count, the count steps aside
  // (`is-tight`) and the name gets its room.
  useEffect(() => {
    const switcher = viewMenuRef.current;
    const button = switcher?.querySelector<HTMLElement>(".record-table__view-button");
    const name = button?.querySelector<HTMLElement>(".record-table__view-name");
    if (!switcher || !button || !name) return;
    const measure = () => {
      button.classList.remove("is-tight");
      button.classList.toggle("is-tight", name.scrollWidth > name.clientWidth + 1);
    };
    measure();
    const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
    if (switcher.parentElement) observer?.observe(switcher.parentElement);
    return () => observer?.disconnect();
  }, [activeViewName, viewCount, viewEdited]);

  const filterCount = filters.length + extraFilterCount;
  const filterButton = (
    <button
      type="button"
      className={
        "record-table__toolbar-button record-table__toolbar-button--collapsible" +
        (filterCount > 0 ? " record-table__toolbar-button--active" : "")
      }
      data-record-table-filter-trigger=""
      aria-label={`${t("common.filter", "Filter")}${filterCount > 0 ? ` · ${filterCount}` : ""}`}
      aria-haspopup="dialog"
      onClick={onOpenFilter}
    >
      <Filter size={12} />
      <span>{t("common.filter", "Filter")}{filterCount > 0 ? ` · ${filterCount}` : ""}</span>
      {isPhone && filterCount > 0 && <b className="record-table__toolbar-badge" aria-hidden="true">{filterCount}</b>}
    </button>
  );

  const setChipsSlot = useCallback((node: HTMLDivElement | null) => handle.get().setChipsSlot(node), [handle]);

  return (
    <div className="record-table__toolbar" ref={toolbarRef}>
      <div className="record-table__toolbar-left">
        {isPhone && hideViewPickerOnPhone ? (
          <div className="record-table__title record-table__title--count" aria-live="polite">
            {resolvedIcon}
            <span>{viewCount} {lowerLabel(viewCount === 1 ? objectMetadata.labelSingular : objectMetadata.labelPlural)}</span>
          </div>
        ) : views && views.length > 0 ? (
          <div className="record-table__view-switcher" ref={viewMenuRef}>
            <button
              type="button"
              className="record-table__view-button"
              // The count chip can be visually hidden on phones (is-tight);
              // the name keeps it either way.
              aria-label={`${activeViewName}${viewEdited ? " (edited)" : ""} ${viewCount}`}
              title={viewEdited ? "Its filters or sort have changed. Choose the view again to reset them." : undefined}
              onClick={() => setViewMenuOpen((x) => !x)}
            >
              {resolvedIcon}
              <span className="record-table__view-name">{activeViewName}</span>
              {/* The view's own filters or sort were changed: the name alone would claim rows it isn't showing. */}
              {viewEdited && <span className="record-table__view-edited">Edited</span>}
              <span className="record-table__view-count">{viewCount}</span>
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
                      // Choosing the view on show again puts back its own filters and sort.
                      if (v._id === currentViewId && viewEdited) handle.get().discardDraftChanges({ keepQuickSearch: true });
                      onChangeView?.(v._id);
                      setViewMenuOpen(false);
                    }}
                  >
                    {v.name}
                    {v.isSystem && <span className="record-table__menu-badge">system</span>}
                    {v._id === currentViewId && viewEdited && <span className="record-table__menu-badge">reset</span>}
                  </button>
                ))}
                {currentView && !currentView.isSystem && canPersistView && (onRenameView || onDeleteView) && (
                  <div className="record-table__menu-divider" role="presentation">
                    {onRenameView && (
                      <button
                        type="button"
                        className="record-table__menu-item"
                        disabled={isSaving}
                        onClick={async () => {
                          setViewMenuOpen(false);
                          const name = await prompt({
                            title: t("recordTable.renameViewTitle", "Rename view"),
                            placeholder: t("recordTable.viewName", "View name"),
                            defaultValue: currentView.name,
                            confirmLabel: t("recordTable.renameView", "Rename"),
                            required: true,
                          });
                          if (!name?.trim() || name.trim() === currentView.name) return;
                          try {
                            setIsSaving(true);
                            await onRenameView(currentView._id, name.trim());
                          } catch (error) {
                            toast.error("Couldn't rename view", error instanceof Error ? error.message : undefined);
                          } finally {
                            setIsSaving(false);
                          }
                        }}
                      >
                        <Pencil size={12} />
                        {t("recordTable.renameViewItem", "Rename view…")}
                      </button>
                    )}
                    {onDeleteView && (
                      <button
                        type="button"
                        className="record-table__menu-item"
                        disabled={isSaving}
                        onClick={async () => {
                          setViewMenuOpen(false);
                          const ok = await confirm({
                            title: t("recordTable.deleteViewTitle", "Delete view?"),
                            message: `“${currentView.name}” is removed for everyone in the workspace. The records stay as they are.`,
                            confirmLabel: t("recordTable.deleteView", "Delete view"),
                            tone: "danger",
                          });
                          if (!ok) return;
                          try {
                            setIsSaving(true);
                            await onDeleteView(currentView._id);
                          } catch (error) {
                            toast.error("Couldn't delete view", error instanceof Error ? error.message : undefined);
                          } finally {
                            setIsSaving(false);
                          }
                        }}
                      >
                        <Trash2 size={12} />
                        {t("recordTable.deleteViewItem", "Delete view")}
                      </button>
                    )}
                  </div>
                )}
              </ViewportPopover>
            )}
          </div>
        ) : hideTitle ? null : (
          <div className="record-table__title">
            {resolvedIcon}
            <span>{label}</span>
            <span className="record-table__view-count">{viewCount}</span>
          </div>
        )}
        {!isPhone && loadingStatusElement}
        {isMobile && !isPhone && (
          <div className="record-table__mobile-tools">
            {!showSearch && !collapsibleSearch && (
              <button
                type="button"
                className="record-table__icon-button"
                aria-label={`Search ${lowerLabel(objectMetadata.labelPlural)}`}
                onClick={openSearch}
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
            placeholder={searchPlaceholder ?? `Search ${lowerLabel(objectMetadata.labelPlural)}…`}
            aria-label={`Search ${lowerLabel(objectMetadata.labelPlural)}`}
            value={searchDraft}
            // Names and reference numbers: no autocorrect or capitals.
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            enterKeyHint="search"
            onChange={(e) => writeSearch(e.target.value)}
            onKeyDown={onSearchKeyDown}
            onFocus={prepareSearch}
            onBlur={(e) => {
              if (searchTimer.current !== null) writeSearch(e.currentTarget.value, true);
              if (!e.currentTarget.value) setSearchOpen(false);
            }}
          />
          {(searching || ((isMobile || collapsibleSearch) && searchOpen)) && (
            <button
              type="button"
              className="record-table__search-clear"
              aria-label={searching ? "Clear search" : "Close search"}
              onMouseDown={(event) => event.preventDefault()}
              onClick={closeSearch}
            >
              <X size={isMobile ? 14 : 11} />
            </button>
          )}
        </div>
      </div>
      )}

      {/* Filter chips sit in the toolbar's own row (RecordTableFilterChips
          portals into this slot); phones keep them on a swipeable row below. */}
      {!isPhone && <div className="record-table__toolbar-chips" ref={setChipsSlot} />}

      <div className="record-table__toolbar-right">
        {/* Phones keep the button beside the open field (it shows the search is on); wider screens swap it for the field. */}
        {collapsibleSearch && (isPhone || !showSearch) && (
          <button
            type="button"
            className={
              "record-table__toolbar-button record-table__toolbar-button--collapsible record-table__toolbar-button--search" +
              (searching ? " record-table__toolbar-button--active" : "")
            }
            aria-label={`Search ${lowerLabel(objectMetadata.labelPlural)}${searching ? " · on" : ""}`}
            aria-expanded={showSearch}
            title={`Search ${lowerLabel(objectMetadata.labelPlural)}`}
            // Keeps the open field's focus, so a tap folds an empty field rather than blurring and reopening it.
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              if (showSearch && !searching) setSearchOpen(false);
              else openSearch();
            }}
          >
            <Search size={12} />
            <span>{t("common.search", "Search")}</span>
          </button>
        )}
        {/* Unsaved-view controls: inline on wider screens, their own line on phones.
          * They stay up, reading "Saving…", until the save has finished: the
          * view's own update can arrive (and clear isDirty) before the write
          * is durable, and a reload then would lose it. */}
        <div className="record-table__toolbar-dirty">
        {onSaveView && (isDirty || isSaving) && (
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

        {onSaveAsView && (isDirty || isSaving) && (
          <button
            type="button"
            className="record-table__toolbar-button"
            disabled={isSaving || !canPersistView}
            onClick={async () => {
              const name = await prompt({
                title: t("recordTable.saveViewTitle", "Save as a new view"),
                message: saveAsViewMessage ?? t("recordTable.saveViewMessage", "Saves the current columns, filters and sort as a personal view."),
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
        </div>

        {!isPhone && (
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
            className={!listActive && viewType === "table" ? "is-active" : ""}
            onClick={() => {
              listView?.onLeave();
              leavePageViews();
              handle.get().setType("table");
              resetScrollForViewSwitch();
            }}
            title={t("recordTable.tableView", "Table view")}
          >
            <Table2 size={12} />
          </button>
          <button
            type="button"
            className={!listActive && (viewType === "kanban" || viewType === "board") ? "is-active" : ""}
            onClick={() => {
              listView?.onLeave();
              leavePageViews();
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
            className={!listActive && viewType === "calendar" ? "is-active" : ""}
            onClick={() => {
              listView?.onLeave();
              leavePageViews();
              const firstField = calendarFieldMetadataId ?? selectableCalendarFields[0]?.fieldMetadataId;
              handle.get().setType("calendar");
              if (firstField) handle.get().setCalendarFieldMetadataId(firstField);
              resetScrollForViewSwitch();
            }}
            title={t("recordTable.calendarView", "Calendar view")}
          >
            <CalendarDays size={12} />
          </button>
          {pageViews?.map((view) => (
            <button
              key={view.id}
              type="button"
              className={view.active ? "is-active" : ""}
              aria-pressed={view.active}
              onClick={() => {
                view.onSelect();
                resetScrollForViewSwitch();
              }}
              title={view.label}
            >
              <view.Icon size={12} />
            </button>
          ))}
        </div>
        )}

        {onOpenFilter && <RecordTableAskFilterButton />}
        {onOpenFilter && filterButton}

        {isPhone && (mobileSelectable && mobileSelectionMode ? (
          <button
            type="button"
            className="record-table__toolbar-button record-table__toolbar-button--text record-table__toolbar-button--active"
            title="Exit selection"
            onKeyDown={(event) => {
              if (!event.ctrlKey && !event.metaKey && !event.altKey) event.stopPropagation();
            }}
            onClick={toggleSelectionMode}
          >
            <span>{t("common.done", "Done")}</span>
          </button>
        ) : (
          <button
            type="button"
            className={
              "record-table__toolbar-button record-table__toolbar-button--options" +
              (viewOptionsActive > 0 ? " record-table__toolbar-button--active" : "")
            }
            aria-label={`${t("recordTable.viewOptions", "View options")}${viewOptionsActive > 0 ? ` · ${viewOptionsActive} active` : ""}`}
            title={t("recordTable.viewOptions", "View options")}
            aria-haspopup="dialog"
            aria-expanded={viewOptionsOpen}
            onClick={() => setViewOptionsOpen(true)}
          >
            <SlidersHorizontal size={12} />
            <span>{t("recordTable.viewOptions", "View options")}</span>
            {viewOptionsActive > 0 && <b className="record-table__toolbar-badge" aria-hidden="true">{viewOptionsActive}</b>}
          </button>
        ))}
        {isPhone && (
          <RecordTableViewOptionsSheet
            open={viewOptionsOpen}
            onClose={() => setViewOptionsOpen(false)}
            viewTypeOptions={viewTypeOptions}
            onChooseViewType={chooseViewType}
            showGroup={!listActive && viewType === "table"}
            showDisplay={!listActive && viewType === "table"}
            kanbanFields={selectableKanbanFields}
            calendarFields={selectableCalendarFields}
            onSearch={openSearchFromSheet}
            onToggleSelection={mobileSelectable ? () => {
              setViewOptionsOpen(false);
              toggleSelectionMode();
            } : undefined}
            onExport={() => {
              setViewOptionsOpen(false);
              setExportOpen(true);
            }}
            actions={actions}
          />
        )}

        {!isPhone && (
        <>
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

        <div className="record-table__view-switcher" ref={columnMenuRef}>
          {/* Grouping, density, columns and export live here; a column's
              header menu still offers "Group by this field". */}
          <button
            type="button"
            className={
              "record-table__toolbar-button record-table__toolbar-button--options" +
              (groupByLabel && !listActive && viewType === "table" ? " record-table__toolbar-button--active" : "")
            }
            data-record-table-action="group"
            aria-label={`${t("common.options", "Options")}${groupByLabel && !listActive && viewType === "table" ? ` · grouped by ${groupByLabel}` : ""}`}
            title={groupByLabel && !listActive && viewType === "table" ? `Grouped by ${groupByLabel}` : "Group, density, columns and export"}
            aria-haspopup="dialog"
            aria-expanded={columnMenuOpen}
            onClick={() => setColumnMenuOpen((x) => !x)}
          >
            <SlidersHorizontal size={12} />
            <span>{t("common.options", "Options")}</span>
          </button>
          {columnMenuOpen && (
            <ViewportPopover open onClose={() => setColumnMenuOpen(false)} anchorRef={columnMenuRef} label="Table options" className="record-table__menu record-table__menu--right record-table__menu--wide">
              {!listActive && viewType === "table" && <RecordTableGroupByEditor />}
              {(viewType === "kanban" || viewType === "board") && (
                <div className="record-table__menu-section">
                  <span className="record-table__menu-label">Kanban field</span>
                  <Select
                    size="sm"
                    aria-label="Kanban field"
                    value={kanbanFieldMetadataId ?? ""}
                    placeholder="Choose field…"
                    onChange={(value) => handle.get().setKanbanFieldMetadataId(value || undefined)}
                    options={selectableKanbanFields.map((column) => ({ value: column.fieldMetadataId, label: column.field.label }))}
                  />
                </div>
              )}

              {viewType === "calendar" && (
                <div className="record-table__menu-section">
                  <span className="record-table__menu-label">Calendar field</span>
                  <Select
                    size="sm"
                    aria-label="Calendar field"
                    value={calendarFieldMetadataId ?? ""}
                    placeholder="Choose date field…"
                    onChange={(value) => handle.get().setCalendarFieldMetadataId(value || undefined)}
                    options={selectableCalendarFields.map((column) => ({ value: column.fieldMetadataId, label: column.field.label }))}
                  />
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
              {!listActive && viewType === "table" && <RecordTableDisplayOptions variant="menu" />}
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
        </>
        )}
      </div>
      {isPhone && loadingStatusElement}
      <RecordTableExportDialog
        open={exportOpen}
        onClose={() => setExportOpen(false)}
        viewName={views && views.length > 0 ? activeViewName : label}
      />
    </div>
  );
}
