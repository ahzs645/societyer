import { ReactNode } from "react";
import { List, Filter, ArrowUpDown, MoreHorizontal, ChevronDown } from "lucide-react";
import { Pill, TintedIconTile } from "./ui";

export function ViewBar({
  label,
  count,
  icon,
  onFilter,
  onSort,
  onOptions,
  extra,
  filterBtnRef,
  sortBtnRef,
  optionsBtnRef,
}: {
  label: string;
  count?: number;
  icon?: ReactNode;
  onFilter?: () => void;
  onSort?: () => void;
  onOptions?: () => void;
  extra?: ReactNode;
  filterBtnRef?: React.RefObject<HTMLButtonElement>;
  sortBtnRef?: React.RefObject<HTMLButtonElement>;
  optionsBtnRef?: React.RefObject<HTMLButtonElement>;
}) {
  return (
    <div className="view-bar">
      <button className="view-pill" type="button">
        <TintedIconTile tone="gray" size="sm" className="view-pill__icon">
          {icon ?? <List size={14} />}
        </TintedIconTile>
        <span>{label}</span>
        {count != null && (
          <Pill size="sm" className="view-pill__count">
            {count}
          </Pill>
        )}
        <ChevronDown size={12} style={{ color: "var(--text-tertiary)" }} />
      </button>
      {(onFilter || onSort || onOptions) && (
        <>
          <div className="view-bar__sep" />
          <div className="view-bar__group">
            {onFilter && (
              <button className="view-bar__btn" type="button" onClick={onFilter} ref={filterBtnRef}>
                <Filter size={12} style={{ marginRight: 4, verticalAlign: -2 }} />
                Filter
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


export function Tabs<T extends string>({
  value,
  onChange,
  items,
}: {
  value: T;
  onChange: (v: T) => void;
  items: { id: T; label: string; count?: number | null; icon?: ReactNode }[];
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
          {it.label}
          {it.count != null && <Pill size="sm" className="tab__count">{it.count}</Pill>}
        </button>
      ))}
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
