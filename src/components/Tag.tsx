import type { ReactNode } from "react";

/**
 * A semantic, colored chip/tag — the visual identity used anywhere we
 * display a categorical value (SELECT cells, multi-select lists, status
 * badges in menus, etc).
 *
 * Modelled after Twenty CRM's `<Tag />`:
 *   - Fixed 20px height, 4px radius (crisp, not pillshaped).
 *   - 8px horizontal padding, 4px internal gap.
 *   - Three variants: `solid` (tonal bg), `outline` (dashed border), `border`
 *     (solid border). Outline is used for the "no value / clear" row in a
 *     select menu.
 *   - A `transparent` color falls back to neutral text, no background.
 *
 * The color palette lives in `_record-table.scss` under the
 * `$chip-tones` map; add a new entry there to teach the component a new
 * tone.
 */

export type TagColor =
  | "blue"
  | "green"
  | "red"
  | "amber"
  | "purple"
  | "teal"
  | "gray"
  | "pink"
  | "violet"
  | "transparent";

const KNOWN_COLORS: readonly TagColor[] = [
  "blue",
  "green",
  "red",
  "amber",
  "purple",
  "teal",
  "gray",
  "pink",
  "violet",
  "transparent",
] as const;

export type TagVariant = "solid" | "outline" | "border";
export type TagWeight = "regular" | "medium";

type TagProps = {
  color?: TagColor | string;
  text: ReactNode;
  icon?: ReactNode;
  variant?: TagVariant;
  weight?: TagWeight;
  title?: string;
  className?: string;
};

export function Tag({
  color = "gray",
  text,
  icon,
  variant = "solid",
  weight = "medium",
  title,
  className,
}: TagProps) {
  // Defensive: configs come from Convex, so an unknown color string
  // should degrade to a neutral gray chip rather than render an
  // un-styled span.
  const safeColor = (KNOWN_COLORS.includes(color as TagColor) ? color : "gray") as TagColor;
  const classes = [
    "ui-tag",
    `ui-tag--${safeColor}`,
    `ui-tag--${variant}`,
    `ui-tag--${weight}`,
  ];
  if (className) classes.push(className);
  return (
    <span className={classes.join(" ")} title={title}>
      {icon && <span className="ui-tag__icon">{icon}</span>}
      <span className="ui-tag__text">{text}</span>
    </span>
  );
}
