/**
 * Heuristic PII redaction for public-facing minutes. Scans a body of text and
 * replaces emails, phone numbers, postal codes and supplied names with a
 * neutral placeholder. The goal isn't bulletproof privacy — a human should
 * still review — but it catches the obvious stuff before you publish minutes
 * to members or attach them to a public filing.
 */

export type RedactOptions = {
  /** Names to blank out (e.g. attendee / absent lists from members & directors). */
  names?: string[];
  /** Replacement label. Defaults to "[redacted]". */
  placeholder?: string;
  /** If true, emails/phones/postal codes are replaced by their *type* label
   * (e.g. "[email]") instead of a generic placeholder, which reads better. */
  typeLabels?: boolean;
};

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
// Canadian-style phone: (604) 555-1234, 604-555-1234, +1 604 555 1234, 6045551234, etc.
const PHONE_RE = /(?:\+?1[\s\-.]?)?(?:\(?\d{3}\)?[\s\-.]?)\d{3}[\s\-.]?\d{4}/g;
// Canadian postal code: A1A 1A1 (optional space)
const POSTAL_RE = /\b[A-Za-z]\d[A-Za-z][\s-]?\d[A-Za-z]\d\b/g;
// Street-number + capitalised word + common suffix: "2187 Commercial Drive"
const STREET_RE =
  /\b\d{1,5}\s+[A-Z][A-Za-z]+(?:\s+[A-Z][A-Za-z]+)*\s+(?:Street|St\.?|Road|Rd\.?|Avenue|Ave\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Lane|Ln\.?|Court|Ct\.?|Place|Pl\.?|Way|Terrace|Crescent|Cres\.?)\b/g;

export type Redaction = { kind: "email" | "phone" | "postal" | "address" | "name"; original: string; start: number; end: number };

export function findRedactions(text: string, opts: RedactOptions = {}): Redaction[] {
  const out: Redaction[] = [];
  const scan = (re: RegExp, kind: Redaction["kind"]) => {
    for (const m of text.matchAll(re)) {
      if (m.index == null) continue;
      out.push({ kind, original: m[0], start: m.index, end: m.index + m[0].length });
    }
  };
  scan(EMAIL_RE, "email");
  scan(PHONE_RE, "phone");
  scan(POSTAL_RE, "postal");
  scan(STREET_RE, "address");

  // Name matching — case-insensitive, whole-word. Longest first so "Jordan
  // Nakamura" is matched before "Jordan".
  const names = [...(opts.names ?? [])]
    .filter(Boolean)
    .map((n) => n.trim())
    .filter((n) => n.length >= 3)
    .sort((a, b) => b.length - a.length);
  for (const name of names) {
    const safe = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nameRe = new RegExp(`\\b${safe}\\b`, "gi");
    for (const m of text.matchAll(nameRe)) {
      if (m.index == null) continue;
      // Skip if this span is already covered by a previous redaction (e.g.
      // the email above mentions the name).
      if (out.some((r) => r.start <= m.index! && r.end >= m.index! + m[0].length)) continue;
      out.push({ kind: "name", original: m[0], start: m.index, end: m.index + m[0].length });
    }
  }

  // Sort by start index, then drop overlaps (prefer the earlier/longer one).
  out.sort((a, b) => a.start - b.start);
  const deduped: Redaction[] = [];
  for (const r of out) {
    const last = deduped[deduped.length - 1];
    if (last && r.start < last.end) continue;
    deduped.push(r);
  }
  return deduped;
}

export function redactText(text: string, opts: RedactOptions = {}): string {
  const redactions = findRedactions(text, opts);
  const placeholder = opts.placeholder ?? "[redacted]";
  const label = (kind: Redaction["kind"]) =>
    opts.typeLabels ? `[${kind}]` : placeholder;

  if (redactions.length === 0) return text;
  let out = "";
  let cursor = 0;
  for (const r of redactions) {
    out += text.slice(cursor, r.start) + label(r.kind);
    cursor = r.end;
  }
  out += text.slice(cursor);
  return out;
}

/** Inline-rendered React fragments with <mark> elements around redacted spans. */
export function redactToSpans(
  text: string,
  opts: RedactOptions = {},
): Array<{ kind: "plain" } & { text: string } | { kind: Redaction["kind"]; original: string }> {
  const redactions = findRedactions(text, opts);
  const parts: any[] = [];
  let cursor = 0;
  for (const r of redactions) {
    if (r.start > cursor) parts.push({ kind: "plain", text: text.slice(cursor, r.start) });
    parts.push({ kind: r.kind, original: r.original });
    cursor = r.end;
  }
  if (cursor < text.length) parts.push({ kind: "plain", text: text.slice(cursor) });
  return parts;
}
