import { useId, useMemo, useRef, useState, type ClipboardEvent, type KeyboardEvent } from "react";
import { X } from "lucide-react";
import { inValues, normalizeRuleText } from "../../../../shared/transactionRules";

/**
 * Chip input for "is any of" conditions: type or pick values (with
 * suggestions from known payees), Enter or comma adds, Backspace on an empty
 * field removes the last chip, and pasting a list splits it on commas or new
 * lines. Holds at most `max` values.
 */
export function ValueChipsInput({
  values,
  onChange,
  suggestions,
  max,
  placeholder,
  "aria-label": ariaLabel,
}: {
  values: string[];
  onChange: (values: string[]) => void;
  suggestions: string[];
  max: number;
  placeholder?: string;
  "aria-label": string;
}) {
  const [text, setText] = useState("");
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [notice, setNotice] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = useId();
  const noticeId = useId();
  const full = values.length >= max;

  const options = useMemo(() => {
    const chosen = new Set(values.map(normalizeRuleText));
    const query = normalizeRuleText(text);
    const pool = suggestions.filter((value) => !chosen.has(normalizeRuleText(value)));
    const starts = pool.filter((value) => normalizeRuleText(value).startsWith(query));
    const contains = query ? pool.filter((value) => !normalizeRuleText(value).startsWith(query) && normalizeRuleText(value).includes(query)) : [];
    return [...starts, ...contains].slice(0, 8);
  }, [suggestions, text, values]);

  const add = (raw: string[]) => {
    const merged = inValues([...values, ...raw]);
    if (merged.length > max) {
      setNotice(`A rule can list at most ${max} values. Split the rest into another rule.`);
      onChange(merged.slice(0, max));
    } else {
      setNotice("");
      onChange(merged);
    }
    setText("");
    setActive(0);
  };

  const remove = (index: number) => {
    setNotice("");
    onChange(values.filter((_, i) => i !== index));
    inputRef.current?.focus();
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    const listOpen = open && options.length > 0;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setOpen(true);
      setActive((index) => (listOpen ? Math.min(index + 1, options.length - 1) : 0));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((index) => Math.max(index - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      if (listOpen && options[active] && (!text.trim() || normalizeRuleText(options[active]).startsWith(normalizeRuleText(text)))) add([options[active]]);
      else if (text.trim()) add([text]);
    } else if (event.key === "," && text.trim()) {
      event.preventDefault();
      add([text]);
    } else if (event.key === "Backspace" && !text && values.length) {
      event.preventDefault();
      remove(values.length - 1);
    } else if (event.key === "Escape" && listOpen) {
      // Close the suggestions without closing the drawer around us.
      event.preventDefault();
      event.stopPropagation();
      setOpen(false);
    }
  };

  const onPaste = (event: ClipboardEvent<HTMLInputElement>) => {
    const pasted = event.clipboardData.getData("text");
    if (!/[,\n]/.test(pasted)) return;
    event.preventDefault();
    add(pasted.split(/[,\n]/));
  };

  const showList = open && options.length > 0 && !full;

  return (
    <div className="value-chips">
      <div className={`value-chips__box${full ? " is-full" : ""}`} onClick={() => inputRef.current?.focus()}>
        {values.map((value, index) => (
          <span key={normalizeRuleText(value)} className="value-chips__chip">
            <span className="value-chips__chip-text">{value}</span>
            <button type="button" className="value-chips__remove" aria-label={`Remove ${value}`} onClick={(event) => { event.stopPropagation(); remove(index); }}>
              <X size={12} aria-hidden="true" />
            </button>
          </span>
        ))}
        <input
          ref={inputRef}
          className="value-chips__input"
          role="combobox"
          aria-label={ariaLabel}
          aria-expanded={showList}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-activedescendant={showList ? `${listId}-${active}` : undefined}
          aria-describedby={noticeId}
          value={text}
          disabled={full}
          placeholder={full ? `${max} of ${max} values` : values.length ? "Add another" : placeholder}
          onChange={(event) => { setText(event.target.value); setOpen(true); setActive(0); }}
          onFocus={() => setOpen(true)}
          onBlur={() => {
            // Let a click on a suggestion land first.
            window.setTimeout(() => setOpen(false), 120);
            if (text.trim()) add([text]);
          }}
          onKeyDown={onKeyDown}
          onPaste={onPaste}
        />
      </div>
      {showList && (
        <ul className="value-chips__list" role="listbox" id={listId} aria-label="Known payees">
          {options.map((option, index) => (
            <li
              key={option}
              id={`${listId}-${index}`}
              role="option"
              aria-selected={index === active}
              className={`value-chips__option${index === active ? " is-active" : ""}`}
              onMouseDown={(event) => { event.preventDefault(); add([option]); }}
              onMouseEnter={() => setActive(index)}
            >
              {option}
            </li>
          ))}
        </ul>
      )}
      <p className={`value-chips__count${notice ? " is-error" : ""}`} id={noticeId} aria-live="polite">
        {notice || (values.length ? `${values.length} of ${max}` : "")}
      </p>
    </div>
  );
}
