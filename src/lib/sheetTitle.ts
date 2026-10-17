import { useLayoutEffect, useRef, useState } from "react";

/**
 * The title a phone bottom sheet shows for the field it was opened from, so
 * a long list (provinces, categories, people) never loses track of what is
 * being chosen. In order of preference:
 *
 * 1. an explicit title passed by the page (`sheetTitle`);
 * 2. the trigger's own label — `<label for>` (what `<Field>` renders),
 *    `aria-labelledby`, or the label of the enclosing `.field`;
 * 3. its `aria-label`;
 * 4. a placeholder the page chose (not a component default like "Select…");
 * 5. `fallback`.
 */
export type SheetTitleSource = {
  explicit?: string;
  trigger?: HTMLElement | null;
  ariaLabel?: string;
  placeholder?: string;
  /** Last resort before `fallback`: the trigger's visible text (menus). */
  useTriggerText?: boolean;
  fallback?: string;
};

function tidy(text: string | null | undefined) {
  const value = (text ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/\s*[:*]+$/, "")
    .trim();
  // Labels styled in capitals are written in sentence case already; text
  // typed in capitals ("PROVINCE") reads as shouting in a sheet title.
  if (value.length > 3 && value === value.toUpperCase() && /[A-Z]/.test(value)) {
    return value.charAt(0) + value.slice(1).toLowerCase();
  }
  return value;
}

function textOfIds(ids: string | null) {
  if (!ids) return "";
  return ids
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ");
}

function labelOf(trigger: HTMLElement) {
  const labels = (trigger as HTMLButtonElement | HTMLInputElement).labels;
  if (labels) {
    for (const label of Array.from(labels)) {
      const text = tidy(label.textContent);
      if (text) return text;
    }
  }
  const labelledBy = tidy(textOfIds(trigger.getAttribute("aria-labelledby")));
  if (labelledBy) return labelledBy;
  const field = trigger.closest(".field");
  const fieldLabel = field?.querySelector(":scope > .field__label, :scope > label");
  return tidy(fieldLabel?.textContent);
}

export function resolveSheetTitle({ explicit, trigger, ariaLabel, placeholder, useTriggerText, fallback = "" }: SheetTitleSource) {
  const fromExplicit = tidy(explicit);
  if (fromExplicit) return fromExplicit;
  if (trigger) {
    const fromLabel = labelOf(trigger);
    if (fromLabel) return fromLabel;
  }
  const fromAria = tidy(ariaLabel ?? trigger?.getAttribute("aria-label"));
  if (fromAria) return fromAria;
  const fromPlaceholder = tidy(placeholder).replace(/…$/, "");
  if (fromPlaceholder) return fromPlaceholder;
  if (useTriggerText && trigger) {
    const fromTitle = tidy(trigger.getAttribute("title"));
    if (fromTitle) return fromTitle;
    const fromText = tidy(trigger.textContent);
    if (fromText) return fromText;
  }
  return fallback;
}

/**
 * Resolves the sheet title each time the sheet opens (labels are read from
 * the DOM, so the trigger must be mounted). A layout effect: the title is in
 * place before the sheet is first painted.
 */
export function useSheetTitle(active: boolean, source: () => SheetTitleSource) {
  const [title, setTitle] = useState("");
  const sourceRef = useRef(source);
  sourceRef.current = source;
  useLayoutEffect(() => {
    if (active) setTitle(resolveSheetTitle(sourceRef.current()));
  }, [active]);
  return title;
}
