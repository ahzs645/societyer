/**
 * Split bylaw text into structured sections so amendments can be compared
 * section-by-section instead of as one whole-document blob. This is the
 * foundation for a meaningful per-section diff: re-ordering or re-OCRing a
 * single page (e.g. a mission-statement / abstract page) then aligns to that
 * section rather than showing the whole document as changed.
 *
 * Pure so it can be unit-tested in plain Node and reused by both bylaw redline
 * surfaces and any future structured-storage migration.
 */

import { type Chunk, tokenize, diffTokens, countChunkEdits } from "./wordDiff";

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

export type AlignedSectionPair = {
  key: string;
  base?: BylawSection;
  next?: BylawSection;
  /** Position of the section in the base version (undefined if added). */
  baseIndex?: number;
  /** Position of the section in the next version (undefined if removed). */
  nextIndex?: number;
};

/** Align two section lists by key for a section-aware diff: returns pairs where
 *  either side may be undefined (added / removed sections). Order follows the
 *  "next" version, with removed sections appended in their original order. Each
 *  pair carries its base/next index so a reordered section can be detected. */
export function alignBylawSections(
  base: BylawSection[],
  next: BylawSection[],
): AlignedSectionPair[] {
  const baseByKey = new Map<string, BylawSection>();
  const baseIndexByKey = new Map<string, number>();
  base.forEach((s, idx) => {
    if (!baseByKey.has(s.key)) {
      baseByKey.set(s.key, s);
      baseIndexByKey.set(s.key, idx);
    }
  });

  const pairs: AlignedSectionPair[] = [];
  const usedBaseKeys = new Set<string>();
  next.forEach((s, idx) => {
    const match = baseByKey.get(s.key);
    if (match) usedBaseKeys.add(s.key);
    pairs.push({
      key: s.key,
      base: match,
      next: s,
      baseIndex: match ? baseIndexByKey.get(s.key) : undefined,
      nextIndex: idx,
    });
  });
  base.forEach((s, idx) => {
    if (!usedBaseKeys.has(s.key)) {
      pairs.push({ key: s.key, base: s, next: undefined, baseIndex: idx, nextIndex: undefined });
    }
  });
  return pairs;
}

export type SectionStatus = "added" | "removed" | "moved" | "changed" | "unchanged";

export type SectionDiff = {
  key: string;
  /** Display heading (the next version's, falling back to the base's). */
  heading: string;
  status: SectionStatus;
  /** Word-level redline of the body. Empty for moved / unchanged sections (and
   *  when the body is too large — see `tooLarge`). */
  chunks: Chunk[];
  /** The per-section LCS exceeded the cell budget; render a plain snapshot. */
  tooLarge: boolean;
  adds: number;
  dels: number;
};

/** Longest common subsequence of two key sequences (keys are unique here). */
function lcsKeys(a: string[], b: string[]): string[] {
  const n = a.length, m = b.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = a[i] === b[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const out: string[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/** Section-aware diff: align clauses by normalized heading, then word-diff each
 *  matched pair's body independently. This is the wiring that makes re-adding a
 *  cover page or relocating the mission statement read as "moved, unchanged"
 *  instead of a whole-document rewrite.
 *
 *  Moved detection: among matched sections whose body is unchanged, the ones
 *  whose relative order changed (not part of the LCS of the shared key order)
 *  are flagged `moved`. Pure insertions/removals elsewhere don't shift the rest
 *  into "moved". A section whose body actually changed is `changed`, never
 *  `moved` — the substantive signal wins. */
export function diffBylawSections(
  oldText: string,
  newText: string,
  opts?: { maxCells?: number },
): SectionDiff[] {
  const maxCells = opts?.maxCells ?? 2_500_000;
  const pairs = alignBylawSections(parseBylawSections(oldText), parseBylawSections(newText));

  const stable = pairs.filter((p) => p.base && p.next && p.base.body === p.next.body);
  const byBase = stable.slice().sort((a, b) => (a.baseIndex ?? 0) - (b.baseIndex ?? 0)).map((p) => p.key);
  const byNext = stable.slice().sort((a, b) => (a.nextIndex ?? 0) - (b.nextIndex ?? 0)).map((p) => p.key);
  const keptInOrder = new Set(lcsKeys(byBase, byNext));
  const movedKeys = new Set(stable.map((p) => p.key).filter((k) => !keptInOrder.has(k)));

  return pairs.map((p) => {
    const heading = (p.next ?? p.base)!.heading || "Preamble";
    let status: SectionStatus;
    if (!p.base) status = "added";
    else if (!p.next) status = "removed";
    else if (p.base.body === p.next.body) status = movedKeys.has(p.key) ? "moved" : "unchanged";
    else status = "changed";

    let chunks: Chunk[] = [];
    let tooLarge = false;
    if (status === "added" || status === "removed" || status === "changed") {
      const oldTokens = tokenize(p.base?.body ?? "");
      const newTokens = tokenize(p.next?.body ?? "");
      if (oldTokens.length * newTokens.length > maxCells) tooLarge = true;
      else chunks = diffTokens(oldTokens, newTokens);
    }
    const { adds, dels } = countChunkEdits(chunks);
    return { key: p.key, heading, status, chunks, tooLarge, adds, dels };
  });
}
