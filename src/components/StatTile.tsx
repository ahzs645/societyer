import { Children, useRef, type ReactNode } from "react";
import { useScrollOverflow } from "../hooks/useScrollOverflow";
import { Link } from "react-router-dom";
import { ArrowDownRight, ArrowRight, ArrowUpRight } from "lucide-react";
import { InfoPopover } from "./InfoPopover";

export type StatTileTone = "neutral" | "ok" | "danger" | "warn" | "info";

export type StatTileTrend = {
  /** The delta as shown, e.g. "+12%", "3 more" or a <Money> node. */
  value: ReactNode;
  /** Arrow direction. Defaults to flat. */
  direction?: "up" | "down" | "flat";
  /** Colour by meaning, not by sign: true = green, false = red, omitted = neutral. */
  favourable?: boolean;
  /** Trailing context, e.g. "vs last year". */
  label?: ReactNode;
};

export type StatTileProps = {
  /** Short label, rendered as an eyebrow above the value. */
  label: ReactNode;
  /** The figure. A ReactNode so callers can pass <Money variant="hero" />, <RollingNumber /> etc. */
  value: ReactNode;
  /** Optional one-line context under the value. */
  sub?: ReactNode;
  /** Colours the sub-line only (e.g. a warning count) while the value stays neutral. */
  subTone?: Exclude<StatTileTone, "neutral">;
  /** Colours the value. The tile itself stays quiet. */
  tone?: StatTileTone;
  /** Small icon shown before the label. */
  icon?: ReactNode;
  /** Background for the figure, shown in an ⓘ popover next to the label. */
  info?: ReactNode;
  /** Accessible name for the ⓘ button. Defaults to "About <label>" when label is a string. */
  infoLabel?: string;
  trend?: StatTileTrend;
  /** Makes the whole tile a link to this in-app route. */
  href?: string;
  /** Makes the whole tile a button. Ignored when href is set. */
  onClick?: () => void;
  /** With onClick: renders a toggle (aria-pressed) and marks the tile selected, e.g. a quick filter. */
  pressed?: boolean;
  /** Accessible name for the link/button. Defaults to the label when it is a string. */
  actionLabel?: string;
  /** Smaller value type for long text values (names, dates). */
  compact?: boolean;
  className?: string;
};

/**
 * The one stat tile used across pages: eyebrow label, value, optional
 * sub-line, trend and ⓘ background. With `href`/`onClick` the whole tile is
 * clickable (a stretched link/button, so the ⓘ stays its own control) and
 * lifts to elevation 2 on hover.
 *
 * Render several inside `.stat-grid` (or `.stat-grid stat-grid--3`).
 */
export function StatTile({
  label,
  value,
  sub,
  subTone,
  tone = "neutral",
  icon,
  info,
  infoLabel,
  trend,
  href,
  onClick,
  pressed,
  actionLabel,
  compact,
  className,
}: StatTileProps) {
  const interactive = Boolean(href || onClick);
  const labelText = typeof label === "string" ? label : undefined;
  const classes = ["stat", "stat-tile"];
  if (tone !== "neutral") classes.push(`stat--${tone}`, `stat-tile--${tone}`);
  if (info) classes.push("stat--has-tooltip");
  if (interactive) classes.push("stat-tile--interactive");
  if (compact) classes.push("stat-tile--compact");
  if (onClick && !href && pressed) classes.push("is-selected");
  if (className) classes.push(className);

  const labelContent = (
    <>
      {icon && <span className="stat-tile__icon" aria-hidden="true">{icon}</span>}
      <span className="stat-tile__label-text">{label}</span>
    </>
  );

  let labelNode: ReactNode;
  if (href) {
    labelNode = (
      <Link to={href} className="stat__label stat-tile__action" aria-label={actionLabel}>
        {labelContent}
      </Link>
    );
  } else if (onClick) {
    labelNode = (
      <button
        type="button"
        className="stat__label stat-tile__action"
        onClick={onClick}
        aria-label={actionLabel}
        aria-pressed={pressed === undefined ? undefined : pressed}
      >
        {labelContent}
      </button>
    );
  } else {
    labelNode = <div className="stat__label">{labelContent}</div>;
  }

  return (
    <div className={classes.join(" ")}>
      {labelNode}
      {info && (
        <span className="stat__info stat-tile__info">
          <InfoPopover label={infoLabel ?? (labelText ? `About ${labelText}` : "About this figure")}>{info}</InfoPopover>
        </span>
      )}
      <div className="stat__value">{value}</div>
      {trend && <StatTileTrendLine trend={trend} />}
      {sub != null && sub !== false && sub !== "" && (
        <div className={subTone ? `stat__sub stat__sub--${subTone}` : "stat__sub"}>{sub}</div>
      )}
    </div>
  );
}

function StatTileTrendLine({ trend }: { trend: StatTileTrend }) {
  const direction = trend.direction ?? "flat";
  const Icon = direction === "up" ? ArrowUpRight : direction === "down" ? ArrowDownRight : ArrowRight;
  const meaning = trend.favourable === true ? "favourable" : trend.favourable === false ? "unfavourable" : "neutral";
  return (
    <div className={`stat-tile__trend stat-tile__trend--${meaning}`}>
      <Icon size={12} aria-hidden="true" />
      <span className="stat-tile__trend-value">{trend.value}</span>
      {trend.label && <span className="stat-tile__trend-label">{trend.label}</span>}
    </div>
  );
}

/**
 * Summary tiles above a list. Desktop and tablet keep the stat grid; on
 * phones the tiles form one row that fills the width when they fit and
 * otherwise scrolls, fading the clipped edge so a cut tile reads as
 * "swipe for more".
 */
export function StatStrip({ children, className, ariaLabel }: { children: ReactNode; className?: string; ariaLabel?: string }) {
  const ref = useRef<HTMLDivElement>(null);
  const overflow = useScrollOverflow(ref, [Children.count(children)]);
  return (
    <div
      ref={ref}
      className={`stat-grid stat-grid--scroll-phone${className ? ` ${className}` : ""}`}
      role={ariaLabel ? "group" : undefined}
      aria-label={ariaLabel}
      data-overflow={overflow}
    >
      {children}
    </div>
  );
}
