import type { ReactNode } from "react";
import { Columns, Download, ListChecks, Search, type LucideIcon } from "lucide-react";
import { Modal } from "../../../../components/Modal";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useRecordTableContextOrThrow } from "../contexts/RecordTableContext";
import { lowerLabel } from "../utils/lowerLabel";
import type { RecordField } from "../../types";
import { RecordTableSortEditor } from "./RecordTableSortPopover";
import { RecordTableGroupByEditor } from "./RecordTableGroupByPopover";
import { RecordTableDisplayOptions } from "./RecordTableDisplayOptions";

export type RecordTableViewTypeOption<Id extends string = string> = {
  id: Id;
  Icon: LucideIcon;
  label: string;
  short: string;
  active: boolean;
};

/**
 * Phones: everything the desktop toolbar spreads over its right-hand buttons
 * (view type, sort, group, density, columns, export, search, "Select
 * records") in one bottom sheet behind the toolbar's "View options" button.
 * The sort and group sections are the same editors the desktop popovers use.
 */
export function RecordTableViewOptionsSheet<Id extends string>({
  open,
  onClose,
  viewTypeOptions,
  onChooseViewType,
  showGroup,
  showDisplay = false,
  kanbanFields,
  calendarFields,
  onSearch,
  onToggleSelection,
  onExport,
  actions,
}: {
  open: boolean;
  onClose: () => void;
  viewTypeOptions: RecordTableViewTypeOption<Id>[];
  onChooseViewType: (id: Id) => void;
  /** Grouping applies to the table view only. */
  showGroup: boolean;
  /** Continuous scroll or pages: the table view only. */
  showDisplay?: boolean;
  kanbanFields: RecordField[];
  calendarFields: RecordField[];
  onSearch: () => void;
  /** Present while the table offers "Select records" on phones. */
  onToggleSelection?: () => void;
  onExport: () => void;
  /** The page's own toolbar actions, if any. */
  actions?: ReactNode;
}) {
  const mobileSelectionMode = useRecordTableState((s) => s.mobileSelectionMode);
  const { objectMetadata } = useRecordTableContextOrThrow();
  const plural = lowerLabel(objectMetadata.labelPlural);

  return (
    <Modal open={open} onClose={onClose} title="View options" size="sm">
      <div className="record-view-sheet">
        <div className="record-view-sheet__actions">
          <button type="button" className="record-view-sheet__action" onClick={onSearch}>
            <Search size={16} aria-hidden="true" />
            <span>Search {plural}</span>
          </button>
          {onToggleSelection && (
            <button
              type="button"
              className="record-view-sheet__action"
              aria-pressed={mobileSelectionMode}
              onClick={onToggleSelection}
            >
              <ListChecks size={16} aria-hidden="true" />
              <span>{mobileSelectionMode ? "Exit selection" : "Select records"}</span>
            </button>
          )}
          <button type="button" className="record-view-sheet__action" onClick={onExport}>
            <Download size={16} aria-hidden="true" />
            <span>Export…</span>
          </button>
        </div>

        <LayoutSection
          viewTypeOptions={viewTypeOptions}
          onChooseViewType={onChooseViewType}
          kanbanFields={kanbanFields}
          calendarFields={calendarFields}
        />

        <section className="record-view-sheet__section record-view-sheet__sort" aria-labelledby="record-view-sheet-sort">
          <h3 className="record-view-sheet__label" id="record-view-sheet-sort">Sort</h3>
          <RecordTableSortEditor />
        </section>

        {showGroup && (
          <section className="record-view-sheet__section record-view-sheet__group" aria-label="Group">
            <RecordTableGroupByEditor />
          </section>
        )}

        <DensitySection />
        {showDisplay && <RecordTableDisplayOptions variant="sheet" />}
        <FieldsSection />

        {actions && <div className="record-view-sheet__section record-view-sheet__page-actions">{actions}</div>}
      </div>
    </Modal>
  );
}

function LayoutSection<Id extends string>({
  viewTypeOptions,
  onChooseViewType,
  kanbanFields,
  calendarFields,
}: {
  viewTypeOptions: RecordTableViewTypeOption<Id>[];
  onChooseViewType: (id: Id) => void;
  kanbanFields: RecordField[];
  calendarFields: RecordField[];
}) {
  const viewType = useRecordTableState((s) => s.type);
  const kanbanFieldMetadataId = useRecordTableState((s) => s.kanbanFieldMetadataId);
  const calendarFieldMetadataId = useRecordTableState((s) => s.calendarFieldMetadataId);
  const handle = useRecordTableStoreHandle();
  const listActive = viewTypeOptions.some((option) => option.id === "list" && option.active);
  const isKanban = !listActive && (viewType === "kanban" || viewType === "board");
  const isCalendar = !listActive && viewType === "calendar";
  return (
    <section className="record-view-sheet__section" aria-labelledby="record-view-sheet-layout">
      <h3 className="record-view-sheet__label" id="record-view-sheet-layout">Layout</h3>
      <div
        className="record-table__density-options record-view-sheet__choices"
        role="radiogroup"
        aria-labelledby="record-view-sheet-layout"
        style={{ gridTemplateColumns: `repeat(${viewTypeOptions.length}, minmax(0, 1fr))` }}
      >
        {viewTypeOptions.map(({ id, Icon, label, short, active }) => (
          <button
            key={id}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={label}
            className={active ? "is-active" : ""}
            onClick={() => onChooseViewType(id)}
          >
            <Icon size={15} aria-hidden="true" />
            <span>{short}</span>
          </button>
        ))}
      </div>
      {isKanban && (
        <div className="record-view-sheet__field">
          <label className="record-table__menu-label" htmlFor="record-view-sheet-kanban-field">
            Kanban field
          </label>
          <select
            id="record-view-sheet-kanban-field"
            className="record-table__menu-select"
            value={kanbanFieldMetadataId ?? ""}
            onChange={(event) => handle.get().setKanbanFieldMetadataId(event.target.value || undefined)}
          >
            <option value="">Choose field...</option>
            {kanbanFields.map((column) => (
              <option key={column.fieldMetadataId} value={column.fieldMetadataId}>
                {column.field.label}
              </option>
            ))}
          </select>
        </div>
      )}
      {isCalendar && (
        <div className="record-view-sheet__field">
          <label className="record-table__menu-label" htmlFor="record-view-sheet-calendar-field">
            Calendar field
          </label>
          <select
            id="record-view-sheet-calendar-field"
            className="record-table__menu-select"
            value={calendarFieldMetadataId ?? ""}
            onChange={(event) => handle.get().setCalendarFieldMetadataId(event.target.value || undefined)}
          >
            <option value="">Choose date field...</option>
            {calendarFields.map((column) => (
              <option key={column.fieldMetadataId} value={column.fieldMetadataId}>
                {column.field.label}
              </option>
            ))}
          </select>
        </div>
      )}
    </section>
  );
}

function DensitySection() {
  const density = useRecordTableState((s) => s.density);
  const handle = useRecordTableStoreHandle();
  return (
    <section className="record-view-sheet__section" aria-labelledby="record-view-sheet-density">
      <h3 className="record-view-sheet__label" id="record-view-sheet-density">Density</h3>
      <div className="record-table__density-options record-view-sheet__choices" role="radiogroup" aria-labelledby="record-view-sheet-density">
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
    </section>
  );
}

function FieldsSection() {
  const columns = useRecordTableState((s) => s.columns);
  const handle = useRecordTableStoreHandle();
  const { objectMetadata } = useRecordTableContextOrThrow();
  return (
    <section className="record-view-sheet__section" aria-labelledby="record-view-sheet-fields">
      <h3 className="record-view-sheet__label record-table__menu-label--icon" id="record-view-sheet-fields">
        <Columns size={12} aria-hidden="true" /> Fields
      </h3>
      <div className="record-view-sheet__fields">
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
    </section>
  );
}
