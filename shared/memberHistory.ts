export const MEMBER_HISTORY_KINDS = ["Joined", "Left", "Status change", "Class change", "Voting rights", "Role", "Attendance", "Dues", "Note"] as const;
export const MEMBER_HISTORY_REVIEW_STATUSES = ["Observed", "Verified", "Rejected"] as const;
export function isMemberHistoryDate(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
export function validMemberSourceUrl(value?: string) {
  if (!value) return true;
  try { return ["https:", "http:"].includes(new URL(value).protocol); } catch { return false; }
}
/** Evidence may establish only a month or year; preserve that precision. */
export function isMemberEvidenceDate(value: string) {
  if (/^\d{4}$/.test(value)) return Number(value) >= 1;
  if (/^\d{4}-\d{2}$/.test(value)) return isMemberHistoryDate(`${value}-01`);
  return isMemberHistoryDate(value);
}
