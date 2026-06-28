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

/** Infer an agenda item type from its title. */
export function staticAgendaItemType(title: string) {
  const lower = title.toLowerCase();
  if (lower.includes("motion") || lower.includes("adopt") || lower.includes("approve")) return "motion";
  if (lower.includes("report") || lower.includes("financial")) return "report";
  if (lower.includes("break")) return "break";
  if (lower.includes("camera") || lower.includes("closed") || lower.includes("executive")) return "executive_session";
  return "discussion";
}
