/**
 * Pure, dependency-free helpers for the static (offline/demo) Convex mirror,
 * extracted from src/lib/staticConvex.ts to chip away at that monolith. These
 * touch no module state (seed tables, fixtures, store), so they live cleanly on
 * their own and are trivially unit-testable.
 */

/** Find a row by its `_id`, or null. */
export function byId(rows: any[], id: string | undefined) {
  return rows.find((row) => row._id === id) ?? null;
}

/** Serialize rows of values into a CSV string, quoting as needed. */
export function staticCsvRows(rows: unknown[][]) {
  return rows
    .map((row) =>
      row
        .map((value) => {
          const text = String(value ?? "");
          return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
        })
        .join(","),
    )
    .join("\n");
}

/** Truncate an ISO timestamp to its date (YYYY-MM-DD). */
export function dateOnlyStatic(value?: string | null) {
  return String(value ?? "").slice(0, 10);
}

/** Whether an ISO-ish string falls in the given calendar year. */
export function inStaticYear(value: unknown, year: number) {
  return typeof value === "string" && value.slice(0, 4) === String(year);
}

/** Add days to a YYYY-MM-DD date (UTC), returning YYYY-MM-DD. */
export function addStaticDays(date: string, days: number) {
  if (!date) return "";
  const parsed = new Date(`${date}T00:00:00.000Z`);
  parsed.setUTCDate(parsed.getUTCDate() + days);
  return parsed.toISOString().slice(0, 10);
}

/** Normalize a billing amount to a monthly-equivalent cents figure. */
export function staticMonthlyEstimateCents(amountCents: number, interval: string) {
  if (interval === "semester") return Math.round((amountCents * 2) / 12);
  if (interval === "week") return Math.round((amountCents * 52) / 12);
  if (interval === "quarter") return Math.round(amountCents / 3);
  if (interval === "year") return Math.round(amountCents / 12);
  return amountCents;
}

/** Lowercase/trim a category label for comparison. */
export function normalizeStaticCategoryLabel(value?: string) {
  return String(value ?? "").trim().toLowerCase();
}

/** Construct a normalized annual-cycle item object. */
export function cycleItem(
  id: string,
  phase: string,
  title: string,
  detail: string,
  status: string,
  evidence: string[],
  dueDate: string | undefined,
  to: string,
  actionLabel: string,
) {
  return { id, phase, title, detail, status, evidence, dueDate, to, actionLabel };
}

/** Whether a filing belongs to the given calendar year (by label or dates). */
export function filingMatchesStaticYear(filing: any, year: number) {
  return (
    String(filing.periodLabel ?? filing.title ?? "").includes(String(year)) ||
    inStaticYear(filing.dueDate, year) ||
    inStaticYear(filing.filedAt, year)
  );
}

/** Report (dev: throw, prod: warn) that an offline write has no static handler. */
export function reportStaticWriteGap(name: string): null {
  const message =
    `[staticConvex] No offline handler for write "${name}". ` +
    `This action does not persist in offline/desktop mode. ` +
    `Add a handler in staticConvex.ts (or list it in staticConvexParity.ts).`;
  const isDev = Boolean((import.meta as any)?.env?.DEV);
  if (isDev) throw new Error(message);
  if (typeof console !== "undefined") console.warn(message);
  return null;
}

/** Infer an agenda item type from its title. */
export function staticAgendaItemType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve")) return "motion";
  if (lower.includes("report") || lower.includes("financial")) return "report";
  if (lower.includes("break")) return "break";
  if (lower.includes("camera") || lower.includes("closed") || lower.includes("executive")) return "executive_session";
  return "discussion";
}
