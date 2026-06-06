import { ReactNode, useEffect, useRef, useState } from "react";
import { List, Filter, FilterX, ArrowUpDown, MoreHorizontal, ChevronDown, Pin, PinOff, X } from "lucide-react";
import { MenuSectionLabel, Pill, TintedIconTile } from "./ui";
import type { SavedView } from "../lib/savedViews";
import { useUIStore } from "../lib/store";

export function ViewBar({
  label,
  count,
  icon,
  onFilter,
  onAdvanced,
  advancedActive,
  onSort,
  onOptions,
  extra,
  filterBtnRef,
  sortBtnRef,
  optionsBtnRef,
  savedViews,
  activeViewId,
  viewsKey,
  onApplyView,
  onSaveView,
  onDeleteView,
  onTogglePinView,
}: {
  label: string;
  count?: number;
  icon?: ReactNode;
  onFilter?: () => void;
  onAdvanced?: () => void;
  advancedActive?: boolean;
  onSort?: () => void;
  onOptions?: () => void;
  extra?: ReactNode;
  filterBtnRef?: React.RefObject<HTMLButtonElement>;
  sortBtnRef?: React.RefObject<HTMLButtonElement>;
  optionsBtnRef?: React.RefObject<HTMLButtonElement>;
  savedViews?: SavedView[];
  activeViewId?: string | null;
  viewsKey?: string;
  onApplyView?: (view: SavedView) => void;
  onSaveView?: (name: string) => void;
  onDeleteView?: (id: string) => void;
  onTogglePinView?: (view: SavedView) => void;
}) {
  const viewsEnabled = Boolean(savedViews);
  const [viewsOpen, setViewsOpen] = useState(false);
  const viewPillRef = useRef<HTMLButtonElement>(null);
  const activeView = savedViews?.find((v) => v.id === activeViewId);
  const displayLabel = activeView?.name ?? label;

  return (
    <div className="view-bar">
      {viewsEnabled ? (
        <button
          className="view-pill"
          type="button"
          ref={viewPillRef}
          onClick={() => setViewsOpen((v) => !v)}
          aria-haspopup="menu"
          aria-expanded={viewsOpen}
        >
          <TintedIconTile tone="gray" size="sm" className="view-pill__icon">
            {icon ?? <List size={14} />}
          </TintedIconTile>
          <span>{displayLabel}</span>
          {count != null && (
            <Pill size="sm" className="view-pill__count">
              {count}
            </Pill>
          )}
          <ChevronDown size={12} style={{ color: "var(--text-tertiary)" }} />
        </button>
      ) : (
        <span className="view-pill view-pill--static">
          <TintedIconTile tone="gray" size="sm" className="view-pill__icon">
            {icon ?? <List size={14} />}
          </TintedIconTile>
          <span>{displayLabel}</span>
          {count != null && (
            <Pill size="sm" className="view-pill__count">
              {count}
            </Pill>
          )}
        </span>
      )}
      {viewsOpen && viewsEnabled && (
        <ViewsPopover
          savedViews={savedViews ?? []}
          activeViewId={activeViewId ?? null}
          viewsKey={viewsKey}
          onApplyView={(view) => {
            onApplyView?.(view);
            setViewsOpen(false);
          }}
          onSaveView={(name) => onSaveView?.(name)}
          onDeleteView={(id) => onDeleteView?.(id)}
          onTogglePinView={(view) => onTogglePinView?.(view)}
          anchorRef={viewPillRef}
          onClose={() => setViewsOpen(false)}
        />
      )}
      {(onFilter || onAdvanced || onSort || onOptions) && (
        <>
          <div className="view-bar__sep" />
          <div className="view-bar__group">
            {onFilter && (
              <button className="view-bar__btn" type="button" onClick={onFilter} ref={filterBtnRef}>
                <Filter size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                Filter
              </button>
            )}
            {onAdvanced && (
              <button
                className={`view-bar__btn${advancedActive ? " is-active" : ""}`}
                type="button"
                onClick={onAdvanced}
                title="Advanced filter"
              >
                <FilterX size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                Advanced
              </button>
            )}
            {onSort && (
              <button className="view-bar__btn" type="button" onClick={onSort} ref={sortBtnRef}>
                <ArrowUpDown size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                Sort
              </button>
            )}
            {onOptions && (
              <button className="view-bar__btn" type="button" onClick={onOptions} ref={optionsBtnRef}>
                <MoreHorizontal size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                Options
              </button>
            )}
          </div>
        </>
      )}
      {extra && (
        <>
          <div className="view-bar__sep" />
          <div className="view-bar__group">{extra}</div>
        </>
      )}
    </div>
  );
}

function ViewsPopover({
  savedViews,
  activeViewId,
  viewsKey,
  onApplyView,
  onSaveView,
  onDeleteView,
  onTogglePinView,
  anchorRef,
  onClose,
}: {
  savedViews: SavedView[];
  activeViewId: string | null;
  viewsKey?: string;
  onApplyView: (view: SavedView) => void;
  onSaveView: (name: string) => void;
  onDeleteView: (id: string) => void;
  onTogglePinView: (view: SavedView) => void;
  anchorRef: React.RefObject<HTMLElement>;
  onClose: () => void;
}) {
  const [newViewName, setNewViewName] = useState("");
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const onDoc = (e: MouseEvent) => {
      if (!ref.current) return;
      if (ref.current.contains(e.target as Node)) return;
      if (anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const timer = window.setTimeout(() => document.addEventListener("mousedown", onDoc), 0);
    return () => {
      window.clearTimeout(timer);
      document.removeEventListener("mousedown", onDoc);
    };
  }, [onClose, anchorRef]);

  const rect = anchorRef.current?.getBoundingClientRect();
  const margin = 8;
  const style = rect
    ? {
        top: Math.max(margin, Math.min(rect.bottom + 4, window.innerHeight - 320 - margin)),
        left: Math.max(margin, Math.min(rect.left, window.innerWidth - 260 - margin)),
      }
    : { top: 48, left: 16 };

  return (
    <div className="popover" ref={ref} style={style}>
      <MenuSectionLabel>Saved views</MenuSectionLabel>
      {savedViews.length === 0 && (
        <div className="empty-state empty-state--sm empty-state--start">
          No saved views yet.
        </div>
      )}
      {savedViews.map((view) => {
        const pinned = viewsKey ? useUIStore.getState().isViewPinned(viewsKey, view.id) : false;
        return (
          <div key={view.id} className="options-popover__view-row">
            <button
              type="button"
              className={`options-popover__view-name${activeViewId === view.id ? " is-active" : ""}`}
              onClick={() => onApplyView(view)}
              title="Apply this view"
            >
              {view.name}
            </button>
            <button
              type="button"
              className="options-popover__view-del"
              onClick={() => onTogglePinView(view)}
              aria-label={pinned ? `Unpin ${view.name}` : `Pin ${view.name} to sidebar`}
              title={pinned ? "Unpin from sidebar" : "Pin to sidebar"}
            >
              {pinned ? <PinOff size={10} /> : <Pin size={10} />}
            </button>
            {!view.isSystem && (
              <button
                type="button"
                className="options-popover__view-del"
                onClick={() => onDeleteView(view.id)}
                aria-label={`Delete view ${view.name}`}
              >
                <X size={10} />
              </button>
            )}
          </div>
        );
      })}
      <div className="options-popover__save-row">
        <input
          className="options-popover__save-input"
          placeholder="Save current view as…"
          value={newViewName}
          onChange={(e) => setNewViewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && newViewName.trim()) {
              onSaveView(newViewName);
              setNewViewName("");
            }
          }}
        />
        <button
          type="button"
          className="btn-action btn-action--primary"
          disabled={!newViewName.trim()}
          onClick={() => {
            onSaveView(newViewName);
            setNewViewName("");
          }}
        >
          Save
        </button>
      </div>
    </div>
  );
}


export function Tabs<T extends string>({
  value,
  onChange,
  items,
  trailing,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number | null; icon?: ReactNode }[];
  trailing?: ReactNode;
}) {
  return (
    <div className="tabs">
      {items.map((it) => (
        <button
          key={it.id}
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
