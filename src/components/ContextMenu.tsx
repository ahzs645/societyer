import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MenuRow, MenuSectionLabel } from "./ui";
import type { MenuSection } from "./Menu";

type Props = {
  position: { x: number; y: number } | null;
  sections: MenuSection[];
  onClose: () => void;
  minWidth?: number;
};

export function ContextMenu({ position, sections, onClose, minWidth = 200 }: Props) {
  const menuRef = useRef<HTMLDivElement>(null);
  const flat = useMemo(() => sections.flatMap((s) => s.items.filter((i) => !i.disabled)), [sections]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [adjusted, setAdjusted] = useState<{ top: number; left: number } | null>(null);

  useEffect(() => {
    if (position) setActiveIdx(0);
  }, [position]);

  useLayoutEffect(() => {
    if (!position || !menuRef.current) {
      setAdjusted(null);
      return;
    }
    const rect = menuRef.current.getBoundingClientRect();
    const margin = 8;
    let left = position.x;
    let top = position.y;
    if (left + rect.width + margin > window.innerWidth) left = window.innerWidth - rect.width - margin;
    if (top + rect.height + margin > window.innerHeight) top = window.innerHeight - rect.height - margin;
    if (left < margin) left = margin;
    if (top < margin) top = margin;
    setAdjusted({ top, left });
  }, [position]);

  useEffect(() => {
    if (!position) return;
    const onDoc = (e: MouseEvent) => {
      if (menuRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onScroll = () => onClose();
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActiveIdx((i) => Math.max(i - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const item = flat[activeIdx];
        if (item) {
          item.onSelect?.();
          onClose();
        }
      }
    };
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("contextmenu", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("contextmenu", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey);
    };
  }, [position, flat, activeIdx, onClose]);

  if (!position) return null;

  let runningIdx = 0;
  return createPortal(
    <div
      ref={menuRef}
      className="menu menu--actions"
      role="menu"
      style={{
        position: "fixed",
        top: adjusted?.top ?? position.y,
        left: adjusted?.left ?? position.x,
        minWidth,
        visibility: adjusted ? "visible" : "hidden",
      }}
    >
      {sections.map((section, sIdx) => (
        <div key={section.id} className="menu__section">
          {section.label && <MenuSectionLabel>{section.label}</MenuSectionLabel>}
          {section.items.map((item) => {
            const isEnabled = !item.disabled;
            const myIdx = isEnabled ? runningIdx++ : -1;
            const isActive = isEnabled && myIdx === activeIdx;
            return (
              <MenuRow
                key={item.id}
                role="menuitem"
                icon={item.icon}
                label={item.label}
                hint={item.hint}
                active={isActive}
                disabled={item.disabled}
                destructive={item.destructive}
                onMouseEnter={() => isEnabled && setActiveIdx(myIdx)}
                onClick={() => {
                  if (item.disabled) return;
                  item.onSelect?.();
                  onClose();
                }}
              />
            );
          })}
          {sIdx < sections.length - 1 && <div className="menu__separator" />}
        </div>
      ))}
    </div>,
    document.body,
  );
}
