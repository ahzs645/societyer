import { internalMutation, internalQuery, mutation, query } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { authorizedMutation, authorizedQuery } from "./lib/authorizedServer";
import { toPortableQueryCtx } from "./lib/portable";
import { hasPermission, requirePermissionPortable } from "../shared/functions/permissions";
import { requireTranscriptReaderPortable } from "../shared/functions/minutesPrivacy";
import { MEETING_SOURCE_CHUNK_BYTES, MEETING_SOURCE_MAX_BYTES, MEETING_TRANSCRIPT_MAX_BYTES, validateMeetingSource } from "../shared/storage/meetingSourceProtocol";

async function access(ctx: QueryCtx | MutationCtx, meetingId: Id<"meetings">) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) throw new Error("Meeting unavailable.");
  // Raw recordings and working transcripts are restricted to meeting editors.
  const actor = await requirePermissionPortable(await toPortableQueryCtx(ctx), meeting.societyId, "meetings:write");
  return { meeting, actor };
}

export const inspect = internalQuery({
  args: { sourceId: v.id("meetingSources") }, returns: v.any(),
  handler: async (ctx, { sourceId }) => {
    const source = await ctx.db.get(sourceId);
    if (!source) throw new Error("Source unavailable.");
    await access(ctx, source.meetingId);
    return source;
  },
});

export const list = internalQuery({
  args: { meetingId: v.id("meetings") }, returns: v.any(),
  handler: async (ctx, { meetingId }) => {
    await access(ctx, meetingId);
    const rows = await ctx.db.query("meetingSources").withIndex("by_meeting", q => q.eq("meetingId", meetingId)).order("desc").take(100);
    return rows.map(s => ({ id: s._id, fileName: s.fileName, size: s.size, kind: s.kind, status: s.status, offset: s.offset, verifiedOffset: s.verifiedOffset, transcriptImported: s.transcriptImported ?? false, textChunks: s.textChunks ?? 0, textBytes: s.textBytes ?? 0, textComplete: s.textComplete ?? false, jobStatus: s.jobStatus, jobError: s.jobError }));
  },
});

/** Imported text is editable user input; the verified original remains separate. */
export const appendText = authorizedMutation("meetingSources:appendText", mutation)({
  args: { sourceId: v.id("meetingSources"), index: v.number(), text: v.string(), complete: v.boolean() }, returns: v.null(),
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sourceId);
    if (!s || s.status !== "ready" || s.jobStatus === "processing") throw new Error("Verified source without an active speech job required.");
    const { actor } = await access(ctx, s.meetingId);
    if (actor._id !== s.actorId) throw new Error("Only the uploader can import this source.");
    const size = new TextEncoder().encode(a.text).length;
    if (size > 48_000 || !Number.isSafeInteger(a.index) || a.index < 0) throw new Error("Invalid transcript chunk.");
    const existing = await ctx.db.query("meetingSourceText").withIndex("by_source_index", q => q.eq("sourceId", s._id).eq("index", a.index)).unique();
    if (existing) { if (existing.text !== a.text) throw new Error("Transcript chunk already exists."); return null; }
    if (s.textComplete || a.index !== (s.textChunks ?? 0) || (s.textBytes ?? 0) + size > MEETING_SOURCE_MAX_BYTES) throw new Error("Transcript is complete, out of order, or too large.");
    await ctx.db.insert("meetingSourceText", { sourceId: s._id, index: a.index, text: a.text });
    await ctx.db.patch(s._id, { textChunks: a.index + 1, textBytes: (s.textBytes ?? 0) + size, textComplete: a.complete });
    return null;
  },
});

export const speechCapabilities = authorizedQuery("meetingSources:speechCapabilities", query)({
  args: { meetingId: v.id("meetings") }, returns: v.object({ configured: v.boolean() }),
  handler: async (ctx, { meetingId }) => {
    await access(ctx, meetingId);
    return { configured: Boolean(process.env.MEETING_TRANSCRIPTION_ENDPOINT && process.env.MEETING_TRANSCRIPTION_KEY) };
  },
});

export const beginSpeech = internalMutation({
  args: { sourceId: v.id("meetingSources"), jobId: v.string() }, returns: v.any(),
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sourceId);
    if (!s || s.status !== "ready" || s.kind !== "recording" || s.textComplete) throw new Error("A verified recording without a completed transcript is required.");
    const { actor } = await access(ctx, s.meetingId);
    if (actor._id !== s.actorId) throw new Error("Only the uploader can start speech processing.");
    if (s.jobStatus === "processing") return { ...s, alreadyStarted: true };
    const next = { jobId: s.textChunks && s.jobId ? s.jobId : a.jobId, jobStatus: "processing", jobStartedAt: Date.now(), jobError: undefined };
    await ctx.db.patch(s._id, next);
    return { ...s, ...next, alreadyStarted: false };
  },
});

/** Scheduled jobs use the recorded actor and job binding, never a client actor ID. */
export const speechJob = internalQuery({
  args: { sourceId: v.id("meetingSources"), jobId: v.string() }, returns: v.any(),
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sourceId);
    if (!s || s.jobId !== a.jobId || s.jobStatus !== "processing") return null;
    const actor = await ctx.db.get(s.actorId);
    const accessRevoked = s.status !== "ready" || !actor || actor.societyId !== s.societyId || Boolean(actor.status && actor.status !== "Active") || !hasPermission(String(actor.role), "meetings:write");
    return { ...s, accessRevoked };
  },
});

export const speechProgress = internalMutation({
  args: { sourceId: v.id("meetingSources"), jobId: v.string(), text: v.optional(v.string()), index: v.optional(v.number()), complete: v.optional(v.boolean()), error: v.optional(v.string()) }, returns: v.null(),
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sourceId);
    if (!s || s.jobId !== a.jobId || s.jobStatus !== "processing" || s.status !== "ready") return null;
    const actor = await ctx.db.get(s.actorId);
    if (!actor || actor.societyId !== s.societyId || actor.status && actor.status !== "Active" || !hasPermission(String(actor.role), "meetings:write")) {
      await ctx.db.patch(s._id, { jobStatus: "failed", jobError: "Processing access was revoked." }); return null;
    }
    if (a.error) { await ctx.db.patch(s._id, { jobStatus: "failed", jobError: a.error.slice(0, 240) }); return null; }
    if (a.text !== undefined) {
      if (a.text.length > 12_000 || a.index === undefined || !Number.isSafeInteger(a.index) || a.index < 0) throw new Error("Invalid speech result chunk.");
      const existing = await ctx.db.query("meetingSourceText").withIndex("by_source_index", q => q.eq("sourceId", s._id).eq("index", a.index!)).unique();
      if (existing) { if (existing.text !== a.text) throw new Error("Speech result differs from the previous result; upload as a new source."); return null; }
      if (a.index !== (s.textChunks ?? 0) || (s.textBytes ?? 0) > 16_000_000) throw new Error("Invalid speech result sequence.");
      await ctx.db.insert("meetingSourceText", { sourceId: s._id, index: a.index, text: a.text });
      await ctx.db.patch(s._id, { textChunks: a.index + 1, textBytes: (s.textBytes ?? 0) + new TextEncoder().encode(a.text).length });
    }
    if (a.complete) {
      if (!s.textChunks) throw new Error("Speech service returned no transcript.");
      await ctx.db.patch(s._id, { jobStatus: "complete", textComplete: true });
    }
    return null;
  },
});

export const textPage = authorizedQuery("meetingSources:textPage", query)({
  args: { sourceId: v.id("meetingSources"), index: v.number() }, returns: v.any(),
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sourceId);
    if (!s || s.status !== "ready") throw new Error("Verified source required.");
    await access(ctx, s.meetingId);
    // Reading transcript text is for minute-takers (decision A1), like transcripts:getByMeeting.
    await requireTranscriptReaderPortable(await toPortableQueryCtx(ctx), s.societyId);
    return ctx.db.query("meetingSourceText").withIndex("by_source_index", q => q.eq("sourceId", s._id).eq("index", a.index)).unique();
  },
});

// The browser extractor and the speech poller write chunks of at most 12,000 characters,
// so a 600 KB transcript needs up to about 51 of them.
const MEETING_TRANSCRIPT_MAX_CHUNKS = 64;

export const useTranscript = authorizedMutation("meetingSources:useTranscript", mutation)({
  args: { sourceId: v.id("meetingSources") }, returns: v.null(),
  handler: async (ctx, { sourceId }) => {
    const s = await ctx.db.get(sourceId);
    if (!s || s.status !== "ready" || !s.textComplete || !s.textBytes || s.textBytes > MEETING_TRANSCRIPT_MAX_BYTES || !s.textChunks || s.textChunks > MEETING_TRANSCRIPT_MAX_CHUNKS) throw new Error("Select a completed transcript of at most 600 KB for the minutes editor. Larger transcripts remain available in pages.");
    await access(ctx, s.meetingId);
    await requirePermissionPortable(await toPortableQueryCtx(ctx), s.societyId, "minutes:write");
    const chunks = await ctx.db.query("meetingSourceText").withIndex("by_source_index", q => q.eq("sourceId", s._id)).take(s.textChunks);
    if (chunks.length !== s.textChunks) throw new Error("Transcript import is incomplete.");
    const text = chunks.map(c => c.text).join("");
    const existing = await ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", s.meetingId)).first();
    if (existing) await ctx.db.patch(existing._id, { text, segments: [], provider: "uploaded-transcript", demo: false });
    else await ctx.db.insert("transcripts", { societyId: s.societyId, meetingId: s.meetingId, text, segments: [], provider: "uploaded-transcript", demo: false, createdAtISO: new Date().toISOString() });
    // A transcript is not an adopted record; never mutate approved minutes.
    const minutes = await ctx.db.query("minutes").withIndex("by_meeting", q => q.eq("meetingId", s.meetingId)).first();
    if (minutes && !minutes.approvedAt) await ctx.db.patch(minutes._id, { draftTranscript: text });
    await ctx.db.patch(s._id, { transcriptImported: true });
    return null;
  },
});

export const allocate = internalMutation({
  args: { meetingId: v.id("meetings"), fileName: v.string(), size: v.number(), fingerprint: v.string(), nonce: v.string() }, returns: v.id("meetingSources"),
  handler: async (ctx, args) => {
    const { meeting, actor } = await access(ctx, args.meetingId);
    const kind = validateMeetingSource(args.fileName, args.size);
    if (!/^[a-f0-9]{64}$/.test(args.fingerprint) || !/^[a-f0-9-]{36}$/.test(args.nonce)) throw new Error("Invalid upload identity.");
    const existing = await ctx.db.query("meetingSources").withIndex("by_actor_fingerprint", q => q.eq("actorId", actor._id as Id<"users">).eq("meetingId", args.meetingId).eq("fingerprint", args.fingerprint)).order("desc").first();
    if (existing && !["cancelled", "expired", "failed"].includes(existing.status)) return existing._id;
    return ctx.db.insert("meetingSources", {
      societyId: meeting.societyId, meetingId: args.meetingId, actorId: actor._id as Id<"users">,
      fileName: args.fileName, size: args.size, kind, fingerprint: args.fingerprint,
      remoteName: `societyer-meeting-${args.nonce}.${args.fileName.split(".").pop()!.toLowerCase()}`,
      status: "initializing", offset: 0, hashes: [], verifiedOffset: 0, createdAt: Date.now(),
    });
  },
});

/** Only the authenticated server broker can change remote transfer state. */
export const change = internalMutation({
  args: {
    sourceId: v.id("meetingSources"), operation: v.string(), lease: v.optional(v.string()),
    uploadUrl: v.optional(v.string()), expiresAt: v.optional(v.number()),
    offset: v.optional(v.number()), hash: v.optional(v.string()), size: v.optional(v.number()),
    itemId: v.optional(v.string()), eTag: v.optional(v.string()), versionId: v.optional(v.string()),
  }, returns: v.any(),
  handler: async (ctx, a) => {
    const s = await ctx.db.get(a.sourceId);
    if (!s) throw new Error("Source unavailable.");
    const { actor } = await access(ctx, s.meetingId);
    if (a.operation === "cancel") {
      await ctx.db.patch(s._id, { status: "cancelled", uploadUrl: undefined, lease: undefined, leaseUntil: undefined }); return null;
    }
    if (["cancelled", "expired", "failed"].includes(s.status)) throw new Error("Upload is no longer active.");
    if (a.operation === "session") {
      if (s.status !== "initializing" || !a.uploadUrl || !a.expiresAt) throw new Error("Upload already started.");
      await ctx.db.patch(s._id, { status: "uploading", uploadUrl: a.uploadUrl, expiresAt: a.expiresAt });
    } else if (a.operation === "lease") {
      if (actor._id !== s.actorId || s.status !== "uploading" || a.offset !== s.offset || !a.lease || !a.hash || !/^[a-f0-9]{64}$/.test(a.hash) || a.size !== Math.min(MEETING_SOURCE_CHUNK_BYTES, s.size - s.offset)) throw new Error("Chunk does not match the active upload.");
      if (s.expiresAt! <= Date.now()) throw new Error("Upload session expired; cancel and upload again.");
      if (s.leaseUntil && s.leaseUntil > Date.now()) throw new Error("A chunk is still transferring. Retry shortly.");
      // Persist the digest before transfer, allowing recovery if the response is lost.
      await ctx.db.patch(s._id, { lease: a.lease, leaseUntil: Date.now() + 90_000, pendingHash: a.hash, pendingSize: a.size });
    } else if (a.operation === "advance") {
      if (s.status !== "uploading" || !s.pendingHash || !s.pendingSize || a.offset !== s.offset + s.pendingSize || a.offset > s.size || a.lease !== s.lease) throw new Error("Invalid transfer acknowledgement.");
      await ctx.db.patch(s._id, { offset: a.offset, hashes: [...s.hashes, s.pendingHash], pendingHash: undefined, pendingSize: undefined, lease: undefined, leaseUntil: undefined });
    } else if (a.operation === "uploaded") {
      if (s.offset !== s.size || !a.itemId || !a.eTag || !a.versionId) throw new Error("Upload has not completed.");
      await ctx.db.patch(s._id, { status: "verifying", itemId: a.itemId, eTag: a.eTag, versionId: a.versionId, uploadUrl: undefined });
    } else if (a.operation === "verified") {
      if (s.status !== "verifying" || a.offset !== s.verifiedOffset || a.hash !== s.hashes[Math.floor(s.verifiedOffset / MEETING_SOURCE_CHUNK_BYTES)]) throw new Error("Stored file checksum mismatch.");
      const verifiedOffset = Math.min(s.size, s.verifiedOffset + MEETING_SOURCE_CHUNK_BYTES);
      await ctx.db.patch(s._id, { verifiedOffset, status: verifiedOffset === s.size ? "ready" : "verifying" });
    } else throw new Error("Unknown transfer operation.");
    return null;
  },
});
