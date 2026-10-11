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
import { MenuRow, MenuSectionLabel } from "./ui";
import { bottomSheetMediaQuery } from "../lib/breakpoints";
import { SHEET_MIN_ITEMS, useSheetDrag } from "../lib/useSheetDrag";

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
  const [posClamped, setPosClamped] = useState(false);
  const [isPhone, setIsPhone] = useState(
    () => typeof window !== "undefined" && window.matchMedia(bottomSheetMediaQuery).matches,
  );
  // Short action menus stay anchored popovers on phones too; only long ones
  // become a bottom sheet.
  const itemCount = sections.reduce((n, s) => n + s.items.length, 0);
  const isBottomSheet = isPhone && itemCount > SHEET_MIN_ITEMS;

  useSheetDrag(menuRef, { enabled: open && isBottomSheet, onDismiss: () => setOpen(false) });

  const flat = useMemo(() => sections.flatMap((s) => s.items.filter((i) => !i.disabled)), [sections]);
  const [activeIdx, setActiveIdx] = useState(0);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      setPosClamped(false);
      return;
    }
    if (isBottomSheet) {
      setPos(null);
      setPosClamped(false);
      return;
    }
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    const left = align === "right" ? r.right : r.left;
    setPos({ top: r.bottom + 4, left, triggerWidth: r.width });
    setPosClamped(false);
  }, [open, align, isBottomSheet]);

  useLayoutEffect(() => {
    if (isBottomSheet || !open || !pos || posClamped || !menuRef.current || !triggerRef.current) return;
    const menu = menuRef.current.getBoundingClientRect();
    const trig = triggerRef.current.getBoundingClientRect();
    const margin = 8;
    let left = align === "right" ? trig.right - menu.width : trig.left;
    left = Math.max(margin, Math.min(left, window.innerWidth - menu.width - margin));
    let top = trig.bottom + 4;
    if (top + menu.height > window.innerHeight - margin) {
      const upward = trig.top - menu.height - 4;
      top = upward >= margin ? upward : Math.max(margin, window.innerHeight - menu.height - margin);
    }
    setPos({ top, left, triggerWidth: trig.width });
    setPosClamped(true);
  }, [open, pos, posClamped, align, isBottomSheet]);

  useEffect(() => {
    const media = window.matchMedia(bottomSheetMediaQuery);
    const update = () => setIsPhone(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t)) return;
      if (menuRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onScroll = (event: Event) => {
      // A long sheet must remain open while its own options are scrolled.
      if (event.target instanceof Node && menuRef.current?.contains(event.target)) return;
      // A trigger click may follow a browser scroll in the same frame. Keep
      // the opened sheet usable and re-anchor desktop menus to visible rows.
      if (isBottomSheet) return;
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor || anchor.bottom <= 0 || anchor.top >= window.innerHeight) {
        setOpen(false);
        return;
      }
      const panel = menuRef.current?.getBoundingClientRect();
      if (!panel) return;
      const margin = 8;
      const left = Math.max(margin, Math.min(align === "right" ? anchor.right - panel.width : anchor.left, window.innerWidth - panel.width - margin));
      const below = anchor.bottom + 4;
      const above = anchor.top - panel.height - 4;
      const top = below + panel.height <= window.innerHeight - margin ? below : above >= margin ? above : Math.max(margin, window.innerHeight - panel.height - margin);
      setPos({ top, left, triggerWidth: anchor.width });
      setPosClamped(true);
    };
    const onResize = () => { if (!isBottomSheet) setOpen(false); };
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
    window.addEventListener("resize", onResize);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, flat, activeIdx, align, isBottomSheet]);

  useEffect(() => {
    if (open) setActiveIdx(0);
  }, [open]);

  const cloned = cloneElement(trigger, {
    ref: (node: HTMLElement | null) => {
      (triggerRef as React.MutableRefObject<HTMLElement | null>).current = node;
      const childRef = (trigger as ReactElement & { ref?: React.Ref<HTMLElement> }).ref;
      if (typeof childRef === "function") childRef(node);
      else if (childRef) {
        (childRef as React.MutableRefObject<HTMLElement | null>).current = node;
      }
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
              onClick={() => select(item)}
            />
          );
        })}
        {sIdx < sections.length - 1 && <div className="menu__separator" />}
      </div>
    ));
  };

  return (
    <>
      {cloned}
      {open && (isBottomSheet || pos)
        ? createPortal(
            <>
              {isBottomSheet && (
                <div
                  className="menu-backdrop"
                  aria-hidden="true"
                  onMouseDown={() => setOpen(false)}
                />
              )}
              <div
                ref={menuRef}
                className={`menu menu--actions${isBottomSheet ? " menu--sheet" : ""}`}
                role="menu"
                style={
                  isBottomSheet || !pos
                    ? undefined
                    : {
                        top: pos.top,
                        left: posClamped ? pos.left : (align === "right" ? undefined : pos.left),
                        right: posClamped ? undefined : (align === "right" ? window.innerWidth - pos.left : undefined),
                        minWidth: Math.max(minWidth ?? 0, pos.triggerWidth),
                        visibility: posClamped ? "visible" : "hidden",
                      }
                }
              >
                {isBottomSheet && <div className="sheet-grabber" aria-hidden="true" />}
                {renderSections()}
              </div>
            </>,
            document.body,
          )
        : null}
    </>
  );
}
