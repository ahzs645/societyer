/**
 * A deep link can resolve a meeting from another workspace the signed-in user
 * belongs to. The page must not combine that meeting with the selected
 * workspace's role, people, documents or automatic backfill permissions.
 */
export function meetingWorkspaceScope(
  meeting: { _id: string; societyId: string } | null | undefined,
  selectedSocietyId: string | null | undefined,
): { matches: boolean; meetingId?: string; societyId?: string } {
  if (!meeting || !selectedSocietyId || String(meeting.societyId) !== String(selectedSocietyId)) {
    return { matches: false };
  }
  return { matches: true, meetingId: meeting._id, societyId: meeting.societyId };
}
