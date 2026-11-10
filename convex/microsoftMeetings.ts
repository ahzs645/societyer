import { v } from "convex/values";
import { query, mutation, internalQuery, internalMutation } from "./_generated/server";
import type { QueryCtx, MutationCtx } from "./_generated/server";
import type { Id } from "./_generated/dataModel";
import { authorizedQuery, authorizedMutation } from "./lib/authorizedServer";
import { toPortableQueryCtx, toPortableMutationCtx } from "./lib/portable";
import { requirePermissionPortable } from "../shared/functions/permissions";
import { requireTranscriptReaderPortable } from "../shared/functions/minutesPrivacy";
import { hostedPrincipal } from "./lib/authIdentity";
import { meetingInvalidatingMutation } from "./lib/offlineMeetingInvalidation";
import { meetingBinding, sourceKey } from "../shared/microsoftMeetings";
import { teamsSourceValidator, teamsParticipantValidator } from "./tables/microsoftMeetings";
import { transcriptSegmentValidator } from "./tables/transcripts";
import { createPortable } from "../shared/functions/meetings";
import { importTimedPortable, assignSpeakerPortable } from "../shared/functions/transcripts";

async function editor(ctx: QueryCtx | MutationCtx, societyId: Id<"societies">) {
  if (hostedPrincipal(await ctx.auth.getUserIdentity()).kind !== "user") throw new Error("Sign in to import Teams meetings.");
  const portable = await toPortableQueryCtx(ctx);
  const actor = await requireTranscriptReaderPortable(portable, societyId);
  await requirePermissionPortable(portable, societyId, "meetings:write");
  await requirePermissionPortable(portable, societyId, "settings:write");
  return actor;
}
export const settings = authorizedQuery("microsoftMeetings:settings", query)({ args: { societyId: v.id("societies") }, returns: v.any(), handler: async (ctx, a) => {
  await editor(ctx, a.societyId);
  const binding = meetingBinding(process.env, a.societyId);
  const configured = Boolean(binding && process.env.MICROSOFT_MEETINGS_TENANT_ID && process.env.MICROSOFT_MEETINGS_CLIENT_ID && process.env.MICROSOFT_MEETINGS_PRIVATE_KEY && process.env.MICROSOFT_MEETINGS_CERT_SHA256);
  return { configured, chats: binding?.chats ?? [], organizers: binding?.organizerIds ?? [] };
} });
export const access = internalQuery({ args: { societyId: v.id("societies"), candidateId: v.optional(v.id("microsoftMeetingCandidates")) }, returns: v.any(), handler: async (ctx, a) => {
  const actor = await editor(ctx, a.societyId);
  const binding = meetingBinding(process.env, a.societyId);
  if (!binding) throw new Error("Teams import is not enabled for this workspace.");
  const candidate = a.candidateId ? await ctx.db.get(a.candidateId) : null;
  if (a.candidateId && (!candidate || candidate.societyId !== a.societyId || candidate.expiresAt < Date.now() || !binding.organizerIds.includes(candidate.source.organizerId))) throw new Error("Teams source expired or is unavailable in this workspace. Refresh the list.");
  const users = await ctx.db.query("users").withIndex("by_society", q => q.eq("societyId", a.societyId)).take(501);
  if (users.length > 500) throw new Error("This connector needs a paginated workspace-user adapter before use with more than 500 users.");
  return { actorId: actor._id, binding, candidate, users: users.filter(u => u.status === "Active").map(u => ({ id: u._id, authSubject: u.authSubject, name: u.displayName })) };
} });
export const stage = internalMutation({ args: { societyId: v.id("societies"), sources: v.array(teamsSourceValidator) }, returns: v.any(), handler: async (ctx, a) => {
  await editor(ctx, a.societyId);
  const binding = meetingBinding(process.env, a.societyId);
  if (!binding || a.sources.length > 100) throw new Error("Teams source limit exceeded.");
  const result: any[] = [];
  for (const source of a.sources) {
    if (!binding.organizerIds.includes(source.organizerId)) throw new Error("Organizer is not enabled for this workspace.");
    const key = sourceKey(source);
    const imported = await ctx.db.query("microsoftMeetingImports").withIndex("by_society_sourceKey", q => q.eq("societyId", a.societyId).eq("sourceKey", key)).unique();
    const existing = await ctx.db.query("microsoftMeetingCandidates").withIndex("by_society_sourceKey", q => q.eq("societyId", a.societyId).eq("sourceKey", key)).unique();
    const value = { societyId: a.societyId, sourceKey: key, source, expiresAt: Date.now() + 3600_000 };
    const id = existing?._id ?? await ctx.db.insert("microsoftMeetingCandidates", value);
    if (existing) await ctx.db.patch(id, value);
    result.push({ id, source, meetingId: imported?.meetingId ?? null });
  }
  return result;
} });
export const commitImport = meetingInvalidatingMutation(internalMutation)({ args: { societyId: v.id("societies"), candidateId: v.id("microsoftMeetingCandidates"), transcriptId: v.string(), title: v.string(), transcriptHash: v.string(), segments: v.array(transcriptSegmentValidator), participants: v.array(teamsParticipantValidator), contextChatId: v.optional(v.string()), contextChatConfirmed: v.boolean() }, returns: v.id("meetings"), handler: async (ctx, a) => {
  const actor = await editor(ctx, a.societyId);
  const binding = meetingBinding(process.env, a.societyId);
  const candidate = await ctx.db.get(a.candidateId);
  if (!binding || !candidate || candidate.societyId !== a.societyId || candidate.expiresAt < Date.now() || candidate.source.transcriptId !== a.transcriptId || !binding.organizerIds.includes(candidate.source.organizerId)) throw new Error("Teams source changed or access was revoked. Refresh the list.");
  if (a.contextChatId && (!a.contextChatConfirmed || !binding.chats.some(c => c.id === a.contextChatId))) throw new Error("Confirm an approved chat before linking its roster.");
  if (!a.title.trim() || a.title.length > 200 || a.participants.length > 250) throw new Error("Invalid Teams import details.");
  for (const p of a.participants) if (p.userId) { const user = await ctx.db.get(p.userId); if (!user || user.societyId !== a.societyId || user.status !== "Active") throw new Error("A linked workspace user is unavailable."); }
  const prior = await ctx.db.query("microsoftMeetingImports").withIndex("by_society_sourceKey", q => q.eq("societyId", a.societyId).eq("sourceKey", candidate.sourceKey)).unique();
  if (prior) { if (!await ctx.db.get(prior.meetingId)) throw new Error("The imported meeting was deleted. Review its import history before restoring it."); return prior.meetingId; }
  const portable = await toPortableMutationCtx(ctx);
  const meetingId = await createPortable(portable, { societyId: a.societyId, type: "Other", title: a.title.trim(), scheduledAt: candidate.source.createdAt, status: "Held", electronic: true, location: "Microsoft Teams", attendeeIds: [], recordKind: "notes", sourceReviewStatus: "imported_needs_review", notes: "Imported from a Teams transcript. Time records the start of transcription; a linked chat roster is not proof of attendance.", ...(candidate.source.joinUrl ? { remoteUrl: candidate.source.joinUrl } : {}) }) as Id<"meetings">;
  await importTimedPortable(portable, { societyId: a.societyId, meetingId, provider: "vtt", segments: a.segments });
  await ctx.db.insert("microsoftMeetingImports", { societyId: a.societyId, sourceKey: candidate.sourceKey, source: candidate.source, meetingId, transcriptHash: a.transcriptHash, importedBy: actor._id as Id<"users">, importedAt: Date.now(), participants: a.participants, contextChatConfirmed: a.contextChatConfirmed, ...(a.contextChatId ? { contextChatId: a.contextChatId } : {}) });
  return meetingId;
} });
export const participants = authorizedQuery("microsoftMeetings:participants", query)({ args: { societyId: v.id("societies"), meetingId: v.id("meetings") }, returns: v.any(), handler: async (ctx, a) => {
  await editor(ctx, a.societyId);
  const row = await ctx.db.query("microsoftMeetingImports").withIndex("by_meeting", q => q.eq("meetingId", a.meetingId)).unique();
  if (!row || row.societyId !== a.societyId) return null;
  const members: { name: string; userId: Id<"users"> | null }[] = [];
  for (const p of row.participants) { const user = p.userId ? await ctx.db.get(p.userId) : null; members.push({ name: p.name, userId: user?.societyId === a.societyId && user.status === "Active" ? user._id : null }); }
  return { participants: members, sourceKind: row.source.kind, importedAt: row.importedAt, chatRoster: Boolean(row.contextChatId) };
} });
export const assignSpeakerToUser = authorizedMutation("microsoftMeetings:assignSpeakerToUser", mutation)({ args: { societyId: v.id("societies"), meetingId: v.id("meetings"), userId: v.id("users"), label: v.string() }, returns: v.null(), handler: async (ctx, a) => {
  const actor = await editor(ctx, a.societyId);
  const row = await ctx.db.query("microsoftMeetingImports").withIndex("by_meeting", q => q.eq("meetingId", a.meetingId)).unique();
  const user = await ctx.db.get(a.userId);
  if (!row || row.societyId !== a.societyId || !row.participants.some(p => p.userId === a.userId) || !user || user.societyId !== a.societyId || user.status !== "Active") throw new Error("Choose an active, verified workspace user from the linked chat.");
  let link = await ctx.db.query("microsoftMeetingPeople").withIndex("by_society_userId", q => q.eq("societyId", a.societyId).eq("userId", a.userId)).unique();
  const now = new Date().toISOString();
  if (!link) { const personId = await ctx.db.insert("peopleDirectory", { societyId: a.societyId, fullName: user.displayName, searchName: user.displayName.trim().toLowerCase(), sourceKey: `teams-user:${a.userId}`, identityReviewStatus: "reviewed", createdAtISO: now, updatedAtISO: now }); const id = await ctx.db.insert("microsoftMeetingPeople", { societyId: a.societyId, userId: a.userId, personId, reviewedBy: actor._id as Id<"users">, reviewedAt: Date.now() }); link = await ctx.db.get(id); }
  const transcript = await ctx.db.query("transcripts").withIndex("by_meeting", q => q.eq("meetingId", a.meetingId)).unique();
  if (!transcript?.segments.some(s => s.speaker === a.label)) throw new Error("Choose an existing transcript speaker.");
  await assignSpeakerPortable(await toPortableMutationCtx(ctx), { societyId: a.societyId, meetingId: a.meetingId, label: a.label, name: user.displayName, personId: link!.personId });
  await ctx.db.insert("activity", { societyId: a.societyId, actor: String(actor._id), action: "teams.speakerLinked", entityType: "meetings", entityId: a.meetingId, summary: JSON.stringify({ label: a.label, userId: a.userId, personId: link!.personId }), createdAtISO: now });
  return null;
} });
