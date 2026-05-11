import { Check, ChevronDown } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Field } from "./ui";
import { OptionSetName, optionChoices } from "../lib/orgHubOptions";
import { Select } from "./Select";

type OptionSelectProps = {
  label: string;
  setName: OptionSetName;
  value?: string | null;
  onChange: (value: string | undefined) => void;
  emptyLabel?: string;
};

export function OptionSelect({ label, setName, value, onChange, emptyLabel }: OptionSelectProps) {
  const options = optionChoices(setName, value ? [value] : []);
  return (
    <Field label={label}>
      <Select
        value={value ?? ""}
        onChange={(nextValue) => onChange(nextValue || undefined)}
        options={[
          ...(emptyLabel ? [{ value: "", label: emptyLabel }] : []),
          ...options.map((option) => ({ value: option.value, label: option.label })),
        ]}
        className="input"
      />
    </Field>
  );
}

type OptionMultiSelectProps = {
  label: string;
  setName: OptionSetName;
  values?: string[];
  onChange: (values: string[]) => void;
  rows?: number;
};

export function OptionMultiSelect({ label, setName, values = [], onChange, rows = 5 }: OptionMultiSelectProps) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const options = optionChoices(setName, values);
  const selected = new Set(values);
  const selectedLabel = values.length ? `${values.length} selected` : "Select options";

  useEffect(() => {
    if (!open) return;
    const onMouseDown = (event: MouseEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onMouseDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onMouseDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const toggle = (value: string) => {
    const next = new Set(values);
    if (next.has(value)) {
      next.delete(value);
    } else {
      next.add(value);
    }
    onChange(Array.from(next));
  };

  return (
    <Field label={label}>
      <div className="option-multi-select" ref={rootRef}>
        <button
          type="button"
          className="select-trigger"
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
        >
          <span className="select-trigger__label">{selectedLabel}</span>
          <ChevronDown size={14} className="select-trigger__chev" />
        </button>
        {open && (
          <div className="menu option-multi-select__menu" role="listbox" aria-multiselectable="true">
            <div className="menu__list" style={{ maxHeight: `${Math.min(Math.max(rows, 3), 8) * 36}px` }}>
              {options.map((option) => {
                const checked = selected.has(option.value);
                return (
                  <button
                    key={option.value}
                    type="button"
                    className={`menu__item${checked ? " is-selected" : ""}`}
                    role="option"
                    aria-selected={checked}
                    onClick={() => toggle(option.value)}
                  >
                    <span className="menu__item-label">{option.label}</span>
                    {checked && <Check size={12} className="menu__item-check" />}
                  </button>
                );
              })}
            </div>
          </div>
        )}
      </div>
    </Field>
  );
}
