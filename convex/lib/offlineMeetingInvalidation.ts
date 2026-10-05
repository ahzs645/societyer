/** Transactional invalidation at the native writer boundary, including portable handlers.
 * Keep the watched table registry alongside projection dependencies. No client ACL
 * input is trusted and the original handler remains responsible for authorization.
 */
import { rebuildMeetingDownloads, blockMeetingDownloads } from "./offlineMeetingProjection";

const CONTENT_TABLES = new Set(["meetings", "minutes", "agendas", "agendaItems"]);
export const MEETING_DOWNLOAD_DEPENDENCIES = [
  ...CONTENT_TABLES, "documents", "meetingMaterials", "users", "externalIdentities",
  "committeeMembers", "committees", "members", "directors", "societies",
] as const;
export { offlineMeetingPreparationEnabled, assertOfflineMeetingPreparationEnabled } from "./offlineMeetingFeature";
import { offlineMeetingPreparationEnabled } from "./offlineMeetingFeature";

export async function withMeetingDownloadInvalidation<T>(ctx: any, body: (ctx: any) => Promise<T>): Promise<T> {
  if (!offlineMeetingPreparationEnabled()) return body(ctx);
  const affected = new Set<string>(), content = new Set<string>();
  const db = ctx.db;
  const tableForId = (id: string) => MEETING_DOWNLOAD_DEPENDENCIES.find(table => db.normalizeId(table, id));
  async function record(table: string | undefined, row: any) {
    if (!table || !row) return;
    if (table === "externalIdentities") {
      // Include old AND new identity binding on replace/rebind/delete. Authoritative
      // membership bindings identify every affected tenant without trusting arguments.
      const members = await db.query("users").withIndex("by_auth_identity", (q: any) => q.eq("authIssuer", row.issuer).eq("authSubject", row.subject)).collect();
      for (const user of members) affected.add(String(user.societyId));
    } else {
      const societyId = table === "societies" ? row._id : row.societyId;
      if (societyId) { affected.add(String(societyId)); if (CONTENT_TABLES.has(table)) content.add(String(societyId)); }
    }
  }
  const writer = new Proxy(db, { get(target, key) {
    if (key === "insert") return async (table: string, values: any) => {
      const id = await target.insert(table, values);
      if ((MEETING_DOWNLOAD_DEPENDENCIES as readonly string[]).includes(table)) await record(table, { ...values, _id: id });
      return id;
    };
    if (key === "patch" || key === "replace" || key === "delete") return async (...args: any[]) => {
      // Support both SDK writer overloads: (id, values) and (table, id, values).
      const explicitTable = typeof args[1] === "string" ? args[0] : undefined;
      const id = explicitTable ? args[1] : args[0];
      const table = explicitTable ?? tableForId(id);
      const watched = table && (MEETING_DOWNLOAD_DEPENDENCIES as readonly string[]).includes(table);
      if (watched) await record(table, await target.get(id));
      const result = await target[key](...args);
      if (watched && key !== "delete") await record(table, await target.get(id));
      return result;
    };
    const value = Reflect.get(target, key);
    return typeof value === "function" ? value.bind(target) : value;
  } });
  const result = await body({ ...ctx, db: writer });
  for (const societyId of affected) {
    const aggregate = await db.query("offlineMeetingAggregates").withIndex("by_society_uuid", (q: any) => q.eq("societyId", societyId)).first();
    if (!aggregate) continue; // No writes, scheduling or membership limits for an ordinary workspace.
    try {
    if (content.has(societyId)) {
      // Native online changes must also invalidate the optimistic command revision.
      // Conservative workspace-wide invalidation favors a visible conflict over overwriting newer work.
      const aggregates = await db.query("offlineMeetingAggregates").withIndex("by_society_uuid", (q: any) => q.eq("societyId", societyId)).take(101);
      if (aggregates.length > 100) throw new Error("OFFLINE_MEETING_DATASET_LIMIT");
      for (const row of aggregates) await db.patch(row._id, { revision: row.revision + 1 });
    }
    await rebuildMeetingDownloads(ctx, societyId);
    } catch { await blockMeetingDownloads(ctx, societyId); }
  }
  return result;
}

/** Use for internal writers too; generated Convex files are never edited. */
export function meetingInvalidatingMutation<T>(builder: T): T {
  return ((definition: any) => (builder as any)({ ...definition, handler: async (ctx: any, args: any) =>
    withMeetingDownloadInvalidation(ctx, next => definition.handler(next, args)) })) as T;
}
