import { ReactNode, useRef, useState, useEffect } from "react";
import { X } from "lucide-react";
import { MenuRow, MenuSectionLabel } from "./ui";
import { Select } from "./Select";

function readCssPx(name: string, fallback: number): number {
  if (typeof window === "undefined") return fallback;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name);
  const n = parseFloat(raw);
  return Number.isFinite(n) ? n : fallback;
}

export type FilterOperator =
  | "contains"
  | "equals"
  | "is"
  | "is_not"
  | "starts_with"
  | "lt"
  | "gt"
  | "before"
  | "after"
  | "between";

/** Default chip labels per operator — keep short so chips stay compact. */
export const OPERATOR_LABELS: Record<FilterOperator, string> = {
  contains: "contains",
  equals: "equals",
  is: "is",
  is_not: "is not",
  starts_with: "starts with",
  lt: "<",
  gt: ">",
  before: "before",
  after: "after",
  between: "between",
};

export type FilterField<T = any> = {
  id: string;
  label: string;
  icon?: ReactNode;
  /** Given the record and a query string, decide if the record matches. */
  match: (record: T, query: string) => boolean;
  /** Optional list of preset values. If supplied, the popover shows a select instead of free-text. */
  options?: string[];
  /** Operators the user can pick in the popover. If omitted, we default to
   * `is` for options fields and `contains` for free-text fields. */
  operators?: FilterOperator[];
  /** Per-operator matcher. Falls back to `match` when omitted. */
  matchWithOp?: (record: T, operator: FilterOperator, value: string) => boolean;
};

export type AppliedFilter = {
  fieldId: string;
  value: string;
  operator?: FilterOperator;
};

/** Node in an advanced filter tree — either a leaf rule or a logical group. */
export type FilterRuleNode =
  | { kind: "rule"; rule: AppliedFilter }
  | { kind: "group"; group: FilterGroup };

export type FilterGroup = {
  op: "and" | "or";
  rules: FilterRuleNode[];
};

export function evaluateGroup<T>(
  record: T,
  group: FilterGroup,
  fields: FilterField<T>[],
): boolean {
  const results = group.rules.map((node) => {
    if (node.kind === "group") return evaluateGroup(record, node.group, fields);
    const field = fields.find((f) => f.id === node.rule.fieldId);
    if (!field) return true; // unknown field — ignore so we don't filter everything out
    if (node.rule.operator && field.matchWithOp) {
      return field.matchWithOp(record, node.rule.operator, node.rule.value);
    }
    return field.match(record, node.rule.value);
  });
  if (group.op === "and") return results.every(Boolean);
  return results.length === 0 ? true : results.some(Boolean);
}

export function applyFilters<T>(
  records: T[],
  filters: AppliedFilter[],
  fields: FilterField<T>[],
): T[] {
  if (filters.length === 0) return records;
  // Group filters by fieldId — same-field values are OR'd together, different
  // fields are AND'd. Pairs each value with its operator so matchWithOp can
  // be invoked per entry.
  const byFieldOrig = new Map<string, AppliedFilter[]>();
  for (const f of filters) {
    const list = byFieldOrig.get(f.fieldId) ?? [];
    list.push(f);
    byFieldOrig.set(f.fieldId, list);
  }
  return records.filter((r) => {
    for (const [fieldId, entries] of byFieldOrig) {
      const field = fields.find((x) => x.id === fieldId);
      if (!field) continue;
      const anyMatch = entries.some((entry) => {
        if (entry.operator && field.matchWithOp) {
          return field.matchWithOp(r, entry.operator, entry.value);
        }
        return field.match(r, entry.value);
      });
      if (!anyMatch) return false;
    }
    return true;
  });
}

export function FilterPopover<T>({
  fields,
  anchorRef,
  onAdd,
  onClose,
}: {
  fields: FilterField<T>[];
  anchorRef: React.RefObject<HTMLElement>;
  onAdd: (f: AppliedFilter) => void;
  onClose: () => void;
}) {
  const [picked, setPicked] = useState<FilterField<T> | null>(null);
  const [operator, setOperator] = useState<FilterOperator | null>(null);
  const [value, setValue] = useState("");
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [onClose, anchorRef]);

  const rect = anchorRef.current?.getBoundingClientRect();
  // Popover size estimates — kept in sync with tokens.css --popover-w-md / --popover-h-md.
  // Used to clamp the popover inside the viewport; the rendered size is driven by CSS.
  const POPOVER_W = readCssPx("--popover-w-md", 240);
  const POPOVER_H = readCssPx("--popover-h-md", 260);
  const margin = 8;
  const style = rect
    ? {
        top: Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - POPOVER_H - margin)),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - POPOVER_W - margin)),
      }
    : { top: 48, left: 16 };

  const commit = () => {
    if (!picked || !value.trim()) return;
    onAdd({ fieldId: picked.id, value: value.trim(), operator: operator ?? undefined });
    onClose();
  };

  return (
    <div className="popover" ref={ref} style={style}>
      {!picked ? (
        <>
          <MenuSectionLabel>Filter by field</MenuSectionLabel>
          {fields.map((f) => (
            <MenuRow
              key={f.id}
              icon={f.icon}
              label={f.label}
              onClick={() => {
                setPicked(f);
                setValue("");
              }}
            />
          ))}
        </>
      ) : (
        <>
          <MenuSectionLabel>
            {picked.label}
            {" "}
            {picked.operators && picked.operators.length > 1 ? (
              <Select value={operator ?? picked.operators[0]} onChange={value => setOperator(value as FilterOperator)} options={[...picked.operators.map(op => ({
  value: op,
  label: OPERATOR_LABELS[op]
}))]} className="popover__op-select" />
            ) : (
              <span className="muted">{picked.options ? "is" : "contains"}</span>
            )}
          </MenuSectionLabel>
          {picked.options ? (
            <>
              {picked.options.map((option) => (
                <MenuRow
                  key={option}
                  label={option}
                  onClick={() => {
                    onAdd({ fieldId: picked.id, value: option, operator: operator ?? undefined });
                    onClose();
                  }}
                />
              ))}
              <div className="popover__footer">
                <button className="btn-action" onClick={() => setPicked(null)}>
                  Back
                </button>
              </div>
            </>
          ) : (
            <>
              <input
                className="popover__input"
                autoFocus
                value={value}
                onChange={(e) => setValue(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && commit()}
                placeholder="Type and press Enter"
              />
              <div className="popover__footer">
                <button className="btn-action" onClick={() => setPicked(null)}>
                  Back
                </button>
                <button className="btn-action btn-action--primary" onClick={commit}>
                  Apply
                </button>
              </div>
            </>
          )}
        </>
      )}
    </div>
  );
}

export function FilterChips({
  filters,
  fields,
  onRemove,
}: {
  filters: AppliedFilter[];
  fields: FilterField<any>[];
  onRemove: (index: number) => void;
}) {
  if (filters.length === 0) return null;
  // Count per-field repeats so we can hint "is X OR Y" vs "contains".
  const counts = new Map<string, number>();
  for (const f of filters) counts.set(f.fieldId, (counts.get(f.fieldId) ?? 0) + 1);
  return (
    <div className="filter-chips">
      {filters.map((f, i) => {
        const field = fields.find((x) => x.id === f.fieldId);
        const isRepeat = (counts.get(f.fieldId) ?? 0) > 1;
        const firstIdxForField = filters.findIndex((other) => other.fieldId === f.fieldId);
        // If this entry isn't the first for its field, show "or" to hint the
        // values are OR'd together.
        const defaultOp: string = f.operator
          ? OPERATOR_LABELS[f.operator]
          : field?.options
            ? "is"
            : "contains";
        const op = isRepeat && i !== firstIdxForField ? "or" : defaultOp;
        return (
          <span className="filter-chip" key={i}>
            {(!isRepeat || i === firstIdxForField) && (
              <span className="filter-chip__field">{field?.label ?? f.fieldId}</span>
            )}
            <span className="filter-chip__op">{op}</span>
            <strong>{f.value}</strong>
            <button className="filter-chip__remove" onClick={() => onRemove(i)} aria-label="Remove filter">
              <X size={10} />
            </button>
          </span>
        );
      })}
    </div>
  );
}
