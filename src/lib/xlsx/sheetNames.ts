/** Excel's sheet-name rules: ≤ 31 characters, none of [ ] : * ? / \, not blank,
 * not starting or ending with an apostrophe, and not the reserved "History". */
export const MAX_SHEET_NAME = 31;

export function sanitizeSheetName(name: string, fallback = "Sheet"): string {
  let clean = String(name ?? "")
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f[\]:*?/\\]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^'+|'+$/g, "")
    .trim();
  if (!clean) clean = fallback;
  if (clean.toLowerCase() === "history") clean = `${clean} sheet`;
  return truncate(clean, MAX_SHEET_NAME);
}

/** Sanitised names, made unique case-insensitively by appending " (2)", " (3)"… within the limit. */
export function uniqueSheetNames(names: string[]): string[] {
  const used = new Set<string>();
  return names.map((name, index) => {
    const base = sanitizeSheetName(name, `Sheet${index + 1}`);
    let candidate = base;
    for (let n = 2; used.has(candidate.toLowerCase()); n += 1) {
      const suffix = ` (${n})`;
      candidate = `${truncate(base, MAX_SHEET_NAME - suffix.length).trimEnd()}${suffix}`;
    }
    used.add(candidate.toLowerCase());
    return candidate;
  });
}

/** Cut on code points so an emoji is never split into a lone surrogate. */
function truncate(text: string, max: number) {
  // Excel counts UTF-16 units, so drop whole code points until that count fits.
  if (text.length <= max) return text;
  const points = Array.from(text);
  while (points.join("").length > max) points.pop();
  const out = points.join("");
  return out.replace(/'+$/g, "").trimEnd();
}

/** A sheet name as it appears in a reference: 'Name'!A1 with apostrophes doubled. */
export function quoteSheetName(name: string): string {
  return `'${name.replace(/'/g, "''")}'`;
}
