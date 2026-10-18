import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowDownUp, X } from "lucide-react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import type { RecordField, ViewFilter, ViewFilterGroup } from "../../types";
import { describeFilter } from "../utils/filterLabels";
import { childFilterGroups, removeFilter, removeFilterGroup, rootFilterGroup } from "../utils/filterTree";
import { useIsBottomSheet } from "../../../../lib/useSheetDrag";

type Chip = {
  key: string;
  label: string;
  /** Phones: the view's sort, which reopens the "View options" sheet. */
  sort?: boolean;
  /** Index in `filters` of the condition the editor should focus. */
  focusIndex: number;
  remove: () => void;
};

const MORE_BUTTON_RESERVE = 84;
const CHIP_GAP = 6;

function groupChipLabel(group: ViewFilterGroup, filters: ViewFilter[], filterGroups: ViewFilterGroup[], columns: RecordField[]): string {
  const columnFor = (id: string) => columns.find((column) => column.fieldMetadataId === id);
  const parts = [
    ...filters.filter((filter) => filter.viewFilterGroupId === group.id).map((filter) => describeFilter(filter, columnFor(filter.fieldMetadataId))),
    ...childFilterGroups(filterGroups, group.id).map((child) => `(${groupChipLabel(child, filters, filterGroups, columns)})`),
  ];
  return parts.join(group.logicalOperator === "or" ? " or " : " and ");
}

/**
 * Active filters as pills above the table body. A pill reopens the filter
 * editor on its condition; pills that do not fit on one line fold into
 * "+N more" (which opens the editor with everything).
 *
 * Phones also lead with the view's sort ("Sort: Last name ↑"), since the
 * toolbar folds Sort into its "View options" sheet; the pill opens that sheet.
 */
export function RecordTableFilterChips() {
  const filters = useRecordTableState((s) => s.filters);
  const filterGroups = useRecordTableState((s) => s.filterGroups);
  const columns = useRecordTableState((s) => s.columns);
  const sorts = useRecordTableState((s) => s.sorts);
  const isPhone = useIsBottomSheet();
  const handle = useRecordTableStoreHandle();
  const containerRef = useRef<HTMLDivElement>(null);
  const measureRef = useRef<HTMLDivElement>(null);
  const [visibleCount, setVisibleCount] = useState<number>(Number.POSITIVE_INFINITY);

  const chips = useMemo<Chip[]>(() => {
    const root = rootFilterGroup(filterGroups);
    const columnFor = (id: string) => columns.find((column) => column.fieldMetadataId === id);
    const update = (next: { filters: ViewFilter[]; filterGroups: ViewFilterGroup[] }) => handle.set(next);
    const topLevel = filters
      .map((filter, index) => ({ filter, index }))
      .filter(({ filter }) => !filter.viewFilterGroupId || !root || filter.viewFilterGroupId === root.id || !filterGroups.some((group) => group.id === filter.viewFilterGroupId));
    const result: Chip[] = topLevel.map(({ filter, index }) => ({
      key: filter.id ?? `${filter.fieldMetadataId}-${index}`,
      label: describeFilter(filter, columnFor(filter.fieldMetadataId)),
      focusIndex: index,
      remove: () => {
        const state = handle.get();
        update(removeFilter(state.filters, state.filterGroups, state.filters[index] ?? filter));
      },
    }));
    if (root) {
      for (const group of childFilterGroups(filterGroups, root.id)) {
        const firstIndex = filters.findIndex((filter) => filter.viewFilterGroupId === group.id);
        const label = groupChipLabel(group, filters, filterGroups, columns);
        if (!label) continue;
        result.push({
          key: group.id,
          label: `${group.logicalOperator === "or" ? "Any of" : "All of"}: ${label}`,
          focusIndex: Math.max(0, firstIndex),
          remove: () => {
            const state = handle.get();
            update(removeFilterGroup(state.filters, state.filterGroups, group.id));
          },
        });
      }
    }
    if (isPhone && sorts.length > 0) {
      const names = sorts.map((sort) => {
        const label = columnFor(sort.fieldMetadataId)?.field.label ?? "Field";
        return `${label} ${sort.direction === "desc" ? "↓" : "↑"}`;
      });
      result.unshift({
        key: "__sort",
        sort: true,
        label: `Sort: ${names.join(", ")}`,
        focusIndex: 0,
        remove: () => handle.get().setSorts([]),
      });
    }
    return result;
  }, [columns, filterGroups, filters, handle, isPhone, sorts]);
  const filterChipCount = chips.filter((chip) => !chip.sort).length;

  const rootOperator = rootFilterGroup(filterGroups)?.logicalOperator;
  // Room kept for "Clear all" (and the "Any of" prefix when shown).
  const tailWidth = (filterChipCount > 0 ? 76 : 0) + (rootOperator === "or" && filterChipCount > 1 ? 56 : 0);
  const signature = `${tailWidth}\u0000${chips.map((chip) => chip.label).join("\u0000")}`;
  useLayoutEffect(() => {
    const container = containerRef.current;
    const measure = measureRef.current;
    if (!container || !measure) return;
    const fit = () => {
      const available = container.clientWidth;
      const widths = Array.from(measure.children).map((child) => (child as HTMLElement).offsetWidth);
      let used = tailWidth;
      let count = 0;
      for (let index = 0; index < widths.length; index += 1) {
        const remaining = widths.length - index - 1;
        const next = used + widths[index] + CHIP_GAP;
        const reserve = remaining > 0 ? MORE_BUTTON_RESERVE : 0;
        if (next + reserve > available && count > 0) break;
        used = next;
        count += 1;
      }
      setVisibleCount((current) => (current === count ? current : count));
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(container);
    return () => observer.disconnect();
  }, [signature, tailWidth]);

  if (chips.length === 0) return null;

  const shown = chips.slice(0, Math.max(1, visibleCount));
  const firstFilterChip = chips.find((chip) => !chip.sort);
  const hiddenCount = chips.length - shown.length;

  return (
    <div className="record-table__chips" ref={containerRef} role="group" aria-label={filterChipCount > 0 ? "Active filters" : "Active sort"}>
      {shown.map((chip) => (
        <Fragment key={chip.key}>
          {/* "Any of" leads the filter pills (after a phone's sort pill). */}
          {chip === firstFilterChip && rootOperator === "or" && filterChipCount > 1 && <span className="record-table__chips-mode">Any of</span>}
          <span className={`record-table__chip${chip.sort ? " record-table__chip--sort" : ""}`}>
            <button
              type="button"
              className="record-table__chip-label"
              title={chip.sort ? `Change sort: ${chip.label}` : `Edit filter: ${chip.label}`}
              onClick={() => (chip.sort ? handle.get().requestViewOptions() : handle.get().requestFilterEditor(chip.focusIndex))}
            >
              {chip.sort && <ArrowDownUp size={11} aria-hidden="true" />}
              {chip.label}
            </button>
            <button
              type="button"
              className="record-table__chip-remove"
              onClick={chip.remove}
              aria-label={chip.sort ? `Remove sort: ${chip.label}` : `Remove filter: ${chip.label}`}
            >
              <X size={11} />
            </button>
          </span>
        </Fragment>
      ))}
      {hiddenCount > 0 && (
        <button
          type="button"
          className="record-table__chip-more"
          onClick={() => handle.get().requestFilterEditor()}
          aria-label={`${hiddenCount} more ${hiddenCount === 1 ? "filter" : "filters"}`}
          title={chips.slice(shown.length).map((chip) => chip.label).join("\n")}
        >
          +{hiddenCount} more
        </button>
      )}
      {filterChipCount > 0 && (
        <button
          type="button"
          className="record-table__chip-clear"
          onClick={() => handle.set({ filters: [], filterGroups: [] })}
        >
          Clear all
        </button>
      )}
      {/* Off-screen copy of every chip, measured to decide how many fit. */}
      <div ref={measureRef} className="record-table__chips-measure" aria-hidden="true">
        {chips.map((chip) => (
          <span key={chip.key} className="record-table__chip">
            <span className="record-table__chip-label">{chip.sort && <ArrowDownUp size={11} />}{chip.label}</span>
            <span className="record-table__chip-remove"><X size={11} /></span>
          </span>
        ))}
      </div>
    </div>
  );
}
