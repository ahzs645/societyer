import { ReactNode, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ChevronDown, Check, Search } from "lucide-react";
import { MenuRow } from "./ui";

export type SelectOption<T extends string = string> = {
  value: T;
  label: string;
  icon?: ReactNode;
  hint?: string;
  disabled?: boolean;
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
  style?: React.CSSProperties;
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
  style,
  id,
  "aria-describedby": ariaDescribedBy,
  "aria-invalid": ariaInvalid,
}: SelectProps<T>) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [activeIdx, setActiveIdx] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left: number; width: number } | null>(null);

  const selected = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    if (!searchable || !query.trim()) return options;
    const q = query.toLowerCase();
    return options.filter((o) => o.label.toLowerCase().includes(q));
  }, [options, query, searchable]);

  const visibleItems: (SelectOption<T> | { value: ""; label: string; _clear: true })[] = useMemo(() => {
    if (clearable) return [{ value: "" as const, label: clearLabel, _clear: true }, ...filtered];
    return filtered;
  }, [clearable, clearLabel, filtered]);

  useLayoutEffect(() => {
    if (!open || !triggerRef.current) return;
    const r = triggerRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 4, left: r.left, width: r.width });
  }, [open]);

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
  }, [open, value, visibleItems]);

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
      <button
        ref={triggerRef}
        type="button"
        className={triggerClass}
        id={id}
        onClick={() => !disabled && setOpen((o) => !o)}
        onKeyDown={onTriggerKey}
        disabled={disabled}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        style={style}
      >
        <span className="select-trigger__label">
          {selected ? (
            <>
              {selected.icon && <span className="select-trigger__icon">{selected.icon}</span>}
              {selected.label}
            </>
          ) : (
            <span className="select-trigger__placeholder">{placeholder}</span>
          )}
        </span>
        <ChevronDown size={size === "sm" ? 12 : 14} className="select-trigger__chev" />
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={menuRef}
              className="menu"
              role="listbox"
              tabIndex={-1}
              onKeyDown={onMenuKey}
              style={{ top: pos.top, left: pos.left, minWidth: Math.max(menuMinWidth ?? 0, pos.width) }}
            >
              {searchable && (
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
                  return (
                    <MenuRow
                      key={`${o.value}-${i}`}
                      role="option"
                      ariaSelected={isSelected}
                      icon={!isClear ? o.icon : undefined}
                      label={o.label}
                      hint={!isClear ? o.hint : undefined}
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
