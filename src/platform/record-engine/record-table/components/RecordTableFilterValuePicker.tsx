import { useEffect, useId, useMemo, useRef, useState, type FocusEvent, type KeyboardEvent, type ReactNode } from "react";
import { Check, X } from "lucide-react";
import type { RecordField, ViewFilterOperator } from "../../types";
import { useRecordTableState } from "../state/recordTableStore";
import { distinctFieldValues, searchDistinctValues, type DistinctFieldValue } from "../utils/distinctFieldValues";

/** Values listed at once; a search narrows the rest. */
const VISIBLE_VALUES = 100;

const formatCount = (value: number) => value.toLocaleString("en-CA");

export type FilterValuePatch = { operator?: ViewFilterOperator; text?: string; value?: unknown };

/**
 * The value editor of a free-text field's filter condition (a buyer, a
 * vendor, an email): the values found in the table's records, most common
 * first with their counts, searchable, with one or more picked for "is any
 * of" / "is none of". Typing still filters by "contains" (or the condition's
 * text operator); picking a value from there switches to "is any of".
 *
 * The list is worked out when the field first opens, from every loaded
 * record, and shows the first 100 matches. It returns the input (for the
 * condition's value cell) and the list (laid out across the whole condition
 * row, under it), so the list has room on narrow screens.
 */
export function useFilterValuePicker({
  enabled,
  column,
  operator,
  text,
  value,
  invalid,
  onChange,
}: {
  /** False for fields that use another editor; the hook then renders nothing. */
  enabled: boolean;
  column: RecordField | undefined;
  operator: ViewFilterOperator;
  text: string;
  value: unknown;
  invalid: boolean;
  onChange: (patch: FilterValuePatch) => void;
}): { control: ReactNode; panel: ReactNode } {
  const records = useRecordTableState((s) => s.records);
  const multi = operator === "in" || operator === "notIn";
  const picked = useMemo(() => (multi && Array.isArray(value) ? value.map(String) : []), [multi, value]);
  const [open, setOpen] = useState(false);
  // Computed lazily: nothing until the list first opens, then kept current
  // as more records arrive.
  const [wanted, setWanted] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const rootRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();

  const field = enabled ? column?.field : undefined;
  const values = useMemo<DistinctFieldValue[]>(
    () => (wanted && field ? distinctFieldValues(records, field) : []),
    [wanted, records, field],
  );
  const search = multi ? query : text;
  const { shown, matched } = useMemo(() => searchDistinctValues(values, search, VISIBLE_VALUES), [values, search]);
  const pickedSet = useMemo(() => new Set(picked.map((entry) => entry.toLowerCase())), [picked]);

  const show = () => {
    setWanted(true);
    setOpen(true);
  };
  const hide = () => {
    setOpen(false);
    setActiveIndex(-1);
  };
  // The list closes when focus or a click moves elsewhere, except to the
  // editor's own Apply / Cancel row: closing it there would move that row up
  // under the pointer before the click lands.
  const staysOpenFor = (target: EventTarget | null) =>
    target instanceof Element &&
    (rootRef.current?.contains(target) || panelRef.current?.contains(target) || Boolean(target.closest(".record-table__filter-popover-actions")));
  const onBlur = (event: FocusEvent) => {
    // No new focus (a click on something that takes none): the pointer handler decides.
    if (!event.relatedTarget || staysOpenFor(event.relatedTarget)) return;
    hide();
  };
  const staysOpenForRef = useRef(staysOpenFor);
  staysOpenForRef.current = staysOpenFor;
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (!staysOpenForRef.current(event.target)) hide();
    };
    window.addEventListener("pointerdown", onPointerDown, true);
    return () => window.removeEventListener("pointerdown", onPointerDown, true);
  }, [open]);

  const choose = (entry: DistinctFieldValue) => {
    if (multi) {
      const isPicked = pickedSet.has(entry.value.toLowerCase());
      onChange({ value: isPicked ? picked.filter((item) => item.toLowerCase() !== entry.value.toLowerCase()) : [...picked, entry.value] });
      return;
    }
    if (operator === "eq" || operator === "neq") {
      onChange({ text: entry.value });
      hide();
      return;
    }
    // From a text condition, a picked value becomes "is any of" (or "is none
    // of" from "doesn't contain"), with more to add.
    onChange({ operator: operator === "notContains" ? "notIn" : "in", value: [entry.value], text: "" });
    setQuery("");
    window.requestAnimationFrame(() => inputRef.current?.focus());
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) show();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => Math.max(-1, Math.min(shown.length - 1, current + step)));
    } else if (event.key === "Enter" && open && activeIndex >= 0 && shown[activeIndex]) {
      // Picks the highlighted value instead of applying the filters.
      event.preventDefault();
      choose(shown[activeIndex]);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      hide();
    } else if (event.key === "Backspace" && multi && !query && picked.length > 0) {
      onChange({ value: picked.slice(0, -1) });
    }
  };

  if (!field) return { control: null, panel: null };
  const activeId = open && activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;
  const control = (
    <div ref={rootRef} className="record-table__value-picker" onBlur={onBlur}>
      {multi && picked.length > 0 && (
        <div className="record-table__filter-multi">
          {picked.map((entry) => (
            <span key={entry} className="record-table__filter-multi-chip">
              <span className="record-table__filter-multi-label">{entry}</span>
              <button type="button" aria-label={`Remove ${entry}`} onClick={() => onChange({ value: picked.filter((item) => item !== entry) })}>
                <X size={11} />
              </button>
            </span>
          ))}
        </div>
      )}
      <input
        ref={inputRef}
        className="record-table__filter-input"
        type="text"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={multi ? "Search values" : "Filter value"}
        aria-invalid={invalid || undefined}
        placeholder={multi ? (picked.length ? "Add another…" : "Search values…") : "Type or pick a value…"}
        value={search}
        onFocus={show}
        onClick={show}
        onChange={(event) => {
          if (multi) setQuery(event.target.value);
          else onChange({ text: event.target.value });
          setActiveIndex(-1);
          if (!open) show();
        }}
        onKeyDown={onKeyDown}
      />
    </div>
  );

  const panel = open ? (
    <div ref={panelRef} className="record-table__value-list-wrap" onBlur={onBlur}>
      {!multi && text.trim() && (
        <div className="record-table__value-list-hint">
          Filtering by text. Pick a value below to match it exactly.
        </div>
      )}
      <div
        id={listId}
        className="record-table__value-list"
        role="listbox"
        aria-label={`${field.label} values`}
        aria-multiselectable={multi || undefined}
      >
        {shown.map((entry, index) => {
          const selected = multi && pickedSet.has(entry.value.toLowerCase());
          return (
            <button
              key={entry.search}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              className={`record-table__value-option${index === activeIndex ? " is-active" : ""}${selected ? " is-selected" : ""}`}
              // Keep focus (and the caret) in the input while picking.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => choose(entry)}
            >
              {multi && (
                <span className="record-table__value-check" aria-hidden="true">
                  {selected && <Check size={11} />}
                </span>
              )}
              <span className="record-table__value-label">{entry.label}</span>
              <span className="record-table__value-count">{formatCount(entry.count)}</span>
            </button>
          );
        })}
        {shown.length === 0 && (
          <div className="record-table__value-list-empty">
            {values.length === 0 ? "No values in these records." : "No values match."}
          </div>
        )}
      </div>
      {matched > shown.length && (
        <div className="record-table__value-list-more">
          Showing {formatCount(shown.length)} of {formatCount(matched)} values. Type to narrow the list.
        </div>
      )}
    </div>
  ) : null;

  return { control, panel };
}
