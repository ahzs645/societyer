import type { FieldDisplayProps } from "../FieldDisplay";

export function EmailFieldDisplay({ value }: FieldDisplayProps) {
  if (!value) return <span className="record-cell__empty">—</span>;
  const email = String(value);
  return (
    <a
      className="record-cell__link"
      href={`mailto:${email}`}
      onClick={(e) => e.stopPropagation()}
    >
      {email}
    </a>
  );
}
