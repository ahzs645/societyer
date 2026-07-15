import { useEffect, useLayoutEffect, useRef, useState, type ComponentType, type KeyboardEvent as ReactKeyboardEvent } from "react";
import type { BooleanFieldConfig, CurrencyFieldConfig, FieldMetadata, SelectFieldConfig } from "../../types";
import { FIELD_TYPES } from "../../types";
import { Select } from "@/components/Select";
import { DatePicker } from "@/components/DatePicker";
import { DateTimeInput } from "@/components/DateTimeInput";
import type { TagColor } from "@/components/Tag";

/**
 * Edit-mode input for a cell. Renders a type-appropriate control, wires
 * Enter/Escape/blur to commit or cancel, and auto-focuses on mount.
 * Types without a dedicated editor fall back to a text input.
 */

export type FieldInputProps = {
  value: unknown;
  field: FieldMetadata;
  onCommit: (value: unknown) => void;
  onCancel: () => void;
  initialValue?: string;
};

type InputComponent = ComponentType<FieldInputProps>;

function TextInput({ value, onCommit, onCancel, field, initialValue }: FieldInputProps) {
  const [draft, setDraft] = useState<string>(initialValue ?? (value == null ? "" : String(value)));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  return (
    <input
      ref={ref}
      className="record-cell__input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => onCommit(draft === "" && field.isNullable ? null : draft)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          onCommit(draft === "" && field.isNullable ? null : draft);
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

// Block any printable key that isn't part of a number. `type="number"` still
// accepts "e"/"E"/"+" (scientific notation) and, in some engines, stray
// letters — so guard at the keystroke. Multi-char keys (Backspace, ArrowLeft,
// Enter…) and shortcut combos (Ctrl/Cmd/Alt) pass through untouched.
function isNonNumericKey(e: ReactKeyboardEvent): boolean {
  if (e.ctrlKey || e.metaKey || e.altKey) return false;
  if (e.key.length !== 1) return false;
  return !/[0-9.\-]/.test(e.key);
}

function NumberInput({ value, onCommit, onCancel, field, initialValue }: FieldInputProps) {
  const [draft, setDraft] = useState<string>(initialValue ?? (value == null ? "" : String(value)));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (draft === "") {
      onCommit(field.isNullable ? null : 0);
      return;
    }
    const num = Number(draft);
    if (Number.isNaN(num)) onCancel();
    else onCommit(num);
  };
  return (
    <input
      ref={ref}
      type="number"
      className="record-cell__input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isNonNumericKey(e)) {
          e.preventDefault();
        } else if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

/**
 * CURRENCY inline editor. Edits in the *display* unit (dollars) and stores in
 * the *underlying* unit. For `isCents` fields the cell shows CA$40.00 for a
 * stored 4000, so the editor must show 40 and write back 4000 — a plain
 * NumberInput would instead edit the raw 4000 and turn a typed "40" into $0.40.
 */
function CurrencyInput({ value, onCommit, onCancel, field, initialValue }: FieldInputProps) {
  const config = (field.config ?? {}) as CurrencyFieldConfig;
  const isCents = Boolean(config.isCents);
  const toDisplay = (v: unknown): string => {
    if (v == null || v === "") return "";
    const n = Number(v);
    if (Number.isNaN(n)) return "";
    return String(isCents ? n / 100 : n);
  };
  const [draft, setDraft] = useState<string>(initialValue ?? toDisplay(value));
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    if (draft === "") {
      onCommit(field.isNullable ? null : 0);
      return;
    }
    const amount = Number(draft);
    if (Number.isNaN(amount)) {
      onCancel();
      return;
    }
    onCommit(isCents ? Math.round(amount * 100) : amount);
  };
  return (
    <input
      ref={ref}
      type="number"
      step="0.01"
      inputMode="decimal"
      className="record-cell__input"
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (isNonNumericKey(e)) {
          e.preventDefault();
        } else if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

/**
 * SELECT inline editor. Renders a Twenty-style floating menu anchored to
 * the parent table cell — no visible trigger, just the dropdown itself.
 *
 * The menu shows colored tag chips so users see the same visual as the
 * read-only cell. Search/keyboard nav come from the shared `<Select />`
 * component.
 */
function SelectInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const config = field.config as SelectFieldConfig;
  const options = (config.options ?? []).map((o) => ({
    value: o.value,
    label: o.label,
    color: o.color as TagColor | undefined,
  }));
  // Use a ref (not state) to track whether the user picked something
  // before the menu closed. State updates can race with the parent's
  // unmount; a ref is synchronous.
  const hasCommittedRef = useRef(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [anchorRect, setAnchorRect] = useState<{
    top: number;
    bottom: number;
    left: number;
    width: number;
  } | null>(null);

  // Anchor to the parent cell so the dropdown aligns to the column,
  // not just the little placeholder span we render inline.
  useLayoutEffect(() => {
    const cell = anchorRef.current?.closest("[data-record-cell-editor-anchor], td");
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    setAnchorRect({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
  }, []);

  return (
    <span
      ref={anchorRef}
      className="record-cell__select-anchor"
      style={{ display: "inline-block", minHeight: 20 }}
    >
      {anchorRect && (
        <Select
          size="sm"
          triggerless
          anchorRect={anchorRect}
          defaultOpen
          value={value == null ? "" : String(value)}
          options={options}
          clearable={field.isNullable}
          clearLabel={field.isNullable ? `No ${field.label.toLowerCase()}` : undefined}
          onChange={(v) => {
            hasCommittedRef.current = true;
            onCommit(v === "" ? null : v);
          }}
          onClose={() => {
            if (!hasCommittedRef.current) onCancel();
          }}
        />
      )}
    </span>
  );
}

/** "YYYY-MM-DD" in local time, or "" when the value can't be parsed. */
function toDateDraft(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value) && !value.includes("T")) {
    return value.slice(0, 10);
  }
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return "";
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  return `${d.getFullYear()}-${mo}-${da}`;
}

/** "YYYY-MM-DDTHH:mm" in local time (datetime-local shape), or "". */
function toDateTimeDraft(value: unknown): string {
  if (value == null || value === "") return "";
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) return value;
  const d = new Date(value as any);
  if (Number.isNaN(d.getTime())) return "";
  const mo = String(d.getMonth() + 1).padStart(2, "0");
  const da = String(d.getDate()).padStart(2, "0");
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return `${d.getFullYear()}-${mo}-${da}T${hh}:${mm}`;
}

/**
 * DATE / DATE_TIME inline editor — the same styled calendar popover used in
 * drawers (DatePicker / DateTimeInput), opened immediately. Commits when the
 * popover closes; if the user closed it without changing anything we cancel
 * instead so no spurious update is written.
 */
function DateInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const isDateTime = field.fieldType === FIELD_TYPES.DATE_TIME;
  const [draft, setDraft] = useState(() =>
    isDateTime ? toDateTimeDraft(value) : toDateDraft(value),
  );
  const draftRef = useRef(draft);
  const dirtyRef = useRef(false);

  const handleChange = (next: string) => {
    dirtyRef.current = true;
    draftRef.current = next;
    setDraft(next);
  };

  const handleClose = () => {
    if (!dirtyRef.current) {
      onCancel();
      return;
    }
    const next = draftRef.current;
    onCommit(next === "" && field.isNullable ? null : next);
  };

  return isDateTime ? (
    <DateTimeInput
      value={draft}
      onChange={handleChange}
      defaultOpen
      onClose={handleClose}
      size="sm"
      clearable={field.isNullable}
    />
  ) : (
    <DatePicker
      value={draft}
      onChange={handleChange}
      defaultOpen
      onClose={handleClose}
      size="sm"
      clearable={field.isNullable}
    />
  );
}

/** ARRAY inline editor — comma-separated text in, string[] out. */
function ArrayInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const initial = Array.isArray(value) ? value.join(", ") : value == null ? "" : String(value);
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
    ref.current?.select();
  }, []);
  const commit = () => {
    const parts = draft.split(",").map((s) => s.trim()).filter(Boolean);
    onCommit(parts.length === 0 && field.isNullable ? null : parts);
  };
  return (
    <input
      ref={ref}
      className="record-cell__input"
      value={draft}
      placeholder="comma, separated, values"
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
        } else if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    />
  );
}

/** MULTI_SELECT inline editor — a checkbox menu anchored to the cell that
 *  commits an array of selected option values. */
function MultiSelectInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const config = field.config as SelectFieldConfig;
  const options = config?.options ?? [];
  const initial = Array.isArray(value)
    ? value.map(String)
    : value == null
      ? []
      : [String(value)];
  const [selected, setSelected] = useState<string[]>(initial);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [rect, setRect] = useState<{ top: number; left: number; width: number } | null>(null);

  useLayoutEffect(() => {
    const cell = anchorRef.current?.closest("[data-record-cell-editor-anchor], td");
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    setRect({ top: r.bottom, left: r.left, width: r.width });
  }, []);

  const toggle = (v: string) =>
    setSelected((cur) => (cur.includes(v) ? cur.filter((x) => x !== v) : [...cur, v]));
  const commit = () => onCommit(selected.length === 0 && field.isNullable ? null : selected);

  return (
    <span ref={anchorRef} className="record-cell__select-anchor" style={{ display: "inline-block", minHeight: 20 }}>
      {rect && (
        <div
          className="record-cell__multiselect"
          style={{
            position: "fixed",
            top: rect.top,
            left: rect.left,
            minWidth: rect.width,
            zIndex: 1000,
            background: "var(--bg)",
            border: "1px solid var(--border)",
            borderRadius: 6,
            padding: 6,
            boxShadow: "var(--shadow-md)",
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              e.preventDefault();
              onCancel();
            }
          }}
        >
          {options.length === 0 && <div className="muted" style={{ padding: 4 }}>No options configured.</div>}
          {options.map((o) => (
            <label key={o.value} className="row" style={{ gap: 6, alignItems: "center", padding: "2px 4px", cursor: "pointer" }}>
              <input type="checkbox" checked={selected.includes(o.value)} onChange={() => toggle(o.value)} />
              <span>{o.label}</span>
            </label>
          ))}
          <div className="row" style={{ gap: 6, justifyContent: "flex-end", marginTop: 4 }}>
            <button className="btn btn--ghost" onMouseDown={(e) => { e.preventDefault(); onCancel(); }}>
              Cancel
            </button>
            <button className="btn btn--accent" onMouseDown={(e) => { e.preventDefault(); commit(); }}>
              Done
            </button>
          </div>
        </div>
      )}
    </span>
  );
}

/**
 * BOOLEAN inline editor. Renders the same Twenty-style floating option menu as
 * SELECT (anchored to the cell) instead of blind-toggling the value — so the
 * user always sees and picks from the available options (Yes / No, or the
 * field's custom true/false labels) rather than the value silently swapping.
 */
function BooleanInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const config = field.config as BooleanFieldConfig;
  const current = value === true || value === "true" || value === 1 || value === "1";
  const isEmpty = value === null || value === undefined;
  const options = [
    { value: "true", label: config.trueLabel ?? "Yes" },
    { value: "false", label: config.falseLabel ?? "No" },
  ];
  const hasCommittedRef = useRef(false);
  const anchorRef = useRef<HTMLSpanElement>(null);
  const [anchorRect, setAnchorRect] = useState<{
    top: number;
    bottom: number;
    left: number;
    width: number;
  } | null>(null);

  useLayoutEffect(() => {
    const cell = anchorRef.current?.closest("[data-record-cell-editor-anchor], td");
    if (!cell) return;
    const r = cell.getBoundingClientRect();
    setAnchorRect({ top: r.top, bottom: r.bottom, left: r.left, width: r.width });
  }, []);

  return (
    <span
      ref={anchorRef}
      className="record-cell__select-anchor"
      style={{ display: "inline-block", minHeight: 20 }}
    >
      {anchorRect && (
        <Select
          size="sm"
          triggerless
          anchorRect={anchorRect}
          defaultOpen
          value={isEmpty ? "" : current ? "true" : "false"}
          options={options}
          clearable={field.isNullable}
          clearLabel={field.isNullable ? `No ${field.label.toLowerCase()}` : undefined}
          onChange={(v) => {
            hasCommittedRef.current = true;
            onCommit(v === "" ? null : v === "true");
          }}
          onClose={() => {
            if (!hasCommittedRef.current) onCancel();
          }}
        />
      )}
    </span>
  );
}

const INPUT_BY_TYPE: Partial<Record<FieldMetadata["fieldType"], InputComponent>> = {
  [FIELD_TYPES.TEXT]: TextInput,
  [FIELD_TYPES.EMAIL]: TextInput,
  [FIELD_TYPES.PHONE]: TextInput,
  [FIELD_TYPES.LINK]: TextInput,
  [FIELD_TYPES.UUID]: TextInput,
  [FIELD_TYPES.NUMBER]: NumberInput,
  [FIELD_TYPES.CURRENCY]: CurrencyInput,
  [FIELD_TYPES.RATING]: NumberInput,
  [FIELD_TYPES.SELECT]: SelectInput,
  [FIELD_TYPES.MULTI_SELECT]: MultiSelectInput,
  [FIELD_TYPES.ARRAY]: ArrayInput,
  [FIELD_TYPES.DATE]: DateInput,
  [FIELD_TYPES.DATE_TIME]: DateInput,
  [FIELD_TYPES.BOOLEAN]: BooleanInput,
  // Relation fields become editable when their metadata adapter supplies a
  // finite option list. Objects backed by a remote relation query remain
  // read-only until that adapter provides the choices rather than falling
  // back to an unsafe free-form record id.
  [FIELD_TYPES.RELATION]: SelectInput,
};

export function FieldInput(props: FieldInputProps) {
  const Component = INPUT_BY_TYPE[props.field.fieldType] ?? TextInput;
  return <Component {...props} />;
}

/**
 * Whether a field supports inline-edit. Three things must hold:
 *   1. Not flagged read-only by the schema (computed/timestamp columns).
 *   2. Its fieldType has a registered input component.
 *   3. For SELECT, an `options` config must be present — a SELECT with
 *      no options is a misconfiguration and should stay read-only
 *      rather than render an empty dropdown.
 */
export function isFieldEditable(field: FieldMetadata): boolean {
  if (field.isReadOnly) return false;
  const input = INPUT_BY_TYPE[field.fieldType];
  if (!input) return false;
  if (
    field.fieldType === "SELECT" ||
    field.fieldType === "MULTI_SELECT" ||
    field.fieldType === "RELATION"
  ) {
    const options = (field.config as SelectFieldConfig)?.options;
    if (!options || options.length === 0) return false;
  }
  return true;
}
