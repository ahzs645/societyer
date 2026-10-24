/** ROE statuses are derived from retained issuance and protected follow-ups. */
export function isPayrollRoeDeadline(row: Record<string, unknown>): boolean {
  return typeof row.sourceKey === "string" &&
    (row.sourceKey.startsWith("payroll:roe:") || row.sourceKey.startsWith("roe-workflow:"));
}
