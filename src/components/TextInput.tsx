import { forwardRef, InputHTMLAttributes, ReactNode, TextareaHTMLAttributes, useRef } from "react";
import { X } from "lucide-react";

type BaseProps = {
  prefix?: ReactNode;
  suffix?: ReactNode;
  error?: string | boolean;
  /** Show an X inside the input that clears the value when clicked. */
  clearable?: boolean;
  onClear?: () => void;
  size?: "md" | "sm";
};

type TextInputProps = BaseProps & InputHTMLAttributes<HTMLInputElement>;

export const TextInput = forwardRef<HTMLInputElement, TextInputProps>(function TextInput(
  { prefix, suffix, error, clearable, onClear, size = "md", className, value, onChange, ...rest },
  ref,
) {
  const innerRef = useRef<HTMLInputElement | null>(null);
  const setRef = (el: HTMLInputElement | null) => {
    innerRef.current = el;
    if (typeof ref === "function") ref(el);
    else if (ref) (ref as React.MutableRefObject<HTMLInputElement | null>).current = el;
  };

  const hasValue = value !== undefined && value !== "" && value !== null;
  const showClear = clearable && hasValue && !rest.disabled && !rest.readOnly;

  return (
    <div
      className={[
        "text-input",
        size === "sm" ? "text-input--sm" : "",
        error ? "is-invalid" : "",
        rest.disabled ? "is-disabled" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      {prefix && <span className="text-input__affix">{prefix}</span>}
      <input ref={setRef} value={value as any} onChange={onChange} {...rest} />
      {showClear && (
        <button
          type="button"
          className="text-input__clear"
          aria-label="Clear"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => {
            if (onClear) onClear();
            else if (onChange) {
              const ev = {
                target: { value: "" },
                currentTarget: { value: "" },
              } as unknown as React.ChangeEvent<HTMLInputElement>;
              onChange(ev);
            }
            innerRef.current?.focus();
          }}
        >
          <X size={12} />
        </button>
      )}
      {suffix && <span className="text-input__affix">{suffix}</span>}
      {typeof error === "string" && error && <div className="text-input__error">{error}</div>}
    </div>
  );
});

type TextAreaProps = Omit<BaseProps, "prefix" | "suffix" | "clearable" | "onClear"> &
  TextareaHTMLAttributes<HTMLTextAreaElement> & { autoResize?: boolean };

export const TextArea = forwardRef<HTMLTextAreaElement, TextAreaProps>(function TextArea(
  { error, size = "md", className, autoResize, onChange, ...rest },
  ref,
) {
  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    if (autoResize) {
      const el = e.currentTarget;
      el.style.height = "auto";
      el.style.height = `${el.scrollHeight}px`;
    }
    onChange?.(e);
  };
  return (
    <div
      className={[
        "text-area",
        size === "sm" ? "text-area--sm" : "",
        error ? "is-invalid" : "",
        rest.disabled ? "is-disabled" : "",
        className ?? "",
      ]
        .filter(Boolean)
        .join(" ")}
    >
      <textarea ref={ref} onChange={handleChange} {...rest} />
      {typeof error === "string" && error && <div className="text-input__error">{error}</div>}
    </div>
  );
});
