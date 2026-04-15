import {
  cloneElement,
  ReactElement,
  ReactNode,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export type MenuItem = {
  id: string;
  label: ReactNode;
  icon?: ReactNode;
  hint?: ReactNode;
  disabled?: boolean;
  destructive?: boolean;
  onSelect?: () => void;
};

export type MenuSection = {
  id: string;
  /** Optional section header label. */
  label?: string;
  items: MenuItem[];
};

type Props = {
  /** Trigger element — receives an onClick + ref. */
  trigger: ReactElement;
  sections: MenuSection[];
  /** Min width in px for the menu. Default trigger width. */
  minWidth?: number;
  /** Align menu to the trigger left or right edge. Default "left". */
  align?: "left" | "right";
};

export function Menu({ trigger, sections, minWidth, align = "left" }: Props) {
  const [open, setOpen] = useState(false);
  const triggerRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; triggerWidth: number } | null>(null);

  const flat = useMemo(() => sections.flatMap((s) => s.items.filter((i) => !i.disabled)), [sections]);
  const [activeIdx, setActiveIdx] = useState(0);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = align === "right" ? r.right : r.left;
    setPos({ top: r.bottom + 4, left, triggerWidth: r.width });
  }, [open, align]);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        (triggerRef.current as HTMLElement | null)?.focus();
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
          setOpen(false);
        }
      }
    };
    document.addEventListener("mousedown", onDoc);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, flat, activeIdx]);

  useEffect(() => {
    if (open) setActiveIdx(0);
  }, [open]);

  const cloned = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      (triggerRef as React.MutableRefObject<HTMLElement | null>).current = node;
      const childRef = (trigger as any).ref;
      if (typeof childRef === "function") childRef(node);
      else if (childRef) childRef.current = node;
    },
    onClick: (e: React.MouseEvent) => {
      trigger.props.onClick?.(e);
      if (e.defaultPrevented) return;
      setOpen((o) => !o);
    },
    "aria-haspopup": "menu",
    "aria-expanded": open,
  });

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    item.onSelect?.();
    setOpen(false);
  };

  const renderSections = () => {
    let runningIdx = 0;
    return sections.map((section, sIdx) => (
      <div key={section.id} className="menu__section">
        {section.label && <div className="menu__section-label">{section.label}</div>}
        {section.items.map((item) => {
          const isEnabled = !item.disabled;
          const myIdx = isEnabled ? runningIdx++ : -1;
          const isActive = isEnabled && myIdx === activeIdx;
          return (
            <div
              key={item.id}
              role="menuitem"
              aria-disabled={item.disabled || undefined}
              className={`menu__item${isActive ? " is-active" : ""}${
                item.disabled ? " is-disabled" : ""
              }${item.destructive ? " menu__item--destructive" : ""}`}
              onMouseEnter={() => isEnabled && setActiveIdx(myIdx)}
              onClick={() => select(item)}
            >
              {item.icon && <span className="menu__item-icon">{item.icon}</span>}
              <span className="menu__item-label">
                {item.label}
                {item.hint && <span className="menu__item-hint"> · {item.hint}</span>}
              </span>
            </div>
          );
        })}
        {sIdx < sections.length - 1 && <div className="menu__separator" />}
      </div>
    ));
  };

  return (
    <>
      {cloned}
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="menu menu--actions"
              role="menu"
              style={{
                top: pos.top,
                left: align === "right" ? undefined : pos.left,
                right: align === "right" ? window.innerWidth - pos.left : undefined,
                minWidth: Math.max(minWidth ?? 0, pos.triggerWidth),
              }}
            >
              {renderSections()}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
