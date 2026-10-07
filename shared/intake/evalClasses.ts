/** Per-class extraction evaluation (WP-L). A golden document lists field checks
 * against the extracted record, so one format grades every class: agenda items,
 * bylaw rules, statement lines, insurance terms, filings, invoices …
 *
 * Paths walk the record with FieldValues unwrapped: `rules.noticeDays`,
 * `items[*].requestedAction` (every element), `lines[2].amount.amountCents`,
 * `entries.length`. The committed fixture is synthetic; the private golden set
 * (real originals, hand-labelled) is read from outside the repository. */
import type { DocClass, ExtractionEnvelope } from "./schemas/common";
import type { VerificationSummary } from "./verify";

export type ClassCheck = {
  path: string;
  /** Scalar equality (strings compared case- and whitespace-insensitively). */
  equals?: unknown;
  /** Some element of a `[*]` path equals this value. */
  includes?: unknown;
  /** The value (or some element) contains this text, case-insensitively. */
  contains?: string;
  minCount?: number;
  maxCount?: number;
  /** The path resolves to nothing (undefined / null / empty). */
  absent?: boolean;
  /** Free-form note shown when the check fails. */
  why?: string;
};

export type ClassGoldenDoc = {
  id: string;
  docClass: DocClass;
  source: { fileName: string; format?: string; path?: string; localPath?: string; shaDir?: string };
  holdout?: boolean;
  expect: ClassCheck[];
  /** Text that must never appear anywhere in the extraction (home addresses, emails, account numbers). */
  forbidText?: string[];
  content?: unknown;
};
export type ClassificationLabel = { fileName: string; path?: string; docClass: DocClass; note?: string };
export type ClassGoldenSet = { version: number; purpose?: string; documents: ClassGoldenDoc[]; classification?: ClassificationLabel[] };

export type ClassDocScore = {
  id: string;
  docClass: DocClass;
  holdout: boolean;
  predictedClass?: DocClass;
  classificationOk?: boolean;
  schemaValid: boolean;
  checks: number;
  passed: number;
  failures: Array<{ path: string; expected: unknown; actual: unknown; why?: string }>;
  quoted: number;
  badQuotes: number;
  piiLeaks: string[];
};
export type ClassAggregate = { documents: number; checks: number; passed: number; fieldAccuracy: number; classificationAccuracy: number; classified: number; hallucinationRate: number; quoted: number; piiLeaks: number; schemaValid: number };

const isFieldValue = (node: unknown): node is { value?: unknown; status: string; locators: unknown[] } => Boolean(node && typeof node === "object" && "status" in (node as any) && "locators" in (node as any));
const unwrap = (node: unknown): unknown => (isFieldValue(node) ? (node as any).value : node);
const ALL = Symbol("all");

/** Resolves a path; `[*]` fans out and returns an array tagged as a fan-out. */
export function resolvePath(record: unknown, path: string): { value: unknown; fanOut: boolean } {
  const tokens: Array<string | number | typeof ALL> = [];
  for (const part of path.split(".")) {
    const match = /^([^[\]]*)((?:\[(?:\d+|\*)\])*)$/.exec(part);
    if (!match) return { value: undefined, fanOut: false };
    if (match[1]) tokens.push(match[1]);
    for (const index of match[2].match(/\[(\d+|\*)\]/g) ?? []) tokens.push(index === "[*]" ? ALL : Number(index.slice(1, -1)));
  }
  let current: unknown[] = [record];
  let fanOut = false;
  for (const token of tokens) {
    const next: unknown[] = [];
    for (const node of current.map(unwrap)) {
      if (token === ALL) {
        fanOut = true;
        if (Array.isArray(node)) next.push(...node);
        continue;
      }
      if (token === "length" && Array.isArray(node)) {
        next.push(node.length);
        continue;
      }
      if (node === null || node === undefined) continue;
      next.push((node as any)[token as any]);
    }
    current = next;
  }
  const values = current.map(unwrap);
  return fanOut ? { value: values.filter((value) => value !== undefined && value !== null), fanOut } : { value: values[0], fanOut };
}

const norm = (value: unknown): unknown => (typeof value === "string" ? value.toLowerCase().replace(/\s+/g, " ").trim() : value);
function same(a: unknown, b: unknown): boolean {
  if (typeof a === "number" && typeof b === "number") return a === b;
  if (a && typeof a === "object" && b && typeof b === "object") return Object.entries(b as Record<string, unknown>).every(([key, value]) => same((a as any)[key], value));
  return norm(a) === norm(b) || (typeof a === "number" && String(a) === String(b)) || (typeof b === "number" && String(b) === String(a));
}
const textOf = (value: unknown) => (typeof value === "string" ? value : JSON.stringify(value ?? ""));

export function runCheck(record: unknown, check: ClassCheck): { ok: boolean; actual: unknown } {
  const { value, fanOut } = resolvePath(record, check.path);
  const list = fanOut ? (value as unknown[]) : Array.isArray(value) ? value : [value];
  if (check.absent) return { ok: value === undefined || value === null || (Array.isArray(value) && value.length === 0), actual: value };
  if (check.minCount !== undefined || check.maxCount !== undefined) {
    const count = Array.isArray(value) ? value.length : value === undefined || value === null ? 0 : 1;
    return { ok: count >= (check.minCount ?? 0) && count <= (check.maxCount ?? Infinity), actual: count };
  }
  if (check.equals !== undefined) return { ok: !fanOut && same(value, check.equals), actual: value };
  if (check.includes !== undefined) return { ok: list.some((item) => same(item, check.includes)), actual: fanOut ? (value as unknown[]).slice(0, 8) : value };
  if (check.contains !== undefined) return { ok: list.some((item) => textOf(item).toLowerCase().includes(check.contains!.toLowerCase())), actual: fanOut ? (value as unknown[]).slice(0, 8) : value };
  return { ok: value !== undefined && value !== null, actual: value };
}

export function scoreClassDocument(doc: ClassGoldenDoc, envelope: ExtractionEnvelope | undefined, options: { schemaValid: boolean; verification?: VerificationSummary; predictedClass?: DocClass }): ClassDocScore {
  const failures: ClassDocScore["failures"] = [];
  let passed = 0;
  for (const check of doc.expect) {
    const result = envelope ? runCheck({ ...envelope.record, unsupported: envelope.unsupported, references: envelope.references }, check) : { ok: false, actual: undefined };
    if (result.ok) passed += 1;
    else failures.push({ path: check.path, expected: check.equals ?? check.includes ?? check.contains ?? (check.absent ? "(absent)" : check.minCount !== undefined || check.maxCount !== undefined ? `count ${check.minCount ?? 0}..${check.maxCount ?? "∞"}` : "(present)"), actual: result.actual, why: check.why });
  }
  const serialized = envelope ? JSON.stringify(envelope).toLowerCase() : "";
  const piiLeaks = (doc.forbidText ?? []).filter((text) => serialized.includes(text.toLowerCase()));
  return {
    id: doc.id,
    docClass: doc.docClass,
    holdout: Boolean(doc.holdout),
    ...(options.predictedClass ? { predictedClass: options.predictedClass, classificationOk: options.predictedClass === doc.docClass } : {}),
    schemaValid: options.schemaValid,
    checks: doc.expect.length,
    passed,
    failures,
    quoted: options.verification?.quoted ?? 0,
    badQuotes: (options.verification?.mismatched ?? 0) + (options.verification?.invalid ?? 0),
    piiLeaks,
  };
}

export function aggregateClassScores(scores: ClassDocScore[]): ClassAggregate {
  const checks = scores.reduce((sum, score) => sum + score.checks, 0);
  const passed = scores.reduce((sum, score) => sum + score.passed, 0);
  const classified = scores.filter((score) => score.classificationOk !== undefined);
  const quoted = scores.reduce((sum, score) => sum + score.quoted, 0);
  const bad = scores.reduce((sum, score) => sum + score.badQuotes, 0);
  return {
    documents: scores.length,
    checks,
    passed,
    fieldAccuracy: checks ? passed / checks : 1,
    classified: classified.length,
    classificationAccuracy: classified.length ? classified.filter((score) => score.classificationOk).length / classified.length : 1,
    quoted,
    hallucinationRate: quoted ? bad / quoted : 0,
    piiLeaks: scores.reduce((sum, score) => sum + score.piiLeaks.length, 0),
    schemaValid: scores.filter((score) => score.schemaValid).length,
  };
}

export function aggregateByClass(scores: ClassDocScore[]): Record<string, ClassAggregate> {
  const byClass = new Map<string, ClassDocScore[]>();
  for (const score of scores) byClass.set(score.docClass, [...(byClass.get(score.docClass) ?? []), score]);
  return Object.fromEntries([...byClass.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([docClass, list]) => [docClass, aggregateClassScores(list)]));
}

/** Classification accuracy over labelled files, with a confusion list. */
export function classificationReport(labels: Array<{ id: string; expected: DocClass; predicted: DocClass }>): { total: number; correct: number; accuracy: number; byClass: Record<string, { total: number; correct: number; recall: number; precision: number }>; confusions: Array<{ id: string; expected: DocClass; predicted: DocClass }> } {
  const byClass: Record<string, { total: number; correct: number; predicted: number }> = {};
  for (const label of labels) {
    byClass[label.expected] ??= { total: 0, correct: 0, predicted: 0 };
    byClass[label.predicted] ??= { total: 0, correct: 0, predicted: 0 };
    byClass[label.expected].total += 1;
    byClass[label.predicted].predicted += 1;
    if (label.expected === label.predicted) byClass[label.expected].correct += 1;
  }
  const correct = labels.filter((label) => label.expected === label.predicted).length;
  return {
    total: labels.length,
    correct,
    accuracy: labels.length ? correct / labels.length : 1,
    byClass: Object.fromEntries(Object.entries(byClass).sort(([a], [b]) => a.localeCompare(b)).map(([docClass, value]) => [docClass, { total: value.total, correct: value.correct, recall: value.total ? value.correct / value.total : 1, precision: value.predicted ? value.correct / value.predicted : 1 }])),
    confusions: labels.filter((label) => label.expected !== label.predicted),
  };
}
