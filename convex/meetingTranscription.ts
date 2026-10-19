import { query, mutation as baseMutation, internalMutation } from "./_generated/server";
import type { MutationCtx, QueryCtx } from "./_generated/server";
import type { Doc, Id } from "./_generated/dataModel";
import { v } from "convex/values";
import { toPortableQueryCtx } from "./lib/portable";
import { hostedPrincipal } from "./lib/authIdentity";
import { requirePermissionPortable, hasPermission } from "../shared/functions/permissions";
import { requireTranscriptReaderPortable } from "../shared/functions/minutesPrivacy";
import { TRANSCRIPTION_LEASE_MS, TRANSCRIPT_MAX_SEGMENTS, validateWhisperXSettings, validateTranscriptPage } from "../shared/transcription/protocol";
import { whisperXSettingsValidator } from "./tables/meetingTranscription";
import { transcriptSegmentValidator } from "./tables/transcripts";

import { meetingInvalidatingMutation } from "./lib/offlineMeetingInvalidation";
const mutation = meetingInvalidatingMutation(baseMutation);

async function human(ctx: QueryCtx | MutationCtx, societyId: Id<"societies">, settings = false) {
  if (hostedPrincipal(await ctx.auth.getUserIdentity()).kind !== "user") throw new Error("Sign in to manage transcription.");
  const portable = await toPortableQueryCtx(ctx);
  const actor = await requireTranscriptReaderPortable(portable, societyId);
  if (settings) await requirePermissionPortable(portable, societyId, "settings:write");
  return actor;
}
async function meetingAccess(ctx: QueryCtx | MutationCtx, meetingId: Id<"meetings">, write = false) {
  const meeting = await ctx.db.get(meetingId);
  if (!meeting) throw new Error("Meeting unavailable.");
  const actor = await human(ctx, meeting.societyId);
  if (write) await requirePermissionPortable(await toPortableQueryCtx(ctx), meeting.societyId, "meetings:write");
  return { meeting, actor };
}
const publicConnection = (c: Doc<"meetingTranscriptionConnections"> | null) => c ? { id: c._id, name: c.name, enabled: c.enabled, settings: c.settings, heartbeatAt: c.heartbeatAt ?? null, capabilities: c.capabilities ? JSON.parse(c.capabilities) : null } : null;
export const publicJob = (j: Doc<"meetingTranscriptionJobs">) => ({ id: j._id, sourceId: j.sourceId, meetingId: j.meetingId, status: j.status, settings: j.settings, phase: j.status === "applied" ? "Transcript applied" : j.phase ?? null, progress: j.progress ?? null, error: j.error ?? null, pageCount: j.pageCount, segmentCount: j.segmentCount, createdAt: j.createdAt, updatedAt: j.updatedAt });
export const settings = query({ args: { societyId: v.id("societies") }, returns: v.any(), handler: async (ctx, a) => {
  await human(ctx, a.societyId);
  return publicConnection(await ctx.db.query("meetingTranscriptionConnections").withIndex("by_society", q => q.eq("societyId", a.societyId)).unique());
} });
/** The browser generates a random pairing key; only its SHA-256 is persisted. */
export const configure = mutation({ args: { societyId: v.id("societies"), enabled: v.boolean(), name: v.string(), settings: whisperXSettingsValidator, keyHash: v.optional(v.string()), allowRecordingProcessing: v.boolean() }, returns: v.null(), handler: async (ctx, a) => {
  const actor = await human(ctx, a.societyId, true);
  validateWhisperXSettings(a.settings);
  if (!a.name.trim() || a.name.length > 120 || !a.allowRecordingProcessing) throw new Error("Allow this processor to access queued recordings, including private meeting sections.");
  if (a.keyHash && !/^[a-f0-9]{64}$/.test(a.keyHash)) throw new Error("Invalid pairing key hash.");
  const prior = await ctx.db.query("meetingTranscriptionConnections").withIndex("by_society", q => q.eq("societyId", a.societyId)).unique();
  if (!prior && !a.keyHash) throw new Error("Create a pairing key first.");
  const data = { createdBy: actor._id as Id<"users">, name: a.name.trim(), enabled: a.enabled, settings: a.settings, updatedAt: Date.now(), ...(a.keyHash ? { keyHash: a.keyHash, heartbeatAt: undefined, capabilities: undefined } : {}) };
  if (prior) await ctx.db.patch(prior._id, data);
  else await ctx.db.insert("meetingTranscriptionConnections", { societyId: a.societyId, keyHash: a.keyHash!, ...data });
  return null;
} });
export const jobs = query({ args: { meetingId: v.id("meetings") }, returns: v.any(), handler: async (ctx, a) => {
  await meetingAccess(ctx, a.meetingId);
  return (await ctx.db.query("meetingTranscriptionJobs").withIndex("by_meeting", q => q.eq("meetingId", a.meetingId)).order("desc").take(30)).map(publicJob);
} });
export const enqueue = mutation({ args: { sourceId: v.id("meetingSources"), settings: v.optional(whisperXSettingsValidator) }, returns: v.id("meetingTranscriptionJobs"), handler: async (ctx, a) => {
  const s = await ctx.db.get(a.sourceId);
  if (!s || s.status !== "ready" || s.kind !== "recording") throw new Error("Choose a verified recording.");
  const { actor } = await meetingAccess(ctx, s.meetingId, true);
  const connection = await ctx.db.query("meetingTranscriptionConnections").withIndex("by_society", q => q.eq("societyId", s.societyId)).unique();
  if (!connection?.enabled) throw new Error("Connect a transcription processor in settings first.");
  const pending = (await ctx.db.query("meetingTranscriptionJobs").withIndex("by_source", q => q.eq("sourceId", s._id)).order("desc").take(30)).find(j => ["queued", "running", "ready"].includes(j.status));
  if (pending) return pending._id;
  const queued = await ctx.db.query("meetingTranscriptionJobs").withIndex("by_connection_status", q => q.eq("connectionId", connection._id).eq("status", "queued")).take(21);
  if (queued.length >= 20) throw new Error("This workspace already has 20 recordings queued.");
  const settings = validateWhisperXSettings(a.settings ?? connection.settings);
  const transcript = await ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", s.meetingId)).first();
  const now = Date.now();
  return ctx.db.insert("meetingTranscriptionJobs", { societyId: s.societyId, meetingId: s.meetingId, sourceId: s._id, actorId: actor._id as Id<"users">, connectionId: connection._id, status: "queued", settings, sourceFingerprint: s.fingerprint, createdAt: now, updatedAt: now, attempt: 0, pageCount: 0, segmentCount: 0, speakers: [], ...(transcript ? { baseTranscriptRevision: transcript.contentRevision ?? `${transcript._id}:${transcript.createdAtISO}` } : {}) });
} });
export const cancel = mutation({ args: { jobId: v.id("meetingTranscriptionJobs") }, returns: v.null(), handler: async (ctx, a) => {
  const job = await ctx.db.get(a.jobId); if (!job) throw new Error("Job unavailable.");
  await meetingAccess(ctx, job.meetingId, true);
  if (["queued", "running", "ready"].includes(job.status)) await ctx.db.patch(job._id, { status: "cancelled", lease: undefined, leaseUntil: undefined, updatedAt: Date.now() });
  return null;
} });
export const apply = mutation({ args: { jobId: v.id("meetingTranscriptionJobs"), replace: v.boolean(), expectedRevision: v.optional(v.string()) }, returns: v.null(), handler: async (ctx, a) => {
  const job = await ctx.db.get(a.jobId); if (!job || !["ready", "applied"].includes(job.status)) throw new Error("A completed transcript is required.");
  await meetingAccess(ctx, job.meetingId, true);
  if (job.status === "applied") return null;
  const prior = await ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", job.meetingId)).first();
  const currentRevision = prior ? prior.contentRevision ?? `${prior._id}:${prior.createdAtISO}` : undefined;
  if (currentRevision !== a.expectedRevision) throw new Error("The transcript changed. Review it before replacing it.");
  if (prior && !a.replace) throw new Error("Confirm replacing the current working transcript.");
  const data = { societyId: job.societyId, meetingId: job.meetingId, provider: "zoer-whisperx", text: "", segments: [], speakers: job.speakers.map(label => ({ label })), durationSeconds: job.durationSeconds, language: job.language, demo: false, createdAtISO: new Date().toISOString(), pagedJobId: job._id, contentRevision: `${job._id}:${job.attempt}`, segmentCount: job.segmentCount, pageCount: job.pageCount, wordsDropped: false };
  if (prior) await ctx.db.patch(prior._id, data); else await ctx.db.insert("transcripts", data);
  // Candidate activation never rewrites either draft or approved minutes.
  await ctx.db.patch(job._id, { status: "applied", phase: "Transcript applied", appliedAt: Date.now(), updatedAt: Date.now() });
  return null;
} });

async function processorAccess(ctx: QueryCtx | MutationCtx, keyHash: string) {
  const c = await ctx.db.query("meetingTranscriptionConnections").withIndex("by_keyHash", q => q.eq("keyHash", keyHash)).unique();
  if (!c?.enabled) throw new Error("Processor access revoked.");
  const owner = await ctx.db.get(c.createdBy);
  if (!owner || owner.societyId !== c.societyId || owner.status && owner.status !== "Active" || !hasPermission(String(owner.role), "settings:write")) throw new Error("Processor administrator access revoked.");
  return c;
}
async function leased(ctx: QueryCtx | MutationCtx, keyHash: string, jobId: Id<"meetingTranscriptionJobs">, lease: string) {
  const connection = await processorAccess(ctx, keyHash);
  const job = await ctx.db.get(jobId);
  if (!job || job.connectionId !== connection._id || job.status !== "running" || job.lease !== lease || (job.leaseUntil ?? 0) < Date.now()) throw new Error("Processing lease ended.");
  const s = await ctx.db.get(job.sourceId); const actor = await ctx.db.get(job.actorId);
  if (!s || s.status !== "ready" || s.fingerprint !== job.sourceFingerprint || s.meetingId !== job.meetingId || !actor || actor.societyId !== job.societyId || actor.status && actor.status !== "Active" || !hasPermission(String(actor.role), "minutes:write") || !hasPermission(String(actor.role), "meetings:write")) throw new Error("Recording processing access revoked.");
  return { connection, job, source: s };
}
export const processor = internalMutation({ args: { keyHash: v.string(), operation: v.string(), data: v.any(), nonce: v.string() }, returns: v.any(), handler: async (ctx, a) => {
  const c = await processorAccess(ctx, a.keyHash); const d = a.data; const now = Date.now();
  if (a.operation === "status" || a.operation === "settings") {
    if (a.operation === "settings") { validateWhisperXSettings(d.settings); await ctx.db.patch(c._id, { settings: d.settings, updatedAt: now }); }
    const queued = await ctx.db.query("meetingTranscriptionJobs").withIndex("by_connection_status", q => q.eq("connectionId", c._id).eq("status", "queued")).take(30);
    const recent = await ctx.db.query("meetingTranscriptionJobs").withIndex("by_connection", q => q.eq("connectionId", c._id)).order("desc").take(30);
    const running = await ctx.db.query("meetingTranscriptionJobs").withIndex("by_connection_status", q => q.eq("connectionId", c._id).eq("status", "running")).take(1);
    return { protocol: 1, connection: publicConnection({ ...c, ...(a.operation === "settings" ? { settings: d.settings } : {}) }), queued: queued.map(publicJob), running: running.map(publicJob), recent: recent.map(publicJob) };
  }
  if (a.operation === "cancel") {
    const job = await ctx.db.get(d.jobId as Id<"meetingTranscriptionJobs">);
    if (!job || job.connectionId !== c._id) throw new Error("Job unavailable.");
    if (["queued", "running", "ready"].includes(job.status)) await ctx.db.patch(job._id, { status: "cancelled", lease: undefined, leaseUntil: undefined, updatedAt: now });
    return { status: "cancelled" };
  }
  if (a.operation === "claim") {
    if (typeof d.workerId !== "string" || !/^[A-Za-z0-9._-]{1,100}$/.test(d.workerId) || (!d.capabilities || Array.isArray(d.capabilities) || typeof d.capabilities !== "object") || JSON.stringify(d.capabilities).length > 4096) throw new Error("Invalid worker identity.");
    await ctx.db.patch(c._id, { heartbeatAt: now, capabilities: JSON.stringify(d.capabilities) });
    let job = c.activeJobId ? await ctx.db.get(c.activeJobId) : null;
    if (job?.status === "running" && (job.leaseUntil ?? 0) > now) return { job: null, busy: true };
    if (job?.status !== "running") job = await ctx.db.query("meetingTranscriptionJobs").withIndex("by_connection_status", q => q.eq("connectionId", c._id).eq("status", "queued")).first();
    if (!job) return { job: null };
    const actor = await ctx.db.get(job.actorId); const source = await ctx.db.get(job.sourceId);
    if (!actor || actor.status && actor.status !== "Active" || actor.societyId !== c.societyId || !hasPermission(String(actor.role), "minutes:write") || !hasPermission(String(actor.role), "meetings:write") || !source || source.status !== "ready" || source.fingerprint !== job.sourceFingerprint) { await ctx.db.patch(job._id, { status: "failed", error: "Recording access was revoked.", updatedAt: now }); return { job: null }; }
    if (job.attempt >= 3) { await ctx.db.patch(job._id, { status: "failed", error: "Processing was interrupted three times. Retry when the worker is available.", updatedAt: now }); return { job: null }; }
    const patch = { status: "running" as const, attempt: job.attempt + 1, lease: a.nonce, leaseUntil: now + TRANSCRIPTION_LEASE_MS, workerId: d.workerId, updatedAt: now, phase: "Downloading", progress: 0, pageCount: 0, segmentCount: 0, speakers: [], lastStartSec: undefined, maxEndSec: undefined, receipt: undefined, error: undefined };
    await ctx.db.patch(job._id, patch); await ctx.db.patch(c._id, { activeJobId: job._id });
    return { job: { id: job._id, lease: a.nonce, settings: job.settings, fileName: source.fileName, size: source.size, hashes: source.hashes, attempt: patch.attempt } };
  }
  if (a.operation === "complete") {
    const prior = await ctx.db.get(d.jobId as Id<"meetingTranscriptionJobs">);
    if (prior && prior.connectionId === c._id && ["ready", "applied"].includes(prior.status) && prior.receipt === d.lease && prior.pageCount === d.pageCount && prior.segmentCount === d.segmentCount) return { status: prior.status };
  }
  const { job, source } = await leased(ctx, a.keyHash, d.jobId, d.lease);
  if (a.operation === "download") {
    if (!Number.isSafeInteger(d.offset) || d.offset < 0 || d.offset >= source.size || d.offset % (5 * 1024 * 1024)) throw new Error("Invalid recording offset.");
    return { source, offset: d.offset };
  }
  if (a.operation === "heartbeat") {
    const progress = typeof d.progress === "number" && Number.isFinite(d.progress) ? Math.min(1, Math.max(0, d.progress)) : job.progress;
    await ctx.db.patch(job._id, { leaseUntil: now + TRANSCRIPTION_LEASE_MS, updatedAt: now, phase: String(d.phase ?? job.phase ?? "Processing").slice(0, 80), ...(progress !== undefined ? { progress } : {}) });
    await ctx.db.patch(c._id, { heartbeatAt: now }); return { status: "running", settings: job.settings };
  }
  if (a.operation === "page") {
    validateTranscriptPage(d.segments);
    if (!Number.isSafeInteger(d.page) || d.page < 0 || typeof d.hash !== "string" || !/^[a-f0-9]{64}$/.test(d.hash)) throw new Error("Invalid result page.");
    const prior = await ctx.db.query("meetingTranscriptPages").withIndex("by_job_attempt_page", q => q.eq("jobId", job._id).eq("attempt", job.attempt).eq("page", d.page)).unique();
    if (prior) { if (prior.hash !== d.hash) throw new Error("Result page changed during retry."); return { received: job.pageCount }; }
    if (d.page !== job.pageCount || job.segmentCount + d.segments.length > TRANSCRIPT_MAX_SEGMENTS || d.segments[0].startSec < (job.lastStartSec ?? 0)) throw new Error("Result pages are out of order or too large.");
    const labels = [...new Set([...job.speakers, ...d.segments.map((s: any) => s.speaker)])] as string[];
    if (labels.length > 64) throw new Error("Too many speaker labels.");
    await ctx.db.insert("meetingTranscriptPages", { societyId: job.societyId, meetingId: job.meetingId, jobId: job._id, attempt: job.attempt, page: d.page, startIndex: job.segmentCount, startSec: d.segments[0].startSec, endSec: Math.max(...d.segments.map((s: any) => s.endSec)), hash: d.hash, text: d.segments.map((s: any) => s.text).join("\n"), segments: d.segments, revision: 0 });
    await ctx.db.patch(job._id, { pageCount: job.pageCount + 1, segmentCount: job.segmentCount + d.segments.length, lastStartSec: d.segments.at(-1).startSec, maxEndSec: Math.max(job.maxEndSec ?? 0, ...d.segments.map((s: any) => s.endSec)), speakers: labels, leaseUntil: now + TRANSCRIPTION_LEASE_MS, updatedAt: now }); return { received: job.pageCount + 1 };
  }
  if (a.operation === "complete") {
    if (!job.pageCount || d.pageCount !== job.pageCount || d.segmentCount !== job.segmentCount || !Number.isFinite(d.durationSeconds) || d.durationSeconds < (job.maxEndSec ?? 0) || d.durationSeconds > 86400 || typeof d.language !== "string" || !/^[a-z]{2,3}$/.test(d.language)) throw new Error("Incomplete or invalid transcription result.");
    await ctx.db.patch(job._id, { status: "ready", receipt: d.lease, durationSeconds: d.durationSeconds, language: d.language, progress: 1, phase: "Ready for review", lease: undefined, leaseUntil: undefined, updatedAt: now }); return { status: "ready" };
  }
  if (a.operation === "fail") { await ctx.db.patch(job._id, { status: "failed", error: "WhisperX processing failed. Check the worker diagnostics and retry.", lease: undefined, leaseUntil: undefined, updatedAt: now }); return { status: "failed" }; }
  throw new Error("Unknown processor operation.");
} });

async function readableJob(ctx: QueryCtx | MutationCtx, jobId: Id<"meetingTranscriptionJobs">, write = false) {
  const job = await ctx.db.get(jobId);
  if (!job || !["ready", "applied"].includes(job.status)) throw new Error("Transcript unavailable.");
  await meetingAccess(ctx, job.meetingId, write);
  return job;
}
export const page = query({ args: { jobId: v.id("meetingTranscriptionJobs"), page: v.number() }, returns: v.any(), handler: async (ctx, a) => {
  const job = await readableJob(ctx, a.jobId);
  if (!Number.isSafeInteger(a.page) || a.page < 0 || a.page >= job.pageCount) throw new Error("Invalid transcript page.");
  const row = await ctx.db.query("meetingTranscriptPages").withIndex("by_job_attempt_page", q => q.eq("jobId", job._id).eq("attempt", job.attempt).eq("page", a.page)).unique();
  if (!row) throw new Error("Transcript page unavailable.");
  return { page: row.page, segments: row.segments, revision: row.revision, startIndex: row.startIndex, startSec: row.startSec, endSec: row.endSec };
} });
export const search = query({ args: { jobId: v.id("meetingTranscriptionJobs"), text: v.string() }, returns: v.any(), handler: async (ctx, a) => {
  const job = await readableJob(ctx, a.jobId);
  if (!a.text.trim() || a.text.length > 200) return [];
  return (await ctx.db.query("meetingTranscriptPages").withSearchIndex("search_text", q => q.search("text", a.text.trim()).eq("jobId", job._id).eq("attempt", job.attempt)).take(20)).map(p => ({ page: p.page, startSec: p.startSec, excerpt: p.text.slice(0, 220) }));
} });
export const pageAtTime = query({ args: { jobId: v.id("meetingTranscriptionJobs"), seconds: v.number() }, returns: v.number(), handler: async (ctx, a) => {
  const job = await readableJob(ctx, a.jobId);
  if (!Number.isFinite(a.seconds) || a.seconds < 0) throw new Error("Invalid recording time.");
  return (await ctx.db.query("meetingTranscriptPages").withIndex("by_job_attempt_startSec", q => q.eq("jobId", job._id).eq("attempt", job.attempt).lte("startSec", a.seconds)).order("desc").first())?.page ?? 0;
} });
export const editSegment = mutation({ args: { jobId: v.id("meetingTranscriptionJobs"), page: v.number(), revision: v.number(), index: v.number(), text: v.optional(v.string()), speaker: v.optional(v.string()) }, returns: v.object({ wordsDropped: v.boolean() }), handler: async (ctx, a) => {
  const job = await readableJob(ctx, a.jobId, true);
  const transcript = await ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", job.meetingId)).first();
  if (transcript?.pagedJobId !== job._id) throw new Error("This transcript is no longer active.");
  const row = await ctx.db.query("meetingTranscriptPages").withIndex("by_job_attempt_page", q => q.eq("jobId", job._id).eq("attempt", job.attempt).eq("page", a.page)).unique();
  if (!row || row.revision !== a.revision) throw new Error("This page changed. Reload it before editing.");
  if (!Number.isSafeInteger(a.index) || a.index < 0 || a.index >= row.segments.length) throw new Error("Invalid segment.");
  const segments = [...row.segments]; const old = segments[a.index];
  segments[a.index] = { ...old, ...(a.text !== undefined ? { text: a.text.trim(), words: undefined } : {}), ...(a.speaker !== undefined ? { speaker: a.speaker.trim() } : {}) };
  validateTranscriptPage(segments);
  const labels = [...new Set([...(transcript.speakers ?? []).map(s => s.label), segments[a.index].speaker])];
  if (labels.length > 64) throw new Error("Too many speakers.");
  await ctx.db.patch(row._id, { segments, text: segments.map(s => s.text).join("\n"), revision: row.revision + 1 });
  const speakers = [...(transcript.speakers ?? [])]; if (!speakers.some(s => s.label === segments[a.index].speaker)) speakers.push({ label: segments[a.index].speaker });
  await ctx.db.patch(transcript._id, { speakers, contentRevision: `${Date.now()}:${Math.random()}` });
  return { wordsDropped: false };
} });
