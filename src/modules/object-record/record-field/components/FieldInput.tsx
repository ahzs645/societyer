import { useEffect, useRef, useState, type ComponentType } from "react";
import type { FieldMetadata, SelectFieldConfig } from "../../types";
import { FIELD_TYPES } from "../../types";

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

function SelectInput({ value, onCommit, onCancel, field }: FieldInputProps) {
  const config = field.config as SelectFieldConfig;
  const options = config.options ?? [];
  const ref = useRef<HTMLSelectElement>(null);
  useEffect(() => {
    ref.current?.focus();
  }, []);
  return (
    <select
      ref={ref}
      className="record-cell__input"
      defaultValue={value == null ? "" : String(value)}
      onChange={(e) => onCommit(e.target.value)}
      onBlur={onCancel}
      onKeyDown={(e) => {
        if (e.key === "Escape") {
          e.preventDefault();
          onCancel();
        }
      }}
    >
      {field.isNullable && <option value="">—</option>}
      {options.map((o) => (
        <option key={o.value} value={o.value}>
          {o.label}
        </option>
      ))}
    </select>
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

/** Types that support inline-edit today. Everything else stays read-only. */
export function isFieldEditable(field: FieldMetadata): boolean {
  return Boolean(INPUT_BY_TYPE[field.fieldType]);
}
