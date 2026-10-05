/** Authoritative selected meeting projection, shared by mutation invalidation and public readers. */
import { makeFunctionReference } from "convex/server";
import { ConvexError } from "convex/values";
import { assertOfflineMeetingPreparationEnabled, offlineMeetingPreparationEnabled } from "./offlineMeetingFeature";
import { toPortableQueryCtx } from "./portable";
import { hostedPrincipal } from "./authIdentity";
import { hasPermission, requirePermissionPortable } from "../../shared/functions/permissions";
import { listPortable as listMeetings } from "../../shared/functions/meetings";
import { listForMeetingPortable } from "../../shared/functions/meetingMaterials";
import type { PortableQueryCtx } from "../../shared/portable/ctx";
import type { FileDescriptor, Mapping, Snapshot } from "../../shared/offline/meetingProtocol";

async function cancelPendingRefresh(ctx: any, scheduledJobId: string | undefined) {
  if (!scheduledJobId) return;
  const job = await ctx.db.system.get(scheduledJobId);
  if (job?.state?.kind === "pending") await ctx.scheduler.cancel(scheduledJobId);
}

export async function visibleSnapshots(portable: PortableQueryCtx, societyId: string, enforceScope = true): Promise<Snapshot[]> {
  assertOfflineMeetingPreparationEnabled();
  const membership = await requirePermissionPortable(portable, societyId, "meetings:read");
  const canEdit = hasPermission(String(membership.role), "meetings:write") && hasPermission(String(membership.role), "minutes:write");
  await requirePermissionPortable(portable, societyId, "minutes:read");
  await requirePermissionPortable(portable, societyId, "agendas:read");
  await requirePermissionPortable(portable, societyId, "documents:read");
  if (enforceScope) await assertMeetingScopeAvailable(portable, societyId);
  const meetings = await listMeetings(portable, { societyId });
  const aggregates = await portable.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", q => q.eq("societyId", societyId)).take(101);
  if (aggregates.length > 100) throw new Error("OFFLINE_MEETING_DATASET_LIMIT: no partial snapshot is permitted.");
  const result: Snapshot[] = [];
  for (const aggregate of aggregates) {
    const mappings: Mapping[] = JSON.parse(aggregate.mappings);
    const meeting = meetings.find(row => row._id === mappings.find(row => row.table === "meetings")?.nativeId);
    if (!meeting) continue;
    const minutes = await portable.db.get(String(meeting.minutesId), "minutes");
    if (!minutes || minutes.societyId !== societyId || minutes.meetingId !== meeting._id) continue;
    const agenda = await portable.db.query("agendas").withIndex("by_meeting", q => q.eq("meetingId", meeting._id)).unique();
    const items = agenda ? await portable.db.query("agendaItems").withIndex("by_agenda", q => q.eq("agendaId", agenda._id)).collect() : [];
    // Existing material availability, explicit grants AND document ACLs apply.
    const materials = await listForMeetingPortable(portable, { meetingId: meeting._id });
    const file: FileDescriptor | undefined = aggregate.file ? JSON.parse(aggregate.file) : undefined;
    const document = mappings.find(row => row.table === "documents");
    const visibleDocument = document ? materials.find(row => row.document?._id === document.nativeId)?.document : undefined;
    // Replaced or deleted online files must never resurrect their earlier cached bytes.
    const sameVersion = visibleDocument && (!aggregate.fileStorageId || visibleDocument.storageId === aggregate.fileStorageId);
    const files = file && document && sameVersion ?
      [{ uuid: document.uuid, name: file.name, sha256: file.sha256, size: file.size, available: Boolean(aggregate.fileStorageId) }] : [];
    result.push({ meetingUuid: aggregate.uuid, revision: aggregate.revision, title: meeting.title, scheduledAt: meeting.scheduledAt,
      ids: { minutes: mappings.find(row => row.table === "minutes")!.uuid, agenda: mappings.find(row => row.table === "agendas")!.uuid,
        items: items.map(item => mappings.find(row => row.nativeId === item._id)!.uuid) }, editable: canEdit && Boolean(agenda) && !minutes?.approvedAt,
      notes: meeting.notes ?? "", discussion: minutes?.discussion ?? "", agenda: items.map(row => row.title), files });
  }
  return result;
}

/** Bounded meeting-preparation materializer, transactionally maintained by native writer hooks. */
export async function rebuildMeetingDownloads(ctx: any, societyId: string) {
  if (!offlineMeetingPreparationEnabled()) return;
  const aggregates = await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", (q: any) => q.eq("societyId", societyId)).take(101);
  if (aggregates.length > 100) throw new Error("OFFLINE_MEETING_DATASET_LIMIT");
  // Online agenda/parent edits retain portable identities for existing rows and
  // allocate identities for new rows. No business row is copied or altered here.
  for (const aggregate of aggregates) {
    const mappings: Mapping[] = JSON.parse(aggregate.mappings);
    const meetingMapping = mappings.find(row => row.table === "meetings");
    const meeting = meetingMapping ? await ctx.db.get(meetingMapping.nativeId) : null;
    if (!meeting || meeting.societyId !== societyId) { await ctx.db.delete(aggregate._id); continue; }
    const agenda = await ctx.db.query("agendas").withIndex("by_meeting", (q: any) => q.eq("meetingId", meeting._id)).unique();
    const items = agenda ? await ctx.db.query("agendaItems").withIndex("by_agenda", (q: any) => q.eq("agendaId", agenda._id)).collect() : [];
    const updated = mappings.filter(row => !["agendaItems"].includes(row.table));
    for (const [table, nativeId] of [["minutes", meeting.minutesId], ["agendas", agenda?._id]]) {
      if (!nativeId) continue;
      const entry = updated.find(row => row.table === table);
      if (entry) entry.nativeId = nativeId; else updated.push({ table: table!, nativeId, uuid: crypto.randomUUID() });
    }
    for (const item of items) updated.push(mappings.find(row => row.table === "agendaItems" && row.nativeId === item._id) ?? { table: "agendaItems", nativeId: item._id, uuid: crypto.randomUUID() });
    const payload = JSON.stringify(updated);
    if (payload !== aggregate.mappings) await ctx.db.patch(aggregate._id, { mappings: payload });
  }
  const remaining = await ctx.db.query("offlineMeetingAggregates").withIndex("by_society_uuid", (q: any) => q.eq("societyId", societyId)).first();
  if (!remaining) {
    for (const row of await ctx.db.query("offlineMeetingDownloads").withIndex("by_society", (q: any) => q.eq("society_id", societyId)).collect()) await ctx.db.delete(row._id);
    const scope = await ctx.db.query("offlineMeetingScopes").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).unique();
    await cancelPendingRefresh(ctx, scope?.scheduledJobId);
    if (scope) await ctx.db.delete(scope._id);
    return;
  }
  const portable = await toPortableQueryCtx(ctx);
  const users = await ctx.db.query("users").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).take(51);
  if (users.length > 50) throw new Error("OFFLINE_MEETING_MEMBERSHIP_LIMIT");
  const previous = await ctx.db.query("offlineMeetingDownloads").withIndex("by_society", (q: any) => q.eq("society_id", societyId)).collect();
  const desired = new Map<string, any>();
  for (const user of users) {
    if (!user.authIssuer || !user.authSubject) continue;
    const actorKey = `${user.authIssuer}|${user.authSubject}`;
    // Projection identity is derived solely from authoritative bindings, never client claims.
    const principal = hostedPrincipal({ issuer: user.authIssuer, subject: user.authSubject, tokenIdentifier: actorKey } as any);
    // Historical bindings for an unconfigured/retired issuer receive no download authority.
    if (principal.kind !== "user" || principal.assurance !== "verified-jwt") continue;
    const scoped = { ...portable, principal };
    // Only membership/permission denial clears this actor's view. Other errors
    // must abort rebuilding, rather than silently publishing an incomplete view.
    let snapshots: Snapshot[];
    try { snapshots = await visibleSnapshots(scoped, societyId, false); }
    catch (error) {
      if (/membership not found|membership is not active|User is disabled|External identity is disabled|Permission (meetings|minutes|agendas|documents):read required/.test(String(error))) continue;
      throw error;
    }
    for (const snapshot of snapshots) {
      const uuid = JSON.stringify([societyId, actorKey, snapshot.meetingUuid]);
      desired.set(uuid, { uuid, society_id: societyId, actor_key: actorKey, meeting_uuid: snapshot.meetingUuid, revision: snapshot.revision, payload: JSON.stringify(snapshot) });
    }
  }
  for (const row of previous) {
    const next = desired.get(row.uuid);
    if (!next) await ctx.db.delete(row._id);
    else { if (row.payload !== next.payload) await ctx.db.patch(row._id, next); desired.delete(row.uuid); }
  }
  for (const row of desired.values()) await ctx.db.insert("offlineMeetingDownloads", row);
  // Query reactivity alone does not wake up at wall-clock expiry. A durable
  // scheduled mutation recomputes at the earliest temporal ACL boundary, with
  // a one-minute repair cadence for operator/internal writes and missed jobs.
  const now = Date.now();
  let nextRefreshAt = now + 60_000;
  const materials = await ctx.db.query("meetingMaterials").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  const appointments = await ctx.db.query("committeeMembers").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).collect();
  for (const date of [...materials.map((row: any) => row.expiresAtISO), ...appointments.flatMap((row: any) => [row.joinedAt, row.leftAt])]) {
    // Material expiry uses '< now', so refresh one millisecond after boundary.
    const timestamp = Date.parse(date ?? "") + 1;
    if (Number.isFinite(timestamp) && timestamp > now) nextRefreshAt = Math.min(nextRefreshAt, timestamp);
  }
  const scope = await ctx.db.query("offlineMeetingScopes").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).unique();
  await cancelPendingRefresh(ctx, scope?.scheduledJobId);
  if (!aggregates.length) { if (scope) await ctx.db.delete(scope._id); return; }
  const scheduledJobId = nextRefreshAt < now + 60_000
    ? await ctx.scheduler.runAt(nextRefreshAt, makeFunctionReference<"mutation">("offlineMeetings:rebuildDownloads"), { societyId }) : undefined;
  const values = { societyId, nextRefreshAt, scheduledJobId, blockedReason: undefined };
  if (scope) await ctx.db.patch(scope._id, values); else await ctx.db.insert("offlineMeetingScopes", values);
}

/** A projection failure must never roll back a successful security revocation. */
export async function blockMeetingDownloads(ctx: any, societyId: string, reason = "MATERIALIZATION_FAILED") {
  for (const row of await ctx.db.query("offlineMeetingDownloads").withIndex("by_society", (q: any) => q.eq("society_id", societyId)).collect()) await ctx.db.delete(row._id);
  const scope = await ctx.db.query("offlineMeetingScopes").withIndex("by_society", (q: any) => q.eq("societyId", societyId)).unique();
  await cancelPendingRefresh(ctx, scope?.scheduledJobId);
  const values = { societyId, nextRefreshAt: Date.now() + 60_000, scheduledJobId: undefined, blockedReason: reason };
  if (scope) await ctx.db.patch(scope._id, values); else await ctx.db.insert("offlineMeetingScopes", values);
}
export async function assertMeetingScopeAvailable(portable: PortableQueryCtx, societyId: string) {
  const scope = await portable.db.query("offlineMeetingScopes").withIndex("by_society", q => q.eq("societyId", societyId)).unique();
  if (scope?.blockedReason) throw new ConvexError({ code: "OFFLINE_ACCESS_DENIED", message: "Meeting preparation access is unavailable while its authorized projection is repaired." });
}
