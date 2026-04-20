import { useEffect, useState } from "react";
import { Modal } from "./Modal";

type Shortcut = {
  keys: string[];
  label: string;
};

type Section = {
  label: string;
  items: Shortcut[];
};

const SECTIONS: Section[] = [
  {
    label: "Navigation",
    items: [
      { keys: ["⌘", "K"], label: "Open command palette" },
      { keys: ["⌘", "\\"], label: "Toggle sidebar" },
      { keys: ["?"], label: "Show this help" },
    ],
  },
  {
    label: "In drawers & dialogs",
    items: [
      { keys: ["Esc"], label: "Close drawer or modal" },
      { keys: ["Tab"], label: "Move focus forward" },
      { keys: ["Shift", "Tab"], label: "Move focus backward" },
    ],
  },
  {
    label: "Tables",
    items: [
      { keys: ["Enter"], label: "Open the focused row" },
      { keys: ["Click"], label: "Open the row detail" },
    ],
  },
];

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
        {SECTIONS.map((section) => (
          <section key={section.label} className="shortcut-help__section">
            <div className="shortcut-help__section-label">{section.label}</div>
            <ul className="shortcut-help__list">
              {section.items.map((item) => (
                <li key={item.label} className="shortcut-help__row">
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
