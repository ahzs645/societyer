/**
 * A person's own notes on a meeting, beside the team notes (`meetings.workingNotes`).
 * Created only when the person chooses "Add my own notes"; private until they
 * share them, then readable by everyone who can read the team notes (and under
 * the same in-camera rule). Shared notes also feed the AI notes; private ones
 * never leave their owner.
 *
 * One row per person per meeting. Every handler acts on the caller's own row:
 * there is no way to read, change or delete someone else's.
 */
import type { PortableDoc, PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { requireOwnedRow, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { canReadInCameraPortable, minutesForMeeting } from "./minutesPrivacy";
import { inCameraFacts } from "../minutesPrivacy";
import { MEETING_WORKING_NOTES_MAX_LENGTH } from "../meetingRecordKind";

export type PersonalNotes = {
  _id: string;
  meetingId: string;
  userId: string;
  authorName: string;
  body: string;
  shared: boolean;
  createdAtISO: string;
  updatedAtISO: string;
  /** The caller's own notes. */
  mine: boolean;
};

async function forMeeting(ctx: PortableQueryCtx, meetingId: string) {
  const meeting = await requireOwnedRow(ctx, "meetings", meetingId);
  const societyId = String(meeting.societyId);
  await requirePermissionPortable(ctx, societyId, "meetings:read");
  const user = await requireSocietyMembership(ctx, societyId);
  return { meeting, societyId, user };
}

async function ownRow(ctx: PortableQueryCtx, meetingId: string, userId: string): Promise<PortableDoc | null> {
  const rows = await ctx.db.query("meetingPersonalNotes").withIndex("by_meeting_user", (q) => q.eq("meetingId", meetingId).eq("userId", userId)).collect();
  return rows[0] ?? null;
}

const view = (row: PortableDoc, userId: string): PersonalNotes => ({
  _id: String(row._id),
  meetingId: String(row.meetingId),
  userId: String(row.userId),
  authorName: String(row.authorName ?? "A member"),
  body: String(row.body ?? ""),
  shared: Boolean(row.shared),
  createdAtISO: String(row.createdAtISO ?? ""),
  updatedAtISO: String(row.updatedAtISO ?? ""),
  mine: String(row.userId) === userId,
});

function authorName(user: Record<string, unknown>): string {
  const name = [user.displayName, user.name, user.email].find((value) => typeof value === "string" && value.trim());
  return (name as string | undefined)?.trim().slice(0, 120) || "Workspace owner";
}

/** The caller's own notes on this meeting, or null when they haven't added any. */
export async function minePortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }): Promise<PersonalNotes | null> {
  const { user } = await forMeeting(ctx, meetingId);
  const row = await ownRow(ctx, meetingId, String(user._id));
  return row ? view(row, String(user._id)) : null;
}

/**
 * Notes people have shared on this meeting, the caller's included (marked
 * `mine`). A formal-minutes meeting with an in-camera session shares them only
 * with readers who have in-camera access, like its team notes.
 */
export async function sharedPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }): Promise<PersonalNotes[]> {
  const { meeting, societyId, user } = await forMeeting(ctx, meetingId);
  const kind = meeting.recordKind ?? "minutes";
  if (kind === "minutes") {
    const minutes = await minutesForMeeting(ctx, meeting._id, meeting.societyId);
    if (inCameraFacts(minutes).hasInCamera && !(await canReadInCameraPortable(ctx, societyId))) return [];
  }
  const rows = await ctx.db.query("meetingPersonalNotes").withIndex("by_meeting", (q) => q.eq("meetingId", meetingId)).collect();
  return rows
    .filter((row) => row.shared === true && String(row.body ?? "").trim())
    .map((row) => view(row, String(user._id)))
    .sort((a, b) => a.authorName.localeCompare(b.authorName));
}

/**
 * Creates or updates the caller's notes. `expected` is the text the editor
 * started from (null when creating): a save against text that changed since
 * (another tab) is refused, as for the team notes.
 */
export async function savePortable(
  ctx: PortableMutationCtx,
  { meetingId, body, expected }: { meetingId: string; body: string; expected?: string | null },
): Promise<{ id: string }> {
  const { meeting, user } = await forMeeting(ctx, meetingId);
  const text = String(body ?? "");
  if (text.length > MEETING_WORKING_NOTES_MAX_LENGTH) throw new Error("These notes are too long to save.");
  const now = new Date().toISOString();
  const row = await ownRow(ctx, meetingId, String(user._id));
  if (!row) {
    if (expected !== undefined && expected !== null) throw new Error("Your notes were deleted in another window. Copy what you need, then add them again.");
    const id = await ctx.db.insert("meetingPersonalNotes", {
      societyId: meeting.societyId, meetingId, userId: String(user._id), authorName: authorName(user as Record<string, unknown>),
      body: text, shared: false, createdAtISO: now, updatedAtISO: now,
    });
    return { id: String(id) };
  }
  if (expected !== undefined && expected !== null && String(row.body ?? "") !== expected) {
    throw new Error("Your notes changed in another window while you were editing.");
  }
  await ctx.db.patch(row._id, { body: text, authorName: authorName(user as Record<string, unknown>), updatedAtISO: now });
  return { id: String(row._id) };
}

/** Shares the caller's notes with everyone who can read the meeting, or makes them private again. */
export async function setSharedPortable(ctx: PortableMutationCtx, { meetingId, shared }: { meetingId: string; shared: boolean }): Promise<null> {
  const { user } = await forMeeting(ctx, meetingId);
  const row = await ownRow(ctx, meetingId, String(user._id));
  if (!row) throw new Error("Add your notes first.");
  await ctx.db.patch(row._id, { shared: Boolean(shared), updatedAtISO: new Date().toISOString() });
  return null;
}

/** Deletes the caller's notes on this meeting. */
export async function removePortable(ctx: PortableMutationCtx, { meetingId }: { meetingId: string }): Promise<null> {
  const { user } = await forMeeting(ctx, meetingId);
  const row = await ownRow(ctx, meetingId, String(user._id));
  if (row) await ctx.db.delete(row._id);
  return null;
}

/**
 * Shared personal notes as text to hand the AI beside the team notes, one
 * heading per person. Private notes never appear here.
 */
export function sharedNotesForDraft(team: string, shared: ReadonlyArray<Pick<PersonalNotes, "authorName" | "body">>): string {
  const parts = [team.trim(), ...shared.filter((row) => row.body.trim()).map((row) => `## Notes from ${row.authorName}\n\n${row.body.trim()}`)];
  return parts.filter(Boolean).join("\n\n");
}
