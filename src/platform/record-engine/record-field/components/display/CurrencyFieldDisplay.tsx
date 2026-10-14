import type { FieldDisplayProps } from "../FieldDisplay";
import type { CurrencyFieldConfig } from "../../../types";
import { Money } from "@/components/Money";
import { DEFAULT_CURRENCY } from "@/lib/money";

/**
 * Amount cell. Goes through `<Money>` so every currency column shares one
 * convention: CAD unless the field names another currency, fixed two
 * decimals, tabular digits and a minus-sign negative.
 */
export function CurrencyFieldDisplay({ value, field }: FieldDisplayProps) {
  if (value === null || value === undefined || value === "") {
    return <span className="record-cell__empty">—</span>;
  }
  const config = (field.config ?? {}) as CurrencyFieldConfig;
  const num = Number(value);
  if (!Number.isFinite(num)) {
    return <span className="record-cell__text">{String(value)}</span>;
  }
  const cents = config.isCents ? num : Math.round(num * 100);
  return (
    <span className="record-cell__number">
      <Money cents={cents} currency={config.currencyCode || DEFAULT_CURRENCY} />
    </span>
  );
}
