import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { Check, Filter } from "lucide-react";
import { Select } from "../../../../components/Select";
import { DatePicker } from "../../../../components/DatePicker";
import { FIELD_TYPES, type FieldMetadata, type RecordField, type SelectOption, type ViewFilter, type ViewFilterOperator } from "../../types";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { useCoarsePointer } from "../hooks/useCoarsePointer";
import {
  distinctFieldValues,
  optionFieldValues,
  searchDistinctValues,
  supportsValuePicker,
  type DistinctFieldValue,
} from "../utils/distinctFieldValues";
import { isDateFieldType, isNumericFieldType, numericFilterInputText, parseNumericFilterInput } from "../utils/filterValues";
import { describeFilter, operatorLabel } from "../utils/filterLabels";
import { columnFilters, withColumnFilter, type ColumnFilterValue } from "../utils/columnFilter";

/** Values listed at once; typing narrows the rest. */
const VISIBLE_VALUES = 100;
/** Typed text filters the table after this pause, not on every key. */
const TYPING_DELAY_MS = 200;

type FilterKind = "values" | "number" | "date" | "boolean" | "text";

const NUMBER_OPERATORS: ViewFilterOperator[] = ["eq", "neq", "gt", "gte", "lt", "lte", "isEmpty", "isNotEmpty"];
const DATE_OPERATORS: ViewFilterOperator[] = ["eq", "lt", "gt", "isEmpty", "isNotEmpty"];
const VALUELESS: ViewFilterOperator[] = ["isEmpty", "isNotEmpty"];

const formatCount = (value: number) => value.toLocaleString("en-CA");

function fieldOptions(field: FieldMetadata): SelectOption[] {
  return Array.isArray(field.config?.options) ? (field.config.options as SelectOption[]) : [];
}

function filterKind(field: FieldMetadata): FilterKind {
  if (field.fieldType === FIELD_TYPES.BOOLEAN) return "boolean";
  if (isNumericFieldType(field.fieldType)) return "number";
  if (isDateFieldType(field.fieldType)) return "date";
  if (fieldOptions(field).length > 0 || supportsValuePicker(field)) return "values";
  return "text";
}

/** Whether the menu can show (and so edit) a condition, or only replace it. */
function representable(kind: FilterKind, filter: ViewFilter, hasOptions: boolean): boolean {
  switch (kind) {
    case "values":
      return ["in", "notIn", "eq", "neq"].includes(filter.operator) || (!hasOptions && ["contains", "notContains"].includes(filter.operator));
    case "number":
      return NUMBER_OPERATORS.includes(filter.operator);
    case "date":
      return DATE_OPERATORS.includes(filter.operator);
    case "boolean":
      return filter.operator === "isTrue" || filter.operator === "isFalse";
    default:
      return filter.operator === "contains";
  }
}

type Commit = (next: ColumnFilterValue | null, options?: { delay?: boolean }) => void;

type EditorProps = {
  recordField: RecordField;
  /** The column's condition as the menu opened, when it can show it. */
  initial: ViewFilter | undefined;
  /** Set the column's condition now, or after a typing pause. */
  commit: Commit;
  /** Close the column menu (Enter in a text box). */
  onDone: () => void;
  autoFocus: boolean;
};

/**
 * The column menu's filter. It edits the column's one top-level condition
 * and applies as you go: ticking a value, choosing a condition or pausing
 * while typing updates the table behind the menu.
 *
 * Text, relations and selects list the values found in the records with how
 * many rows carry each (Excel's and Google Sheets' "filter by values").
 * Typing narrows that list and, until a value is ticked, filters rows that
 * contain the text. Numbers, dates and yes/no fields get a condition and a
 * value instead.
 */
export function RecordTableHeaderFilter({ recordField, onDone }: { recordField: RecordField; onDone: () => void }) {
  const handle = useRecordTableStoreHandle();
  const filters = useRecordTableState((s) => s.filters);
  const filterGroups = useRecordTableState((s) => s.filterGroups);
  const coarse = useCoarsePointer();
  const field = recordField.field;
  const kind = filterKind(field);
  const active = useMemo(
    () => columnFilters(filters, filterGroups, recordField.fieldMetadataId),
    [filters, filterGroups, recordField.fieldMetadataId],
  );
  // Read once: while the menu is open the editor's own state leads, and the
  // store follows it.
  const [opened] = useState(() => active);
  const [resetKey, setResetKey] = useState(0);
  const editable = opened[0] && representable(kind, opened[0], fieldOptions(field).length > 0) ? opened[0] : undefined;
  const replaced = resetKey === 0 && opened.length > 0 && (!editable || opened.length > 1) ? opened : [];

  const apply = useCallback(
    (next: ColumnFilterValue | null) => {
      const state = handle.get();
      handle.set(withColumnFilter(state.filters, state.filterGroups, recordField.fieldMetadataId, next));
    },
    [handle, recordField.fieldMetadataId],
  );
  const commit = useCommit(apply);
  const clear = () => {
    // Also drops a typed change still waiting to apply.
    commit(null);
    setResetKey((key) => key + 1);
  };

  const editorProps: EditorProps = {
    recordField,
    initial: resetKey === 0 ? editable : undefined,
    commit,
    onDone,
    // A phone keyboard covering the menu is worse than one more tap.
    autoFocus: !coarse,
  };

  return (
    <div className="record-table__header-menu-section record-table__header-filter" role="group" aria-label={`Filter ${field.label}`}>
      <div className="record-table__header-filter-head">
        <span className="record-table__header-filter-title">
          <Filter size={13} aria-hidden="true" />
          Filter
        </span>
        {active.length > 0 && (
          <button type="button" className="record-table__header-filter-clear" onClick={clear}>
            Clear
          </button>
        )}
      </div>
      {replaced.length > 0 && (
        <p className="record-table__header-filter-note">
          Now: {replaced.map((filter) => describeFilter(filter, recordField)).join("; ")}. A new choice replaces it.
        </p>
      )}
      {kind === "values" && <ValuesFilter key={resetKey} {...editorProps} />}
      {kind === "number" && <NumberFilter key={resetKey} {...editorProps} />}
      {kind === "date" && <DateFilter key={resetKey} {...editorProps} />}
      {kind === "boolean" && <BooleanFilter key={resetKey} {...editorProps} />}
      {kind === "text" && <TextFilter key={resetKey} {...editorProps} />}
    </div>
  );
}

/**
 * Applies at once, or after a typing pause. A pending change is applied
 * (not dropped) when the menu closes first.
 */
function useCommit(apply: (next: ColumnFilterValue | null) => void): Commit {
  const applyRef = useRef(apply);
  applyRef.current = apply;
  const pending = useRef<{ timer: number; next: ColumnFilterValue | null } | null>(null);
  const flush = useCallback(() => {
    const current = pending.current;
    if (!current) return;
    window.clearTimeout(current.timer);
    pending.current = null;
    applyRef.current(current.next);
  }, []);
  useEffect(() => flush, [flush]);
  return useCallback((next, { delay = false } = {}) => {
    if (pending.current) window.clearTimeout(pending.current.timer);
    pending.current = null;
    if (!delay) {
      applyRef.current(next);
      return;
    }
    pending.current = { timer: window.setTimeout(flush, TYPING_DELAY_MS), next };
  }, [flush]);
}

function ValuesFilter({ recordField, initial, commit, onDone, autoFocus }: EditorProps) {
  const field = recordField.field;
  const records = useRecordTableState((s) => s.records);
  const options = useMemo(() => fieldOptions(field), [field]);
  const canContain = options.length === 0;
  const values = useMemo<DistinctFieldValue[]>(
    () => (options.length > 0 ? optionFieldValues(records, field, options) : distinctFieldValues(records, field)),
    [records, field, options],
  );
  const listId = useId();

  const [picked, setPicked] = useState<string[]>(() => {
    if (!initial) return [];
    if (initial.operator === "in" || initial.operator === "notIn") return Array.isArray(initial.value) ? initial.value.map(String) : [];
    if (initial.operator === "eq" || initial.operator === "neq") return initial.value == null || initial.value === "" ? [] : [String(initial.value)];
    return [];
  });
  const [exclude, setExclude] = useState(() => initial?.operator === "notIn" || initial?.operator === "neq" || initial?.operator === "notContains");
  const [text, setText] = useState(() =>
    initial && (initial.operator === "contains" || initial.operator === "notContains") ? String(initial.value ?? "") : "",
  );
  const [activeIndex, setActiveIndex] = useState(-1);
  const pickedSet = useMemo(() => new Set(picked.map((value) => value.toLowerCase())), [picked]);
  const { shown, matched } = useMemo(() => searchDistinctValues(values, text, VISIBLE_VALUES), [values, text]);

  const filterFor = (nextPicked: string[], nextExclude: boolean, nextText: string): ColumnFilterValue | null => {
    if (nextPicked.length > 0) return { operator: nextExclude ? "notIn" : "in", value: nextPicked };
    const typed = nextText.trim();
    if (canContain && typed) return { operator: nextExclude ? "notContains" : "contains", value: typed };
    return null;
  };

  const toggle = (entry: DistinctFieldValue) => {
    const key = entry.value.toLowerCase();
    const next = pickedSet.has(key) ? picked.filter((value) => value.toLowerCase() !== key) : [...picked, entry.value];
    setPicked(next);
    commit(filterFor(next, exclude, text));
  };
  const setMode = (nextExclude: boolean) => {
    if (nextExclude === exclude) return;
    setExclude(nextExclude);
    commit(filterFor(picked, nextExclude, text));
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const step = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => Math.max(-1, Math.min(shown.length - 1, current + step)));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (activeIndex >= 0 && shown[activeIndex]) {
        toggle(shown[activeIndex]);
        return;
      }
      // Nothing highlighted: apply what is typed now and close.
      commit(filterFor(picked, exclude, text));
      onDone();
    }
  };

  const typed = text.trim();
  const filtersByText = canContain && typed !== "" && picked.length === 0;
  const activeId = activeIndex >= 0 ? `${listId}-${activeIndex}` : undefined;

  return (
    <>
      <input
        className="record-table__filter-input"
        type="text"
        role="combobox"
        aria-expanded
        aria-controls={listId}
        aria-autocomplete="list"
        aria-activedescendant={activeId}
        aria-label={`${field.label} filter value`}
        placeholder={canContain ? "Type to filter or find a value…" : `Find a ${field.label.toLowerCase()}…`}
        data-autofocus={autoFocus || undefined}
        value={text}
        onChange={(event) => {
          const next = event.target.value;
          setText(next);
          setActiveIndex(-1);
          // With values ticked, typing only searches the list.
          if (picked.length === 0 && canContain) commit(filterFor([], exclude, next), { delay: true });
        }}
        onKeyDown={onKeyDown}
      />
      {(picked.length > 0 || filtersByText) && (
        <div className="record-table__menu-segmented" role="group" aria-label="Match">
          <button type="button" aria-pressed={!exclude} onClick={() => setMode(false)}>
            {filtersByText ? "Contains" : "Only these"}
          </button>
          <button type="button" aria-pressed={exclude} onClick={() => setMode(true)}>
            {filtersByText ? "Doesn't contain" : "All but these"}
          </button>
          {picked.length > 0 && <span className="record-table__header-filter-count">{formatCount(picked.length)} picked</span>}
        </div>
      )}
      {filtersByText && values.length > 0 && (
        <p className="record-table__value-list-hint">Tick values below to match them exactly instead.</p>
      )}
      <div
        id={listId}
        className="record-table__value-list"
        role="listbox"
        aria-label={`${field.label} values`}
        aria-multiselectable
      >
        {shown.map((entry, index) => {
          const selected = pickedSet.has(entry.value.toLowerCase());
          return (
            <button
              key={entry.search}
              id={`${listId}-${index}`}
              type="button"
              role="option"
              aria-selected={selected}
              tabIndex={-1}
              className={`record-table__value-option${index === activeIndex ? " is-active" : ""}${selected ? " is-selected" : ""}${entry.count === 0 ? " is-unused" : ""}`}
              // Keep the caret in the search box while ticking values.
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => toggle(entry)}
            >
              <span className="record-table__value-check" aria-hidden="true">
                {selected && <Check size={11} />}
              </span>
              <span className="record-table__value-label">{entry.label}</span>
              <span className="record-table__value-count">{formatCount(entry.count)}</span>
            </button>
          );
        })}
        {shown.length === 0 && (
          <div className="record-table__value-list-empty">
            {values.length === 0 ? "No values in these records." : canContain ? `No exact values match. Rows containing “${typed}” are shown.` : "No values match."}
          </div>
        )}
      </div>
      {matched > shown.length && (
        <p className="record-table__value-list-more">
          Showing {formatCount(shown.length)} of {formatCount(matched)}. Type to narrow the list.
        </p>
      )}
    </>
  );
}

function NumberFilter({ recordField, initial, commit, onDone, autoFocus }: EditorProps) {
  const field = recordField.field;
  const [operator, setOperator] = useState<ViewFilterOperator>(initial?.operator ?? "eq");
  const [text, setText] = useState(() => (initial ? numericFilterInputText(field, initial.value) : ""));
  const valueless = VALUELESS.includes(operator);
  const parsed = parseNumericFilterInput(field, text);
  const invalid = !valueless && text.trim() !== "" && parsed === undefined;

  const filterFor = (nextOperator: ViewFilterOperator, nextText: string): ColumnFilterValue | null => {
    if (VALUELESS.includes(nextOperator)) return { operator: nextOperator, value: null };
    const value = parseNumericFilterInput(field, nextText);
    return value === undefined ? null : { operator: nextOperator, value };
  };

  return (
    <div className="record-table__header-filter-row">
      <Select
        size="sm"
        aria-label={`${field.label} filter condition`}
        value={operator}
        onChange={(next) => {
          setOperator(next);
          commit(filterFor(next, text));
        }}
        options={NUMBER_OPERATORS.map((value) => ({ value, label: capitalize(operatorLabel(value, field.fieldType)) }))}
      />
      {!valueless && (
        <input
          className="record-table__filter-input"
          aria-label={`${field.label} filter value`}
          aria-invalid={invalid || undefined}
          type="text"
          inputMode="decimal"
          placeholder={field.fieldType === FIELD_TYPES.CURRENCY ? "e.g. 1.5k" : "Number"}
          data-autofocus={autoFocus || undefined}
          value={text}
          onChange={(event) => {
            setText(event.target.value);
            const next = filterFor(operator, event.target.value);
            // Half-typed input ("1.") keeps the last good filter.
            if (next || event.target.value.trim() === "") commit(next, { delay: true });
          }}
          onKeyDown={(event) => {
            if (event.key !== "Enter") return;
            event.preventDefault();
            commit(filterFor(operator, text));
            onDone();
          }}
        />
      )}
    </div>
  );
}

function DateFilter({ recordField, initial, commit }: EditorProps) {
  const field = recordField.field;
  const [operator, setOperator] = useState<ViewFilterOperator>(initial?.operator ?? "eq");
  const [value, setValue] = useState(() => (typeof initial?.value === "string" ? initial.value : ""));
  const valueless = VALUELESS.includes(operator);
  const filterFor = (nextOperator: ViewFilterOperator, nextValue: string): ColumnFilterValue | null => {
    if (VALUELESS.includes(nextOperator)) return { operator: nextOperator, value: null };
    return nextValue ? { operator: nextOperator, value: nextValue } : null;
  };

  return (
    <div className="record-table__header-filter-row">
      <Select
        size="sm"
        aria-label={`${field.label} filter condition`}
        value={operator}
        onChange={(next) => {
          setOperator(next);
          commit(filterFor(next, value));
        }}
        options={DATE_OPERATORS.map((entry) => ({ value: entry, label: capitalize(operatorLabel(entry, field.fieldType)) }))}
      />
      {!valueless && (
        <DatePicker
          size="sm"
          value={value}
          onChange={(next) => {
            setValue(next);
            commit(filterFor(operator, next));
          }}
          placeholder="Pick a date"
        />
      )}
    </div>
  );
}

function BooleanFilter({ recordField, initial, commit }: EditorProps) {
  const field = recordField.field;
  const [operator, setOperator] = useState<ViewFilterOperator | null>(initial?.operator ?? null);
  const choices: { operator: ViewFilterOperator | null; label: string }[] = [
    { operator: null, label: "Any" },
    { operator: "isTrue", label: String(field.config?.trueLabel ?? "Yes") },
    { operator: "isFalse", label: String(field.config?.falseLabel ?? "No") },
  ];
  return (
    <div className="record-table__menu-segmented" role="group" aria-label={`${field.label} filter`}>
      {choices.map((choice) => (
        <button
          key={choice.label}
          type="button"
          aria-pressed={operator === choice.operator}
          onClick={() => {
            setOperator(choice.operator);
            commit(choice.operator ? { operator: choice.operator, value: null } : null);
          }}
        >
          {choice.label}
        </button>
      ))}
    </div>
  );
}

function TextFilter({ recordField, initial, commit, onDone, autoFocus }: EditorProps) {
  const field = recordField.field;
  const [text, setText] = useState(() => (initial ? String(initial.value ?? "") : ""));
  const filterFor = (next: string): ColumnFilterValue | null => (next.trim() ? { operator: "contains", value: next.trim() } : null);
  return (
    <input
      className="record-table__filter-input"
      type="text"
      aria-label={`${field.label} filter value`}
      placeholder="Contains…"
      data-autofocus={autoFocus || undefined}
      value={text}
      onChange={(event) => {
        setText(event.target.value);
        commit(filterFor(event.target.value), { delay: true });
      }}
      onKeyDown={(event) => {
        if (event.key !== "Enter") return;
        event.preventDefault();
        commit(filterFor(text));
        onDone();
      }}
    />
  );
}

function capitalize(text: string) {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
