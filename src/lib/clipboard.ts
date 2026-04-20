import type { ReactNode } from "react";
import { isValidElement } from "react";

/** Flattens a React-rendered cell into a plain string suitable for a TSV
 * clipboard payload. Best-effort: strips tags, keeps text content. */
export function cellToText(node: ReactNode): string {
  if (node == null || typeof node === "boolean") return "";
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(cellToText).join("");
  if (isValidElement(node)) {
    return cellToText((node.props as any).children);
  }
  return "";
}

/** Write rows as TSV to the clipboard. Returns true on success. */
export async function copyAsTsv(rows: string[][]): Promise<boolean> {
  const text = rows.map((r) => r.map(escapeTsvCell).join("\t")).join("\n");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    return false;
  }
}

function escapeTsvCell(value: string): string {
  // Tabs and newlines would break the TSV row structure. Strip them.
  return value.replace(/\t/g, " ").replace(/\r?\n/g, " ");
}
