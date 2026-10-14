import { useEffect, useMemo, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Modal } from "./Modal";
import { ShortcutHint } from "./ShortcutHint";
import {
  SHORTCUT_SECTIONS,
  formatShortcut,
  isApplePlatform,
  isTypingTarget,
} from "../lib/shortcutsRegistry";

/** Dispatch to open the shortcut help from anywhere (menus, sidebar links). */
export const OPEN_SHORTCUT_HELP_EVENT = "societyer:open-shortcut-help";

export function openShortcutHelp() {
  window.dispatchEvent(new Event(OPEN_SHORTCUT_HELP_EVENT));
}

/**
 * `?` opens a searchable list of keyboard shortcuts grouped by where they
 * apply (General, Navigation, Tables, Side panel…). Keys render as ⌘ on
 * Apple platforms and Ctrl elsewhere.
 */
export function ShortcutHelp() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    const onOpen = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_SHORTCUT_HELP_EVENT, onOpen);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_SHORTCUT_HELP_EVENT, onOpen);
    };
  }, []);

  useEffect(() => {
    if (!open) return;
    setQuery("");
    // The dialog focuses its first focusable on open; make that the search box.
    const timer = window.setTimeout(() => inputRef.current?.focus(), 0);
    return () => window.clearTimeout(timer);
  }, [open]);

  const apple = isApplePlatform();
  const sections = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return SHORTCUT_SECTIONS;
    return SHORTCUT_SECTIONS.map((section) => {
      // Searching a context name ("tables") lists that whole section.
      if (section.label.toLowerCase().includes(q)) return section;
      return {
        ...section,
        items: section.items.filter((item) => {
          const haystack = [
            item.label,
            formatShortcut(item, apple),
            item.keys.join(" "),
            ...(item.keywords ?? []),
          ]
            .join(" ")
            .toLowerCase();
          return haystack.includes(q);
        }),
      };
    }).filter((section) => section.items.length > 0);
  }, [query, apple]);

  return (
    <Modal open={open} onClose={() => setOpen(false)} title="Keyboard shortcuts" size="lg">
      <div className="shortcut-help">
        <div className="shortcut-help__search">
          <Search size={14} aria-hidden="true" />
          <input
            ref={inputRef}
            type="search"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search shortcuts…"
            aria-label="Search shortcuts"
            onKeyDown={(event) => {
              // Esc clears the filter first; a second Esc closes the dialog.
              if (event.key === "Escape" && query) {
                event.preventDefault();
                event.stopPropagation();
                setQuery("");
              }
            }}
          />
          {query && (
            <button type="button" aria-label="Clear search" onClick={() => setQuery("")}>
              <X size={12} />
            </button>
          )}
        </div>
        <div className="shortcut-help__sections" aria-live="polite">
          {sections.length === 0 && (
            <p className="shortcut-help__empty">No shortcuts match “{query.trim()}”.</p>
          )}
          {sections.map((section) => (
            <section
              key={section.id}
              className="shortcut-help__section"
              aria-labelledby={`shortcut-help-${section.id}`}
            >
              <h3 id={`shortcut-help-${section.id}`} className="shortcut-help__section-label">
                {section.label}
              </h3>
              <ul className="shortcut-help__list">
                {section.items.map((item, itemIndex) => (
                  <li key={`${item.label}-${itemIndex}`} className="shortcut-help__row">
                    <span className="shortcut-help__label">{item.label}</span>
                    <ShortcutHint keys={item.keys} sequence={item.sequence} className="shortcut-help__keys" />
                  </li>
                ))}
              </ul>
            </section>
          ))}
        </div>
        <p className="shortcut-help__foot">
          Shortcuts pause while you type in a field. Press <ShortcutHint keys={["?"]} /> to open this list again.
        </p>
      </div>
    </Modal>
  );
}
