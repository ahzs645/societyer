import { formatMoney, splitMoney, type MoneyDirection, type NegativeStyle } from "../lib/money";

type MoneyProps = {
  /** Integer cents. */
  cents: number | null | undefined;
  currency?: string;
  /**
   * Colour by meaning. "auto" keeps amounts neutral (most tables); "in"/"out"
   * mark money direction; "favourable"/"unfavourable" mark variances.
   */
  tone?: "auto" | MoneyDirection | "favourable" | "unfavourable";
  /** "hero" de-emphasises cents for headline balances. */
  variant?: "default" | "hero";
  negativeStyle?: NegativeStyle;
  signDisplay?: "auto" | "always" | "exceptZero";
  /** Drop ".00" on whole amounts. Only for prose and stat tiles. */
  trimWholeCents?: boolean;
  /** Strike through voided/reversed amounts. */
  struck?: boolean;
  className?: string;
  empty?: string;
};

/**
 * Tabular, right-aligned-friendly money. Use for every amount in a table,
 * statement, total or stat so digits line up and sign/colour rules match.
 */
export function Money({
  cents,
  currency,
  tone = "auto",
  variant = "default",
  negativeStyle,
  signDisplay,
  trimWholeCents,
  struck,
  className,
  empty,
}: MoneyProps) {
  const options = { currency, negativeStyle, signDisplay, trimWholeCents, empty };
  const classes = ["money", tone !== "auto" ? `money--${tone}` : "", variant === "hero" ? "money--hero" : "", struck ? "money--struck" : "", className ?? ""]
    .filter(Boolean)
    .join(" ");
  if (cents == null || !Number.isFinite(cents)) {
    return <span className={`${classes} money--empty`}>{empty ?? "—"}</span>;
  }
  if (variant === "hero" && !trimWholeCents) {
    const { whole, fraction } = splitMoney(cents, options);
    return (
      <span className={classes} aria-label={formatMoney(cents, options)}>
        <span aria-hidden="true">{whole}</span>
        {fraction && <span className="money__cents" aria-hidden="true">{fraction}</span>}
      </span>
    );
  }
  return <span className={classes}>{formatMoney(cents, options)}</span>;
}
