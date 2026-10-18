import { forwardRef, useEffect, useId, useRef, useState } from "react";
import type { InputHTMLAttributes, ReactNode } from "react";
import { Eye, EyeOff } from "lucide-react";

type PasswordFieldProps = Omit<InputHTMLAttributes<HTMLInputElement>, "type" | "id" | "className"> & {
  label: string;
  /** Rendered at the end of the label row, e.g. a "Forgot password?" link. */
  labelAction?: ReactNode;
  hint?: ReactNode;
};

/** Password input with an accessible show/hide toggle. */
export const PasswordField = forwardRef<HTMLInputElement, PasswordFieldProps>(function PasswordField(
  { label, labelAction, hint, disabled, ...inputProps },
  forwardedRef,
) {
  const id = useId();
  const hintId = `${id}-hint`;
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [visible, setVisible] = useState(false);

  // Mask the value again on submit so browsers and password managers see a
  // password field, not a text field holding a password.
  useEffect(() => {
    const form = inputRef.current?.form;
    if (!form) return;
    const hide = () => setVisible(false);
    form.addEventListener("submit", hide);
    return () => form.removeEventListener("submit", hide);
  }, []);

  const setRefs = (node: HTMLInputElement | null) => {
    inputRef.current = node;
    if (typeof forwardedRef === "function") forwardedRef(node);
    else if (forwardedRef) forwardedRef.current = node;
  };

  return (
    <div className="field auth-field">
      <div className="auth-field__label-row">
        <label className="field__label" htmlFor={id}>{label}</label>
        {labelAction}
      </div>
      <div className="auth-password">
        <input
          {...inputProps}
          ref={setRefs}
          id={id}
          type={visible ? "text" : "password"}
          className="input auth-input auth-password__input"
          disabled={disabled}
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-describedby={hint ? hintId : undefined}
        />
        <button
          type="button"
          className="auth-password__toggle"
          aria-label="Show password"
          aria-pressed={visible}
          aria-controls={id}
          disabled={disabled}
          // Keep focus (and the phone keyboard) on the input when clicked.
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => setVisible((current) => !current)}
        >
          {visible ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>
      </div>
      {hint && <p id={hintId} className="field__hint auth-field__hint">{hint}</p>}
    </div>
  );
});
