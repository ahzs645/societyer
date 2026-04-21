import { ExternalLink } from "lucide-react";
import type { FieldDisplayProps } from "../FieldDisplay";

export function LinkFieldDisplay({ value }: FieldDisplayProps) {
  if (!value) return <span className="record-cell__empty">—</span>;
  const url = String(value);
  let display = url;
  try {
    const parsed = new URL(url);
    display = parsed.hostname + (parsed.pathname === "/" ? "" : parsed.pathname);
  } catch {
    /* keep raw */
  }
  return (
    <a
      className="record-cell__link"
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => e.stopPropagation()}
    >
      {display}
      <ExternalLink size={10} />
    </a>
  );
}
