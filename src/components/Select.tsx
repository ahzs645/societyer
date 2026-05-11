import { ReactNode, useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";
import { MenuRow } from "./ui";
import { Tag, type TagColor } from "./Tag";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
  /**
   * When set, the option's label renders as a colored `<Tag />` inside
   * the menu (and the trigger, when selected). Matches Twenty CRM's
   * SELECT-cell dropdown pattern — the chip you see in the row is the
   * same chip you click on in the menu.
   */
  color?: TagColor;
};

type SelectProps<T extends string> = {
  value: T | "";
  onChange: (value: T) => void;
  options: SelectOption<T>[];
  placeholder?: string;
  size?: "md" | "sm";
  className?: string;
  disabled?: boolean;
  searchable?: boolean;
  /** Allow an empty selection rendered as `clearLabel`. */
  clearable?: boolean;
  clearLabel?: string;
  /** Min width of the popup menu in px. Defaults to the trigger width. */
  menuMinWidth?: number;
  /**
   * When true, the menu is open on first render. Used for cell-edit
   * inputs in the record table, where clicking the cell should drop
   * straight into an open menu (no extra click on the trigger).
   */
  defaultOpen?: boolean;
  /**
   * Fires every time the menu closes — whether by selection, click-
   * outside, or Escape. Cell-edit inputs use this to distinguish a
   * "user cancelled" close from a "user picked something" close.
   */
  onClose?: () => void;
  /** Hide the trigger entirely — used when we want the menu to float
   * above a custom anchor (like a table cell). */
  triggerless?: boolean;
  /** External anchor rect for triggerless mode (pageX/Y coords). */
  anchorRect?: { top: number; bottom: number; left: number; width: number };
  style?: React.CSSProperties;
  onKeyDown?: React.KeyboardEventHandler<HTMLButtonElement>;
  id?: string;
  "aria-describedby"?: string;
  "aria-invalid"?: boolean;
};

export function Select<T extends string>({
  value,
  onChange,
  options,
  placeholder = "Select…",
  size = "md",
  className,
  disabled,
  searchable,
  clearable,
  clearLabel = "— none —",
  menuMinWidth,
  defaultOpen = false,
  onClose,
  triggerless = false,
  anchorRect,
  style,
  onKeyDown,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: SelectProps<T>) {
  const [open, setOpen] = useState(defaultOpen);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);
  // Notify parents exactly once per open→close cycle. We don't want
  // `onClose` to fire when we first mount with `defaultOpen=true`.
  const wasOpenRef = useRef(defaultOpen);
  useEffect(() => {
    if (wasOpenRef.current && !open) {
      onClose?.();
    }
    wasOpenRef.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const selected = options.find((o) => o.value === value);

  // Any option with a `color` becomes a tagged menu — we default
  // `searchable` on in that case so large enums stay usable.
  const anyTagged = useMemo(() => options.some((o) => o.color), [options]);
  const renderedSearchable = searchable ?? anyTagged;

  const filtered = useMemo(() => {
    if (!renderedSearchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, renderedSearchable]);

  const visibleItems: (SelectOption<T> | { value: ""; label: string; _clear: true })[] = useMemo(() => {
    if (clearable) return [{ value: "" as const, label: clearLabel, _clear: true }, ...filtered];
    return filtered;
  }, [clearable, clearLabel, filtered]);

  useLayoutEffect(() => {
    if (!open) return;
    if (triggerless && anchorRect) {
      setPos({ top: anchorRect.bottom + 4, left: anchorRect.left, width: anchorRect.width });
      return;
    }
    if (!triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, [open, triggerless, anchorRect]);

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
        e.preventDefault();
        setOpen(false);
        triggerRef.current?.focus();
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
  }, [open]);

  useEffect(() => {
    if (!open) {
      setQuery("");
      return;
    }
    const currentIdx = visibleItems.findIndex((o) => o.value === value);
    setActiveIdx(currentIdx >= 0 ? currentIdx : 0);
    if (!renderedSearchable) setTimeout(() => menuRef.current?.focus(), 0);
  }, [open, value, visibleItems, renderedSearchable]);

  // Keep the keyboard-focused option visible as the user moves through the menu.
  useEffect(() => {
    if (!open || !menuRef.current) return;
    const items = menuRef.current.querySelectorAll<HTMLElement>(".menu__list .menu__item");
    items[activeIdx]?.scrollIntoView({ block: "nearest" });
  }, [activeIdx, open]);

  const commit = (idx: number) => {
    const item = visibleItems[idx];
    if (!item || (!("_clear" in item) && item.disabled)) return;
    onChange(item.value as T);
    setOpen(false);
    triggerRef.current?.focus();
  };

  const onTriggerKey = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "Enter" || e.key === " " || e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
    }
  };

  const onMenuKey = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, visibleItems.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      commit(activeIdx);
    } else if (e.key === "Home") {
      e.preventDefault();
      setActiveIdx(0);
    } else if (e.key === "End") {
      e.preventDefault();
      setActiveIdx(visibleItems.length - 1);
    }
  };

  const triggerClass = [
    "select-trigger",
    size === "sm" ? "select-trigger--sm" : "",
    open ? "is-open" : "",
    className ?? "",
  ]
    .filter(Boolean)
    .join(" ");

  return (
    <>
      {!triggerless && (
        <button
          ref={triggerRef}
          type="button"
          className={triggerClass}
          id={id}
          onClick={() => !disabled && setOpen((o) => !o)}
          onKeyDown={(event) => {
            onKeyDown?.(event);
            if (!event.defaultPrevented) onTriggerKey(event);
          }}
          disabled={disabled}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? `${controlId}-menu` : undefined}
          aria-describedby={ariaDescribedBy}
          aria-invalid={ariaInvalid}
          style={style}
        >
          <span className="select-trigger__label">
            {selected ? (
              selected.color ? (
                <Tag color={selected.color} text={selected.label} />
              ) : (
                <>
                  {selected.icon && <span className="select-trigger__icon">{selected.icon}</span>}
                  {selected.label}
                </>
              )
            ) : (
              <span className="select-trigger__placeholder">{placeholder}</span>
            )}
          </span>
          <ChevronDown size={size === "sm" ? 12 : 14} className="select-trigger__chev" />
        </button>
      )}
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              id={`${controlId}-menu`}
              className="menu"
              role="listbox"
              tabIndex={-1}
              onKeyDown={onMenuKey}
              style={{ top: pos.top, left: pos.left, minWidth: Math.max(menuMinWidth ?? 0, pos.width) }}
            >
              {renderedSearchable && (
                <div className="menu__search">
                  <Search size={12} />
                  <input
                    autoFocus
                    className="menu__search-input"
                    value={query}
                    onChange={(e) => {
                      setQuery(e.target.value);
                      setActiveIdx(0);
                    }}
                    placeholder="Search…"
                    onKeyDown={onMenuKey}
                  />
                </div>
              )}
              <div className="menu__list">
                {visibleItems.length === 0 && <div className="menu__empty">No results</div>}
                {visibleItems.map((o, i) => {
                  const isActive = i === activeIdx;
                  const isSelected = o.value === value;
                  const isClear = "_clear" in o;
                  const hasColor = !isClear && "color" in o && o.color;
                  // A "clear" row renders as an outline-variant Tag so
                  // it visually reads as an empty state.
                  const label = isClear ? (
                    <Tag color="transparent" variant="outline" text={o.label} />
                  ) : hasColor ? (
                    <Tag color={(o as SelectOption<T>).color!} text={o.label} />
                  ) : (
                    o.label
                  );
                  return (
                    <MenuRow
                      key={`${o.value}-${i}`}
                      role="option"
                      ariaSelected={isSelected}
                      icon={!isClear && !hasColor ? o.icon : undefined}
                      label={label}
                      hint={!isClear && !hasColor ? o.hint : undefined}
                      right={isSelected ? <Check size={12} className="menu__item-check" /> : undefined}
                      active={isActive}
                      disabled={!isClear && o.disabled}
                      subtle={isClear}
                      onMouseEnter={() => setActiveIdx(i)}
                      onClick={() => commit(i)}
                    />
                  );
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
