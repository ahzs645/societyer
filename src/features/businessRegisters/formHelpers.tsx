import { useEffect, useRef, type ReactNode } from "react";
import { parseMoneyInput } from "../../lib/money";
import { Field } from "../../components/ui";

/** Cents to the plain dollars string an amount input edits ("1250.5" → "1250.50"). */
export function centsToInput(cents: number | null | undefined): string {
  if (cents == null || !Number.isFinite(cents)) return "";
  return (cents / 100).toFixed(2);
}

/** Dollars typed by a person ("1,250.50", "1.5k", "(300)") to cents; blank is undefined. */
export function inputToCents(value: string | null | undefined): number | undefined {
  return parseMoneyInput(value ?? "");
}

/** Read a string field from a loosely typed form, never undefined. */
export function text(value: unknown): string {
  return typeof value === "string" ? value : value == null ? "" : String(value);
}

/** A labelled amount input that keeps what the person typed until save. */
export function MoneyField({
  label,
  value,
  onChange,
  hint,
  required,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  hint?: string;
  required?: boolean;
  disabled?: boolean;
}) {
  return (
    <Field label={label} hint={hint} required={required}>
      <input
        className="input input--money"
        inputMode="decimal"
        autoComplete="off"
        placeholder="0.00"
        value={value}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </Field>
  );
}

/** Two or three fields side by side on wide drawers, stacked on phones. */
export function FieldRow({ children }: { children: ReactNode }) {
  return <div className="register-field-row">{children}</div>;
}

/**
 * Runs `run` once, the first time `when` is true. The registers use it to
 * bring generated deadlines in step when a workspace query reports drift (a
 * remittance came due, a reminder date passed, a deadline was completed on
 * the Deadlines page).
 */
export function useOnceWhen(when: boolean, run: () => void) {
  const done = useRef(false);
  useEffect(() => {
    if (!when || done.current) return;
    done.current = true;
    run();
  }, [when, run]);
}
