/**
 * The proposed registered office that recording an incorporation makes
 * current: the latest by effective date, then by creation. The server's
 * `recordIncorporation` and the "Record incorporation" drawer both use this,
 * so the drawer names the address the server promotes.
 */
export function proposedRegisteredOffice<T extends object>(rows: readonly T[]): T | undefined {
  const field = (row: T, key: "type" | "status" | "effectiveFrom" | "createdAtISO") => (row as Record<string, unknown>)[key];
  return rows
    .filter((row) => field(row, "type") === "registered_office" && field(row, "status") === "proposed")
    .sort((a, b) => String(field(b, "effectiveFrom") ?? "").localeCompare(String(field(a, "effectiveFrom") ?? ""))
      || String(field(b, "createdAtISO") ?? "").localeCompare(String(field(a, "createdAtISO") ?? "")))[0];
}
