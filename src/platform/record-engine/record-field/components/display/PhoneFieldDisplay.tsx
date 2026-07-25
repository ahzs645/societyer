import type { FieldDisplayProps } from "../FieldDisplay";

export function PhoneFieldDisplay({ value }: FieldDisplayProps) {
  if (!value) return <span className="record-cell__empty">—</span>;
  const phone = String(value);
  return (
    <a
      className="record-cell__link"
      href={`tel:${phone.replace(/[^\d+]/g, "")}`}
      onClick={(e) => e.stopPropagation()}
    >
      {phone}
    </a>
  );
}
