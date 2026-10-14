import { ReactNode, useEffect, useRef, type KeyboardEvent as ReactKeyboardEvent } from "react";
import { useScrollOverflow } from "../hooks/useScrollOverflow";
import { Pill } from "./ui";

export function Tabs<T extends string>({
  value,
  onChange,
  items,
  trailing,
  tabRoles = false,
  ariaLabel,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number | null; icon?: ReactNode }[];
  trailing?: ReactNode;
  /** Expose ARIA tablist/tab roles and selection state (opt-in per page). */
  tabRoles?: boolean;
  ariaLabel?: string;
}) {
  // The tab row never wraps: it scrolls sideways once the tabs outgrow it
  // (tablet detail pages, phones). Keep the active tab in view without
  // touching the page's vertical scroll position, and fade whichever edge
  // has tabs scrolled out of sight.
  const listRef = useRef<HTMLDivElement>(null);
  const overflow = useScrollOverflow(listRef, [items.length]);
  useEffect(() => {
    const list = listRef.current;
    const active = list?.querySelector<HTMLElement>(".tab.is-active");
    if (!list || !active || list.scrollWidth <= list.clientWidth) return;
    const listRect = list.getBoundingClientRect();
    const activeRect = active.getBoundingClientRect();
    const left = activeRect.left - listRect.left + list.scrollLeft;
    const right = left + activeRect.width;
    if (left < list.scrollLeft + 24 || right > list.scrollLeft + list.clientWidth - 24) {
      const reduceMotion = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      list.scrollTo({ left: Math.max(0, left - 24), behavior: reduceMotion ? "auto" : "smooth" });
    }
  }, [value]);
  // Arrow keys / Home / End move between tabs. With tab roles this is the
  // ARIA tablist pattern: one tab stop (the selected tab) and arrows select.
  const hasSelected = items.some((it) => it.id === value);
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home" && event.key !== "End") return;
    const buttons = Array.from(listRef.current?.querySelectorAll<HTMLButtonElement>(":scope > .tab") ?? []);
    const current = buttons.indexOf(event.target as HTMLButtonElement);
    if (current < 0) return;
    event.preventDefault();
    const next = event.key === "Home" ? 0
      : event.key === "End" ? buttons.length - 1
      : (current + (event.key === "ArrowRight" ? 1 : -1) + buttons.length) % buttons.length;
    buttons[next]?.focus();
    if (tabRoles && items[next]) onChange(items[next].id);
  };
  return (
    <div
      ref={listRef}
      className="tabs"
      role={tabRoles ? "tablist" : undefined}
      aria-label={ariaLabel}
      data-overflow={overflow}
      onKeyDown={onKeyDown}
    >
      {items.map((it, index) => (
        <button
          key={it.id}
          type="button"
          role={tabRoles ? "tab" : undefined}
          aria-selected={tabRoles ? value === it.id : undefined}
          tabIndex={tabRoles && (hasSelected ? value !== it.id : index > 0) ? -1 : undefined}
          className={`tab${value === it.id ? " is-active" : ""}`}
          onClick={() => onChange(it.id)}
        >
          {it.icon}
          <span className="tab__label">{it.label}</span>
          {it.count != null && <Pill size="sm" className="tab__count">{it.count}</Pill>}
        </button>
      ))}
      {trailing != null && <div className="tabs__trailing">{trailing}</div>}
    </div>
  );
}

export function Progress({ value, tone }: { value: number; tone?: "success" | "warn" | "danger" }) {
  const v = Math.max(0, Math.min(100, value));
  const klass = tone ? `progress progress--${tone}` : "progress";
  return (
    <div className={klass}>
      <div className="progress__fill" style={{ width: `${v}%` }} />
    </div>
  );
}

export function Segmented<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string }[];
}) {
  return (
    <div className="segmented">
      {items.map((it) => (
        <button
          key={it.id}
          type="button"
          aria-pressed={value === it.id}
          className={`segmented__btn${value === it.id ? " is-active" : ""}`}
          onClick={() => onChange(it.id)}
        >
          {it.label}
        </button>
      ))}
    </div>
  );
}

export function AvatarGroup({ names, max = 4 }: { names: string[]; max?: number }) {
  const shown = names.slice(0, max);
  const rest = names.length - shown.length;
  return (
    <div className="avatar-stack">
      {shown.map((n, i) => (
        <span key={i} className="avatar" title={n}>
          {n
            .split(" ")
            .map((p) => p[0])
            .join("")
            .slice(0, 2)
            .toUpperCase()}
        </span>
      ))}
      {rest > 0 && <span className="avatar">+{rest}</span>}
    </div>
  );
}
