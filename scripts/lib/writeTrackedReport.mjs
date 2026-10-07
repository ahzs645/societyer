import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

/**
 * Gate reports under artifacts/offline/ and stage2-tenancy-report.md are
 * tracked in git as evidence. A gate run must leave `git status` clean when the
 * evidence did not change, so a report is rewritten only when its content
 * differs from the committed one. Run timestamps (and other volatile keys) are
 * ignored in that comparison: when nothing else changed, the old file — with
 * its old timestamp — is kept.
 */
export const VOLATILE_REPORT_KEYS = ["executedAt", "completedAt", "recordedAt", "generatedAt", "generatedAtISO", "durationMs", "elapsedMs"];

function stripVolatile(value, keys) {
  if (Array.isArray(value)) return value.map((item) => stripVolatile(item, keys));
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.entries(value)
        .filter(([key]) => !keys.has(key))
        .map(([key, item]) => [key, stripVolatile(item, keys)]),
    );
  }
  return value;
}

/**
 * @param {string} previous
 * @param {string} next
 * @param {readonly string[]} [volatileKeys]
 */
export function sameReportContent(previous, next, volatileKeys = VOLATILE_REPORT_KEYS) {
  if (previous === next) return true;
  try {
    const keys = new Set(volatileKeys);
    return JSON.stringify(stripVolatile(JSON.parse(previous), keys)) === JSON.stringify(stripVolatile(JSON.parse(next), keys));
  } catch {
    return false;
  }
}

/**
 * Writes `content` to `file` unless the existing file already holds the same
 * report. Returns whether it wrote.
 * @param {string} file
 * @param {string} content
 * @param {readonly string[]} [volatileKeys]
 */
export function writeTrackedReport(file, content, volatileKeys = VOLATILE_REPORT_KEYS) {
  if (existsSync(file) && sameReportContent(readFileSync(file, "utf8"), content, volatileKeys)) return false;
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, content);
  return true;
}
