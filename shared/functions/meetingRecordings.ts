/**
 * PORTABLE FUNCTIONS: meeting recordings kept in workspace file storage
 * (`meetingRecordings`), and the workspace's choice to keep recordings at all.
 * SharePoint recordings stay in the Meeting source files pipeline.
 *
 * Capability-backed: hosted Convex resolves `storageKey` through `_storage`
 * (convex/meetingRecordings.ts adds the native-upload policy guard); the
 * desktop app writes files to disk through its bridge and records the key.
 *
 * Raw recordings are working material for meeting editors (meetings:write),
 * the same rule as Meeting source files.
 */
import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { claimStorageId, principalUserId, requireOwnedRow, requireSocietyMembership } from "./access";
import { requirePermissionPortable } from "./permissions";
import { meetingSourceKind } from "../storage/meetingSourceProtocol";
import {
  isMeetingRecordingPreference,
  MEETING_RECORDING_MAX_BYTES,
  meetingRecordingPreference,
  type MeetingRecordingPreference,
} from "../meetingRecordingStorage";

type RecordingProvider = "convex" | "local-filesystem";

function assertRecordingFile(fileName: string, size: number) {
  const name = String(fileName ?? "").trim();
  if (!name || name.length > 240 || /[\x00-\x1f/\\]/.test(name)) throw new Error("Invalid file name.");
  if (!Number.isSafeInteger(size) || size < 1 || size > MEETING_RECORDING_MAX_BYTES) throw new Error("Recordings must be between 1 byte and 500 MB.");
  let kind: string;
  try {
    kind = meetingSourceKind(name);
  } catch {
    kind = "unknown";
  }
  if (kind !== "recording") throw new Error("Choose an audio or video recording. Import transcripts on the Transcript tab.");
  return name;
}

async function requireRecordingWriter(ctx: PortableQueryCtx, meetingId: string) {
  const meeting = await requireOwnedRow(ctx, "meetings", meetingId);
  const societyId = String(meeting.societyId);
  await requirePermissionPortable(ctx, societyId, "meetings:write");
  return { meeting, societyId };
}

async function assertKeepsRecordings(ctx: PortableQueryCtx, societyId: string) {
  const society = await ctx.db.get(societyId);
  if (meetingRecordingPreference(society as { meetingRecordingPreference?: unknown }) !== "keep") {
    throw new Error("This workspace keeps transcripts only. An administrator can change that in Settings.");
  }
}

/**
 * The workspace's choice. The hosted wrapper adds the operator storage policy
 * and whether the server can transcribe; a local runtime has neither.
 */
export async function settingsPortable(ctx: PortableQueryCtx, { societyId }: { societyId: string }) {
  await requireSocietyMembership(ctx, societyId);
  const society = await ctx.db.get(societyId);
  return {
    preference: meetingRecordingPreference(society as { meetingRecordingPreference?: unknown }),
    policy: null as null | { nativeUploads: boolean; documentVersionProvider: "native" | "sharepoint" },
    serverTranscription: null as null | { maxBytes: number },
  };
}

/** Settings: keep recordings, or transcripts only. Existing recordings are not deleted. */
export async function setPreferencePortable(
  ctx: PortableMutationCtx,
  { societyId, preference }: { societyId: string; preference: MeetingRecordingPreference },
) {
  await requirePermissionPortable(ctx, societyId, "settings:write");
  if (!isMeetingRecordingPreference(preference)) throw new Error("Choose keep recordings or transcripts only.");
  await ctx.db.patch(societyId, { meetingRecordingPreference: preference });
  return { preference };
}

export async function listPortable(ctx: PortableQueryCtx, { meetingId }: { meetingId: string }) {
  await requireRecordingWriter(ctx, meetingId);
  const rows = await ctx.db
    .query("meetingRecordings")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  rows.sort((a, b) => String(b.createdAtISO).localeCompare(String(a.createdAtISO)));
  return Promise.all(
    rows.map(async (row) => ({
      id: String(row._id),
      fileName: String(row.fileName),
      size: Number(row.size),
      mimeType: row.mimeType ? String(row.mimeType) : undefined,
      provider: row.provider as RecordingProvider,
      storageKey: String(row.storageKey),
      createdAtISO: String(row.createdAtISO),
      // Hosted: a short-lived signed URL. Desktop files are read through the bridge.
      url: row.provider === "convex" ? (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(row.storageKey) })).url : null,
    })),
  );
}

export async function generateUploadUrlPortable(
  ctx: PortableMutationCtx,
  args: { meetingId: string; fileName: string; size: number },
) {
  const { societyId } = await requireRecordingWriter(ctx, args.meetingId);
  await assertKeepsRecordings(ctx, societyId);
  assertRecordingFile(args.fileName, args.size);
  return (await ctx.capabilities.storage.createUploadUrl({})).uploadUrl;
}

/**
 * Records an uploaded recording. Hosted callers pass a `_storage` id they
 * just uploaded (claimed for this workspace here, so a foreign blob is
 * refused); the desktop app passes the key its bridge returned.
 */
export async function attachPortable(
  ctx: PortableMutationCtx,
  args: { meetingId: string; fileName: string; size: number; mimeType?: string; provider: RecordingProvider; storageKey: string; sha256?: string },
) {
  const { meeting, societyId } = await requireRecordingWriter(ctx, args.meetingId);
  await assertKeepsRecordings(ctx, societyId);
  const fileName = assertRecordingFile(args.fileName, args.size);
  if (args.provider !== "convex" && args.provider !== "local-filesystem") throw new Error("Unknown recording storage.");
  const storageKey = String(args.storageKey ?? "").trim();
  if (!storageKey || storageKey.length > 500) throw new Error("The uploaded recording has no storage reference.");
  if (args.provider === "convex") await claimStorageId(ctx, storageKey, societyId);
  const uploadedByUserId = await principalUserId(ctx, societyId);
  const id = await ctx.db.insert("meetingRecordings", {
    societyId,
    meetingId: String(meeting._id),
    fileName,
    size: args.size,
    ...(args.mimeType ? { mimeType: String(args.mimeType).slice(0, 120) } : {}),
    provider: args.provider,
    storageKey,
    ...(args.sha256 && /^[a-f0-9]{64}$/.test(args.sha256) ? { sha256: args.sha256 } : {}),
    ...(uploadedByUserId ? { uploadedByUserId } : {}),
    createdAtISO: new Date().toISOString(),
  });
  return { id: String(id) };
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const row = await requireOwnedRow(ctx, "meetingRecordings", id);
  await requireRecordingWriter(ctx, String(row.meetingId));
  if (row.provider === "convex") {
    // Only this workspace's claim on the blob is removed with it.
    await ctx.capabilities.storage.delete({ storageKey: String(row.storageKey) });
    const claims = await ctx.db
      .query("storageOwnership")
      .withIndex("by_storage", (q) => q.eq("storageId", String(row.storageKey)))
      .collect();
    for (const claim of claims) if (String(claim.societyId) === String(row.societyId)) await ctx.db.delete(String(claim._id));
  }
  await ctx.db.delete(id);
  return { provider: row.provider as RecordingProvider, storageKey: String(row.storageKey) };
}
