import { ReactNode } from "react";
import { Check, Minus } from "lucide-react";

type CheckboxProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  indeterminate?: boolean;
  /** Render just the box (no label row). */
  bare?: boolean;
};

export function Checkbox({ checked, onChange, label, hint, disabled, indeterminate, bare }: CheckboxProps) {
  const box = (
    <span
      className={`check-box${checked ? " is-checked" : ""}${
        indeterminate ? " is-indeterminate" : ""
      }${disabled ? " is-disabled" : ""}`}
      aria-hidden
    >
      {indeterminate ? <Minus size={10} /> : checked ? <Check size={10} /> : null}
    </span>
  );

  if (bare) {
    return (
      <button
        type="button"
        role="checkbox"
        aria-checked={indeterminate ? "mixed" : checked}
        className="check-bare"
        disabled={disabled}
        onClick={() => onChange(!checked)}
      >
        {box}
      </button>
    );
  }

  return (
    <label className={`check-row${disabled ? " is-disabled" : ""}`}>
      <input
        type="checkbox"
        className="check-row__input"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {box}
      <span className="check-row__body">
        {label && <span className="check-row__label">{label}</span>}
        {hint && <span className="check-row__hint">{hint}</span>}
      </span>
    </label>
  );
}

type ToggleProps = {
  checked: boolean;
  onChange: (checked: boolean) => void;
  label?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  size?: "md" | "sm";
};

export function Toggle({ checked, onChange, label, hint, disabled, size = "md" }: ToggleProps) {
  const sw = (
    <span
      className={`switch${checked ? " is-on" : ""}${disabled ? " is-disabled" : ""}${
        size === "sm" ? " switch--sm" : ""
      }`}
      aria-hidden
    >
      <span className="switch__thumb" />
    </span>
  );
  if (!label && !hint) {
    return (
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        disabled={disabled}
        className="switch-bare"
        onClick={() => onChange(!checked)}
      >
        {sw}
      </button>
    );
  }
  return (
    <label className={`check-row${disabled ? " is-disabled" : ""}`}>
      <input
        type="checkbox"
        className="check-row__input"
        role="switch"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        disabled={disabled}
      />
      {sw}
      <span className="check-row__body">
        {label && <span className="check-row__label">{label}</span>}
        {hint && <span className="check-row__hint">{hint}</span>}
      </span>
    </label>
  );
}

type RadioOption<T extends string> = { value: T; label: ReactNode; hint?: ReactNode; disabled?: boolean };

type RadioGroupProps<T extends string> = {
  value: T;
  onChange: (value: T) => void;
  options: RadioOption<T>[];
  name?: string;
  direction?: "vertical" | "horizontal";
};

export function RadioGroup<T extends string>({
  value,
  onChange,
  options,
  name,
  direction = "vertical",
}: RadioGroupProps<T>) {
  return (
    <div
      className={`radio-group radio-group--${direction}`}
      role="radiogroup"
    >
      {options.map((o) => {
        const selected = o.value === value;
        return (
          <label
            key={o.value}
            className={`radio-row${selected ? " is-selected" : ""}${o.disabled ? " is-disabled" : ""}`}
          >
            <input
              type="radio"
              name={name}
              checked={selected}
              disabled={o.disabled}
              onChange={() => onChange(o.value)}
              className="radio-row__input"
            />
            <span className={`radio-dot${selected ? " is-on" : ""}${o.disabled ? " is-disabled" : ""}`} aria-hidden />
            <span className="radio-row__body">
              <span className="radio-row__label">{o.label}</span>
              {o.hint && <span className="radio-row__hint">{o.hint}</span>}
            </span>
          </label>
        );
      })}
    </div>
  );
}
