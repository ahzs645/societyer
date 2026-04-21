import type { FieldDisplayProps } from "../FieldDisplay";
import type { SelectFieldConfig, SelectOption } from "../../../types";
import { Tag, type TagColor } from "@/components/Tag";

/**
 * Read-only cell for a SELECT field. Renders the configured option as a
 * colored `<Tag />` (Twenty-style — 20px tall, 4px radius, solid bg).
 * Unknown values fall back to a gray tag with the raw value as the
 * label, so a renamed option still shows up in old rows.
 */
export function SelectFieldDisplay({ value, field }: FieldDisplayProps) {
  if (value === null || value === undefined || value === "") {
    return <span className="record-cell__empty">—</span>;
  }
  const config = field.config as SelectFieldConfig;
  const option =
    (config.options ?? []).find((o: SelectOption) => o.value === String(value)) ??
    ({ value: String(value), label: String(value), color: "gray" } as SelectOption);
  return (
    <Tag
      color={(option.color as TagColor | undefined) ?? "gray"}
      text={option.label}
      title={option.label}
    />
  );
}
