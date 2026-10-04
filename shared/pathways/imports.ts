/** Backups preserve pathway history, never execution or external submission authority. */
export function quarantineImportedPathways<T extends Record<string, any[]>>(tables: T): T {
  return {
    ...tables,
    ...(tables.pathwayRuns ? { pathwayRuns: tables.pathwayRuns.map((run) => ({ ...run, status: "imported_readonly", inputsFrozen: true })) } : {}),
    ...(tables.pathwaySubmissionOutbox ? { pathwaySubmissionOutbox: tables.pathwaySubmissionOutbox.map((row) => (
      ["queued", "dispatching", "manual_required"].includes(row.status)
        ? { ...row, status: "blocked", error: "Imported submission history cannot be dispatched. Start a new reviewed pathway run." }
        : row
    )) } : {}),
  };
}
