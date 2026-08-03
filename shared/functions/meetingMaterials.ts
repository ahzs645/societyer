/**
 * PORTABLE FUNCTIONS: the meeting-materials domain
 * (listForMeeting / listForSociety / attach / setAvailability / remove).
 *
 * Reads/writes the `meetingMaterials` table (plus `meetings`, `documents`,
 * `users`, `committeeMembers`) over `ctx.db`. The access-control helpers are
 * portable copies of `convex/lib/access/materialAccess.ts` and
 * `convex/lib/access/documentAccess.ts` (both only touch `ctx.db`). Each handler
 * runs unchanged on hosted Convex, the local Dexie runtime, and the convex-test
 * oracle.
 *
 * `packageForMeeting` resolves each material's document download URL through the
 * injected `ctx.capabilities.storage`; its agenda + material-summary helpers are
 * portable copies of `convex/lib/agendaItems.ts` and the material-access lib.
 */

import type { PortableMutationCtx, PortableQueryCtx } from "../portable/ctx";
import { getOwned, principalUserId, requireSocietyMembership } from "./access";

// ----- portable access helpers (copied from convex/lib/access/*) ------------

const ACCESS_RANK: Record<string, number> = {
  view: 10,
  comment: 20,
  sign: 30,
  manage: 40,
};

type AccessSubjectContext = {
  userId?: string | null;
  userRole?: string | null;
  memberId?: string | null;
  directorId?: string | null;
  committeeIds?: string[];
  attendeeNames?: string[];
  groups?: string[];
};

function normalizeAccessGrants(grants: any[] | undefined) {
  if (!Array.isArray(grants)) return [];
  return grants
    .map((grant) => ({
      subjectType: String(grant.subjectType ?? "").trim(),
      subjectId: grant.subjectId ? String(grant.subjectId).trim() : undefined,
      subjectLabel: String(grant.subjectLabel ?? "").trim(),
      access: String(grant.access ?? "view").trim() || "view",
      note: grant.note ? String(grant.note).trim() : undefined,
    }))
    .filter((grant) => grant.subjectType && grant.subjectLabel);
}

function materialEffectiveStatus(material: any, nowMs = Date.now()): string {
  if (!material) return "available";
  if (material.availabilityStatus === "withdrawn") return "withdrawn";
  if (isMaterialExpired(material, nowMs)) return "expired";
  return material.availabilityStatus ?? "available";
}

function isMaterialExpired(material: any, nowMs = Date.now()) {
  if (!material?.expiresAtISO) return false;
  const expires = new Date(material.expiresAtISO).getTime();
  return Number.isFinite(expires) && expires < nowMs;
}

function materialNeedsAttention(material: any, nowMs = Date.now()) {
  const status = materialEffectiveStatus(material, nowMs);
  return status === "pending" || status === "expired" || status === "withdrawn";
}

function summarizeMeetingMaterials(materials: any[], nowMs = Date.now()) {
  const total = materials.length;
  const ready = materials.filter((material) => !materialNeedsAttention(material, nowMs)).length;
  return {
    total,
    ready,
    needsAttention: total - ready,
    expired: materials.filter((material) => materialEffectiveStatus(material, nowMs) === "expired").length,
    restricted: materials.filter((material) => material.accessLevel === "restricted").length,
    withExplicitGrants: materials.filter((material) => (material.accessGrants ?? []).length > 0).length,
  };
}

function canAccessMeetingMaterial(
  material: any,
  context: AccessSubjectContext,
  requiredAccess = "view",
) {
  if (!material || materialEffectiveStatus(material) === "withdrawn") return false;
  if (roleCanBypass(context.userRole)) return true;
  if (hasExplicitGrant(material, context, requiredAccess)) return true;
  return broadAccessAllows(material.accessLevel, context);
}

function hasExplicitGrant(
  material: any,
  context: AccessSubjectContext,
  requiredAccess = "view",
) {
  const requiredRank = ACCESS_RANK[requiredAccess] ?? ACCESS_RANK.view;
  return normalizeAccessGrants(material?.accessGrants).some((grant) => {
    const grantRank = ACCESS_RANK[grant.access] ?? ACCESS_RANK.view;
    return grantRank >= requiredRank && grantMatchesContext(grant, context);
  });
}

function grantMatchesContext(grant: any, context: AccessSubjectContext) {
  const subjectId = grant.subjectId ? String(grant.subjectId) : "";
  const subjectLabel = normalizeLabel(grant.subjectLabel);
  if (grant.subjectType === "user") return !!subjectId && subjectId === String(context.userId ?? "");
  if (grant.subjectType === "member") return !!subjectId && subjectId === String(context.memberId ?? "");
  if (grant.subjectType === "director") return !!subjectId && subjectId === String(context.directorId ?? "");
  if (grant.subjectType === "committee") return !!subjectId && (context.committeeIds ?? []).map(String).includes(subjectId);
  if (grant.subjectType === "attendee") {
    return (context.attendeeNames ?? []).some((name) => normalizeLabel(name) === subjectLabel);
  }
  if (grant.subjectType === "group") {
    return (context.groups ?? []).some((name) => normalizeLabel(name) === subjectLabel);
  }
  return false;
}

function broadAccessAllows(accessLevel: string | undefined, context: AccessSubjectContext) {
  if (accessLevel === "public") return true;
  if (accessLevel === "members") return !!context.memberId || roleAtLeast(context.userRole, "Member");
  if (accessLevel === "committee") return (context.committeeIds ?? []).length > 0 || roleAtLeast(context.userRole, "Director");
  if (accessLevel === "board") return !!context.directorId || roleAtLeast(context.userRole, "Director");
  if (accessLevel === "restricted") return false;
  return roleAtLeast(context.userRole, "Director");
}

function roleCanBypass(role: string | null | undefined) {
  return role === "Owner" || role === "Admin";
}

function roleAtLeast(role: string | null | undefined, required: "Viewer" | "Member" | "Director" | "Admin" | "Owner") {
  const ranks: Record<string, number> = {
    Viewer: 20,
    Member: 40,
    Director: 60,
    Admin: 80,
    Owner: 100,
  };
  return (ranks[role ?? ""] ?? 0) >= ranks[required];
}

function normalizeLabel(value: string) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function documentAccessContextFromUser(user: any, committeeIds: string[] = []): AccessSubjectContext {
  return {
    userId: user?._id ? String(user._id) : undefined,
    userRole: user?.role,
    memberId: user?.memberId ? String(user.memberId) : undefined,
    directorId: user?.directorId ? String(user.directorId) : undefined,
    committeeIds,
  };
}

async function documentAccessContextForActor(
  ctx: PortableQueryCtx | PortableMutationCtx,
  societyId: any,
  actingUserId?: any,
): Promise<AccessSubjectContext | null> {
  const userId = await principalUserId(ctx, String(societyId));
  if (actingUserId && String(actingUserId) !== userId) {
    throw new Error("Authenticated actor does not match the current principal.");
  }
  const user = await getOwned(ctx, "users", userId, String(societyId));

  const committeeRows = await ctx.db
    .query("committeeMembers")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const committeeIds = committeeRows
    .filter((row: Record<string, any>) =>
      (user.memberId && String(row.memberId ?? "") === String(user.memberId)) ||
      (user.directorId && String(row.directorId ?? "") === String(user.directorId)) ||
      normalizeDocLabel(row.email ?? "") === normalizeDocLabel(user.email ?? "") ||
      normalizeDocLabel(row.name ?? "") === normalizeDocLabel(user.displayName ?? ""),
    )
    .map((row: Record<string, any>) => String(row.committeeId));

  return documentAccessContextFromUser(user, Array.from(new Set(committeeIds)));
}

function normalizeDocLabel(value: string) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9@.]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

// --- Portable copy of convex/lib/agendaItems.ts (ctx.db-only) ----------------

type AgendaEntry = { title: string; depth: 0 | 1 };

async function readMeetingAgendaItems(ctx: PortableQueryCtx, meetingId: string): Promise<any[]> {
  const agendas = await ctx.db
    .query("agendas")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  agendas.sort((a: any, b: any) => a.createdAtISO.localeCompare(b.createdAtISO));
  const agenda = agendas[0];
  if (!agenda) return [];
  const items = await ctx.db
    .query("agendaItems")
    .withIndex("by_agenda", (q) => q.eq("agendaId", agenda._id))
    .collect();
  items.sort((a: any, b: any) => a.order - b.order);
  return items;
}

async function readMeetingAgendaEntries(ctx: PortableQueryCtx, meetingId: string): Promise<AgendaEntry[]> {
  const items = await readMeetingAgendaItems(ctx, meetingId);
  return items
    .map((item: any) => ({
      title: String(item.title ?? "").trim(),
      depth: item.depth === 1 ? (1 as const) : (0 as const),
    }))
    .filter((entry: AgendaEntry) => entry.title);
}

// ----- queries --------------------------------------------------------------

export async function listForMeetingPortable(
  ctx: PortableQueryCtx,
  { meetingId, actingUserId }: { meetingId: string; actingUserId?: string },
) {
  const candidate = await ctx.db.get(meetingId, "meetings");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("meetings not found.");
  const societyId = candidate.societyId;
  await requireSocietyMembership(ctx, societyId);
  const meeting = await getOwned(ctx, "meetings", meetingId, societyId);
  const materials = await ctx.db
    .query("meetingMaterials")
    .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
    .collect();
  const accessContext = await documentAccessContextForActor(ctx, meeting.societyId, actingUserId);
  const visibleMaterials = materials.filter((material) => canAccessMeetingMaterial(material, accessContext!));
  const rows = await Promise.all(
    visibleMaterials.map(async (material) => ({
      ...material,
      document: await getOwned(ctx, "documents", String(material.documentId), societyId),
    })),
  );
  return rows.sort((a: any, b: any) => a.order - b.order || String(a.createdAtISO).localeCompare(String(b.createdAtISO)));
}

export async function packageForMeetingPortable(
  ctx: PortableQueryCtx,
  { meetingId, actingUserId }: { meetingId: string; actingUserId?: string },
) {
  const candidate = await ctx.db.get(meetingId, "meetings");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("meetings not found.");
  const societyId = candidate.societyId;
  await requireSocietyMembership(ctx, societyId);
  const meeting = await getOwned(ctx, "meetings", meetingId, societyId);

  const [materials, minutes, tasks] = await Promise.all([
    ctx.db
      .query("meetingMaterials")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect(),
    ctx.db
      .query("minutes")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .first(),
    ctx.db
      .query("tasks")
      .withIndex("by_meeting", (q) => q.eq("meetingId", meetingId))
      .collect(),
  ]);
  const accessContext = await documentAccessContextForActor(ctx, meeting.societyId, actingUserId);
  const visibleMaterials = materials.filter((material) => canAccessMeetingMaterial(material, accessContext!));

  const materialRows = await Promise.all(
    visibleMaterials.map(async (material) => {
      const document = await getOwned(ctx, "documents", String(material.documentId), societyId);
      const downloadUrl = document?.storageId
        ? (await ctx.capabilities.storage.getDownloadUrl({ storageKey: String(document.storageId) })).url
        : null;
      return {
        ...material,
        document: document ? { ...document, downloadUrl } : document,
      };
    }),
  );

  const agenda = (await readMeetingAgendaEntries(ctx, meetingId)).map((entry) => entry.title);
  const visibleMaterialSummary = summarizeMeetingMaterials(visibleMaterials);
  return {
    meeting,
    minutes,
    agenda,
      materials: materialRows
      .filter((row: any) => row.document)
      .sort((a: any, b: any) => a.order - b.order || String(a.createdAtISO).localeCompare(String(b.createdAtISO))),
    tasks: tasks.sort((a, b) => String(a.dueDate ?? "").localeCompare(String(b.dueDate ?? ""))),
    counts: {
      agendaItems: agenda.length,
      materials: materials.length,
      visibleMaterials: visibleMaterials.length,
      requiredMaterials: visibleMaterials.filter((row) => row.requiredForMeeting).length,
      readyMaterials: visibleMaterialSummary.ready,
      attentionMaterials: visibleMaterialSummary.needsAttention,
      expiredMaterials: visibleMaterialSummary.expired,
      restrictedMaterials: visibleMaterialSummary.restricted,
      explicitGrantMaterials: visibleMaterialSummary.withExplicitGrants,
      openTasks: tasks.filter((task) => task.status !== "Done").length,
    },
  };
}

export async function listForSocietyPortable(
  ctx: PortableQueryCtx,
  { societyId, actingUserId }: { societyId: string; actingUserId?: string },
) {
  await requireSocietyMembership(ctx, societyId);
  const materials = await ctx.db
    .query("meetingMaterials")
    .withIndex("by_society", (q) => q.eq("societyId", societyId))
    .collect();
  const accessContext = await documentAccessContextForActor(ctx, societyId, actingUserId);
  const visibleMaterials = materials.filter((material) => canAccessMeetingMaterial(material, accessContext!));
  const rows = await Promise.all(
    visibleMaterials.map(async (material) => ({
      ...material,
      document: await getOwned(ctx, "documents", String(material.documentId), societyId),
      meeting: await getOwned(ctx, "meetings", String(material.meetingId), societyId),
    })),
  );
  return rows.sort((a, b) => String(b.meeting?.scheduledAt ?? "").localeCompare(String(a.meeting?.scheduledAt ?? "")));
}

// ----- mutations ------------------------------------------------------------

export async function attachPortable(ctx: PortableMutationCtx, args: any) {
  await requireSocietyMembership(ctx, String(args.societyId));
  const [meeting, document] = await Promise.all([
    getOwned(ctx, "meetings", String(args.meetingId), String(args.societyId)),
    getOwned(ctx, "documents", String(args.documentId), String(args.societyId)),
  ]);
  if (args.id) await getOwned(ctx, "meetingMaterials", String(args.id), String(args.societyId));
  for (const grant of normalizeAccessGrants(args.accessGrants)) {
    const table = grant.subjectType === "user"
      ? "users"
      : grant.subjectType === "member"
        ? "members"
        : grant.subjectType === "director"
          ? "directors"
          : grant.subjectType === "committee"
            ? "committees"
            : null;
    if (table && grant.subjectId) {
      await getOwned(ctx, table, grant.subjectId, String(args.societyId));
    }
  }

  const existing = await ctx.db
    .query("meetingMaterials")
    .withIndex("by_meeting", (q) => q.eq("meetingId", args.meetingId))
    .collect();
  const same = existing.find((row) => String(row.documentId) === String(args.documentId));
  const target = args.id ? existing.find((row) => row._id === args.id) : same;
  const patch = {
    documentId: args.documentId,
    agendaLabel: args.agendaLabel || undefined,
    label: args.label || undefined,
    order: args.order ?? target?.order ?? existing.length + 1,
    requiredForMeeting: args.requiredForMeeting ?? target?.requiredForMeeting ?? true,
    accessLevel: args.accessLevel ?? target?.accessLevel ?? "board",
    accessGrants: args.accessGrants ? normalizeAccessGrants(args.accessGrants) : target?.accessGrants ?? [],
    availabilityStatus: args.availabilityStatus ?? target?.availabilityStatus ?? "available",
    syncStatus: args.syncStatus ?? target?.syncStatus ?? "online",
    expiresAtISO: args.expiresAtISO === undefined ? target?.expiresAtISO : args.expiresAtISO || undefined,
    notes: args.notes || undefined,
  };

  if (args.id) {
    if (!target) throw new Error("Meeting material not found.");
    await ctx.db.patch(args.id, patch);
    await ctx.db.patch(args.documentId, {
      meetingId: args.meetingId,
      librarySection: document.librarySection ?? "meeting_material",
      reviewStatus: document.reviewStatus ?? "in_review",
    });
    return args.id;
  }

  if (same) {
    await ctx.db.patch(same._id, patch);
    return same._id;
  }

  const id = await ctx.db.insert("meetingMaterials", {
    societyId: args.societyId,
    meetingId: args.meetingId,
    ...patch,
    createdAtISO: new Date().toISOString(),
  });
  await ctx.db.patch(args.documentId, {
    meetingId: args.meetingId,
    librarySection: document.librarySection ?? "meeting_material",
    reviewStatus: document.reviewStatus ?? "in_review",
  });
  return id;
}

export async function setAvailabilityPortable(
  ctx: PortableMutationCtx,
  { id, availabilityStatus, syncStatus, expiresAtISO }: {
    id: string;
    availabilityStatus: string;
    syncStatus?: string;
    expiresAtISO?: string;
  },
) {
  const candidate = await ctx.db.get(id, "meetingMaterials");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("meetingMaterials not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "meetingMaterials", id, candidate.societyId);
  await ctx.db.patch(id, {
    availabilityStatus,
    syncStatus: syncStatus ?? undefined,
    expiresAtISO: expiresAtISO || undefined,
  });
}

export async function removePortable(ctx: PortableMutationCtx, { id }: { id: string }) {
  const candidate = await ctx.db.get(id, "meetingMaterials");
  if (!candidate || typeof candidate.societyId !== "string") throw new Error("meetingMaterials not found.");
  await requireSocietyMembership(ctx, candidate.societyId);
  await getOwned(ctx, "meetingMaterials", id, candidate.societyId);
  await ctx.db.delete(id);
}
