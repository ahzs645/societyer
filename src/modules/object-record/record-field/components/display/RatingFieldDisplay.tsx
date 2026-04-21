import { Star } from "lucide-react";
import type { FieldDisplayProps } from "../FieldDisplay";
import type { RatingFieldConfig } from "../../../types";

export function RatingFieldDisplay({ value, field }: FieldDisplayProps) {
  const config = field.config as RatingFieldConfig;
  const max = config.max ?? 5;
  const rating = typeof value === "number" ? Math.max(0, Math.min(max, value)) : 0;
  if (rating === 0 && value === null) {
    return <span className="record-cell__empty">—</span>;
  }
  return (
    <span className="record-cell__rating" aria-label={`${rating} out of ${max}`}>
      {Array.from({ length: max }, (_, i) => (
        <Star
          key={i}
          size={12}
          className={i < rating ? "record-cell__rating-star--filled" : "record-cell__rating-star"}
        />
      ))}
    </span>
  );
}
