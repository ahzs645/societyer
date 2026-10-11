/** Privacy controls for intake (design §4.6): a deterministic PII detector,
 * length-preserving redaction before any model call (so locator offsets and
 * quotes stay valid), and a per-run processing log entry shape. */

export type PiiKind = "email" | "phone" | "sin" | "account" | "card" | "postal_code";
export type PiiFinding = { kind: PiiKind; index: number; length: number };

function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let index = digits.length - 1; index >= 0; index--) {
    let digit = Number(digits[index]);
    if (double) {
      digit *= 2;
      if (digit > 9) digit -= 9;
    }
    sum += digit;
    double = !double;
  }
  return digits.length > 0 && sum % 10 === 0;
}

const PATTERNS: Array<{ kind: PiiKind; re: RegExp; valid?: (match: string, text: string, index: number) => boolean }> = [
  { kind: "email", re: /[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/g },
  { kind: "card", re: /\b(?:\d[ -]?){13,19}\b/g, valid: (match) => luhn(match.replace(/\D/g, "")) && match.replace(/\D/g, "").length >= 13 },
  {
    kind: "sin",
    re: /\b\d{3}[ -]?\d{3}[ -]?\d{3}\b/g,
    // A SIN is 9 digits passing Luhn; require a SIN/SSN cue nearby to avoid matching other numbers.
    valid: (match, text, index) => luhn(match.replace(/\D/g, "")) && /\b(?:SIN|S\.I\.N|social insurance|SSN|social security)\b/i.test(text.slice(Math.max(0, index - 60), index + match.length + 20)),
  },
  { kind: "account", re: /\b(?:acct|account|a\/c|transit|institution|branch|routing|chequing|savings)\s*(?:no\.?|number|#)?\s*[:#]?\s*\d[\d -]{3,}\d\b/gi },
  { kind: "phone", re: /(?<!\d)(?:\+?1[ .-]?)?\(?\d{3}\)?[ .-]\d{3}[ .-]\d{4}(?!\d)/g },
  { kind: "postal_code", re: /\b[ABCEGHJ-NPRSTVXY]\d[ABCEGHJ-NPRSTV-Z][ -]?\d[ABCEGHJ-NPRSTV-Z]\d\b/g },
];

export function detectPii(text: string): PiiFinding[] {
  const findings: PiiFinding[] = [];
  for (const pattern of PATTERNS) {
    for (const match of text.matchAll(pattern.re)) {
      const index = match.index!;
      if (pattern.valid && !pattern.valid(match[0], text, index)) continue;
      if (findings.some((finding) => index < finding.index + finding.length && finding.index < index + match[0].length)) continue;
      findings.push({ kind: pattern.kind, index, length: match[0].length });
    }
  }
  return findings.sort((a, b) => a.index - b.index);
}

export const ALWAYS_REDACT: readonly PiiKind[] = ["sin", "account", "card"];
export const DEFAULT_LLM_REDACT: readonly PiiKind[] = ["sin", "account", "card", "phone", "email", "postal_code"];

/** Same-length masking: digits → '#', letters → 'x'; separators kept. Offsets are unchanged. */
export function redact(text: string, kinds: readonly PiiKind[] = DEFAULT_LLM_REDACT): { text: string; counts: Partial<Record<PiiKind, number>>; findings: PiiFinding[] } {
  const findings = detectPii(text).filter((finding) => kinds.includes(finding.kind));
  const chars = text.split("");
  const counts: Partial<Record<PiiKind, number>> = {};
  for (const finding of findings) {
    counts[finding.kind] = (counts[finding.kind] ?? 0) + 1;
    for (let index = finding.index; index < finding.index + finding.length; index++) {
      const char = chars[index];
      chars[index] = /\d/.test(char) ? "#" : /[A-Za-z]/.test(char) ? "x" : char;
    }
  }
  return { text: chars.join(""), counts, findings };
}

export type Sensitivity = "standard" | "personal" | "restricted";
export function sensitivityFor(input: { restrictedClass: boolean; findings: PiiFinding[] }): Sensitivity {
  if (input.restrictedClass || input.findings.some((finding) => ALWAYS_REDACT.includes(finding.kind))) return "restricted";
  if (input.findings.length) return "personal";
  return "standard";
}

/** One processing-log row per file and stage (which file went to which provider). */
export type ProcessingLogEntry = {
  atISO: string;
  fileKey?: string;
  stage: "acquire" | "junk" | "extract" | "cluster" | "classify" | "llm_request" | "llm_skipped" | "extract_fields" | "verify" | "bundle";
  provider?: string;
  model?: string;
  sentToProvider: boolean;
  redactions?: Partial<Record<PiiKind, number>>;
  inputChars?: number;
  outputTokens?: number;
  inputTokens?: number;
  note?: string;
};
