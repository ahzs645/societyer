/**
 * Distinguishable import-session names (finding D-09).
 *
 * Batch names such as "Drive source review PGAIR mentioned 73" and
 * "…mentioned 74" were truncated to the identical "Drive source review
 * PGAIR…". This picks the part of each name that tells it apart from its
 * siblings: the words after the longest word-prefix it shares with any other
 * session, keeping a little of that prefix for context.
 */

export type SessionLabel = {
  /** Short label that differs between sibling sessions. */
  primary: string;
  /** The shared prefix that was dropped from `primary` (empty when none). */
  sharedPrefix: string;
  full: string;
};

function words(name: string) {
  return name.replace(/\s+/g, " ").trim().split(" ").filter(Boolean);
}

function commonWordPrefix(a: string[], b: string[]) {
  let index = 0;
  while (index < a.length && index < b.length && a[index].toLowerCase() === b[index].toLowerCase()) index += 1;
  return index;
}

export function distinguishSessionNames(names: string[], contextWords = 2): SessionLabel[] {
  const tokenized = names.map((name) => words(String(name ?? "")));
  return tokenized.map((tokens, index) => {
    const full = tokens.join(" ");
    let shared = 0;
    tokenized.forEach((other, otherIndex) => {
      if (otherIndex !== index) shared = Math.max(shared, commonWordPrefix(tokens, other));
    });
    // A name identical to (or a prefix of) a sibling keeps all of its words.
    if (shared >= tokens.length) shared = Math.max(0, tokens.length - 1);
    const keepFrom = Math.max(0, shared - contextWords);
    if (keepFrom === 0) return { primary: full || "Untitled session", sharedPrefix: "", full };
    return {
      primary: `…${tokens.slice(keepFrom).join(" ")}`,
      sharedPrefix: tokens.slice(0, keepFrom).join(" "),
      full,
    };
  });
}
