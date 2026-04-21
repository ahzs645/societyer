import { useEffect, useLayoutEffect, useRef, useState, type ComponentType } from "react";
import type { FieldMetadata, SelectFieldConfig } from "../../types";
import { FIELD_TYPES } from "../../types";
import { Select } from "@/components/Select";
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
};

type InputComponent = ComponentType<FieldInputProps>;

function TextInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
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

function NumberInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const [draft, setDraft] = useState<string>(value == null ? "" : String(value));
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
    const cell = anchorRef.current?.closest("td");
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

function DateInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const initial =
    value == null
      ? ""
      : typeof value === "string"
        ? value.slice(0, 10)
        : new Date(value as any).toISOString().slice(0, 10);
  const [draft, setDraft] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <input
      ref={ref}
      type="date"
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

function BooleanInput({ value, onCommit }: FieldInputProps) {
  // Boolean "edit" is an immediate toggle — no popover needed.
  const current = value === true || value === "true" || value === 1 || value === "1";
  useEffect(() => {
    onCommit(!current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return null;
}

const INPUT_BY_TYPE: Partial<Record<FieldMetadata["fieldType"], InputComponent>> = {
  [FIELD_TYPES.TEXT]: TextInput,
  [FIELD_TYPES.EMAIL]: TextInput,
  [FIELD_TYPES.PHONE]: TextInput,
  [FIELD_TYPES.LINK]: TextInput,
  [FIELD_TYPES.UUID]: TextInput,
  [FIELD_TYPES.NUMBER]: NumberInput,
  [FIELD_TYPES.CURRENCY]: NumberInput,
  [FIELD_TYPES.RATING]: NumberInput,
  [FIELD_TYPES.SELECT]: SelectInput,
  [FIELD_TYPES.DATE]: DateInput,
  [FIELD_TYPES.DATE_TIME]: DateInput,
  [FIELD_TYPES.BOOLEAN]: BooleanInput,
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
  if (field.fieldType === "SELECT") {
    const options = (field.config as SelectFieldConfig)?.options;
    if (!options || options.length === 0) return false;
  }
  return true;
}
