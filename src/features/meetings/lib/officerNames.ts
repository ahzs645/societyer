// Chair / secretary / recorder suggested from the roles typed in attendance.
const OFFICER_ROLES: Array<["chairName" | "secretaryName" | "recorderName", RegExp]> = [
  ["chairName", /^(?:the\s+)?(?:chair|chairperson|chairman|chairwoman|chair of the board|board chair|presiding)\b/i],
  ["secretaryName", /^(?:the\s+)?(?:recording\s+)?secretary\b/i],
  ["recorderName", /^(?:the\s+)?(?:recorder|minute[-\s]?taker|note[-\s]?taker|recording secretary)\b/i],
];

/** Chair / secretary / recorder names taken from attendance roles, for the empty fields only. */
export function officerNamesFromAttendance(
  attendance: unknown,
  current: { chairName?: string; secretaryName?: string; recorderName?: string },
): Partial<Record<"chairName" | "secretaryName" | "recorderName", string>> {
  const rows = (Array.isArray(attendance) ? attendance : []).filter((row: any) => row?.name && row?.roleTitle && row?.status !== "absent" && row?.status !== "regrets");
  const out: Partial<Record<"chairName" | "secretaryName" | "recorderName", string>> = {};
  for (const [key, pattern] of OFFICER_ROLES) {
    if (String(current[key] ?? "").trim()) continue;
    const matches = rows.filter((row: any) => pattern.test(String(row.roleTitle).trim()));
    if (matches.length === 1) out[key] = String(matches[0].name);
  }
  return out;
}
