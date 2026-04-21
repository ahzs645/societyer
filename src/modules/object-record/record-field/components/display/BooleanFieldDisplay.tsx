import { Check, X } from "lucide-react";
import type { FieldDisplayProps } from "../FieldDisplay";
import type { BooleanFieldConfig } from "../../../types";

export function BooleanFieldDisplay({ value, field }: FieldDisplayProps) {
  const config = field.config as BooleanFieldConfig;
  if (value === null || value === undefined) {
    return <span className="record-cell__empty">—</span>;
  }
  const isTrue = value === true || value === "true" || value === 1 || value === "1";
  if (isTrue) {
    return (
      <span className="record-cell__boolean record-cell__boolean--true">
        <Check size={12} />
        {config.trueLabel ?? "Yes"}
      </span>
    );
  }
  return (
    <span className="record-cell__boolean record-cell__boolean--false">
      <X size={12} />
      {config.falseLabel ?? "No"}
    </span>
  );
}
