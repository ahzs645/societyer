/**
 * Status shown for a workspace user row. A duplicate retired by
 * users:operatorRetireMembership names the membership it was merged into
 * (`mergedIntoDisplayName` comes from users:list).
 */
export function membershipStatusLabel(
  row: { status?: string; authSubject?: string; mergedIntoUserId?: string; mergedIntoDisplayName?: string },
  hostedSignIn: boolean,
): string {
  if (row.mergedIntoUserId) return `Merged into ${row.mergedIntoDisplayName?.trim() || "another user"}`;
  const status = row.status || "Active";
  return hostedSignIn && !row.authSubject && status === "Active" ? "Not joined" : status;
}
