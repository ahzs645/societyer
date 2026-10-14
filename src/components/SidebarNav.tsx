// Two-level sidebar navigation (disclosure tree) and the collapsed icon rail
// with hover/focus flyouts. Layout.tsx owns the data (visibility filtering,
// favorites, counts); this file owns structure, keyboard movement and flyouts.

import {
  useCallback,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type ReactNode,
} from "react";
import { createPortal } from "react-dom";
import { Link, useNavigate } from "react-router-dom";
import { ChevronRight, Monitor, Moon, Sun } from "lucide-react";
import { useTranslation } from "react-i18next";
import { Menu } from "./Menu";
import { NAV_AREAS, type NavAreaChoice } from "../lib/navConfig";
import { navEntryInArea } from "../lib/navTree";
import { SHORTCUTS, type ShortcutId } from "../lib/shortcutsRegistry";
import { TintedIconTile } from "./ui";
import { Tooltip } from "./Tooltip";
import { useThemePreference } from "../hooks/useThemePreference";
import type { NavItem, VisibleNavEntry, VisibleNavParent } from "./Layout.internal";

// ---------------------------------------------------------------------------
// Keyboard movement shared by the tree and the rail
// ---------------------------------------------------------------------------

function isVisibleRow(el: HTMLElement) {
  return el.offsetParent !== null || el.getClientRects().length > 0;
}

function navRows(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>("[data-nav-row]")).filter(isVisibleRow);
}

/**
 * Arrow-key movement inside the sidebar `<nav>`: ↑/↓ (and Home/End) move
 * between rows, → expands a parent or steps into it, ← collapses it or steps
 * back up to the parent. Enter/Space stay native (links open, buttons toggle).
 */
export function handleSidebarNavKeyDown(
  event: ReactKeyboardEvent<HTMLElement>,
  setParentOpen: (id: string, open: boolean) => void,
  openFlyout?: (id: string, focusFirst: boolean) => void,
) {
  if (event.altKey || event.ctrlKey || event.metaKey) return;
  const container = event.currentTarget;
  const target = event.target as HTMLElement;
  // From the filter box, ↓ drops into the first result.
  if (target instanceof HTMLInputElement) {
    if (event.key !== "ArrowDown") return;
    const rows = navRows(container);
    const next = rows.find((row) => target.compareDocumentPosition(row) & Node.DOCUMENT_POSITION_FOLLOWING);
    if (next) {
      event.preventDefault();
      next.focus();
    }
    return;
  }
  if (!target.hasAttribute("data-nav-row")) return;
  const rows = navRows(container);
  const index = rows.indexOf(target);
  if (index === -1) return;
  const focusAt = (i: number) => {
    const row = rows[Math.max(0, Math.min(rows.length - 1, i))];
    row?.focus();
    row?.scrollIntoView({ block: "nearest" });
  };
  const parentId = target.getAttribute("data-nav-parent");
  const childOf = target.getAttribute("data-nav-child-of");
  switch (event.key) {
    case "ArrowDown":
      event.preventDefault();
      focusAt(index + 1);
      break;
    case "ArrowUp":
      event.preventDefault();
      focusAt(index - 1);
      break;
    case "Home":
      event.preventDefault();
      focusAt(0);
      break;
    case "End":
      event.preventDefault();
      focusAt(rows.length - 1);
      break;
    case "ArrowRight":
      if (!parentId) return;
      event.preventDefault();
      if (openFlyout && target.hasAttribute("data-nav-rail")) {
        openFlyout(parentId, true);
      } else if (target.getAttribute("aria-expanded") !== "true") {
        setParentOpen(parentId, true);
      } else {
        focusAt(index + 1);
      }
      break;
    case "ArrowLeft":
      if (parentId && target.getAttribute("aria-expanded") === "true" && !target.hasAttribute("data-nav-rail")) {
        event.preventDefault();
        setParentOpen(parentId, false);
      } else if (childOf) {
        event.preventDefault();
        container.querySelector<HTMLElement>(`[data-nav-parent="${CSS.escape(childOf)}"]`)?.focus();
      }
      break;
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// Expanded sidebar: L1 parents with L2 children on a rail line
// ---------------------------------------------------------------------------

export function SidebarNavTree({
  entries,
  openParents,
  forceOpen,
  activeRoute,
  onToggleParent,
  getParentLabel,
  renderItem,
}: {
  entries: VisibleNavEntry[];
  openParents: Record<string, boolean>;
  /** The nav filter is active: every remaining parent shows its matches. */
  forceOpen: boolean;
  activeRoute: string | null;
  onToggleParent: (id: string, open: boolean) => void;
  getParentLabel: (entry: VisibleNavParent) => string;
  renderItem: (item: NavItem, parentId?: string) => ReactNode;
}) {
  const baseId = useId();
  return (
    <div className="sidebar__tree">
      {entries.map((entry) => {
        if (entry.kind === "item") return renderItem(entry.item);
        const open = forceOpen || Boolean(openParents[entry.id]);
        const containsActive = entry.children.some((child) => child.to === activeRoute);
        const label = getParentLabel(entry);
        const Icon = entry.icon;
        const groupId = `${baseId}-${entry.id}`;
        return (
          <div
            key={entry.id}
            className={`sidebar__parent${open ? " is-open" : ""}${containsActive ? " has-active" : ""}`}
          >
            <button
              type="button"
              className={`sidebar__item sidebar__parent-toggle sidebar__group-toggle${containsActive && !open ? " is-active-parent" : ""}`}
              aria-expanded={open}
              aria-controls={open ? groupId : undefined}
              data-nav-row=""
              data-nav-parent={entry.id}
              onClick={() => onToggleParent(entry.id, !open)}
            >
              <TintedIconTile tone={entry.color} size="sm" className="sidebar__icon-chip">
                <Icon size={14} />
              </TintedIconTile>
              <span className="sidebar__label">{label}</span>
              {containsActive && !open && <span className="sidebar__parent-dot" aria-hidden="true" />}
              <ChevronRight size={12} className="sidebar__parent-chevron" aria-hidden="true" />
            </button>
            {open && (
              <div className="sidebar__children" role="group" id={groupId} aria-label={label}>
                {entry.children.map((child) => renderItem(child, entry.id))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Icon rail (collapsed desktop sidebar)
// ---------------------------------------------------------------------------

export type RailFavorite = {
  key: string;
  label: string;
  icon: ReactNode;
  to?: string;
  run?: () => void;
  active: boolean;
};

type FlyoutState = { id: string; top: number; left: number; focusFirst: boolean };

const FLYOUT_OPEN_DELAY = 90;
const FLYOUT_CLOSE_DELAY = 180;

export function SidebarRail({
  favorites,
  entries,
  activeRoute,
  getParentLabel,
  getItemLabel,
  renderCount,
  flyoutRef: externalFlyoutRef,
}: {
  favorites: RailFavorite[];
  entries: VisibleNavEntry[];
  activeRoute: string | null;
  getParentLabel: (entry: VisibleNavParent) => string;
  /** Label for an L2 child (tree label, e.g. "Overview"). */
  getItemLabel: (item: NavItem) => string;
  renderCount: (item: NavItem) => ReactNode;
  /** Receives the open/close API so the nav's keyboard handler can open flyouts. */
  flyoutRef?: { current: ((id: string, focusFirst: boolean) => void) | null };
}) {
  const navigate = useNavigate();
  const [flyout, setFlyout] = useState<FlyoutState | null>(null);
  const openTimer = useRef<number | null>(null);
  const closeTimer = useRef<number | null>(null);
  const flyoutElRef = useRef<HTMLDivElement | null>(null);
  const triggerRefs = useRef(new Map<string, HTMLButtonElement>());

  const clearTimers = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    openTimer.current = null;
    closeTimer.current = null;
  };

  const openFlyout = useCallback((id: string, focusFirst: boolean) => {
    const trigger = triggerRefs.current.get(id);
    if (!trigger) return;
    clearTimers();
    const rect = trigger.getBoundingClientRect();
    const rail = trigger.closest(".sidebar")?.getBoundingClientRect();
    setFlyout({ id, top: rect.top - 6, left: (rail?.right ?? rect.right) + 6, focusFirst });
  }, []);

  const flyoutIdRef = useRef<string | null>(null);
  const suppressFocusOpen = useRef(false);
  flyoutIdRef.current = flyout?.id ?? null;
  const closeFlyout = useCallback((returnFocus = false) => {
    clearTimers();
    const openId = flyoutIdRef.current;
    setFlyout(null);
    if (openId && returnFocus) {
      suppressFocusOpen.current = true;
      triggerRefs.current.get(openId)?.focus();
      suppressFocusOpen.current = false;
    }
  }, []);

  useEffect(() => {
    if (externalFlyoutRef) externalFlyoutRef.current = openFlyout;
    return () => {
      if (externalFlyoutRef) externalFlyoutRef.current = null;
    };
  }, [externalFlyoutRef, openFlyout]);

  useEffect(() => () => clearTimers(), []);

  // Keep the flyout inside the viewport once its height is known, then move
  // focus into it when it was opened from the keyboard.
  useLayoutEffect(() => {
    if (!flyout) return;
    const el = flyoutElRef.current;
    if (!el) return;
    const margin = 8;
    const overflow = flyout.top + el.offsetHeight - (window.innerHeight - margin);
    if (overflow > 0) el.style.top = `${Math.max(margin, flyout.top - overflow)}px`;
    if (flyout.focusFirst) el.querySelector<HTMLElement>("a")?.focus();
  }, [flyout]);

  useEffect(() => {
    if (!flyout) return;
    const onDown = (event: MouseEvent) => {
      const target = event.target as Node;
      if (flyoutElRef.current?.contains(target)) return;
      if (triggerRefs.current.get(flyout.id)?.contains(target)) return;
      closeFlyout();
    };
    const onScroll = (event: Event) => {
      if (flyoutElRef.current?.contains(event.target as Node)) return;
      closeFlyout();
    };
    document.addEventListener("mousedown", onDown);
    window.addEventListener("resize", onScroll);
    window.addEventListener("scroll", onScroll, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      window.removeEventListener("resize", onScroll);
      window.removeEventListener("scroll", onScroll, true);
    };
  }, [flyout, closeFlyout]);

  const scheduleOpen = (id: string) => {
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    if (flyout?.id === id) return;
    if (openTimer.current) window.clearTimeout(openTimer.current);
    openTimer.current = window.setTimeout(() => openFlyout(id, false), flyout ? 0 : FLYOUT_OPEN_DELAY);
  };
  const scheduleClose = () => {
    if (openTimer.current) window.clearTimeout(openTimer.current);
    if (closeTimer.current) window.clearTimeout(closeTimer.current);
    closeTimer.current = window.setTimeout(() => setFlyout(null), FLYOUT_CLOSE_DELAY);
  };

  const flyoutEntry = flyout
    ? (entries.find((entry) => entry.kind === "parent" && entry.id === flyout.id) as VisibleNavParent | undefined)
    : undefined;

  const onFlyoutKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLElement>("a"));
    const index = links.indexOf(document.activeElement as HTMLElement);
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const next = index === -1 ? 0 : (index + (event.key === "ArrowDown" ? 1 : -1) + links.length) % links.length;
      links[next]?.focus();
    } else if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      links[event.key === "Home" ? 0 : links.length - 1]?.focus();
    } else if (event.key === "Escape" || event.key === "ArrowLeft") {
      event.preventDefault();
      event.stopPropagation();
      closeFlyout(true);
    } else if (event.key === "Tab") {
      // The flyout lives at the end of <body>; hand focus back to the rail.
      event.preventDefault();
      const trigger = flyout ? triggerRefs.current.get(flyout.id) : null;
      closeFlyout();
      if (!trigger) return;
      const nav = trigger.closest("nav");
      const rows = nav ? navRows(nav) : [];
      const i = rows.indexOf(trigger);
      suppressFocusOpen.current = event.shiftKey;
      (event.shiftKey ? trigger : rows[i + 1] ?? trigger).focus();
      suppressFocusOpen.current = false;
    }
  };

  return (
    <div className="sidebar-rail">
      {favorites.length > 0 && (
        <div className="sidebar-rail__section" role="group" aria-label="Favorites">
          {favorites.map((fav) => {
            const tile = <span className="sidebar-rail__tile">{fav.icon}</span>;
            const className = `sidebar-rail__item${fav.active ? " is-active" : ""}`;
            return (
              <Tooltip key={fav.key} content={fav.label} placement="right" delay={250}>
                {fav.to ? (
                  <Link
                    to={fav.to}
                    className={className}
                    aria-label={fav.label}
                    aria-current={fav.active ? "page" : undefined}
                    data-nav-row=""
                  >
                    {tile}
                  </Link>
                ) : (
                  <button type="button" className={className} aria-label={fav.label} data-nav-row="" onClick={fav.run}>
                    {tile}
                  </button>
                )}
              </Tooltip>
            );
          })}
        </div>
      )}
      <div className="sidebar-rail__section" role="group" aria-label="All records">
        {entries.map((entry) => {
          if (entry.kind === "item") {
            const item = entry.item;
            const Icon = item.icon;
            const label = getItemLabel(item);
            const active = activeRoute === item.to;
            return (
              <Tooltip key={item.to} content={label} placement="right" delay={250}>
                <Link
                  to={item.to}
                  className={`sidebar-rail__item${active ? " is-active" : ""}`}
                  aria-label={label}
                  aria-current={active ? "page" : undefined}
                  data-nav-row=""
                >
                  <TintedIconTile tone={item.color} size="sm" className="sidebar__icon-chip">
                    <Icon size={14} />
                  </TintedIconTile>
                </Link>
              </Tooltip>
            );
          }
          const Icon = entry.icon;
          const label = getParentLabel(entry);
          const containsActive = entry.children.some((child) => child.to === activeRoute);
          const isOpen = flyout?.id === entry.id;
          return (
            <button
              key={entry.id}
              ref={(node) => {
                if (node) triggerRefs.current.set(entry.id, node);
                else triggerRefs.current.delete(entry.id);
              }}
              type="button"
              className={`sidebar-rail__item${containsActive ? " is-active" : ""}${isOpen ? " is-open" : ""}`}
              aria-label={label}
              aria-haspopup="true"
              aria-expanded={isOpen}
              data-nav-row=""
              data-nav-rail=""
              data-nav-parent={entry.id}
              onMouseEnter={() => scheduleOpen(entry.id)}
              onMouseLeave={scheduleClose}
              onFocus={(event) => {
                // Keyboard focus previews the section; a mouse click navigates.
                if (suppressFocusOpen.current) return;
                if (event.currentTarget.matches(":focus-visible")) openFlyout(entry.id, false);
              }}
              onClick={() => {
                const first = entry.children[0];
                if (first) navigate(first.to);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter" || event.key === " ") {
                  event.preventDefault();
                  openFlyout(entry.id, true);
                } else if (event.key === "Escape" && isOpen) {
                  event.preventDefault();
                  closeFlyout();
                }
              }}
            >
              <TintedIconTile tone={entry.color} size="sm" className="sidebar__icon-chip">
                <Icon size={14} />
              </TintedIconTile>
            </button>
          );
        })}
      </div>
      {flyout && flyoutEntry && createPortal(
        <div
          ref={flyoutElRef}
          className="sidebar-flyout"
          role="group"
          aria-label={getParentLabel(flyoutEntry)}
          data-floating-layer=""
          style={{ top: flyout.top, left: flyout.left }}
          onMouseEnter={() => {
            if (closeTimer.current) window.clearTimeout(closeTimer.current);
          }}
          onMouseLeave={scheduleClose}
          onKeyDown={onFlyoutKeyDown}
        >
          <div className="sidebar-flyout__title">{getParentLabel(flyoutEntry)}</div>
          {flyoutEntry.children.map((child) => {
            const active = activeRoute === child.to;
            const Icon = child.icon;
            return (
              <Link
                key={child.to}
                to={child.to}
                className={`sidebar-flyout__item${active ? " is-active" : ""}`}
                aria-current={active ? "page" : undefined}
                onClick={() => closeFlyout()}
              >
                <span className="sidebar-flyout__icon" aria-hidden="true"><Icon size={14} /></span>
                <span className="sidebar-flyout__label">{getItemLabel(child)}</span>
                {renderCount(child)}
              </Link>
            );
          })}
        </div>,
        document.body,
      )}
    </div>
  );
}

const THEME_CYCLE = [
  { value: "light", label: "Light mode", Icon: Sun },
  { value: "dark", label: "Dark mode", Icon: Moon },
  { value: "system", label: "System theme", Icon: Monitor },
] as const;

/** The rail's one-button theme control: cycles light → dark → system. */
export function SidebarThemeCycleButton() {
  const { preference, setPreference } = useThemePreference();
  const index = Math.max(0, THEME_CYCLE.findIndex((option) => option.value === preference));
  const current = THEME_CYCLE[index];
  const next = THEME_CYCLE[(index + 1) % THEME_CYCLE.length];
  const Icon = current.Icon;
  return (
    <Tooltip content={`${current.label} — switch to ${next.label.toLowerCase()}`} placement="right" delay={250}>
      <button
        type="button"
        className="sidebar-rail__tool"
        aria-label={`Theme: ${current.label}. Switch to ${next.label.toLowerCase()}`}
        onClick={() => setPreference(next.value)}
      >
        <Icon size={14} />
      </button>
    </Tooltip>
  );
}

// ---------------------------------------------------------------------------
// Workspace area switcher (All · Governance · Finance)
// ---------------------------------------------------------------------------

/**
 * The tree narrowed to one area. A single remaining section (Finance) is
 * flattened so its pages read as the area's own top-level list, with the
 * area home (Financials overview) first.
 */
export function filterEntriesForArea(entries: VisibleNavEntry[], area: NavAreaChoice): VisibleNavEntry[] {
  if (area === "all") return entries;
  const kept = entries.filter((entry) => navEntryInArea(entry, area));
  if (kept.length === 1 && kept[0].kind === "parent") {
    return kept[0].children.map((child) => ({ kind: "item" as const, item: { ...child, treeLabel: undefined } }));
  }
  return kept;
}

type AreaSwitcherProps = {
  area: NavAreaChoice;
  labels: Record<NavAreaChoice, string>;
  onChange: (area: NavAreaChoice) => void;
};

const AREA_SHORTCUTS: Partial<Record<NavAreaChoice, ShortcutId>> = {
  all: "areaAll",
  governance: "areaGovernance",
  finance: "goFinancials",
};

/** Segmented radio group at the top of the expanded sidebar and the phone drawer. */
export function SidebarAreaSwitcher({ area, labels, onChange }: AreaSwitcherProps) {
  const { t } = useTranslation();
  const refs = useRef(new Map<NavAreaChoice, HTMLButtonElement>());
  const onKeyDown = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    const step = event.key === "ArrowRight" || event.key === "ArrowDown" ? 1 : event.key === "ArrowLeft" || event.key === "ArrowUp" ? -1 : 0;
    if (!step) return;
    event.preventDefault();
    const index = NAV_AREAS.findIndex((entry) => entry.id === area);
    const next = NAV_AREAS[(index + step + NAV_AREAS.length) % NAV_AREAS.length].id;
    onChange(next);
    refs.current.get(next)?.focus();
  };
  return (
    <div className="sidebar-area" role="radiogroup" aria-label={t("navArea.label", "Workspace area")} onKeyDown={onKeyDown}>
      {NAV_AREAS.map((entry) => {
        const selected = entry.id === area;
        const shortcut = AREA_SHORTCUTS[entry.id];
        const keys = shortcut ? ` (${SHORTCUTS[shortcut].keys.join(" then ")})` : "";
        return (
          <button
            key={entry.id}
            ref={(node) => {
              if (node) refs.current.set(entry.id, node);
              else refs.current.delete(entry.id);
            }}
            type="button"
            role="radio"
            aria-checked={selected}
            tabIndex={selected ? 0 : -1}
            className={`sidebar-area__btn${selected ? " is-active" : ""}`}
            title={`${t(`navArea.${entry.id}Hint`, labels[entry.id])}${keys}`}
            onClick={() => onChange(entry.id)}
          >
            {labels[entry.id]}
          </button>
        );
      })}
    </div>
  );
}

/** Rail mode: one button showing the current area's icon, opening a menu of areas. */
export function SidebarRailAreaButton({ area, labels, onChange }: AreaSwitcherProps) {
  const { t } = useTranslation();
  const current = NAV_AREAS.find((entry) => entry.id === area) ?? NAV_AREAS[0];
  const Icon = current.icon;
  const label = `${t("navArea.label", "Workspace area")}: ${labels[current.id]}`;
  return (
    <Menu
      minWidth={200}
      sections={[
        {
          id: "areas",
          label: t("navArea.label", "Workspace area"),
          items: NAV_AREAS.map((entry) => {
            const ItemIcon = entry.icon;
            return {
              id: entry.id,
              label: labels[entry.id],
              icon: <ItemIcon size={14} />,
              hint: entry.id === area ? t("navArea.current", "current") : undefined,
              onSelect: () => onChange(entry.id),
            };
          }),
        },
      ]}
      trigger={
        <button type="button" className={`sidebar-rail__tool sidebar-rail__area is-${area}`} aria-label={label} title={label} data-nav-row="">
          <Icon size={15} />
        </button>
      }
    />
  );
}
