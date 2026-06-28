/**
 * Word-level diff (longest-common-subsequence) shared by the bylaw redline
 * surfaces. Pure and dependency-free so it can be unit-tested in plain Node and
 * reused by BylawDiff, BylawsHistory, and the section-aware diff helpers.
 *
 * Previously this was copy-pasted into both bylaw pages; centralising it keeps
 * the two redlines from drifting.
 */

export type Chunk = { kind: "same" | "add" | "del"; text: string };

/** Split a string into diffable tokens: runs of whitespace, words (incl.
 *  accented letters), or single punctuation characters. */
export function tokenize(s: string): string[] {
  return String(s ?? "").match(/(\s+|[\wÀ-ÿ]+|[^\s\w])/g) ?? [];
}

/** Word-level diff of two token arrays via an LCS table. O(n·m) time/space —
 *  guard large inputs with `maxCells` at the call site. */
export function diffTokens(oldTokens: string[], newTokens: string[]): Chunk[] {
  const n = oldTokens.length;
  const m = newTokens.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] = oldTokens[i] === newTokens[j]
        ? dp[i + 1][j + 1] + 1
        : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }
  const chunks: Chunk[] = [];
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (oldTokens[i] === newTokens[j]) { chunks.push({ kind: "same", text: oldTokens[i] }); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { chunks.push({ kind: "del", text: oldTokens[i] }); i++; }
    else { chunks.push({ kind: "add", text: newTokens[j] }); j++; }
  }
  while (i < n) chunks.push({ kind: "del", text: oldTokens[i++] });
  while (j < m) chunks.push({ kind: "add", text: newTokens[j++] });
  return chunks;
}

/** Convenience: diff two raw strings. */
export function diffText(oldText: string, newText: string): Chunk[] {
  return diffTokens(tokenize(oldText), tokenize(newText));
}

/** Count non-whitespace added / deleted tokens in a chunk list. */
export function countChunkEdits(chunks: Chunk[]): { adds: number; dels: number } {
  let adds = 0, dels = 0;
  for (const c of chunks) {
    if (c.kind === "add") adds += c.text.trim() ? 1 : 0;
    if (c.kind === "del") dels += c.text.trim() ? 1 : 0;
  }
  return { adds, dels };
}

export function wordCount(text: string): number {
  return String(text ?? "").match(/[\wÀ-ÿ]+/g)?.length ?? 0;
}
