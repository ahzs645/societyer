/**
 * Turns server copy written with "(s)" placeholders into real plurals:
 * "1 director(s) missing" -> "1 director missing",
 * "1 of 7 active director(s)" -> "1 of 7 active directors".
 * The count is the nearest number before the word.
 */
export function pluralizeCounts(text: string): string {
  if (!text || !text.includes("(s)")) return text;
  return text.replace(/\b(\d+)((?:\s+[A-Za-z-]+)*?)\s+([A-Za-z-]+)\(s\)/g, (_match, count: string, middle: string, word: string) => {
    const plural = Number(count) === 1 ? word : `${word}s`;
    return `${count}${middle} ${plural}`;
  }).replace(/\(s\)/g, "s");
}
