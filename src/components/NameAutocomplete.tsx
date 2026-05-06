import { useMemo, useState } from "react";

/**
 * Styled name-autocomplete input. Replaces the browser's native <datalist>
 * popup so suggestions render inside the app's theme and respond to keyboard
 * navigation.
 *
 * Two modes:
 *  - Default (no `onCommit` prop): used as a controlled form field. Enter on a
 *    highlighted option fills `value`; Enter without a highlight does nothing
 *    special (caller can still attach an outer onKeyDown to submit).
 *  - Tag mode (with `onCommit`): the component owns the Enter key. Enter
 *    commits either the highlighted option or the currently typed value via
 *    `onCommit`, then closes the dropdown.
 */
export function NameAutocomplete({
  value,
  onChange,
  options,
  excludeOptions,
  placeholder,
  ariaLabel,
  className = "input",
  onCommit,
  inputProps,
}: {
  value: string;
  onChange: (next: string) => void;
  options: string[];
  excludeOptions?: ReadonlySet<string>;
  placeholder?: string;
  ariaLabel?: string;
  className?: string;
  onCommit?: (value: string) => void;
  inputProps?: Omit<
    React.InputHTMLAttributes<HTMLInputElement>,
    "value" | "onChange" | "placeholder" | "className" | "role" | "aria-expanded" | "aria-autocomplete" | "aria-label"
  >;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [highlightIndex, setHighlightIndex] = useState(0);

  const filtered = useMemo(() => {
    const query = value.trim().toLowerCase();
    return options.filter((option) => {
      if (excludeOptions && excludeOptions.has(option.toLowerCase())) return false;
      if (!query) return true;
      return option.toLowerCase().includes(query);
    });
  }, [value, options, excludeOptions]);

  const visible = isOpen && filtered.length > 0;

  const selectOption = (option: string) => {
    if (onCommit) {
      onCommit(option);
    } else {
      onChange(option);
    }
    setIsOpen(false);
    setHighlightIndex(0);
  };

  return (
    <div className="name-autocomplete">
      <input
        {...inputProps}
        className={className}
        value={value}
        onChange={(event) => {
          onChange(event.target.value);
          setIsOpen(true);
          setHighlightIndex(0);
        }}
        onFocus={(event) => {
          setIsOpen(true);
          inputProps?.onFocus?.(event);
        }}
        onBlur={(event) => {
          // Delay close so a click on a suggestion item registers before the
          // input loses focus and the dropdown unmounts.
          window.setTimeout(() => setIsOpen(false), 120);
          inputProps?.onBlur?.(event);
        }}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown") {
            event.preventDefault();
            setIsOpen(true);
            setHighlightIndex((index) => Math.min(filtered.length - 1, index + 1));
          } else if (event.key === "ArrowUp") {
            event.preventDefault();
            setHighlightIndex((index) => Math.max(0, index - 1));
          } else if (event.key === "Escape") {
            setIsOpen(false);
          } else if (event.key === "Enter") {
            const highlighted = visible ? filtered[highlightIndex] : undefined;
            if (onCommit) {
              event.preventDefault();
              onCommit(highlighted ?? value);
              setIsOpen(false);
              setHighlightIndex(0);
            } else if (highlighted) {
              event.preventDefault();
              onChange(highlighted);
              setIsOpen(false);
              setHighlightIndex(0);
            }
          }
          inputProps?.onKeyDown?.(event);
        }}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={visible}
        aria-autocomplete="list"
        aria-label={ariaLabel}
      />
      {visible && (
        <ul className="name-autocomplete__menu" role="listbox">
          {filtered.map((option, idx) => (
            <li
              key={option}
              role="option"
              aria-selected={idx === highlightIndex}
              className={`name-autocomplete__option${idx === highlightIndex ? " is-highlighted" : ""}`}
              onMouseDown={(event) => {
                // preventDefault keeps the input focused so onBlur doesn't
                // race with this click and close the dropdown first.
                event.preventDefault();
                selectOption(option);
              }}
              onMouseEnter={() => setHighlightIndex(idx)}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
