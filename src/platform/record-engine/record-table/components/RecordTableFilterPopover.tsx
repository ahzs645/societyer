import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from "react";
import { ListPlus, Plus, Trash2, X } from "lucide-react";
import { useRecordTableState, useRecordTableStoreHandle } from "../state/recordTableStore";
import { FIELD_TYPES, type RecordField, type ViewFilter, type ViewFilterGroup, type ViewFilterOperator } from "../../types";
import { Select } from "@/components/Select";
import { DatePicker } from "@/components/DatePicker";
import { DateRangePicker } from "@/components/DateRangePicker";
import { isOutsidePointerEvent } from "@/lib/floatingLayer";
import { isDateRangeValue, resolveDateRange, type DateRangeContext, type DateRangeValue } from "@/lib/dateRanges";
import { operatorLabel, operatorsForField } from "../utils/filterLabels";
import {
  VALUELESS_OPERATORS,
  isDateFieldType,
  isNumericFieldType,
  numericFilterInputText,
  parseNumericFilterInput,
} from "../utils/filterValues";
import { childFilterGroups, filterTreeSignature, rootFilterGroup } from "../utils/filterTree";
import { RecordTableAskFilter } from "./RecordTableAskFilter";

type DraftCondition = {
  id: string;
  groupId: string;
  fieldMetadataId: string;
  operator: ViewFilterOperator;
  /** Typed text for text / number / amount values. */
  text: string;
  /** Picked values: option key, ISO date, or a date range. */
  value: unknown;
};

type DraftGroup = { id: string; parentId: string | null; logicalOperator: "and" | "or" };

type Draft = { root: DraftGroup; groups: DraftGroup[]; conditions: DraftCondition[] };

let draftSeq = 0;
const nextId = (prefix: string) => `${prefix}_${Date.now().toString(36)}${(draftSeq += 1).toString(36)}`;

function blankCondition(groupId: string): DraftCondition {
  return { id: nextId("f"), groupId, fieldMetadataId: "", operator: "contains", text: "", value: "" };
}

function draftFromStore(filters: ViewFilter[], filterGroups: ViewFilterGroup[], columns: RecordField[]): Draft {
  const storedRoot = rootFilterGroup(filterGroups);
  const root: DraftGroup = {
    id: storedRoot?.id ?? nextId("fg"),
    parentId: null,
    logicalOperator: storedRoot?.logicalOperator ?? "and",
  };
  const groups: DraftGroup[] = [];
  const known = new Set([root.id]);
  // Breadth-first so a nested group always follows its parent.
  const queue = [root.id];
  while (queue.length > 0) {
    const parent = queue.shift()!;
    for (const group of childFilterGroups(filterGroups, parent)) {
      groups.push({ id: group.id, parentId: parent, logicalOperator: group.logicalOperator });
      known.add(group.id);
      queue.push(group.id);
    }
  }
  const conditions = filters.map((filter): DraftCondition => {
    const column = columns.find((entry) => entry.fieldMetadataId === filter.fieldMetadataId);
    const groupId = filter.viewFilterGroupId && known.has(filter.viewFilterGroupId) ? filter.viewFilterGroupId : root.id;
    const numeric = column && isNumericFieldType(column.field.fieldType);
    return {
      id: filter.id ?? nextId("f"),
      groupId,
      fieldMetadataId: filter.fieldMetadataId,
      operator: filter.operator,
      text: numeric ? numericFilterInputText(column.field, filter.value) : typeof filter.value === "string" ? filter.value : "",
      value: filter.value,
    };
  });
  if (conditions.length === 0) conditions.push(blankCondition(root.id));
  return { root, groups, conditions };
}

/** The stored value for a condition, or undefined while it is incomplete. */
function conditionValue(condition: DraftCondition, column: RecordField | undefined, dateContext: DateRangeContext): { ok: boolean; value: unknown } {
  if (!column) return { ok: false, value: undefined };
  if (VALUELESS_OPERATORS.includes(condition.operator)) return { ok: true, value: null };
  if (condition.operator === "between") {
    const range = isDateRangeValue(condition.value) ? condition.value : null;
    return range && resolveDateRange(range, dateContext) ? { ok: true, value: range } : { ok: false, value: undefined };
  }
  if (isMultiValueOperator(condition.operator)) {
    const values = Array.isArray(condition.value) ? condition.value.map(String).filter(Boolean) : [];
    return values.length > 0 ? { ok: true, value: values } : { ok: false, value: undefined };
  }
  if (isNumericFieldType(column.field.fieldType)) {
    const parsed = parseNumericFilterInput(column.field, condition.text);
    return parsed === undefined ? { ok: false, value: undefined } : { ok: true, value: parsed };
  }
  if (hasOptions(column) || isDateFieldType(column.field.fieldType)) {
    const picked = typeof condition.value === "string" ? condition.value : "";
    return picked ? { ok: true, value: picked } : { ok: false, value: undefined };
  }
  const text = condition.text.trim();
  return text ? { ok: true, value: text } : { ok: false, value: undefined };
}

function isMultiValueOperator(operator: ViewFilterOperator) {
  return operator === "in" || operator === "notIn";
}

/** Value kinds an operator switch must not carry across (range / list / single). */
function valueKind(operator: ViewFilterOperator) {
  if (operator === "between") return "range";
  return isMultiValueOperator(operator) ? "list" : "single";
}

function hasOptions(column: RecordField | undefined) {
  return Array.isArray(column?.field.config?.options) && column!.field.config.options.length > 0;
}

/**
 * Filter editor. Flat "match all / match any" conditions by default, with
 * "Add filter group" for a nested any-of / all-of block. Edits are drafted
 * and applied together (Apply or Enter), so a half-typed value never blanks
 * the table.
 *
 * Opened by the page's Filter button (`open`) or by a filter chip, which
 * asks through the table store and focuses that condition.
 */
export function RecordTableFilterPopover({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const request = useRecordTableState((s) => s.filterEditorRequest);
  const handle = useRecordTableStoreHandle();
  if (!open && !request) return null;
  const close = () => {
    handle.get().clearFilterEditorRequest();
    onClose();
  };
  return <FilterEditor key={request?.nonce ?? "toolbar"} focusIndex={request?.filterIndex} onClose={close} />;
}

function FilterEditor({ focusIndex, onClose }: { focusIndex?: number; onClose: () => void }) {
  const columns = useRecordTableState((s) => s.columns);
  const dateContext = useRecordTableState((s) => s.dateContext);
  const handle = useRecordTableStoreHandle();
  const popoverRef = useRef<HTMLDivElement>(null);
  const [draft, setDraft] = useState<Draft>(() => draftFromStore(handle.get().filters, handle.get().filterGroups, handle.get().columns));
  const [showErrors, setShowErrors] = useState(false);
  const focusId = focusIndex !== undefined ? draft.conditions[focusIndex]?.id : undefined;
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  useEffect(() => {
    const onPointerDown = (event: PointerEvent) => {
      // Field/operator Selects and the date pickers portal their menus to
      // <body>; picking an option there is not an outside click.
      if (!isOutsidePointerEvent(event, popoverRef)) return;
      onCloseRef.current();
    };
    window.addEventListener("pointerdown", onPointerDown);
    return () => window.removeEventListener("pointerdown", onPointerDown);
  }, []);

  useEffect(() => {
    if (!focusId) return;
    const row = popoverRef.current?.querySelector<HTMLElement>(`[data-condition-id="${focusId}"]`);
    row?.scrollIntoView({ block: "nearest" });
    row?.querySelector<HTMLElement>("input, button")?.focus({ preventScroll: true });
  }, [focusId]);

  const fieldOptions = useMemo(
    () => columns.map((column) => ({ value: column.fieldMetadataId, label: column.field.label })),
    [columns],
  );
  const columnFor = (fieldMetadataId: string) => columns.find((column) => column.fieldMetadataId === fieldMetadataId);

  const updateCondition = (id: string, patch: Partial<DraftCondition>) =>
    setDraft((current) => ({
      ...current,
      conditions: current.conditions.map((condition) => (condition.id === id ? { ...condition, ...patch } : condition)),
    }));

  const removeCondition = (id: string) =>
    setDraft((current) => {
      const removed = current.conditions.find((condition) => condition.id === id);
      let conditions = current.conditions.filter((condition) => condition.id !== id);
      let groups = current.groups;
      // An emptied nested group goes with its last condition.
      if (removed && removed.groupId !== current.root.id && !conditions.some((condition) => condition.groupId === removed.groupId)) {
        groups = groups.filter((group) => group.id !== removed.groupId);
      }
      if (conditions.length === 0) conditions = [blankCondition(current.root.id)];
      return { ...current, groups, conditions };
    });

  const addCondition = (groupId: string) =>
    setDraft((current) => ({ ...current, conditions: [...current.conditions, blankCondition(groupId)] }));

  const addGroup = () =>
    setDraft((current) => {
      const group: DraftGroup = { id: nextId("fg"), parentId: current.root.id, logicalOperator: "or" };
      return { ...current, groups: [...current.groups, group], conditions: [...current.conditions, blankCondition(group.id)] };
    });

  const removeGroup = (groupId: string) =>
    setDraft((current) => {
      const conditions = current.conditions.filter((condition) => condition.groupId !== groupId);
      return {
        ...current,
        groups: current.groups.filter((group) => group.id !== groupId && group.parentId !== groupId),
        conditions: conditions.length > 0 ? conditions : [blankCondition(current.root.id)],
      };
    });

  const setGroupOperator = (groupId: string, logicalOperator: "and" | "or") =>
    setDraft((current) =>
      groupId === current.root.id
        ? { ...current, root: { ...current.root, logicalOperator } }
        : { ...current, groups: current.groups.map((group) => (group.id === groupId ? { ...group, logicalOperator } : group)) },
    );

  const evaluated = draft.conditions.map((condition) => ({
    condition,
    column: columnFor(condition.fieldMetadataId),
    result: conditionValue(condition, columnFor(condition.fieldMetadataId), dateContext),
  }));
  const incomplete = evaluated.filter(({ condition, result }) => condition.fieldMetadataId && !result.ok);

  const apply = () => {
    if (incomplete.length > 0) {
      setShowErrors(true);
      return;
    }
    const complete = evaluated.filter(({ result }) => result.ok);
    const usedGroups = new Set(complete.map(({ condition }) => condition.groupId));
    // Keep parents of used groups.
    for (const group of [...draft.groups].reverse()) {
      if (usedGroups.has(group.id) && group.parentId) usedGroups.add(group.parentId);
    }
    const positions = new Map<string, number>();
    const filters: ViewFilter[] = complete.map(({ condition, result }) => {
      const position = positions.get(condition.groupId) ?? 0;
      positions.set(condition.groupId, position + 1);
      return {
        id: condition.id,
        fieldMetadataId: condition.fieldMetadataId,
        operator: condition.operator,
        value: result.value,
        viewFilterGroupId: condition.groupId,
        positionInViewFilterGroup: position,
      };
    });
    const filterGroups: ViewFilterGroup[] = filters.length === 0
      ? []
      : [
          { id: draft.root.id, logicalOperator: draft.root.logicalOperator, parentViewFilterGroupId: null, positionInViewFilterGroup: 0 },
          ...draft.groups
            .filter((group) => usedGroups.has(group.id))
            .map((group, index) => ({
              id: group.id,
              logicalOperator: group.logicalOperator,
              parentViewFilterGroupId: group.parentId,
              positionInViewFilterGroup: index + 1,
            })),
        ];
    const state = handle.get();
    // Re-applying the same conditions must not mark the view as changed.
    if (filterTreeSignature(filters, filterGroups) !== filterTreeSignature(state.filters, state.filterGroups)) {
      handle.set({ filters, filterGroups });
    }
    onClose();
  };

  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape" && !event.defaultPrevented) {
      event.preventDefault();
      onClose();
    } else if (event.key === "Enter" && event.target instanceof HTMLInputElement && !event.defaultPrevented) {
      event.preventDefault();
      apply();
    }
  };

  const renderConditions = (groupId: string) =>
    evaluated
      .filter(({ condition }) => condition.groupId === groupId)
      .map(({ condition, column, result }) => (
        <ConditionRow
          key={condition.id}
          condition={condition}
          column={column}
          fieldOptions={fieldOptions}
          dateContext={dateContext}
          invalid={showErrors && !!condition.fieldMetadataId && !result.ok}
          highlighted={condition.id === focusId}
          onChange={(patch) => updateCondition(condition.id, patch)}
          onRemove={() => removeCondition(condition.id)}
          defaultOperator={(fieldMetadataId) => operatorsForField(columnFor(fieldMetadataId)?.field.fieldType)[0] ?? "contains"}
        />
      ));

  const nestedGroups = draft.groups.filter((group) => group.parentId === draft.root.id);
  const conditionCount = draft.conditions.filter((condition) => condition.fieldMetadataId).length;

  return (
    <div ref={popoverRef} className="record-table__filter-popover" role="group" aria-label="Filters" onKeyDown={onKeyDown}>
      <RecordTableAskFilter onApplied={onClose} onEditAsFilters={(tree) => setDraft(draftFromStore(tree.filters, tree.filterGroups, handle.get().columns))} />
      <div className="record-table__popover-head">
        <strong>Filters</strong>
        <LogicalOperatorSelect
          value={draft.root.logicalOperator}
          onChange={(value) => setGroupOperator(draft.root.id, value)}
          labels={{ and: "Match all", or: "Match any" }}
          aria-label="How conditions combine"
          disabled={conditionCount + nestedGroups.length < 2}
        />
      </div>
      <div className="record-table__filter-conditions">
        {renderConditions(draft.root.id)}
        {nestedGroups.map((group) => (
          <div key={group.id} className="record-table__filter-group" role="group" aria-label="Filter group">
            <div className="record-table__filter-group-head">
              <LogicalOperatorSelect
                value={group.logicalOperator}
                onChange={(value) => setGroupOperator(group.id, value)}
                labels={{ and: "All of these", or: "Any of these" }}
                aria-label="How this group's conditions combine"
              />
              <button type="button" className="record-table__icon-btn" aria-label="Remove filter group" title="Remove group" onClick={() => removeGroup(group.id)}>
                <Trash2 size={13} />
              </button>
            </div>
            {renderConditions(group.id)}
            <button type="button" className="record-table__filter-add record-table__filter-add--nested" onClick={() => addCondition(group.id)}>
              <Plus size={12} /> Add condition
            </button>
          </div>
        ))}
      </div>
      <div className="record-table__filter-popover-actions">
        <div className="record-table__filter-add-row">
          <button type="button" className="record-table__filter-add" onClick={() => addCondition(draft.root.id)}>
            <Plus size={12} /> Add filter
          </button>
          <button type="button" className="record-table__filter-add" onClick={addGroup}>
            <ListPlus size={12} /> Add filter group
          </button>
        </div>
        {showErrors && incomplete.length > 0 && (
          <span className="record-table__filter-error" role="alert">
            Finish or remove the highlighted {incomplete.length === 1 ? "condition" : "conditions"}.
          </span>
        )}
        <div className="record-table__filter-submit">
          <button type="button" className="record-table__secondary-btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="record-table__primary-btn" onClick={apply}>
            Apply
          </button>
        </div>
      </div>
    </div>
  );
}

function LogicalOperatorSelect({
  value,
  onChange,
  labels,
  disabled,
  "aria-label": ariaLabel,
}: {
  value: "and" | "or";
  onChange: (value: "and" | "or") => void;
  labels: { and: string; or: string };
  disabled?: boolean;
  "aria-label": string;
}) {
  return (
    <select
      className="record-table__menu-select record-table__logic-select"
      value={value}
      disabled={disabled}
      aria-label={ariaLabel}
      onChange={(event) => onChange(event.target.value === "or" ? "or" : "and")}
    >
      <option value="and">{labels.and}</option>
      <option value="or">{labels.or}</option>
    </select>
  );
}

function ConditionRow({
  condition,
  column,
  fieldOptions,
  dateContext,
  invalid,
  highlighted,
  onChange,
  onRemove,
  defaultOperator,
}: {
  condition: DraftCondition;
  column: RecordField | undefined;
  fieldOptions: { value: string; label: string }[];
  defaultOperator: (fieldMetadataId: string) => ViewFilterOperator;
  dateContext: DateRangeContext;
  invalid: boolean;
  highlighted: boolean;
  onChange: (patch: Partial<DraftCondition>) => void;
  onRemove: () => void;
}) {
  const fieldType = column?.field.fieldType;
  const baseOperators = operatorsForField(fieldType);
  // A saved view may use an operator this editor does not offer for the
  // field; keep it selectable so the condition round-trips unchanged.
  const operators = condition.fieldMetadataId && !baseOperators.includes(condition.operator)
    ? [condition.operator, ...baseOperators]
    : baseOperators;
  const valueless = VALUELESS_OPERATORS.includes(condition.operator);
  const options = hasOptions(column)
    ? (column!.field.config.options as { value: string; label: string; color?: any }[]).map((option) => ({
        value: String(option.value),
        label: String(option.label ?? option.value),
      }))
    : [];
  const isCurrency = fieldType === FIELD_TYPES.CURRENCY;

  let valueControl: ReactNode = null;
  if (column && !valueless) {
    if (condition.operator === "between") {
      valueControl = (
        <DateRangePicker
          size="sm"
          value={isDateRangeValue(condition.value) ? (condition.value as DateRangeValue) : null}
          onChange={(range) => onChange({ value: range ?? "" })}
          context={dateContext}
          placeholder="Choose a range…"
          aria-label="Date range"
          clearable={false}
        />
      );
    } else if (options.length > 0 && isMultiValueOperator(condition.operator)) {
      const picked = Array.isArray(condition.value) ? condition.value.map(String) : [];
      const labelFor = (value: string) => options.find((option) => option.value === value)?.label ?? value;
      valueControl = (
        <div className="record-table__filter-multi">
          {picked.map((value) => (
            <span key={value} className="record-table__filter-multi-chip">
              {labelFor(value)}
              <button
                type="button"
                aria-label={`Remove ${labelFor(value)}`}
                onClick={() => onChange({ value: picked.filter((entry) => entry !== value) })}
              >
                <X size={11} />
              </button>
            </span>
          ))}
          <Select
            size="sm"
            value=""
            onChange={(value) => onChange({ value: [...picked, value] })}
            placeholder={picked.length ? "Add…" : "Choose values…"}
            searchable={options.length > 8}
            aria-label="Filter values"
            options={options.filter((option) => !picked.includes(option.value))}
          />
        </div>
      );
    } else if (options.length > 0) {
      valueControl = (
        <Select
          size="sm"
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={(value) => onChange({ value })}
          placeholder="Choose…"
          searchable={options.length > 8}
          aria-label="Filter value"
          options={options}
        />
      );
    } else if (fieldType && isDateFieldType(fieldType)) {
      valueControl = (
        <DatePicker
          size="sm"
          value={typeof condition.value === "string" ? condition.value : ""}
          onChange={(value) => onChange({ value })}
          placeholder="Pick a date"
        />
      );
    } else {
      const numeric = fieldType ? isNumericFieldType(fieldType) : false;
      valueControl = (
        <input
          className="record-table__filter-input"
          type="text"
          inputMode={numeric ? "decimal" : undefined}
          placeholder={isCurrency ? "e.g. 1.5k, $2,000, (300)" : numeric ? "Number" : "Value…"}
          aria-label="Filter value"
          aria-invalid={invalid || undefined}
          value={condition.text}
          onChange={(event) => onChange({ text: event.target.value })}
        />
      );
    }
  }

  return (
    <div
      className={`record-table__filter-popover-row${invalid ? " is-invalid" : ""}${highlighted ? " is-highlighted" : ""}`}
      data-condition-id={condition.id}
    >
      <Select
        size="sm"
        placeholder="Choose field…"
        value={condition.fieldMetadataId}
        onChange={(fieldMetadataId) => {
          if (fieldMetadataId === condition.fieldMetadataId) return;
          onChange({ fieldMetadataId, operator: defaultOperator(fieldMetadataId), text: "", value: "" });
        }}
        options={fieldOptions}
        searchable={fieldOptions.length > 6}
      />
      <Select
        size="sm"
        value={condition.fieldMetadataId ? condition.operator : ""}
        placeholder="Condition"
        aria-label="Filter condition"
        onChange={(value) => {
          const operator = value as ViewFilterOperator;
          // Ranges, value lists and single values hold different shapes.
          const kind = valueKind(operator);
          const previous = valueKind(condition.operator);
          if (kind === previous) onChange({ operator });
          else if (kind === "list" && typeof condition.value === "string" && condition.value) onChange({ operator, value: [condition.value] });
          else if (previous === "list" && kind === "single" && Array.isArray(condition.value) && condition.value.length) onChange({ operator, value: String(condition.value[0]) });
          else onChange({ operator, value: "", text: "" });
        }}
        options={operators.map((operator) => ({ value: operator, label: operatorLabel(operator, fieldType) }))}
        disabled={!column}
      />
      <div className="record-table__filter-value">{valueControl}</div>
      <button type="button" className="record-table__icon-btn" aria-label="Remove condition" title="Remove" onClick={onRemove}>
        <X size={13} />
      </button>
    </div>
  );
}
