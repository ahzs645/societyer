import type { CSSProperties } from "react";

/**
 * Column width as rendered: the saved size scaled by `--rt-stretch`, which
 * RecordTable sets so columns share spare width on wide screens instead of
 * leaving an empty strip while headers truncate. The saved size stays the
 * minimum, and resizing still works in saved-size units.
 */
export function columnWidthStyle(size: number): CSSProperties {
  const width = `calc(${size}px * var(--rt-stretch, 1))`;
  return { width, minWidth: width };
}
