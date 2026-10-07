/** Finds a locator's quote inside rendered source (docx-preview DOM, a pdf.js
 * text layer, the block view) and highlights it. Matching ignores case,
 * whitespace runs and bullets, the same tolerance span verification uses. */

const MARK_CLASS = "intake-hl";

function normalizeChar(char: string): string {
  if (/\s/.test(char)) return " ";
  if (/[‘’]/.test(char)) return "'";
  if (/[“”]/.test(char)) return '"';
  if (/[–—]/.test(char)) return "-";
  return char.toLowerCase();
}

/** Normalised text plus a map from each normalised character to its source offset. */
export function normalizeWithMap(value: string): { text: string; map: number[] } {
  let text = "";
  const map: number[] = [];
  for (let index = 0; index < value.length; index++) {
    // List glyphs are often CSS-generated in renderings but present in extracted text.
    if (/[•●▪◦]/.test(value[index])) continue;
    const char = normalizeChar(value[index]);
    if (char === " " && (text.endsWith(" ") || !text.length)) continue;
    text += char;
    map.push(index);
  }
  return { text, map };
}

/** Candidate needles for a quote: as written, without bullets/leading markers, then a prefix. */
export function quoteNeedles(quote: string): string[] {
  const base = normalizeWithMap(quote).text.trim();
  const stripped = base.replace(/^(?:[•●▪◦·*\-–]+|\(?[a-z0-9]{1,3}[.)])\s*/i, "").trim();
  const needles = [base, stripped];
  if (stripped.length > 48) needles.push(stripped.slice(0, 48));
  return [...new Set(needles.filter((needle) => needle.length >= 2))];
}

/** Offsets [start, end) of the quote within `haystack`, or null. With `context` (the
 * locator's cell or block text), the occurrence inside that context wins, so a
 * name quoted in a motion is not confused with the same name in the attendance list. */
export function findQuote(haystack: string, quote: string, context?: string): [number, number] | null {
  const { text, map } = normalizeWithMap(haystack);
  const find = (from: number, to: number): [number, number] | null => {
    for (const needle of quoteNeedles(quote)) {
      const at = text.indexOf(needle, from);
      if (at >= 0 && at + needle.length <= to) return [map[at], map[at + needle.length - 1] + 1];
    }
    return null;
  };
  if (context && context.trim().length > quote.trim().length) {
    for (const needle of quoteNeedles(context)) {
      let at = text.indexOf(needle);
      while (at >= 0) {
        const found = find(at, at + needle.length);
        if (found) return found;
        at = text.indexOf(needle, at + 1);
      }
    }
  }
  return find(0, text.length);
}

export function clearHighlights(root: HTMLElement) {
  for (const mark of Array.from(root.querySelectorAll(`mark.${MARK_CLASS}`))) {
    const parent = mark.parentNode;
    if (!parent) continue;
    while (mark.firstChild) parent.insertBefore(mark.firstChild, mark);
    parent.removeChild(mark);
    parent.normalize();
  }
  for (const element of Array.from(root.querySelectorAll(`.${MARK_CLASS}`))) element.classList.remove(MARK_CLASS);
}

/** Wraps the first occurrence of `quote` in text nodes under `root` with <mark>; returns the first mark. */
export function highlightQuote(root: HTMLElement, quote: string | undefined, context?: string): HTMLElement | null {
  clearHighlights(root);
  if (!quote?.trim()) return null;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes: Text[] = [];
  const starts: number[] = [];
  let full = "";
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const text = node as Text;
    if (!text.data) continue;
    nodes.push(text);
    starts.push(full.length);
    // Separate block-level text so words in adjacent cells/paragraphs do not merge.
    full += `${text.data} `;
  }
  const match = findQuote(full, quote, context);
  if (!match) return null;
  const [start, end] = match;
  let first: HTMLElement | null = null;
  for (let index = nodes.length - 1; index >= 0; index--) {
    const node = nodes[index];
    const nodeStart = starts[index];
    const nodeEnd = nodeStart + node.data.length;
    if (nodeEnd <= start || nodeStart >= end) continue;
    const from = Math.max(0, start - nodeStart);
    const to = Math.min(node.data.length, end - nodeStart);
    if (to <= from) continue;
    const range = document.createRange();
    range.setStart(node, from);
    range.setEnd(node, to);
    const mark = document.createElement("mark");
    mark.className = MARK_CLASS;
    try {
      range.surroundContents(mark);
      first = mark;
    } catch {
      // A range crossing element boundaries cannot be wrapped; the other pieces still are.
    }
  }
  return first;
}

/** Highlights pdf.js text-layer spans covering the quote; returns the first span. */
export function highlightSpans(spans: HTMLElement[], texts: string[], quote: string | undefined, context?: string): HTMLElement | null {
  for (const span of spans) span.classList.remove(MARK_CLASS);
  if (!quote?.trim()) return null;
  // pdf.js splits words into items (superscripts, kerning runs): try items joined directly, then with spaces.
  let starts: number[] = [];
  let match: [number, number] | null = null;
  for (const separator of ["", " "]) {
    starts = [];
    let full = "";
    for (const text of texts) {
      starts.push(full.length);
      full += `${text}${separator}`;
    }
    match = findQuote(full, quote, context);
    if (match) break;
  }
  if (!match) return null;
  let first: HTMLElement | null = null;
  texts.forEach((text, index) => {
    const from = starts[index];
    const to = from + text.length;
    if (to > match![0] && from < match![1] && spans[index]) {
      spans[index].classList.add(MARK_CLASS);
      first ??= spans[index];
    }
  });
  return first;
}
