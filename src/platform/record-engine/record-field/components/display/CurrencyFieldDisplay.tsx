import type { FieldDisplayProps } from "../FieldDisplay";
import type { CurrencyFieldConfig } from "../../../types";

export function CurrencyFieldDisplay({ value, field }: FieldDisplayProps) {
  if (value === null || value === undefined || value === "") {
    return <span className="record-cell__empty">—</span>;
  }
  const config = field.config as CurrencyFieldConfig;
  let num = Number(value);
  if (Number.isNaN(num)) {
    return <span className="record-cell__text">{String(value)}</span>;
  }
  if (config.isCents) num = num / 100;
  const currency = config.currencyCode ?? "USD";
  try {
    const formatted = new Intl.NumberFormat(undefined, {
      style: "currency",
      currency,
      minimumFractionDigits: config.decimals ?? 2,
      maximumFractionDigits: config.decimals ?? 2,
    }).format(num);
    return <span className="record-cell__number mono">{formatted}</span>;
  } catch {
    return <span className="record-cell__number mono">{num.toFixed(2)}</span>;
  }
}
