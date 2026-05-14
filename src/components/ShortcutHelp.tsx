import { useEffect, useState } from "react";
import { Modal } from "./Modal";
import { SHORTCUT_SECTIONS } from "../lib/shortcutsRegistry";

function isTypingTarget(el: EventTarget | null) {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

export function ShortcutHelp() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "?" || isTypingTarget(e.target)) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      e.preventDefault();
      setOpen((v) => !v);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title="Keyboard shortcuts"
      size="md"
    >
      <div className="shortcut-help">
        {SHORTCUT_SECTIONS.map((section) => (
          <section key={section.id} className="shortcut-help__section">
            <div className="shortcut-help__section-label">{section.label}</div>
            <ul className="shortcut-help__list">
              {section.items.map((item, itemIndex) => (
                <li key={`${item.label}-${itemIndex}`} className="shortcut-help__row">
                  <span className="shortcut-help__label">{item.label}</span>
                  <span className="shortcut-help__keys">
                    {item.keys.map((k, i) => (
                      <kbd key={i} className="shortcut-help__key">{k}</kbd>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </Modal>
  );
}
