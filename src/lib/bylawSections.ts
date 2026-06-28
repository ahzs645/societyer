/**
 * Split bylaw text into structured sections so amendments can be compared
 * section-by-section instead of as one whole-document blob. This is the
 * foundation for a meaningful per-section diff: re-ordering or re-OCRing a
 * single page (e.g. a mission-statement / abstract page) then aligns to that
 * section rather than showing the whole document as changed.
 *
 * Pure and dependency-free so it can be unit-tested in plain Node and reused by
 * both the diff UI and any future structured-storage migration.
 */

export type BylawSection = {
  /** Section heading text (empty for the leading preamble). */
  heading: string;
  /** Heading depth: 0 = preamble, 1 = top-level (Part/#), 2+ = nested. */
  level: number;
  /** A stable, normalized key for aligning sections across versions. */
  key: string;
  /** The body text under the heading (excludes the heading line). */
  body: string;
};

/** Recognize a heading line and return its level, or 0 if it isn't one. */
function headingLevel(line: string): number {
  const trimmed = line.trim();
  if (!trimmed) return 0;
  // Markdown ATX heading: ##, ###, …
  const md = /^(#{1,6})\s+\S/.exec(trimmed);
  if (md) return md[1].length;
  // "Part I", "Division 2", "Article 3", "Schedule A" → top-level.
  if (/^(part|division|article|schedule|appendix)\b/i.test(trimmed)) return 1;
  // "Section 4." / "4." / "4.2 Title" → numbered section (nested under parts).
  if (/^\s*section\b/i.test(trimmed)) return 2;
  if (/^\d+(\.\d+)*\.?\s+\S/.test(trimmed)) return 2;
  return 0;
}

/** Normalize a heading into an alignment key (lowercased, punctuation/number
 *  prefixes stripped, whitespace collapsed). Empty headings key as "preamble". */
export function bylawSectionKey(heading: string): string {
  const withoutMarker = heading.replace(/^#{1,6}\s+/, "");
  const normalize = (s: string) =>
    s.toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  // Prefer the title with the Part/Section label and number stripped, so the
  // same clause aligns across versions even if it's renumbered or reformatted.
  const title = normalize(
    withoutMarker
      .replace(/^(part|division|article|schedule|appendix|section)\b[\s:.-]*/i, "")
      .replace(/^\d+(\.\d+)*\.?\s*/, ""),
  );
  if (title) return title;
  // No title (e.g. a bare "Part 1") — keep the label+number as identity rather
  // than collapsing to the preamble.
  return normalize(withoutMarker) || "preamble";
}

/** Parse bylaw text into ordered sections. Text before the first heading is a
 *  level-0 "preamble" section (only emitted when non-empty). */
export function parseBylawSections(text: string): BylawSection[] {
  const lines = String(text ?? "").split(/\r?\n/);
  const sections: BylawSection[] = [];
  let current: { heading: string; level: number; bodyLines: string[] } = {
    heading: "",
    level: 0,
    bodyLines: [],
  };

  const flush = () => {
    const body = current.bodyLines.join("\n").trim();
    if (current.heading || body) {
      sections.push({
        heading: current.heading,
        level: current.level,
        key: bylawSectionKey(current.heading),
        body,
      });
    }
  };

  for (const line of lines) {
    const level = headingLevel(line);
    if (level > 0) {
      flush();
      current = { heading: line.trim(), level, bodyLines: [] };
    } else {
      current.bodyLines.push(line);
    }
  }
  flush();
  return sections;
}

/** Align two section lists by key for a section-aware diff: returns pairs where
 *  either side may be undefined (added / removed sections). Order follows the
 *  "next" version, with removed sections appended in their original order. */
export function alignBylawSections(
  base: BylawSection[],
  next: BylawSection[],
): { key: string; base?: BylawSection; next?: BylawSection }[] {
  const baseByKey = new Map<string, BylawSection>();
  for (const s of base) if (!baseByKey.has(s.key)) baseByKey.set(s.key, s);

  const pairs: { key: string; base?: BylawSection; next?: BylawSection }[] = [];
  const usedBaseKeys = new Set<string>();
  for (const s of next) {
    const match = baseByKey.get(s.key);
    if (match) usedBaseKeys.add(s.key);
    pairs.push({ key: s.key, base: match, next: s });
  }
  for (const s of base) {
    if (!usedBaseKeys.has(s.key)) pairs.push({ key: s.key, base: s, next: undefined });
  }
  return pairs;
}
